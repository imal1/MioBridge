import type { KernelFileSystem, KernelLogger } from './ports.js';
import type { KernelAdapter, KernelType } from './types.js';

interface Outbound {
  protocol: string;
  tag?: string;
  settings?: { vnext?: Array<{ address: string; port: number; users?: Array<{ id: string; alterId?: number; security?: string; flow?: string }> }>; servers?: Array<{ address: string; port: number; method?: string; password?: string }> };
  streamSettings?: { network?: string; security?: string; wsSettings?: { path?: string }; tlsSettings?: { serverName?: string }; realitySettings?: { serverName?: string; publicKey?: string; shortId?: string } };
}

abstract class JsonOutboundAdapter implements KernelAdapter {
  abstract readonly type: KernelType;
  constructor(protected readonly fs: KernelFileSystem, protected readonly logger: KernelLogger, protected readonly configPath: string) {}
  async getConfigPaths() { return [this.configPath]; }
  async isAvailable() { return this.fs.exists(this.configPath); }
  async extractNodeUrls(): Promise<string[]> {
    try {
      if (!(await this.fs.exists(this.configPath))) return [];
      const config = JSON.parse(await this.fs.readFile(this.configPath)) as { outbounds?: Outbound[] };
      return (config.outbounds ?? []).map(outbound => this.toUrl(outbound)).filter((url): url is string => Boolean(url));
    } catch (error) {
      this.logger.error(`${this.type}Adapter: 解析配置失败`, { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
  private toUrl(out: Outbound): string | null {
    const tag = out.tag || out.protocol;
    const vnext = out.settings?.vnext?.[0];
    const server = out.settings?.servers?.[0];
    if ((out.protocol === 'vmess' || out.protocol === 'vless') && vnext) {
      const user = vnext.users?.[0];
      if (out.protocol === 'vmess') {
        const body = { v: '2', ps: tag, add: vnext.address, port: String(vnext.port), id: user?.id ?? '', aid: String(user?.alterId ?? 0), scy: user?.security ?? 'auto', net: out.streamSettings?.network ?? 'tcp', type: 'none', host: '', path: out.streamSettings?.wsSettings?.path ?? '/', tls: out.streamSettings?.security === 'tls' ? 'tls' : '' };
        return `vmess://${Buffer.from(JSON.stringify(body)).toString('base64')}`;
      }
      const params = new URLSearchParams({ type: out.streamSettings?.network ?? 'tcp', sni: out.streamSettings?.tlsSettings?.serverName ?? out.streamSettings?.realitySettings?.serverName ?? vnext.address });
      if (out.streamSettings?.security && out.streamSettings.security !== 'none') params.set('security', out.streamSettings.security);
      if (user?.flow) params.set('flow', user.flow);
      if (out.streamSettings?.network === 'ws' && out.streamSettings.wsSettings?.path) params.set('path', out.streamSettings.wsSettings.path);
      if (out.streamSettings?.security === 'reality') { params.set('pbk', out.streamSettings.realitySettings?.publicKey ?? ''); params.set('sid', out.streamSettings.realitySettings?.shortId ?? ''); }
      return `vless://${user?.id ?? ''}@${vnext.address}:${vnext.port}?${params}#${encodeURIComponent(tag)}`;
    }
    if ((out.protocol === 'trojan' || out.protocol === 'shadowsocks' || out.protocol === 'ss') && server) {
      if (out.protocol !== 'trojan') return `ss://${Buffer.from(`${server.method ?? 'aes-256-gcm'}:${server.password ?? ''}`).toString('base64')}@${server.address}:${server.port}#${encodeURIComponent(tag)}`;
      const params = new URLSearchParams({ sni: out.streamSettings?.tlsSettings?.serverName ?? server.address, security: 'tls' });
      if (out.streamSettings?.network && out.streamSettings.network !== 'tcp') params.set('type', out.streamSettings.network);
      return `trojan://${server.password ?? ''}@${server.address}:${server.port}?${params}#${encodeURIComponent(tag)}`;
    }
    return null;
  }
}

export class XrayAdapter extends JsonOutboundAdapter {
  readonly type = 'xray' as const;
  constructor(fs: KernelFileSystem, logger: KernelLogger, configPath = '/etc/xray/config.json') { super(fs, logger, configPath); }
}
export class V2rayAdapter extends JsonOutboundAdapter {
  readonly type = 'v2ray' as const;
  constructor(fs: KernelFileSystem, logger: KernelLogger, configPath = '/etc/v2ray/config.json') { super(fs, logger, configPath); }
}
