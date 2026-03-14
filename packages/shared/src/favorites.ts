// ---------------------------------------------------------------------------
// Favorites (saved providers/services) — shared types
// ---------------------------------------------------------------------------

export type FavoriteTargetType = 'provider' | 'service';

export type Favorite = {
  id: string;
  userId: string;
  targetType: FavoriteTargetType;
  targetId: string;
  createdAt: string;
};

export type AddFavoriteBody = {
  targetType: FavoriteTargetType;
  targetId: string;
};
