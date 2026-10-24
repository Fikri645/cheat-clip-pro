export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message || fallback;
  }
  return fallback;
}

export function errorName(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : undefined;
}
