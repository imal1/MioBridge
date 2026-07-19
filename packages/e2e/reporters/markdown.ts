import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface Row {
  readonly title: string;
  readonly project: string;
  readonly status: TestResult['status'];
  readonly expectedStatus: TestCase['expectedStatus'];
  readonly duration: number;
  readonly error?: string;
}

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

export default class MarkdownReporter implements Reporter {
  private readonly rows: Row[] = [];
  private startedAt = new Date();
  private outputFile = resolve('.artifacts/summary.md');

  onBegin(config: FullConfig): void {
    this.startedAt = new Date();
    this.outputFile = resolve(config.rootDir, '..', '.artifacts', 'summary.md');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const error = result.errors.map(item => item.message ?? item.value ?? '').filter(Boolean).join('\n');
    this.rows.push({
      title: test.titlePath().slice(1).join(' › '),
      project: test.parent.project()?.name ?? 'unknown',
      status: result.status,
      expectedStatus: test.expectedStatus,
      duration: result.duration,
      ...(error ? { error } : {}),
    });
  }

  onEnd(result: FullResult): void {
    const latest = new Map<string, Row>();
    for (const row of this.rows) latest.set(`${row.project}:${row.title}`, row);
    const rows = [...latest.values()];
    const passed = rows.filter(row => row.status === 'passed' && row.expectedStatus === 'passed').length;
    const knownGaps = rows.filter(row => row.status === 'failed' && row.expectedStatus === 'failed').length;
    const failed = rows.filter(row => row.status !== row.expectedStatus && row.status !== 'skipped').length;
    const skipped = rows.filter(row => row.status === 'skipped').length;
    const endedAt = new Date();

    const lines = [
      '# MioBridge Dashboard Playwright 执行摘要',
      '',
      `- 结论：${result.status}`,
      `- 开始：${this.startedAt.toISOString()}`,
      `- 结束：${endedAt.toISOString()}`,
      `- 用时：${Math.round(result.duration / 1000)} 秒`,
      `- 通过：${passed}`,
      `- 已知产品缺口（expected failure）：${knownGaps}`,
      `- 非预期失败：${failed}`,
      `- 跳过：${skipped}`,
      '',
      '| Project | 用例 | 实际 | 期望 | 用时 |',
      '|---|---|---:|---:|---:|',
      ...rows.map(row => `| ${cell(row.project)} | ${cell(row.title)} | ${row.status} | ${row.expectedStatus} | ${row.duration} ms |`),
    ];

    const failures = rows.filter(row => row.error);
    if (failures.length) {
      lines.push('', '## 失败证据索引', '');
      for (const row of failures) lines.push(`- **${cell(row.title)}**：${cell(row.error ?? '')}`);
    }

    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${lines.join('\n')}\n`, 'utf8');
  }
}
