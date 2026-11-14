// Shared frontend types for model listings (mirrors the core-api `GET /api/models` contract)

export const LICENSES = ['CC0', 'CC-BY', 'CC-BY-NC', 'COMMERCIAL'] as const;
export type License = (typeof LICENSES)[number];

export const GALLERY_TAGS = ['character', 'vehicle', 'architecture', 'nature', 'sci-fi', 'props', 'abstract', 'animal'] as const;

export interface Model {
  id: string;
  title: string;
  creator: string;
  tags: string[];
  license: License;
  priceCents: number;
  likeCount: number;
  downloadCount: number;
  posterUrl?: string;
  description?: string;
}

export interface ModelsParams {
  q?: string;
  tag?: string;
  license?: License;
  price?: 'free' | 'paid';
  page?: number;
}

export interface ModelsPage {
  items: Model[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: 'user' | 'creator' | 'admin';
  is_seller: boolean;
}

export interface PurchaseItem {
  id: string;
  modelId: string;
  title: string;
  priceCents: number;
  amountCents: number;
  currency: string;
  licenseType: License | string;
  watermarkHash: string | null;
  embedKey: string;
  paidAt: string;
  purchasedAt: string;
}

export interface SellerModelItem {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  viewCount: number;
  downloadCount: number;
  isHidden: boolean;
  isDeleted: boolean;
  createdAt: string;
}

export interface SellerSalesSummary {
  totalRevenue: number;
  totalSales: number;
  sales: {
    purchaseId: string;
    modelId: string;
    title: string;
    priceCents: number;
    currency: string;
    buyerName: string;
    soldAt: string;
  }[];
}
