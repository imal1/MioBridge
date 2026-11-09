import type { StateStore, MetricsSnapshot } from '@miobridge/core';

export async function recordMetric(state: StateStore, snapshot: MetricsSnapshot): Promise<void> {
  const now = Date.parse(snapshot.timestamp);
  await state.withLock('metrics', async () => {
    const key = `metrics/${snapshot.timestamp.slice(0, 10)}.jsonl`;
    const lines = parseLines(await state.get(key));
    lines.push(snapshot);
    await state.set(key, lines.map(value => JSON.stringify(value)).join('\n') + '\n');
    for (const file of await state.listKeys('metrics/')) {
      const day = file.match(/metrics\/(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1];
      const timestamp = day ? Date.parse(day) : Number(file.match(/metrics\/(\d+)\.json$/)?.[1]);
      if (!Number.isFinite(timestamp)) continue;
      if (timestamp < now - 30 * 86400000) { await state.del(file); continue; }
      if (day && timestamp < now - 7 * 86400000) {
        const hourly = new Map<string, MetricsSnapshot>();
        for (const item of parseLines(await state.get(file))) hourly.set(item.timestamp.slice(0, 13), item);
        await state.set(file, [...hourly.values()].map(value => JSON.stringify(value)).join('\n') + '\n');
      }
    }
  });
}
export async function metricHistory(state: StateStore, cutoff: number): Promise<MetricsSnapshot[]> {
  const result: MetricsSnapshot[] = [];
  for (const key of await state.listKeys('metrics/')) {
    const day = key.match(/metrics\/(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1];
    const timestamp = day ? Date.parse(day) + 86400000 : Number(key.match(/metrics\/(\d+)\.json$/)?.[1]);
    if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
    result.push(...parseLines(await state.get(key)).filter(item => Date.parse(item.timestamp) >= cutoff));
  }
  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
function parseLines(raw: string | null): MetricsSnapshot[] {
  return (raw ?? '').split('\n').flatMap(line => {
    try { const value = JSON.parse(line) as MetricsSnapshot; return Number.isFinite(Date.parse(value.timestamp)) ? [value] : []; }
    catch { return []; }
  });
}
