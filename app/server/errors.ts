export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function safeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  if (status === 401) return new AppError('authentication', 'The API key was rejected. Check your local OpenAI key configuration.', 401);
  if (status === 403 || status === 404) return new AppError('model_access', 'This model is not available to your OpenAI project. Choose another model explicitly.', 403);
  if (status === 429) return new AppError('rate_limit', 'OpenAI returned a rate or usage limit. Check your project limits, then retry when ready.', 429);
  if (error instanceof Error && error.name === 'AbortError') return new AppError('cancelled', 'Translation cancelled. Unfinished sections remain incomplete.', 499);
  return new AppError('provider_error', 'The request could not finish. Your partial output has been kept. Retry when ready.', 502);
}
