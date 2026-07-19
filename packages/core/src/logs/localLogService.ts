import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface LocalLogQuery {
  readonly lines?: number;
  readonly level?: string;
  readonly signal?: AbortSignal;
}

export interface LocalLogEntry {
  readonly file: string;
  readonly lineNumber: number;
  readonly content: string;
  readonly level?: string;
}

export interface LocalLogResult {
  readonly entries: LocalLogEntry[];
  readonly files: string[];
  readonly updatedAt: string;
}

interface LogSnapshot {
  readonly entries: LocalLogEntry[];
  readonly files: string[];
  readonly byFile: ReadonlyMap<string, readonly LocalLogEntry[]>;
}

const DEFAULT_LINES = 200;
const DEFAULT_POLL_INTERVAL_MS = 250;
const LEVEL_PATTERN = /(?:^|[^a-z])(debug|info|warn(?:ing)?|error)(?=$|[^a-z])/iu;

function errno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function normalizeLevel(level: string | undefined): string | undefined {
  const normalized = level?.trim().toLowerCase();
  if (!normalized || normalized === 'all') return undefined;
  return normalized === 'warning' ? 'warn' : normalized;
}

function detectLevel(content: string): string | undefined {
  const match = LEVEL_PATTERN.exec(content)?.[1]?.toLowerCase();
  return match === 'warning' ? 'warn' : match;
}

function lineLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LINES;
  if (!Number.isFinite(value)) return DEFAULT_LINES;
  return Math.max(0, Math.floor(value));
}

function filterEntries(entries: readonly LocalLogEntry[], level: string | undefined): LocalLogEntry[] {
  const expected = normalizeLevel(level);
  return expected ? entries.filter(entry => entry.level === expected) : [...entries];
}

function tail(entries: readonly LocalLogEntry[], limit: number): LocalLogEntry[] {
  if (limit === 0) return [];
  return entries.length > limit ? entries.slice(-limit) : [...entries];
}

export class LocalLogService {
  constructor(
    private readonly logDir: string,
    private readonly now: () => Date = () => new Date(),
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  async query(options: LocalLogQuery = {}): Promise<LocalLogResult> {
    const snapshot = await this.snapshot();
    return {
      entries: tail(filterEntries(snapshot.entries, options.level), lineLimit(options.lines)),
      files: snapshot.files,
      updatedAt: this.now().toISOString(),
    };
  }

  async *follow(options: LocalLogQuery = {}): AsyncIterable<LocalLogEntry> {
    if (options.signal?.aborted) return;

    let previous = await this.snapshot();
    const initial = tail(filterEntries(previous.entries, options.level), lineLimit(options.lines));
    for (const entry of initial) {
      if (options.signal?.aborted) return;
      yield entry;
    }

    while (!options.signal?.aborted) {
      await this.waitForPoll(options.signal);
      if (options.signal?.aborted) return;

      const current = await this.snapshot();
      for (const file of current.files) {
        const before = previous.byFile.get(file) ?? [];
        const after = current.byFile.get(file) ?? [];
        let unchangedPrefix = 0;
        while (
          unchangedPrefix < before.length
          && unchangedPrefix < after.length
          && before[unchangedPrefix]?.content === after[unchangedPrefix]?.content
        ) unchangedPrefix += 1;

        for (const entry of filterEntries(after.slice(unchangedPrefix), options.level)) {
          if (options.signal?.aborted) return;
          yield entry;
        }
      }
      previous = current;
    }
  }

  private async snapshot(): Promise<LogSnapshot> {
    let files: string[];
    try {
      const entries = await readdir(this.logDir, { withFileTypes: true });
      files = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.log'))
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if (errno(error, 'ENOENT')) return { entries: [], files: [], byFile: new Map() };
      throw error;
    }

    const byFile = new Map<string, readonly LocalLogEntry[]>();
    const combined: LocalLogEntry[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = await readFile(join(this.logDir, file), 'utf8');
      } catch (error) {
        if (errno(error, 'ENOENT')) continue;
        throw error;
      }
      const entries = content.split(/\r?\n/u).flatMap((line, index): LocalLogEntry[] => {
        if (line.length === 0) return [];
        const level = detectLevel(line);
        return [{ file, lineNumber: index + 1, content: line, ...(level ? { level } : {}) }];
      });
      byFile.set(file, entries);
      combined.push(...entries);
    }

    const readableFiles = files.filter(file => byFile.has(file));
    return { entries: combined, files: readableFiles, byFile };
  }

  private waitForPoll(signal: AbortSignal | undefined): Promise<void> {
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      timer = setTimeout(finish, Math.max(1, this.pollIntervalMs));
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
