export type HealthResponse = {
  ok: true;
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
