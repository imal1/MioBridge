export interface DownloadOptions {
  readonly attempts?: number;
  /**
   * 空闲超时：连续这么多毫秒没有收到任何数据才中止本次尝试。
   * 之前是整次下载的总时长上限，结果慢而健康的链路（比如跨境拉 GitHub
   * Release）永远在 120s 处被掐断重来，一次都完不成；停摆和缓慢必须区分。
   */
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly fetcher?: (input: string, init: RequestInit) => Promise<Response>;
  readonly onProgress?: (receivedBytes: number, totalBytes?: number) => void;
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function downloadBytes(url: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // abort 负责撕掉真实网络流；idle promise 负责叫醒 race——测试或代理注入的
    // Response 可能不理会 signal，只靠 abort 的话 read() 会永远悬着。
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire: (() => void) | undefined;
    const idle = new Promise<never>((_, reject) => {
      expire = () => reject(new Error(`Download stalled: no data received for ${timeoutMs}ms`));
    });
    idle.catch(() => undefined); // 正常完成时无人等待这个 promise，不能变成未处理拒绝。
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { controller.abort(); expire?.(); }, timeoutMs);
    };
    try {
      arm();
      const response = await Promise.race([fetcher(url, { redirect: 'follow', signal: controller.signal }), idle]);
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      if (!response.body) {
        const bytes = new Uint8Array(await Promise.race([response.arrayBuffer(), idle]));
        options.onProgress?.(bytes.length, bytes.length);
        return bytes;
      }
      const lengthHeader = response.headers.get('content-length');
      const total = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : undefined;
      const reader = response.body.getReader();
      try {
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await Promise.race([reader.read(), idle]);
          if (done) break;
          arm();
          received += value.byteLength;
          chunks.push(value);
          options.onProgress?.(received, total);
        }
        const data = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
        return data;
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        options.onRetry?.(attempt, error);
        await delay(retryDelayMs * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
