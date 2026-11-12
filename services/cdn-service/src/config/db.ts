import { Pool } from 'pg';
import { env } from './env';
import { supabase } from './supabase';

// Determine if connection requires SSL (e.g. Supabase, Render, or sslmode=require)
const isCloudPostgres =
  Boolean(env.databaseUrl) &&
  (env.databaseUrl.includes('supabase.co') ||
    env.databaseUrl.includes('pooler.supabase.com') ||
    env.databaseUrl.includes('sslmode=require') ||
    env.databaseUrl.includes('render.com'));

export const db = new Pool({
  connectionString: env.databaseUrl,
  ssl: isCloudPostgres ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Prevent unhandled errors on idle clients from crashing the server process
db.on('error', (err) => {
  console.error('[PostgreSQL Pool Error (CDN)]: Unexpected error on idle client:', err.message);
});

/**
 * ทดสอบการเชื่อมต่อฐานข้อมูล (Health Check & Diagnostics)
 * รองรับทั้งการเชื่อมต่อผ่าน PostgreSQL Pool (DATABASE_URL) และ Supabase Client (SUPABASE_URL + SUPABASE_KEY)
 */
export async function testDbConnection(): Promise<{ ok: boolean; message: string }> {
  if (env.databaseUrl) {
    try {
      const client = await db.connect();
      try {
        await client.query('SELECT 1');
        return { ok: true, message: 'Database connection successful (PostgreSQL Pool)' };
      } finally {
        client.release();
      }
    } catch (err: any) {
      if (supabase) {
        const { error } = await supabase.from('models').select('id', { count: 'exact', head: true });
        if (!error) {
          return { ok: true, message: 'Database connection successful (Supabase REST Client)' };
        }
      }
      const errorMsg = err?.message || 'Unknown database connection error';
      return { ok: false, message: `Database connection failed: ${errorMsg}` };
    }
  }

  if (supabase) {
    const { error } = await supabase.from('models').select('id', { count: 'exact', head: true });
    if (!error) {
      return { ok: true, message: 'Database connection successful (Supabase REST Client)' };
    }
    return { ok: false, message: `Supabase connection failed: ${error.message}` };
  }

  return { ok: false, message: 'Neither DATABASE_URL nor SUPABASE_URL is configured in .env' };
}
