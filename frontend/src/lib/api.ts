import { buildProfile, creatorHandle, type CreatorProfile } from './creators';
import { PAGE_SIZE, queryModels } from './pagination';
import { MOCK_MODELS } from './mock-models';
import type { License, Model, ModelsPage, ModelsParams, PurchaseItem, SellerModelItem, SellerSalesSummary } from './types';

export const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL || 'http://localhost:4000';
export const CDN_SERVICE_URL = process.env.NEXT_PUBLIC_CDN_SERVICE_URL || 'http://localhost:4001';
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

// Mock data is merged with real Supabase/API models unless NEXT_PUBLIC_USE_MOCK=false.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapSupabaseRow(row: any): Model | null {
  const owner = Array.isArray(row.users) ? row.users[0] : row.users;
  if (row.hidden_at || row.deleted_at || owner?.suspended_at) return null;

  return {
    id: String(row.id),
    title: String(row.title || 'Untitled Model'),
    creator: String(owner?.display_name || row.creator || 'Creator'),
    description: row.description ? String(row.description) : undefined,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    license: (row.license as License) || 'CC0',
    priceCents: Number(row.price_cents) || 0,
    likeCount: Number(row.like_count) || 0,
    downloadCount: Number(row.download_count) || 0,
    posterUrl: row.poster_hash
      ? `${CDN_SERVICE_URL}/cdn/models/${encodeURIComponent(String(row.id))}/poster.webp`
      : undefined,
  };
}

async function fetchSupabaseModels(): Promise<Model[]> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return [];
  try {
    const select =
      'id,title,description,tags,license,price_cents,download_count,poster_hash,hidden_at,deleted_at,users!models_owner_id_fkey(display_name,suspended_at)';
    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/models?select=${encodeURIComponent(select)}&hidden_at=is.null&deleted_at=is.null&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    return rows.map(mapSupabaseRow).filter((m): m is Model => m !== null);
  } catch {
    return [];
  }
}

async function fetchSupabaseModelById(id: string): Promise<Model | null> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !UUID_RE.test(id)) return null;
  try {
    const select =
      'id,title,description,tags,license,price_cents,download_count,poster_hash,hidden_at,deleted_at,users!models_owner_id_fkey(display_name,suspended_at)';
    const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/models?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as any[];
    if (!rows.length) return null;
    return mapSupabaseRow(rows[0]);
  } catch {
    return null;
  }
}

/** List models for the gallery (paged, real uploaded models from Supabase + mock catalogue). */
export async function fetchModels(params: ModelsParams): Promise<ModelsPage> {
  const supabaseModels = await fetchSupabaseModels();

  if (USE_MOCK) {
    const combined = [...supabaseModels, ...MOCK_MODELS];
    return queryModels(combined, params);
  }

  try {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));

    const res = await fetch(`${CORE_API_URL}/api/models?${sp}`, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as Partial<ModelsPage>;
      if (data.items && data.items.length > 0) {
        return {
          items: data.items,
          page: data.page ?? 1,
          pageSize: data.pageSize ?? PAGE_SIZE,
          total: data.total ?? data.items.length,
        };
      }
    }
  } catch {
    // Fall through to Supabase models
  }

  return queryModels(supabaseModels, params);
}

/** One model for its detail page, or `null` when it does not exist. */
export async function fetchModel(id: string): Promise<Model | null> {
  if (UUID_RE.test(id)) {
    const fromSupabase = await fetchSupabaseModelById(id);
    if (fromSupabase) return fromSupabase;

    try {
      const res = await fetch(`${CORE_API_URL}/api/models/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data && data.id && data.title !== 'Sample 3D Asset') {
          return data as Model;
        }
      }
    } catch {
      // Ignore if core-api is offline
    }
  }

  if (USE_MOCK) return MOCK_MODELS.find((m) => m.id === id) ?? null;
  return null;
}

/** Other models by the same creator (most popular first), for the "More from" row. */
export async function fetchMoreFromCreator(model: Model, limit = 4): Promise<Model[]> {
  const supabaseModels = await fetchSupabaseModels();
  const pool = USE_MOCK ? [...supabaseModels, ...MOCK_MODELS] : supabaseModels;
  return queryModels(
    pool.filter((m) => m.creator === model.creator && m.id !== model.id),
    {},
    limit,
  ).items;
}

/** A creator profile by handle (see `creatorHandle`), or `null` when nobody has that handle. */
export async function fetchCreator(handle: string): Promise<CreatorProfile | null> {
  const supabaseModels = await fetchSupabaseModels();
  const pool = USE_MOCK ? [...supabaseModels, ...MOCK_MODELS] : supabaseModels;
  const mine = pool.filter((m) => creatorHandle(m.creator) === handle);
  if (mine.length > 0) return buildProfile(mine[0].creator, mine);

  if (!USE_MOCK) {
    try {
      const res = await fetch(`${CORE_API_URL}/api/creators/${encodeURIComponent(handle)}`, { cache: 'no-store' });
      if (res.ok) return (await res.json()) as CreatorProfile;
    } catch {
      return null;
    }
  }
  return null;
}

/** Fetch purchases for the currently logged-in user (`GET /api/me/purchases`). */
export async function fetchMyPurchases(token: string): Promise<PurchaseItem[]> {
  const res = await fetch(`${CORE_API_URL}/api/me/purchases`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to fetch purchases (${res.status})`);
  }
  const data = await res.json();
  return data.purchases || [];
}

/** Regenerate embed_key for a purchase (`POST /api/purchases/:id/regenerate-key`). */
export async function regenerateEmbedKey(purchaseId: string, token: string): Promise<{ id: string; embedKey: string }> {
  const res = await fetch(`${CORE_API_URL}/api/purchases/${encodeURIComponent(purchaseId)}/regenerate-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to regenerate key (${res.status})`);
  }
  return res.json();
}

/** Enable seller mode for user (`POST /api/seller/enable`). */
export async function enableSellerMode(token: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/api/seller/enable`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to enable seller mode (${res.status})`);
  }
}

/** Fetch seller status (`GET /api/seller/status`). */
export async function fetchSellerStatus(token: string): Promise<boolean> {
  const res = await fetch(`${CORE_API_URL}/api/seller/status`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.isSeller);
}

/** Fetch seller's own uploaded models (`GET /api/seller/models`). */
export async function fetchSellerModels(token: string): Promise<SellerModelItem[]> {
  const res = await fetch(`${CORE_API_URL}/api/seller/models`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to fetch seller models (${res.status})`);
  }
  const data = await res.json();
  return data.models || [];
}

/** Fetch seller sales summary (`GET /api/seller/sales`). */
export async function fetchSellerSales(token: string): Promise<SellerSalesSummary> {
  const res = await fetch(`${CORE_API_URL}/api/seller/sales`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to fetch seller sales (${res.status})`);
  }
  return res.json();
}

/** Soft delete a model (`DELETE /api/models/:id`). */
export async function deleteModel(modelId: string, token: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/api/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Failed to delete model (${res.status})`);
  }
}
