import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { StorageAdapter, ByteRange } from './storage.interface';
import { supabase } from '../config/supabase';
import { db } from '../config/db';
import { env } from '../config/env';

let bucketInitialized = false;

export async function ensureSupabaseModelsBucket(bucketName: string): Promise<void> {
  if (bucketInitialized || !supabase) return;
  bucketInitialized = true;

  // 1. Try creating bucket + RLS policies via PostgreSQL Pool if connected
  if (env.databaseUrl) {
    try {
      await db.query(
        `INSERT INTO storage.buckets (id, name, public)
         VALUES ($1, $1, true)
         ON CONFLICT (id) DO UPDATE SET public = true`,
        [bucketName],
      );
      await db.query(`
        DO $$ BEGIN
          CREATE POLICY "Public Read Access for models bucket" ON storage.objects FOR SELECT USING (bucket_id = '${bucketName}');
        EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN
          CREATE POLICY "Allow Uploads to models bucket" ON storage.objects FOR INSERT WITH CHECK (bucket_id = '${bucketName}');
        EXCEPTION WHEN duplicate_object THEN null; END $$;
        DO $$ BEGIN
          CREATE POLICY "Allow Updates on models bucket" ON storage.objects FOR UPDATE USING (bucket_id = '${bucketName}') WITH CHECK (bucket_id = '${bucketName}');
        EXCEPTION WHEN duplicate_object THEN null; END $$;
      `);
      return;
    } catch {
      // Ignore if DATABASE_URL pool is not connected as superuser; fall through to storage API
    }
  }

  // 2. Try creating bucket via Supabase Storage API (succeeds when using service_role key)
  try {
    await supabase.storage.createBucket(bucketName, { public: true });
  } catch {
    // Ignore if bucket already exists or anon key is used
  }
}

export async function uploadBufferToSupabaseBucket(
  bucketName: string,
  hashKey: string,
  fileBuffer: Buffer,
): Promise<boolean> {
  if (!supabase) return false;
  await ensureSupabaseModelsBucket(bucketName);

  const cleanKey = path.basename(hashKey);
  const contentType = cleanKey.endsWith('.glb')
    ? 'model/gltf-binary'
    : cleanKey.endsWith('.webp')
      ? 'image/webp'
      : 'application/octet-stream';

  const { error } = await supabase.storage.from(bucketName).upload(cleanKey, fileBuffer, {
    upsert: true,
    contentType,
  });

  if (error) {
    console.warn(
      `[SupabaseStorage] Could not upload "${cleanKey}" to bucket "${bucketName}": ${error.message}. ` +
        `Run Section 8 of supabase/schema.sql in Supabase SQL Editor (or set SUPABASE_KEY to service_role key) to enable bucket writes.`,
    );
    return false;
  }

  console.log(`[SupabaseStorage] Stored "${cleanKey}" in Supabase bucket "${bucketName}"`);
  return true;
}

export class SupabaseStorage implements StorageAdapter {
  private bucket = env.supabaseStorageBucket || 'models';
  private localCacheDir = path.resolve(env.storageDir);

  private resolveLocalCachePath(hashKey: string): string {
    return path.join(this.localCacheDir, path.basename(hashKey));
  }

  async put(hashKey: string, tempFilePath: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const fileBuffer = await fsp.readFile(tempFilePath);

    // 1. Upload to Supabase Storage bucket ('models')
    await uploadBufferToSupabaseBucket(this.bucket, hashKey, fileBuffer);

    // 2. Also keep a copy in local storage_data/ for fast streaming & fallback
    await fsp.mkdir(this.localCacheDir, { recursive: true });
    await fsp.writeFile(this.resolveLocalCachePath(hashKey), fileBuffer);
    await fsp.unlink(tempFilePath).catch(() => undefined);
  }

  async getStream(hashKey: string, range?: ByteRange): Promise<{ stream: Readable; size: number }> {
    const cleanKey = path.basename(hashKey);

    if (supabase) {
      const { data, error } = await supabase.storage.from(this.bucket).download(cleanKey);
      if (!error && data) {
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const totalSize = buffer.length;

        let targetBuffer = buffer;
        if (range) {
          const start = Math.max(0, range.start);
          const end = Math.min(totalSize - 1, range.end);
          targetBuffer = buffer.subarray(start, end + 1);
        }

        return { stream: Readable.from(targetBuffer), size: totalSize };
      }
    }

    // Fallback to local cache if object is not yet in Supabase bucket
    const localPath = this.resolveLocalCachePath(cleanKey);
    const stat = await fsp.stat(localPath);
    const stream = fs.createReadStream(localPath, range ? { start: range.start, end: range.end } : undefined);
    return { stream, size: stat.size };
  }

  async delete(hashKey: string): Promise<void> {
    const cleanKey = path.basename(hashKey);
    if (supabase) {
      await supabase.storage.from(this.bucket).remove([cleanKey]).catch(() => undefined);
    }
    await fsp.unlink(this.resolveLocalCachePath(cleanKey)).catch(() => undefined);
  }
}
