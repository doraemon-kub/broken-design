// CDN business logic: model lookup, access rules, embed_key check and file streaming.
// Supports both PostgreSQL Pool (db.query) and Supabase REST/Storage (supabase client).
import crypto from "crypto";
import { pipeline } from "stream";
import type { Readable } from "stream";
import type { Request, Response } from "express";
import { db } from "../../config/db";
import { env } from "../../config/env";
import { supabase } from "../../config/supabase";
import { getStorage, LocalDiskStorage, SupabaseStorage } from "../../storage";
import { AppError } from "../../middlewares/error.middleware";
import { parseRangeSpec, resolveRange, type ResolvedRange } from "./range";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
// purchases.embed_key is VARCHAR(64); payments currently issues 48 hex chars.
const EMBED_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const isUuid = (v: string) => UUID_RE.test(v);
export const isContentHash = (v: string) => HASH_RE.test(v);

export interface CdnModel {
  id: string;
  owner_id: string;
  title: string;
  license?: string;
  file_hash: string;
  preview_hash: string | null;
  poster_hash: string | null;
  price_cents: number;
  hidden_at: Date | string | null;
  deleted_at: Date | string | null;
  owner_suspended_at: Date | string | null;
}

export const isPaid = (m: CdnModel) => Number(m.price_cents) > 0;

function normaliseModelRow(row: CdnModel): CdnModel {
  row.file_hash = row.file_hash?.trim();
  row.preview_hash = row.preview_hash?.trim() || null;
  row.poster_hash = row.poster_hash?.trim() || null;
  row.price_cents = Number(row.price_cents) || 0;
  return row;
}

