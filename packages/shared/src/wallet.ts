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

export type DepositMethod = 'crypto' | 'card';

export type CreateDepositCheckoutBody = {
  amount: number;
  currency?: string;
  method: DepositMethod;
  payCurrency?: string;
  returnUrl?: string;
};

export type DepositCheckoutResponse = {
  checkoutUrl: string;
  orderId: string;
  method: DepositMethod;
  provider: 'nowpayments';
};

export type WithdrawalRequestStatus =
  | 'pending_verification'
  | 'processing'
  | 'finished'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'blocked';

export type WithdrawalRequest = {
  id: string;
  userId: string;
  walletId: string;
  holdId: string | null;
  amount: number;
  currency: string;
  payoutAddress: string | null;
  payoutExtraId: string | null;
  status: WithdrawalRequestStatus;
  provider: string;
  providerBatchWithdrawalId: string | null;
  providerWithdrawalId: string | null;
  providerStatus: string | null;
  providerError: string | null;
  verificationRequired: boolean;
  verifiedAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWithdrawalRequestBody = {
  amount: number;
  currency?: string;
  address?: string;
  extraId?: string;
  saveAddress?: boolean;
};
