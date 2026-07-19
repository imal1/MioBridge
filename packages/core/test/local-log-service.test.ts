import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalLogService } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'miobridge-local-logs-'));
  roots.push(root);
  const logDir = join(root, 'log');
  await mkdir(logDir);
  return { logDir };
}

describe('LocalLogService', () => {
  it('reads stable log files, detects levels, filters, and tails the aggregate', async () => {
    const { logDir } = await setup();
    await writeFile(join(logDir, 'b.log'), '2026-07-16 WARN later\nplain line\n');
    await writeFile(join(logDir, 'a.log'), '2026-07-16 INFO ready\r\n2026-07-16 ERROR failed\r\n');
    await writeFile(join(logDir, 'ignored.txt'), 'ERROR ignored\n');
    const service = new LocalLogService(logDir, () => new Date('2026-07-16T12:00:00.000Z'));

    const errors = await service.query({ level: 'ERROR' });
    expect(errors).toEqual({
      entries: [{ file: 'a.log', lineNumber: 2, content: '2026-07-16 ERROR failed', level: 'error' }],
      files: ['a.log', 'b.log'],
      updatedAt: '2026-07-16T12:00:00.000Z',
    });
    expect((await service.query({ lines: 2 })).entries.map(entry => entry.content)).toEqual([
      '2026-07-16 WARN later',
      'plain line',
    ]);
  });

  it('returns an empty result for a missing log directory', async () => {
    const { logDir } = await setup();
    await rm(logDir, { recursive: true });
    const service = new LocalLogService(logDir, () => new Date('2026-07-16T12:00:00.000Z'));
    expect(await service.query()).toEqual({ entries: [], files: [], updatedAt: '2026-07-16T12:00:00.000Z' });
  });

  it('follows appended lines and stops when aborted', async () => {
    const { logDir } = await setup();
    const file = join(logDir, 'combined.log');
    await writeFile(file, 'INFO initial\n');
    const controller = new AbortController();
    const iterator = new LocalLogService(logDir, undefined, 5)
      .follow({ lines: 1, level: 'error', signal: controller.signal })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await appendFile(file, 'ERROR appended\n');
    expect((await pending).value?.content).toBe('ERROR appended');
    controller.abort();
    expect((await iterator.next()).done).toBe(true);
  });
});
