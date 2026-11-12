export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error) return error.message || fallback;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message || fallback;
  return fallback;
}
