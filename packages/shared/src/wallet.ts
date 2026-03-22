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

/** Checkout-only; InstaPay uses POST /api/wallet/deposits/instapay */
export type DepositMethod = 'crypto' | 'card' | 'instapay';

export type CreateDepositCheckoutBody = {
  amount: number;
  currency?: string;
  method: 'crypto' | 'card';
  payCurrency?: string;
  returnUrl?: string;
};

export type DepositCheckoutResponse = {
  checkoutUrl: string;
  orderId: string;
  method: 'crypto' | 'card';
  provider: 'nowpayments';
};

export type SubmitInstapayDepositBody = {
  amountEgp: number;
  proofUploadId: string;
};

export type ManualDepositRequestStatus =
  | 'pending'
  | 'pending_review'
  | 'paid'
  | 'rejected'
  | 'expired'
  | 'failed'
  | 'cancelled';

export type ManualDepositRequest = {
  id: string;
  userId: string;
  amountEgp: number;
  currency: string;
  orderId: string;
  status: ManualDepositRequestStatus;
  provider: string;
  proofUploadId: string | null;
  destinationAccountSnapshot: Record<string, unknown>;
  reviewedAt: string | null;
  rejectionReason: string | null;
  creditedAmountEgp: number | null;
  rateSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalRequestStatus =
  | 'pending_verification'
  | 'processing'
  | 'awaiting_transfer'
  | 'finished'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'blocked';

export type WithdrawalMethod = 'crypto' | 'instapay';

export type WithdrawalRequest = {
  id: string;
  userId: string;
  walletId: string;
  holdId: string | null;
  /** EGP deducted from wallet (hold) */
  sourceAmountEgp: number;
  sourceCurrency: string;
  method: WithdrawalMethod;
  /** Crypto payout ticker when method is crypto */
  destinationCurrency: string;
  destinationCryptoAmount: number | null;
  payoutAddress: string | null;
  payoutExtraId: string | null;
  instapayRecipient: string | null;
  adminProofUploadId: string | null;
  rateSnapshot: Record<string, unknown>;
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
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWithdrawalRequestBody = {
  method: WithdrawalMethod;
  /** EGP amount to withdraw from wallet */
  amountEgp: number;
  /** Crypto method: payout currency (e.g. USDTTRC20) */
  currency?: string;
  address?: string;
  extraId?: string;
  saveAddress?: boolean;
  /** InstaPay method: recipient phone/account */
  instapayRecipient?: string;
  saveInstapayRecipient?: boolean;
};

export type WithdrawalQuoteResponse = {
  amountEgp: number;
  payoutCurrency: string;
  quotedCryptoAmount: number;
  rateSnapshot: Record<string, unknown>;
};
