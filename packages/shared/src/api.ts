export type HealthResponse = {
  ok: true;
  /** Present when DATABASE_URL is set; true if DB ping succeeded, false otherwise */
  database?: boolean;
};

export type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

export type ApiSuccessBody<T> = {
  ok: true;
  data: T;
};
