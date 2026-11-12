import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createNodeCore } from '../src/index.js';
import { CLI_VERSION } from '../src/command.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCompiled(args: string[], cwd: string, baseDir: string) {
  const entry = join(packageDir, 'dist', 'main.js');
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd,
      env: { ...process.env, MIOBRIDGE_CONFIG_DIR: baseDir, PATH: process.env.PATH ?? '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => resolveResult({ code, stdout, stderr }));
  });
}

describe('headless CLI composition', () => {
  it('generates state only beneath an injected base directory from an external cwd', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'miobridge-cli-headless-'));
    const cwd = join(sandbox, 'unrelated-cwd');
    const baseDir = join(sandbox, 'runtime');
    await mkdir(cwd);
    await writeFile(join(cwd, '.keep'), 'unchanged');
    const composition = createNodeCore({
      env: { MIOBRIDGE_CONFIG_DIR: baseDir, PATH: '' },
      metadata: { version: 'test' },
      uptime: () => 7,
      local: { isAvailable: async () => true, extractNodeUrls: async () => ['vless://id@headless.example:443#headless'] },
      remote: { collectRemoteNodeSources: async () => ({ sources: [], errors: [] }) },
      mihomo: {
        checkHealth: async () => true,
        getVersion: async () => ({ version: 'test-mihomo' }),
        convertToClashByContent: async () => 'proxies:\n  - name: headless\n',
      },
    });

    const previous = process.cwd();
    process.chdir(cwd);
    try {
      await composition.core.updateSubscription();
      const status = await composition.core.getStatus();
      expect(status).toMatchObject({ subscriptionExists: true, rawExists: true, clashExists: true, nodesCount: 1 });
      expect(composition.paths.baseDir).toBe(baseDir);
      expect(await readdir(cwd)).toEqual(['.keep']);
      expect((await readdir(baseDir)).sort()).toEqual(['artifact-state', 'backup', 'log', 'www']);
    } finally {
      process.chdir(previous);
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it('runs compiled status from an external cwd without frontend or dashboard artifacts', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'miobridge-cli-process-'));
    const cwd = join(sandbox, 'cwd');
    const baseDir = join(sandbox, 'runtime');
    await mkdir(cwd);
    await writeFile(join(cwd, '.keep'), 'unchanged');
    const result = await runCompiled(['status', '--json'], cwd, baseDir);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ version: CLI_VERSION, subscriptionExists: false });
    expect(await readdir(cwd)).toEqual(['.keep']);
    await rm(sandbox, { recursive: true, force: true });
  });

  it('persists subscription endpoint settings through the compiled nodes proxy command (issue #48)', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'miobridge-cli-proxy-'));
    const baseDir = join(sandbox, 'runtime');
    await mkdir(baseDir);
    const nodesFile = join(baseDir, 'nodes.yaml');
    await writeFile(nodesFile, stringify({ nodes: [{
      id: 'ht', name: 'HT 节点', host: '198.51.100.9', port: 3001, secret: 'agent-secret',
      kernels: [{ type: 'sing-box' }], location: '香港', enabled: true,
    }] }));
    const stored = async () => (parse(await readFile(nodesFile, 'utf8')) as { nodes: Array<Record<string, unknown>> }).nodes[0]!;
    try {
      const saved = await runCompiled(['nodes', 'proxy', 'ht', '--server', 'ht.example.com', '--sni', 'ht.example.com', '--cert-verify', 'strict', '--protocols', 'hy2,trojan', '--name', 'HT', '--json'], sandbox, baseDir);
      expect(saved.stderr).toBe('');
      expect(saved.code).toBe(0);
      const proxy = { server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict', protocols: ['trojan', 'hysteria2'], displayName: 'HT' };
      expect(JSON.parse(saved.stdout)).toEqual({ id: 'ht', name: 'HT 节点', host: '198.51.100.9', proxy });
      // 出口设置落盘到 nodes.yaml；Agent 管理地址与密钥保持原样。
      expect(await stored()).toMatchObject({ id: 'ht', host: '198.51.100.9', secret: 'agent-secret', proxy });

      // 逐字段编辑：只清除显示名称，其余保持。
      const renamed = await runCompiled(['nodes', 'proxy', 'ht', '--name', ''], sandbox, baseDir);
      expect(renamed.code).toBe(0);
      expect(renamed.stdout).toContain('Server: ht.example.com');
      expect(renamed.stdout).toContain('Display name: (location + kernel node name)');
      expect((await stored()).proxy).toEqual({ server: 'ht.example.com', sni: 'ht.example.com', certVerify: 'strict', protocols: ['trojan', 'hysteria2'] });

      // 与其他 nodes 命令一致：服务器可以用名称或 ID 前缀指定。
      const byName = await runCompiled(['nodes', 'proxy', 'HT 节点', '--json'], sandbox, baseDir);
      expect(byName.code).toBe(0);
      expect(JSON.parse(byName.stdout)).toMatchObject({ id: 'ht', proxy: { server: 'ht.example.com' } });

      // 无效输入不落盘。
      const rejected = await runCompiled(['nodes', 'proxy', 'ht', '--server', 'bad host'], sandbox, baseDir);
      expect(rejected.code).toBe(1);
      expect(rejected.stderr).toContain('连接域名必须是有效的域名或 IP 地址');
      expect((await stored()).proxy).toMatchObject({ server: 'ht.example.com' });
      const missing = await runCompiled(['nodes', 'proxy', 'nope', '--clear'], sandbox, baseDir);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain('节点 nope 不存在');

      const cleared = await runCompiled(['nodes', 'proxy', 'ht', '--clear', '--json'], sandbox, baseDir);
      expect(cleared.code).toBe(0);
      expect(JSON.parse(cleared.stdout)).toMatchObject({ id: 'ht', proxy: null });
      expect(await stored()).not.toHaveProperty('proxy');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
