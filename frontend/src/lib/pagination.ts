// Gallery helpers: search/filter/page params <-> URL, popularity sort and slicing.
import type { License, Model, ModelsPage, ModelsParams } from './types';

export const PAGE_SIZE = 48;

const VALID_TAGS: readonly string[] = ['character', 'vehicle', 'architecture', 'nature', 'sci-fi', 'props', 'abstract', 'animal'];
const VALID_LICENSES: readonly string[] = ['CC0', 'CC-BY', 'CC-BY-NC', 'COMMERCIAL'];

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read Next.js `searchParams` into validated params; anything unknown is dropped. */
export function parseParams(raw: RawParams): ModelsParams {
  const params: ModelsParams = {};

  const q = first(raw.q)?.trim();
  if (q) params.q = q;

  const tag = first(raw.tag)?.trim().toLowerCase();
  if (tag && VALID_TAGS.includes(tag)) {
    params.tag = tag;
  }

  const license = first(raw.license)?.trim().toUpperCase();
  if (license && VALID_LICENSES.includes(license)) {
    params.license = license as License;
  }

  const price = first(raw.price)?.trim().toLowerCase();
  if (price === 'free' || price === 'paid') {
    params.price = price;
  }

  const page = Number.parseInt(first(raw.page) ?? '', 10);
  if (Number.isFinite(page) && page > 1) {
    params.page = page;
  }

  return params;
}

/** `/gallery` or `/gallery?...` (page 1 has no `page` query). */
export function buildHref(params: ModelsParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.tag) sp.set('tag', params.tag);
  if (params.license) sp.set('license', params.license);
  if (params.price) sp.set('price', params.price);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const qs = sp.toString();
  return qs ? `/gallery?${qs}` : '/gallery';
}

/** Filter, sort by popularity (likes, then downloads) and slice one page. The page number is clamped to the last page. */
export function queryModels(models: Model[], params: ModelsParams, pageSize = PAGE_SIZE): ModelsPage {
  const q = params.q?.trim().toLowerCase();
  const filtered = models.filter((m) => {
    if (q) {
      const inTitle = m.title.toLowerCase().includes(q);
      const inDesc = (m.description ?? '').toLowerCase().includes(q);
      const inCreator = m.creator.toLowerCase().includes(q);
      const inTags = m.tags.some((t) => t.toLowerCase().includes(q));
      if (!inTitle && !inDesc && !inCreator && !inTags) return false;
    }
    if (params.tag && !m.tags.includes(params.tag)) return false;
    if (params.license && m.license !== params.license) return false;
    if (params.price === 'free' && m.priceCents !== 0) return false;
    if (params.price === 'paid' && m.priceCents <= 0) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => b.likeCount - a.likeCount || b.downloadCount - a.downloadCount);
  const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, params.page ?? 1), lastPage);
  return { items: sorted.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: sorted.length };
}
