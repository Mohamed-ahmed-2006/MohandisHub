// ---------------------------------------------------------------------------
// Service & category types — shared between API and frontend
// ---------------------------------------------------------------------------

export type ServiceCategory = {
  id: string;
  nameEn: string;
  nameAr: string;
  slug: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateCategoryBody = {
  nameEn: string;
  nameAr: string;
  slug: string;
  descriptionEn?: string;
  descriptionAr?: string;
  icon?: string;
  parentId?: string;
  sortOrder?: number;
};

export type UpdateCategoryBody = Partial<CreateCategoryBody> & {
  isActive?: boolean;
};

export type ServiceStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'paused'
  | 'rejected'
  | 'archived';

export type PriceType = 'fixed' | 'hourly';

export type Service = {
  id: string;
  providerId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  price: number | null;
  priceType: PriceType;
  isNegotiable: boolean;
  currency: string;
  deliveryTimeDays: number | null;
  status: ServiceStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  tags: string[];
  images: string[];
  isFeatured: boolean;
  viewCount: number;
  orderCount: number;
  avgRating: number | null;
  city: string | null;
  area: string | null;
  country: string;
  createdAt: string;
  updatedAt: string;
};

export type ServiceSearchSort =
  | 'newest'
  | 'rating'
  | 'price_asc'
  | 'price_desc'
  | 'completed_count';

export type ServiceSearchParams = {
  categoryId?: string;
  city?: string;
  area?: string;
  providerType?: 'expert' | 'business' | 'craftsman';
  query?: string;
  minRating?: number;
  minPrice?: number;
  maxPrice?: number;
  verifiedOnly?: boolean;
  tags?: string[];
  sort?: ServiceSearchSort;
  page?: number;
  limit?: number;
};

export type CreateServiceBody = {
  title: string;
  description?: string;
  categoryId?: string;
  price?: number;
  priceType?: PriceType;
  isNegotiable?: boolean;
  currency?: string;
  deliveryTimeDays?: number;
  tags?: string[];
  images?: string[];
  city?: string;
  area?: string;
  country?: string;
};

export type UpdateServiceBody = {
  title?: string;
  description?: string;
  categoryId?: string;
  price?: number;
  priceType?: PriceType;
  isNegotiable?: boolean;
  currency?: string;
  deliveryTimeDays?: number;
  tags?: string[];
  images?: string[];
  city?: string;
  area?: string;
  country?: string;
};

export type ServiceSearchResult = {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  providerAvatar: string | null;
  providerVerified: boolean;
  categorySlug: string | null;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
  price: number | null;
  currency: string;
  priceType: PriceType;
  isNegotiable: boolean;
  city: string | null;
  area: string | null;
  avgRating: number | null;
  isFeatured: boolean;
  tags?: string[];
  /** Public gallery URLs (same as `Service.images`); may be empty. */
  images: string[];
};
