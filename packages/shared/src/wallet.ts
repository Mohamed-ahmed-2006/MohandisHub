// ---------------------------------------------------------------------------
// Wallet & transaction types — shared between API and frontend
// ---------------------------------------------------------------------------

export type Wallet = {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  isFrozen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'payment'
  | 'refund'
  | 'adjustment'
  | 'bonus'
  | 'commission'
  | 'hold'
  | 'release';

export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export type Transaction = {
  id: string;
  walletId: string;
  userId: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  status: TransactionStatus;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
};

export type AdjustBalanceBody = {
  userId: string;
  type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus';
  amount: number;
  description?: string;
};

export type WalletHoldStatus = 'held' | 'released' | 'captured' | 'cancelled';

export type WalletHold = {
  id: string;
  walletId: string;
  userId: string;
  amount: number;
  currency: string;
  status: WalletHoldStatus;
  referenceType: string;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  releasedAt: string | null;
  capturedAt: string | null;
};