/** Load a model plus its owner's suspension state. 404 for malformed ids or unknown models. */
export async function loadModel(id: string): Promise<CdnModel> {
  if (!isUuid(id))
    throw new AppError(404, "MODEL_NOT_FOUND", "Model not found");

  let row: CdnModel | undefined;
  try {
    const result = await db.query(
      `SELECT m.id, m.owner_id, m.title, m.license, m.file_hash, m.preview_hash, m.poster_hash,
              m.price_cents, m.hidden_at, m.deleted_at, u.suspended_at AS owner_suspended_at
         FROM models m
         JOIN users u ON u.id = m.owner_id
        WHERE m.id = $1`,
      [id],
    );
    row = result.rows[0] as CdnModel | undefined;
  } catch (err) {
    if (!supabase) throw err;
    const { data, error } = await supabase
      .from("models")
      .select(
        "id, owner_id, title, license, file_hash, preview_hash, poster_hash, price_cents, hidden_at, deleted_at, users!models_owner_id_fkey(suspended_at)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw err;
    if (data) {
      const ownerRel = Array.isArray((data as any).users)
        ? (data as any).users[0]
        : (data as any).users;
      row = {
        id: data.id,
        owner_id: data.owner_id,
        title: data.title,
        license: (data as any).license,
        file_hash: data.file_hash,
        preview_hash: data.preview_hash,
        poster_hash: data.poster_hash,
        price_cents: data.price_cents,
        hidden_at: data.hidden_at,
        deleted_at: data.deleted_at,
        owner_suspended_at: ownerRel?.suspended_at ?? null,
      };
    }
  }

  if (!row) throw new AppError(404, "MODEL_NOT_FOUND", "Model not found");
  return normaliseModelRow(row);
}

/**
 * Hidden models and models whose owner is suspended stop being served immediately — for everyone, buyers included.
 * Soft-deleted models are only served to people who bought them (`allowDeleted`).
 */
export function assertServable(
  model: CdnModel,
  opts: { allowDeleted?: boolean } = {},
): void {
  if (model.hidden_at || model.owner_suspended_at) {
    throw new AppError(
      403,
      "MODEL_UNAVAILABLE",
      "This model is currently unavailable",
    );
  }
  if (model.deleted_at && !opts.allowDeleted) {
    throw new AppError(404, "MODEL_NOT_FOUND", "Model not found");
  }
}

export function verifyEmbedKeyConstantTime(
  providedKey: string,
  storedKey: string,
): boolean {
  const a = Buffer.from(providedKey);
  const b = Buffer.from(storedKey);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Throws unless `key` is a paid purchase's embed_key for this model. */
export async function assertValidEmbedKey(
  modelId: string,
  key: unknown,
): Promise<void> {
  if (typeof key !== "string" || key === "") {
    throw new AppError(
      401,
      "KEY_REQUIRED",
      "This is a paid model. Add ?key=YOUR_EMBED_KEY to stream it",
    );
  }
  if (!EMBED_KEY_RE.test(key)) {
    throw new AppError(
      403,
      "INVALID_KEY",
      "Embed key is invalid or has been regenerated",
    );
  }

  let row: { model_id: string; embed_key: string } | undefined;
  try {
    const result = await db.query(
      `SELECT model_id, embed_key FROM purchases WHERE embed_key = $1 AND status = 'paid'`,
      [key],
    );
    row = result.rows[0] as { model_id: string; embed_key: string } | undefined;
  } catch (err) {
    if (!supabase) throw err;
    const { data, error } = await supabase
      .from("purchases")
      .select("model_id, embed_key")
      .eq("embed_key", key)
      .eq("status", "paid")
      .maybeSingle();
    if (error) throw err;
    row = (data as { model_id: string; embed_key: string } | null) ?? undefined;
  }

  // Constant-time compare on the stored value as well (defence in depth on top of the indexed lookup).
  const ok =
    Boolean(row) &&
    row!.model_id === modelId &&
    verifyEmbedKeyConstantTime(key, row!.embed_key.trim());
  if (!ok)
    throw new AppError(
      403,
      "INVALID_KEY",
      "Embed key is invalid or has been regenerated",
    );
}

export interface PaidDownloadAccess {
  purchaseId: string | null;
  licenseType: string | null;
}

/** Paid-model download: owner or a buyer with a `paid` purchase; the downloader must not be suspended. */
export async function assertCanDownloadPaid(
  model: CdnModel,
  userId: string,
): Promise<PaidDownloadAccess> {
  let row:
    | {
        suspended_at: Date | string | null;
        purchased: boolean;
        purchase_id?: string | null;
        license_type?: string | null;
      }
    | undefined;
  try {
    const result = await db.query(
      `SELECT u.suspended_at,
              EXISTS (
                SELECT 1 FROM purchases p
                 WHERE p.user_id = u.id AND p.model_id = $2 AND p.status = 'paid'
              ) AS purchased,
              (
                SELECT p.id FROM purchases p
                 WHERE p.user_id = u.id AND p.model_id = $2 AND p.status = 'paid'
                 LIMIT 1
              ) AS purchase_id,
              (
                SELECT p.license_type FROM purchases p
                 WHERE p.user_id = u.id AND p.model_id = $2 AND p.status = 'paid'
                 LIMIT 1
              ) AS license_type
         FROM users u
        WHERE u.id = $1`,
      [userId, model.id],
    );
    row = result.rows[0] as any;
  } catch (err) {
    if (!supabase) throw err;
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id, suspended_at")
      .eq("id", userId)
      .maybeSingle();
    if (userErr) throw err;
    if (userRow) {
      const { data: purchaseRow } = await supabase
        .from("purchases")
        .select("id, license_type")
        .eq("user_id", userId)
        .eq("model_id", model.id)
        .eq("status", "paid")
        .maybeSingle();
      row = {
        suspended_at: userRow.suspended_at,
        purchased: Boolean(purchaseRow),
        purchase_id: (purchaseRow as any)?.id ?? null,
        license_type: (purchaseRow as any)?.license_type ?? null,
      };
    }
  }

  if (!row) throw new AppError(401, "UNAUTHORIZED", "Account not found");
  if (row.suspended_at)
    throw new AppError(
      403,
      "ACCOUNT_SUSPENDED",
      "Your account has been suspended",
    );
  if (model.owner_id !== userId && !row.purchased) {
    throw new AppError(
      403,
      "PURCHASE_REQUIRED",
      "Buy this model to download it",
    );
  }

  return {
    purchaseId: row.purchase_id ?? null,
    licenseType: row.license_type ?? model.license ?? "COMMERCIAL",
  };
}

export async function savePurchaseWatermarkHash(
  purchaseId: string,
  watermarkHash: string,
): Promise<void> {
  try {
    await db.query(`UPDATE purchases SET watermark_hash = $1 WHERE id = $2`, [
      watermarkHash,
      purchaseId,
    ]);
  } catch (err) {
    if (!supabase) throw err;
    await supabase
      .from("purchases")
      .update({ watermark_hash: watermarkHash })
      .eq("id", purchaseId);
  }
}

export async function readAssetBuffer(storageKey: string): Promise<Buffer> {
  const { stream } = await openStream(storageKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function incrementDownloadCount(modelId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE models SET download_count = download_count + 1 WHERE id = $1`,
      [modelId],
    );
  } catch (err) {
    if (!supabase) throw err;
    const { data } = await supabase
      .from("models")
      .select("download_count")
      .eq("id", modelId)
      .maybeSingle();
    if (data) {
      await supabase
        .from("models")
        .update({ download_count: Number(data.download_count || 0) + 1 })
        .eq("id", modelId);
    }
  }
}

// ─── Streaming ──────────────────────────────────────────────────────────────

export const CONTENT_TYPES = {
  glb: "model/gltf-binary",
  webp: "image/webp",
} as const;

export interface SendAssetOptions {
  storageKey: string; // e.g. `${hash}.glb`
  etag: string; // content hash
  contentType: string;
  cacheControl: string;
  downloadName?: string; // set → Content-Disposition: attachment
}

export interface SendAssetResult {
  status: 200 | 206 | 304;
  range: ResolvedRange | null;
}

function isNotFoundError(err: any): boolean {
  const msg = String(err?.message ?? "");
  return (
    err?.code === "ENOENT" ||
    /not\s*found/i.test(msg) ||
    msg.includes("Supabase Storage download failed")
  );
}

async function openStream(
  storageKey: string,
  range?: { start: number; end: number },
) {
  try {
    return await getStorage().getStream(storageKey, range);
  } catch (primaryErr) {
    // Fallback between LocalDiskStorage and SupabaseStorage if the file exists in the other store
    try {
      if (env.storageProvider === "local" && supabase) {
        return await new SupabaseStorage().getStream(storageKey, range);
      }
      if (env.storageProvider === "supabase") {
        return await new LocalDiskStorage().getStream(storageKey, range);
      }
    } catch {
      // Ignore secondary error and handle primaryErr below
    }
    if (isNotFoundError(primaryErr))
      throw new AppError(404, "FILE_NOT_FOUND", "File not found in storage");
    throw primaryErr;
  }
}

/** ASCII fallback + RFC 5987 UTF-8 filename (titles may be Thai). */
export function contentDisposition(name: string): string {
  const base = name.replace(/[\r\n"\\/]+/g, " ").trim() || "model";
  const ascii =
    base.replace(/[^\x20-\x7e]+/g, "_").replace(/\s+/g, "_") || "model";
  return `attachment; filename="${ascii}.glb"; filename*=UTF-8''${encodeURIComponent(base)}.glb`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

/**
 * Stream a stored file with Range, ETag/304 and caching headers.
 * Only call after access checks have passed — success headers are set here, never earlier.
 */
export async function sendAsset(
  req: Request,
  res: Response,
  opts: SendAssetOptions,
): Promise<SendAssetResult> {
  const etag = `"${opts.etag}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", opts.cacheControl);
  res.setHeader("Accept-Ranges", "bytes");

  if (!opts.downloadName && etagMatches(req.headers["if-none-match"], etag)) {
    res.status(304).end();
    return { status: 304, range: null };
  }

  // If-Range: only honour Range when the client's cached copy is still current.
  const ifRange = req.headers["if-range"];
  const spec =
    ifRange && ifRange !== etag ? null : parseRangeSpec(req.headers.range);

  const unsatisfiable = (size: number): never => {
    res.setHeader("Content-Range", `bytes */${size}`);
    res.setHeader("Cache-Control", "no-store");
    throw new AppError(
      416,
      "RANGE_NOT_SATISFIABLE",
      "Requested range is outside the file",
    );
  };

  let opened: { stream: Readable; size: number };
  let range: ResolvedRange | null = null;

  if (!spec) {
    opened = await openStream(opts.storageKey);
  } else if (spec.kind === "suffix") {
    // "last N bytes" needs the total size first; adapters report it alongside the stream.
    const probe = await openStream(opts.storageKey);
    probe.stream.destroy();
    range = resolveRange(spec, probe.size) ?? unsatisfiable(probe.size);
    opened = await openStream(opts.storageKey, range);
  } else {
    // Open with the requested bounds directly (adapters stop at EOF), then validate against the real size.
    opened = await openStream(opts.storageKey, {
      start: spec.start,
      end: spec.kind === "bounded" ? spec.end : Number.MAX_SAFE_INTEGER,
    });
    range = resolveRange(spec, opened.size);
    if (!range) {
      opened.stream.destroy();
      unsatisfiable(opened.size);
    }
  }
  const { stream, size } = opened;

  res.setHeader("Content-Type", opts.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (opts.downloadName)
    res.setHeader("Content-Disposition", contentDisposition(opts.downloadName));

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
  } else {
    res.status(200);
    res.setHeader("Content-Length", String(size));
  }

  if (req.method === "HEAD") {
    stream.destroy();
    res.end();
    return { status: range ? 206 : 200, range };
  }

  pipeline(stream, res, (err) => {
    // Client aborts (seeking, closing the tab) are normal for media streaming.
    if (err && (err as any).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      console.error("[CDN] stream error:", err.message);
    }
  });
  return { status: range ? 206 : 200, range };
}
