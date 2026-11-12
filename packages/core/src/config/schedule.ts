import { Cron } from 'croner';

export function validateSchedule(expression: string, timezone?: string): void {
  if (typeof expression !== 'string' || expression.trim().split(/\s+/).length !== 5) throw new Error('Cron 必须包含 5 个字段');
  try { new Cron(expression, { paused: true, ...(timezone ? { timezone } : {}) }).stop(); }
  catch (error) { throw new Error(`Cron 或时区无效: ${error instanceof Error ? error.message : String(error)}`); }
}
export function nextScheduledRun(expression: string, after: Date, timezone?: string): Date | null {
  validateSchedule(expression, timezone);
  const cron = new Cron(expression, { paused: true, ...(timezone ? { timezone } : {}) });
  try { return cron.nextRun(after); } finally { cron.stop(); }
}
