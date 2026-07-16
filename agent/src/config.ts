import * as fs from 'fs';

export interface AgentNodeConfig {
  id: string;
  name: string;
  secret: string;
}

export const SUPPORTED_KERNELS = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof SUPPORTED_KERNELS[number];

export interface AgentKernelConfig {
  type: KernelType;
  configPath?: string;
}

export interface AgentMihomoConfig {
  path: string;
}

export interface AgentConfig {
  node: AgentNodeConfig;
  kernels: AgentKernelConfig[];
  mihomo: AgentMihomoConfig;
  port: number;
}

const DEFAULT_CONFIG_PATHS: Record<KernelType, string> = {
  'sing-box': '/etc/sing-box/config.json',
  'xray': '/etc/xray/config.json',
  'v2ray': '/etc/v2ray/config.json',
};

interface ParsedKernel {
  type?: string;
  configPath?: string;
  properties: Set<string>;
}

export function getDefaultConfig(): AgentConfig {
  return {
    node: { id: '', name: '', secret: '' },
    kernels: [{ type: 'sing-box', configPath: '/etc/sing-box/config.json' }],
    mihomo: { path: '/usr/local/bin/mihomo' },
    port: 3001,
  };
}

function extractYamlValue(line: string): string {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  let val = line.substring(idx + 1).trim();
  let quote = '';
  for (let i = 0; i < val.length; i++) {
    if (quote) {
      if (val[i] === quote) quote = '';
    } else if (val[i] === '"' || val[i] === "'") {
      quote = val[i];
    } else if (val[i] === '#') {
      val = val.slice(0, i).trim();
      break;
    }
  }
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

export async function loadConfig(filePath: string): Promise<AgentConfig> {
  if (!fs.existsSync(filePath)) {
    console.log(`[config] ${filePath} 不存在，使用默认配置`);
    return getDefaultConfig();
  }

  const config = getDefaultConfig();
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const parsedKernels: ParsedKernel[] = [];
  let explicitEmptyKernels = false;
  let currentKernel: ParsedKernel | undefined;
  let section = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const indentation = line.match(/^[ \t]*/)?.[0] ?? '';

    // Reset section on top-level keys (non-indented).
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      section = '';
      currentKernel = undefined;
    }

    if (trimmed === 'node:') { section = 'node'; continue; }
    if (trimmed === 'kernels:') { section = 'kernels'; continue; }
    if (trimmed === 'kernels: []') { explicitEmptyKernels = true; continue; }
    if (trimmed === 'mihomo:') { section = 'mihomo'; continue; }

    if (section === 'kernels' && trimmed.startsWith('-')) {
      if (indentation !== '  ') {
        throw new Error('Kernel list item must use exactly two spaces of indentation');
      }

      const item = trimmed.slice(1).trim();
      if (!item.startsWith('type:')) {
        throw new Error(`Invalid kernel entry: expected "- type:", got "${trimmed}"`);
      }

      currentKernel = { properties: new Set(['type']) };
      parsedKernels.push(currentKernel);
      currentKernel.type = extractYamlValue(item);
      continue;
    }

    const val = extractYamlValue(trimmed);

    if (section === 'node') {
      if (trimmed.startsWith('id:')) config.node.id = val;
      else if (trimmed.startsWith('name:')) config.node.name = val;
      else if (trimmed.startsWith('secret:')) config.node.secret = val;
    } else if (section === 'kernels') {
      if (!currentKernel) {
        throw new Error('Kernel property must belong to a list item');
      }
      if (indentation !== '    ') {
        throw new Error('Kernel property must use exactly four spaces of indentation');
      }

      const separator = trimmed.indexOf(':');
      if (separator === -1) {
        throw new Error(`Malformed kernel property: "${trimmed}"`);
      }

      const property = trimmed.slice(0, separator).trim();
      if (property !== 'type' && property !== 'configPath') {
        throw new Error(`Unknown kernel property: "${property}"`);
      }
      if (currentKernel.properties.has(property)) {
        throw new Error(`Duplicate kernel property: "${property}"`);
      }
      currentKernel.properties.add(property);

      if (property === 'type') currentKernel.type = val;
      else currentKernel.configPath = val;
    } else if (section === 'mihomo') {
      if (trimmed.startsWith('path:')) config.mihomo.path = val;
    }

    if (trimmed.startsWith('port:') && section === '') {
      if (!/^[0-9]+$/.test(val)) throw new Error(`Invalid Agent port: "${val}"`);
      config.port = Number(val);
    }
  }

  if (parsedKernels.length === 0 && !explicitEmptyKernels) {
    throw new Error('Invalid kernels configuration: at least one kernel is required');
  }

  const seenKernels = new Set<KernelType>();
  config.kernels = parsedKernels.map((kernel, index) => {
    if (!kernel.type || !SUPPORTED_KERNELS.includes(kernel.type as KernelType)) {
      throw new Error(`Unsupported kernel type at index ${index}: "${kernel.type ?? ''}"`);
    }

    const type = kernel.type as KernelType;
    if (seenKernels.has(type)) {
      throw new Error(`Duplicate kernel type: "${type}"`);
    }
    seenKernels.add(type);

    return {
      type,
      configPath: kernel.configPath || DEFAULT_CONFIG_PATHS[type],
    };
  });

  return config;
}

export function validateAgentConfig(config: AgentConfig): AgentConfig {
  if (!config.node.id.trim()) throw new Error('Agent node.id is required');
  if (!config.node.name.trim()) throw new Error('Agent node.name is required');
  if (!config.node.secret.trim()) throw new Error('Agent node.secret is required');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error(`Invalid Agent port: "${config.port}"`);
  }
  for (const kernel of config.kernels) {
    if (!kernel.configPath?.trim()) throw new Error(`Kernel config path is required: "${kernel.type}"`);
  }
  return config;
}

export async function checkConfig(filePath: string): Promise<AgentConfig> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Agent config does not exist: ${filePath}`);
  }
  return validateAgentConfig(await loadConfig(filePath));
}
