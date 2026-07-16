import type { KernelType } from '@miobridge/core';

export interface KernelScriptDefinition {
  readonly repository: string;
  readonly branch: 'main' | 'master';
  readonly wrapperPath: string;
  readonly corePath: string;
  readonly configRoot: string;
  readonly configPath: string;
  readonly configDir: string;
  readonly serviceName: string;
}

export const KERNEL_SCRIPTS: Readonly<Record<KernelType, KernelScriptDefinition>> = {
  'sing-box': definition('sing-box', '233boy/sing-box', 'main'),
  xray: definition('xray', '233boy/Xray', 'main'),
  v2ray: definition('v2ray', '233boy/v2ray', 'master'),
};

function definition(type: KernelType, repository: string, branch: KernelScriptDefinition['branch']): KernelScriptDefinition {
  const configRoot = `/etc/${type}`;
  return {
    repository,
    branch,
    wrapperPath: `/usr/local/bin/${type}`,
    corePath: `${configRoot}/bin/${type}`,
    configRoot,
    configPath: `${configRoot}/config.json`,
    configDir: `${configRoot}/conf`,
    serviceName: type,
  };
}

export function installerUrl(type: KernelType): string {
  const definition = KERNEL_SCRIPTS[type];
  return `https://raw.githubusercontent.com/${definition.repository}/${definition.branch}/install.sh`;
}

export function installCommand(type: KernelType): string {
  const url = installerUrl(type);
  return [
    'set -e',
    `workdir=$(mktemp -d /tmp/miobridge-${type}-install.XXXXXX)`,
    `trap 'rm -rf "$workdir"' EXIT`,
    `url=${shellQuote(url)}`,
    'if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 "$url" -o "$workdir/install.sh"; elif command -v wget >/dev/null 2>&1; then wget -qO "$workdir/install.sh" "$url"; else echo "缺少 curl 或 wget" >&2; exit 127; fi',
    'test -s "$workdir/install.sh"',
    'bash "$workdir/install.sh"',
  ].join('\n');
}

export function wrapperCommand(type: KernelType, ...args: readonly string[]): string {
  return [KERNEL_SCRIPTS[type].wrapperPath, ...args].map(shellQuote).join(' ');
}

export function uninstallCommand(type: KernelType, preserveConfig: boolean): string {
  const definition = KERNEL_SCRIPTS[type];
  const uninstall = `printf 'y\\n1\\n' | ${wrapperCommand(type, 'uninstall')}`;
  if (!preserveConfig) return uninstall;
  return [
    'set -e',
    `backup=$(mktemp -d /tmp/miobridge-${type}-config.XXXXXX)`,
    `trap 'rm -rf "$backup"' EXIT`,
    `if [ -f ${shellQuote(definition.configPath)} ]; then cp -a ${shellQuote(definition.configPath)} "$backup/config.json"; fi`,
    `if [ -d ${shellQuote(definition.configDir)} ]; then cp -a ${shellQuote(definition.configDir)} "$backup/conf"; fi`,
    uninstall,
    `mkdir -p ${shellQuote(definition.configRoot)}`,
    `if [ -f "$backup/config.json" ]; then cp -a "$backup/config.json" ${shellQuote(definition.configPath)}; fi`,
    `if [ -d "$backup/conf" ]; then rm -rf ${shellQuote(definition.configDir)}; cp -a "$backup/conf" ${shellQuote(definition.configDir)}; fi`,
  ].join('\n');
}

export function reinstallCommand(type: KernelType, preserveConfig: boolean): string {
  if (!preserveConfig) {
    return [
      'set -e',
      `printf 'y\\n1\\n' | ${wrapperCommand(type, 'uninstall')}`,
      `(${installCommand(type)})`,
    ].join('\n');
  }
  const definition = KERNEL_SCRIPTS[type];
  return [
    'set -e',
    `backup=$(mktemp -d /tmp/miobridge-${type}-reinstall.XXXXXX)`,
    'restore_config() {',
    `  mkdir -p ${shellQuote(definition.configRoot)}`,
    `  if [ -f "$backup/config.json" ]; then cp -a "$backup/config.json" ${shellQuote(definition.configPath)}; fi`,
    `  if [ -d "$backup/conf" ]; then rm -rf ${shellQuote(definition.configDir)}; cp -a "$backup/conf" ${shellQuote(definition.configDir)}; fi`,
    '}',
    'finish() { status=$?; if [ "$status" -ne 0 ]; then restore_config || true; fi; rm -rf "$backup"; exit "$status"; }',
    'trap finish EXIT',
    `if [ -f ${shellQuote(definition.configPath)} ]; then cp -a ${shellQuote(definition.configPath)} "$backup/config.json"; fi`,
    `if [ -d ${shellQuote(definition.configDir)} ]; then cp -a ${shellQuote(definition.configDir)} "$backup/conf"; fi`,
    `printf 'y\\n1\\n' | ${wrapperCommand(type, 'uninstall')}`,
    `(${installCommand(type)})`,
    'restore_config',
    wrapperCommand(type, 'restart'),
    'trap - EXIT',
    'rm -rf "$backup"',
  ].join('\n');
}

export function upgradeCommand(type: KernelType): string {
  return [
    'set -e',
    wrapperCommand(type, 'update', 'core'),
    wrapperCommand(type, 'update.sh'),
  ].join('\n');
}

export function repairCommand(type: KernelType): string {
  const definition = KERNEL_SCRIPTS[type];
  return [
    'set -e',
    wrapperCommand(type, 'fix-all'),
    wrapperCommand(type, 'restart'),
    `systemctl is-active --quiet ${shellQuote(definition.serviceName)}`,
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
