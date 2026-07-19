// 服务端的 SSE 路由通过 Last-Event-ID 请求头决定从哪一条事件继续推送。
// 原生 EventSource 只会在“它自己断线重连”时补上该请求头，页面刷新后新建的连接
// 一律从头订阅，无法续传，因此这里用 fetch + ReadableStream 自行解析 SSE 帧。

export interface ServerSentMessage {
  id?: string;
  event: string;
  data: string;
}

interface StreamOptions {
  lastEventId?: string;
  signal: AbortSignal;
  onMessage: (message: ServerSentMessage) => void;
}

function parseFrame(frame: string): ServerSentMessage | null {
  const message: ServerSentMessage = { event: 'message', data: '' };
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'id') message.id = value;
    else if (field === 'event') message.event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return { ...message, data: data.join('\n') };
}

/** 订阅一个 SSE 端点，直到流结束或 signal 被中止。 */
export async function streamServerEvents(url: string, options: StreamOptions): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      ...(options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : {}),
    },
    signal: options.signal,
  });
  if (!response.ok || !response.body) throw new Error(`事件流订阅失败：${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const message = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (message) options.onMessage(message);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
