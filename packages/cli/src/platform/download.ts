export interface DownloadOptions {
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly fetcher?: (input: string, init: RequestInit) => Promise<Response>;
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function downloadBytes(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(retryDelayMs * attempt);
    }
  }

  throw lastError;
}
