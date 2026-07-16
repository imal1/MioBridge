import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { checkConfig, loadConfig, getDefaultConfig, validateAgentConfig } from '../config';

const TMP_DIR = path.join(os.tmpdir(), 'miobridge-agent-test-' + Date.now());
const CONFIG_PATH = path.join(TMP_DIR, 'agent.yaml');
const baseNodeYaml = `node:
  id: node-1
  name: 香港
  secret: secret`;

async function loadFixture(yaml: string) {
  fs.writeFileSync(CONFIG_PATH, yaml);
  return loadConfig(CONFIG_PATH);
}

describe('Agent Config', () => {
  beforeAll(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe('getDefaultConfig', () => {
    test('returns a default sing-box kernel and port 3001', () => {
      const cfg = getDefaultConfig();
      expect(cfg.port).toBe(3001);
      expect(cfg.node.id).toBe('');
      expect(cfg.node.secret).toBe('');
      expect(cfg.kernels).toEqual([
        { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
      ]);
    });
  });

  describe('loadConfig', () => {
    test('returns default config when file does not exist', async () => {
      const cfg = await loadConfig('/nonexistent/agent.yaml');
      expect(cfg.port).toBe(3001);
    });

    test('loads the documented example configuration', async () => {
      const cfg = await loadConfig(path.join(import.meta.dir, '..', '..', 'agent.yaml.example'));
      expect(cfg.node.id).toBe('node-sg');
      expect(cfg.kernels).toEqual([
        { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
        { type: 'xray', configPath: '/etc/xray/config.json' },
      ]);
    });

    test('loads multiple unique kernels with independent paths', async () => {
      const cfg = await loadFixture(`
node:
  id: node-1
  name: 香港
  secret: secret
kernels:
  - type: sing-box
    configPath: /custom/sing-box.json
  - type: xray
    configPath: /custom/xray.json
mihomo:
  path: /usr/bin/mihomo
port: 3002
`);
      expect(cfg.node.id).toBe('node-1');
      expect(cfg.node.name).toBe('香港');
      expect(cfg.node.secret).toBe('secret');
      expect(cfg.kernels).toEqual([
        { type: 'sing-box', configPath: '/custom/sing-box.json' },
        { type: 'xray', configPath: '/custom/xray.json' },
      ]);
      expect(cfg.mihomo.path).toBe('/usr/bin/mihomo');
      expect(cfg.port).toBe(3002);
    });

    test('fills omitted config paths from kernel defaults', async () => {
      const cfg = await loadFixture(`${baseNodeYaml}
kernels:
  - type: sing-box
  - type: xray
  - type: v2ray
`);
      expect(cfg.kernels).toEqual([
        { type: 'sing-box', configPath: '/etc/sing-box/config.json' },
        { type: 'xray', configPath: '/etc/xray/config.json' },
        { type: 'v2ray', configPath: '/etc/v2ray/config.json' },
      ]);
    });

    test('accepts an explicit empty kernel list for Agent-first deployment', async () => {
      const cfg = await loadFixture(`${baseNodeYaml}
kernels: []
`);
      expect(cfg.kernels).toEqual([]);
    });

    test.each([
      ['empty', 'kernels:\n', /at least one kernel is required/],
      ['duplicate', 'kernels:\n  - type: xray\n  - type: xray\n', /Duplicate kernel type: "xray"/],
      ['unsupported', 'kernels:\n  - type: clash\n', /Unsupported kernel type at index 0: "clash"/],
    ])('rejects %s kernel configuration with a descriptive error', async (_name, yaml, error) => {
      await expect(loadFixture(`${baseNodeYaml}\n${yaml}`)).rejects.toThrow(error);
    });

    test.each([
      ['configPat', 'configPat: /custom/xray.json', /Unknown kernel property: "configPat"/],
      ['malformed property', 'configPath /custom/xray.json', /Malformed kernel property: "configPath \/custom\/xray.json"/],
    ])('rejects %s instead of silently using a default path', async (_name, property, error) => {
      await expect(loadFixture(`${baseNodeYaml}
kernels:
  - type: xray
    ${property}
`)).rejects.toThrow(error);
    });

    test.each([
      ['one-space list item', 'kernels:\n - type: xray\n', /Kernel list item must use exactly two spaces of indentation/],
      ['four-space list item', 'kernels:\n    - type: xray\n', /Kernel list item must use exactly two spaces of indentation/],
      ['shallow property', 'kernels:\n  - type: xray\n  configPath: \/custom\/xray.json\n', /Kernel property must use exactly four spaces of indentation/],
      ['deep property', 'kernels:\n  - type: xray\n      configPath: \/custom\/xray.json\n', /Kernel property must use exactly four spaces of indentation/],
      ['property before item', 'kernels:\n    configPath: \/custom\/xray.json\n  - type: xray\n', /Kernel property must belong to a list item/],
    ])('rejects invalid kernel hierarchy: %s', async (_name, yaml, error) => {
      await expect(loadFixture(`${baseNodeYaml}\n${yaml}`)).rejects.toThrow(error);
    });

    test.each([
      ['type', '    type: v2ray\n', /Duplicate kernel property: "type"/],
      ['configPath', '    configPath: \/first.json\n    configPath: \/second.json\n', /Duplicate kernel property: "configPath"/],
    ])('rejects duplicate %s keys within one kernel item', async (_name, properties, error) => {
      await expect(loadFixture(`${baseNodeYaml}
kernels:
  - type: xray
${properties}`)).rejects.toThrow(error);
    });

    test.each([
      ['non-numeric', 'abc'],
      ['negative', '-1'],
    ])('rejects a %s port while parsing', async (_name, value) => {
      await expect(loadFixture(`${baseNodeYaml}\nkernels: []\nport: ${value}\n`)).rejects.toThrow('Invalid Agent port');
    });
  });

  describe('checkConfig', () => {
    test('validates a complete Agent-first configuration', async () => {
      fs.writeFileSync(CONFIG_PATH, `${baseNodeYaml}\nkernels: []\nport: 3001\n`);
      expect((await checkConfig(CONFIG_PATH)).kernels).toEqual([]);
    });

    test('requires an existing regular file', async () => {
      await expect(checkConfig(path.join(TMP_DIR, 'missing.yaml'))).rejects.toThrow('does not exist');
    });

    test.each([
      ['node id', { node: { id: '', name: 'n', secret: 's' } }, /node.id is required/],
      ['node name', { node: { id: 'i', name: '', secret: 's' } }, /node.name is required/],
      ['secret', { node: { id: 'i', name: 'n', secret: '' } }, /node.secret is required/],
      ['port range', { port: 70000 }, /Invalid Agent port/],
    ])('rejects a missing or invalid %s', (_name, override, error) => {
      const config = {
        ...getDefaultConfig(),
        node: { id: 'i', name: 'n', secret: 's' },
        ...override,
      };
      expect(() => validateAgentConfig(config)).toThrow(error);
    });
  });
});
