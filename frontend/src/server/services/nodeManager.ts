import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import { MioBridgeService } from './mioBridgeService';
import { getMioBridgeBaseDir } from '../runtimePaths';
import type { NodeConfig, NodeStatus, ClusterStatus, NodesYaml, NodeAgentInfo } from '../types';

const CONFIG_DIR = getMioBridgeBaseDir();
const NODES_YAML_PATH = path.join(CONFIG_DIR, 'nodes.yaml');
const REMOTE_TIMEOUT_MS = 10_000;
/** fs.watch 去抖延迟：文件可能连续触发多次 change 事件 */
const WATCH_DEBOUNCE_MS = 500;

export class NodeManager {
  private static instance: NodeManager;
  private nodes: NodeConfig[] = [];
  private localService: MioBridgeService;
  /** In-memory cache of last known remote node statuses */
  private nodeCache: Map<string, NodeStatus> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 部署委托：加载节点后，对有 SSH 配置但 agent 未部署的节点自动触发部署 */
  private deployDelegate: ((node: NodeConfig) => Promise<{ success: boolean; message: string }>) | null = null;

  private constructor() {
    this.localService = MioBridgeService.getInstance();
  }

  public static getInstance(): NodeManager {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager();
    }
    return NodeManager.instance;
  }

  /** 设置部署委托（由 DeployManager 注册） */
  setDeployDelegate(delegate: (node: NodeConfig) => Promise<{ success: boolean; message: string }>): void {
    this.deployDelegate = delegate;
  }

  /** 持久化首次 SSH 连接记录到的 host key */
  async updateNodeSshHostKey(nodeId: string, hostKey: string): Promise<void> {
    if (!hostKey || !(await fs.pathExists(NODES_YAML_PATH))) return;

    const raw = await fs.readFile(NODES_YAML_PATH, 'utf8');
    const lines = raw.split('\n');
    let inTargetNode = false;
    let inSsh = false;
    let hostKeyUpdated = false;
    let sshSectionStart = -1;

    const quotedHostKey = this.quoteYamlValue(hostKey);

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('- id:')) {
        if (inTargetNode && inSsh && !hostKeyUpdated && sshSectionStart !== -1) {
          lines.splice(sshSectionStart + 1, 0, `      hostKey: ${quotedHostKey}`);
          hostKeyUpdated = true;
          i++;
        }
        inTargetNode = this.extractYamlValue(trimmed, 'id') === nodeId;
        inSsh = false;
        sshSectionStart = -1;
        continue;
      }

      if (!inTargetNode) continue;

      if (trimmed === 'ssh:') {
        inSsh = true;
        sshSectionStart = i;
        continue;
      }

      if (inSsh && /^ {4}\S/.test(lines[i]) && trimmed !== 'ssh:') {
        if (!hostKeyUpdated && sshSectionStart !== -1) {
          lines.splice(i, 0, `      hostKey: ${quotedHostKey}`);
          hostKeyUpdated = true;
          i++;
        }
        inSsh = false;
        sshSectionStart = -1;
        continue;
      }

      if (inSsh && trimmed.startsWith('hostKey:')) {
        lines[i] = `      hostKey: ${quotedHostKey}`;
        hostKeyUpdated = true;
      }
    }

    if (inTargetNode && inSsh && !hostKeyUpdated && sshSectionStart !== -1) {
      lines.splice(sshSectionStart + 1, 0, `      hostKey: ${quotedHostKey}`);
      hostKeyUpdated = true;
    }

    if (!hostKeyUpdated) return;

    await fs.writeFile(NODES_YAML_PATH, lines.join('\n').replace(/\n*$/, '\n'));
    logger.info(`NodeManager: 节点 ${nodeId} SSH host key 已写入 nodes.yaml`);
    await this.loadNodes();
  }

  /** 持久化 Agent 部署状态 */
  async updateNodeAgentInfo(nodeId: string, agent: Partial<NodeAgentInfo>): Promise<void> {
    if (!(await fs.pathExists(NODES_YAML_PATH))) return;

    const raw = await fs.readFile(NODES_YAML_PATH, 'utf8');
    const lines = raw.split('\n');
    let inTargetNode = false;
    let inAgent = false;
    let agentSectionStart = -1;
    const seen = new Set<keyof NodeAgentInfo>();

    const insertMissing = (index: number) => {
      const additions: string[] = [];
      if (agent.deployed !== undefined && !seen.has('deployed')) additions.push(`      deployed: ${agent.deployed}`);
      if (agent.version !== undefined && !seen.has('version')) additions.push(`      version: ${this.quoteYamlValue(agent.version)}`);
      if (agent.status !== undefined && !seen.has('status')) additions.push(`      status: ${this.quoteYamlValue(agent.status)}`);
      if (agent.lastDeploy !== undefined && !seen.has('lastDeploy')) additions.push(`      lastDeploy: ${this.quoteYamlValue(agent.lastDeploy)}`);
      if (agent.port !== undefined && !seen.has('port')) additions.push(`      port: ${agent.port}`);
      if (additions.length > 0) lines.splice(index, 0, ...additions);
      return additions.length;
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith('- id:')) {
        if (inTargetNode && inAgent) i += insertMissing(i);
        inTargetNode = this.extractYamlValue(trimmed, 'id') === nodeId;
        inAgent = false;
        agentSectionStart = -1;
        seen.clear();
        continue;
      }

      if (!inTargetNode) continue;

      if (trimmed === 'agent:') {
        inAgent = true;
        agentSectionStart = i;
        continue;
      }

      if (inAgent && /^ {4}\S/.test(lines[i]) && trimmed !== 'agent:') {
        i += insertMissing(i);
        inAgent = false;
        agentSectionStart = -1;
        continue;
      }

      if (!inAgent) continue;

      if (trimmed.startsWith('deployed:') && agent.deployed !== undefined) {
        lines[i] = `      deployed: ${agent.deployed}`;
        seen.add('deployed');
      } else if (trimmed.startsWith('version:') && agent.version !== undefined) {
        lines[i] = `      version: ${this.quoteYamlValue(agent.version)}`;
        seen.add('version');
      } else if (trimmed.startsWith('status:') && agent.status !== undefined) {
        lines[i] = `      status: ${this.quoteYamlValue(agent.status)}`;
        seen.add('status');
      } else if (trimmed.startsWith('lastDeploy:') && agent.lastDeploy !== undefined) {
        lines[i] = `      lastDeploy: ${this.quoteYamlValue(agent.lastDeploy)}`;
        seen.add('lastDeploy');
      } else if (trimmed.startsWith('port:') && agent.port !== undefined) {
        lines[i] = `      port: ${agent.port}`;
        seen.add('port');
      }
    }

    if (inTargetNode && inAgent) {
      insertMissing(lines.length);
    } else if (inTargetNode && agentSectionStart === -1) {
      lines.push('    agent:');
      insertMissing(lines.length);
    }

    await fs.writeFile(NODES_YAML_PATH, lines.join('\n').replace(/\n*$/, '\n'));
    logger.info(`NodeManager: 节点 ${nodeId} Agent 状态已写入 nodes.yaml`);
    await this.loadNodes({ triggerDeploy: false });
  }

  /** 将节点写入 nodes.yaml（追加或创建） */
  async writeNodeToYaml(node: NodeConfig): Promise<NodeConfig> {
    // 确保目录存在
    const dir = path.dirname(NODES_YAML_PATH);
    await fs.ensureDir(dir);

    // 重新加载现有节点以检查重复
    await this.loadNodes();
    if (this.nodes.find(n => n.id === node.id)) {
      throw new Error(`节点 ${node.id} 已存在`);
    }

    // 生成默认值
    if (!node.id) {
      node.id = 'node-' + crypto.randomBytes(2).toString('hex');
    }
    if (!node.secret) {
      node.secret = crypto.randomBytes(32).toString('hex');
    }
    if (!node.agent) {
      node.agent = { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' };
    }
    node.enabled = true;

    // 序列化为 YAML
    const lines: string[] = [];
    const fileExists = await fs.pathExists(NODES_YAML_PATH);

    if (fileExists) {
      // Append to existing file
      const existing = await fs.readFile(NODES_YAML_PATH, 'utf8');
      lines.push(existing.trimEnd());
      if (!existing.endsWith('\n')) lines.push('');
    } else {
      lines.push('nodes:');
    }

    // Build node entry
    lines.push(`  - id: "${node.id}"`);
    if (node.name) lines.push(`    name: "${node.name}"`);
    if (node.host) lines.push(`    host: "${node.host}"`);
    lines.push(`    port: ${node.port ?? node.agent?.port ?? 3001}`);
    if (node.secret) lines.push(`    secret: "${node.secret}"`);
    if (node.kernel) lines.push(`    kernel: "${node.kernel}"`);
    if (node.location) lines.push(`    location: "${node.location}"`);
    lines.push(`    enabled: ${node.enabled}`);

    if (node.ssh) {
      lines.push(`    ssh:`);
      lines.push(`      user: "${node.ssh.user}"`);
      if (node.ssh.port) lines.push(`      port: ${node.ssh.port}`);
      if (node.ssh.keyPath) lines.push(`      keyPath: "${node.ssh.keyPath}"`);
      if (node.ssh.hostKey) lines.push(`      hostKey: "${node.ssh.hostKey}"`);
      if (node.ssh.password) lines.push(`      password: "${node.ssh.password}"`);
    }

    if (node.agent) {
      lines.push(`    agent:`);
      lines.push(`      deployed: ${node.agent.deployed}`);
      if (node.agent.version) lines.push(`      version: "${node.agent.version}"`);
      lines.push(`      status: "${node.agent.status}"`);
      if (node.agent.lastDeploy) lines.push(`      lastDeploy: "${node.agent.lastDeploy}"`);
      if (node.agent.port) lines.push(`      port: ${node.agent.port}`);
    }

    if (node.kernelInfo) {
      lines.push(`    kernelInfo:`);
      lines.push(`      installed: ${node.kernelInfo.installed}`);
      if (node.kernelInfo.version) lines.push(`      version: "${node.kernelInfo.version}"`);
      if (node.kernelInfo.installScript) lines.push(`      installScript: "${node.kernelInfo.installScript}"`);
    }

    await fs.writeFile(NODES_YAML_PATH, lines.join('\n') + '\n');
    logger.info(`NodeManager: 节点 ${node.id} 已写入 nodes.yaml`);

    // 重新加载节点
    await this.loadNodes();

    // 如果有 SSH 配置且 agent 未部署，触发自动部署
    if (this.deployDelegate && node.ssh && node.agent?.status === 'not_deployed') {
      logger.info(`NodeManager: 触发自动部署节点 ${node.id}`);
      this.deployDelegate(node).catch(err => {
        logger.error(`NodeManager: 自动部署节点 ${node.id} 失败: ${err.message}`);
      });
    }

    return node;
  }

  /** 启动 nodes.yaml 文件监听（热加载） */
  startWatch(): void {
    if (this.watcher) return; // 防止重复启动

    try {
      // 确保父目录存在后再监听（目录不存在时 watch 会失败）
      const dir = path.dirname(NODES_YAML_PATH);
      if (!fs.existsSync(dir)) {
        logger.info('NodeManager: nodes.yaml 目录不存在，跳过文件监听');
        return;
      }

      this.watcher = fs.watch(NODES_YAML_PATH, (eventType) => {
        if (eventType !== 'change') return;
        // 去抖：短时间内的重复事件只触发一次
        if (this.watchDebounceTimer) clearTimeout(this.watchDebounceTimer);
        this.watchDebounceTimer = setTimeout(async () => {
          logger.info('NodeManager: 检测到 nodes.yaml 变更，重新加载节点...');
          await this.loadNodes();
        }, WATCH_DEBOUNCE_MS);
      });

      logger.info('NodeManager: nodes.yaml 文件监听已启动');
    } catch (error: any) {
      logger.warn(`NodeManager: 启动文件监听失败: ${error.message}`);
    }
  }

  /** 停止文件监听 */
  stopWatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.watchDebounceTimer) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
  }

  /** 读取 nodes.yaml */
  async loadNodes(options: { triggerDeploy?: boolean } = { triggerDeploy: true }): Promise<NodeConfig[]> {
    try {
      if (!(await fs.pathExists(NODES_YAML_PATH))) {
        this.nodes = [];
        logger.info('NodeManager: nodes.yaml 不存在，运行在单机模式');
        return [];
      }
      const raw = await fs.readFile(NODES_YAML_PATH, 'utf8');
      const parsed = this.parseNodesYaml(raw);
      this.nodes = parsed.nodes.filter(n => n.enabled);
      logger.info(`NodeManager: 加载了 ${this.nodes.length} 个节点`);

      // 自动部署：对已配置 SSH 但 agent 未部署的节点触发部署
      if (options.triggerDeploy !== false && this.deployDelegate) {
        const deployable = this.nodes.filter(n => n.ssh && n.agent?.status === 'not_deployed');
        for (const node of deployable) {
          logger.info(`NodeManager: 触发自动部署节点 ${node.id}`);
          this.deployDelegate(node).catch(err => {
            logger.error(`NodeManager: 自动部署节点 ${node.id} 失败: ${err.message}`);
          });
        }
      }

      return this.nodes;
    } catch (error: any) {
      logger.error(`NodeManager: 加载 nodes.yaml 失败: ${error.message}`);
      this.nodes = [];
      return [];
    }
  }

  /** 简易 YAML 解析（只解析 nodes 数组） */
  private parseNodesYaml(raw: string): NodesYaml {
    const nodes: NodeConfig[] = [];
    let current: Partial<NodeConfig> = {};
    let subSection = '';
    const lines = raw.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;

      if (trimmed.startsWith('- id:')) {
        if (current.id) { nodes.push(current as NodeConfig); }
        current = { id: this.extractYamlValue(trimmed, 'id') };
        subSection = '';
      } else if (trimmed === 'ssh:') {
        subSection = 'ssh';
        current.ssh = { user: 'root', keyPath: '', hostKey: '', password: '' };
      } else if (trimmed === 'agent:') {
        subSection = 'agent';
        current.agent = { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' };
      } else if (trimmed === 'kernelInfo:') {
        subSection = 'kernelInfo';
        current.kernelInfo = { installed: false, version: '', installScript: '' };
      } else if (subSection === 'ssh') {
        if (trimmed.startsWith('user:')) current.ssh!.user = this.extractYamlValue(trimmed, 'user');
        else if (trimmed.startsWith('port:')) current.ssh!.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 22;
        else if (trimmed.startsWith('keyPath:')) current.ssh!.keyPath = this.extractYamlValue(trimmed, 'keyPath');
        else if (trimmed.startsWith('hostKey:')) current.ssh!.hostKey = this.extractYamlValue(trimmed, 'hostKey');
        else if (trimmed.startsWith('password:')) current.ssh!.password = this.extractYamlValue(trimmed, 'password');
      } else if (subSection === 'agent') {
        if (trimmed.startsWith('deployed:')) current.agent!.deployed = this.extractYamlValue(trimmed, 'deployed') === 'true';
        else if (trimmed.startsWith('version:')) current.agent!.version = this.extractYamlValue(trimmed, 'version');
        else if (trimmed.startsWith('status:')) current.agent!.status = this.extractYamlValue(trimmed, 'status') as NodeAgentInfo['status'];
        else if (trimmed.startsWith('lastDeploy:')) current.agent!.lastDeploy = this.extractYamlValue(trimmed, 'lastDeploy');
        else if (trimmed.startsWith('port:')) current.agent!.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 3001;
      } else if (subSection === 'kernelInfo') {
        if (trimmed.startsWith('installed:')) current.kernelInfo!.installed = this.extractYamlValue(trimmed, 'installed') === 'true';
        else if (trimmed.startsWith('version:')) current.kernelInfo!.version = this.extractYamlValue(trimmed, 'version');
        else if (trimmed.startsWith('installScript:')) current.kernelInfo!.installScript = this.extractYamlValue(trimmed, 'installScript');
      } else if (trimmed.startsWith('name:')) {
        current.name = this.extractYamlValue(trimmed, 'name');
      } else if (trimmed.startsWith('host:')) {
        current.host = this.extractYamlValue(trimmed, 'host');
      } else if (trimmed.startsWith('port:')) {
        current.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 3001;
      } else if (trimmed.startsWith('secret:')) {
        current.secret = this.extractYamlValue(trimmed, 'secret');
      } else if (trimmed.startsWith('kernel:')) {
        current.kernel = this.extractYamlValue(trimmed, 'kernel') as NodeConfig['kernel'];
      } else if (trimmed.startsWith('location:')) {
        current.location = this.extractYamlValue(trimmed, 'location');
      } else if (trimmed.startsWith('enabled:')) {
        current.enabled = this.extractYamlValue(trimmed, 'enabled') !== 'false';
      }
    }
    if (current.id) { nodes.push(current as NodeConfig); }
    return { nodes };
  }

  private extractYamlValue(line: string, _key: string): string {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return '';
    let val = line.substring(colonIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }

  private quoteYamlValue(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  private getRemoteBaseUrl(node: NodeConfig): string {
    const port = node.port ?? node.agent?.port ?? 3001;
    return `http://${node.host}:${port}`;
  }

  private async fetchRemoteJson(node: NodeConfig, reqPath: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.getRemoteBaseUrl(node)}${reqPath}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...this.signRequest(node, 'GET', reqPath),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async collectRemoteNodeUrls(): Promise<{ urls: string[]; errors: string[] }> {
    await this.loadNodes({ triggerDeploy: false });

    const urls: string[] = [];
    const errors: string[] = [];
    const results = await Promise.allSettled(
      this.nodes
        .filter(node => node.enabled !== false)
        .map(async (node) => {
          const json = await this.fetchRemoteJson(node, '/api/urls');
          const data = json.data || json;
          return { node, urls: Array.isArray(data.urls) ? data.urls : [] };
        }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        urls.push(...result.value.urls);
      } else {
        errors.push(result.reason?.message || String(result.reason));
      }
    }

    return { urls: Array.from(new Set(urls)), errors };
  }

  /** 检查是否有远程节点 */
  hasRemoteNodes(): boolean {
    return this.nodes.length > 0;
  }

  /** 获取节点缓存（供 Dashboard 使用） */
  getNodeCache(): Map<string, NodeStatus> {
    return this.nodeCache;
  }

  /** HMAC-SHA256 签名 */
  signRequest(
    node: NodeConfig,
    method: string,
    reqPath: string,
    body?: string,
  ): Record<string, string> {
    // localhost 节点不签名
    if (node.host === 'localhost' || node.host === '127.0.0.1') {
      return {};
    }
    const timestamp = Date.now().toString();
    const payload = `${timestamp}\n${method}\n${reqPath}\n${body ?? ''}`;
    const signature = crypto
      .createHmac('sha256', node.secret || '')
      .update(payload)
      .digest('hex');
    return {
      'X-Node-Id': node.id,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    };
  }

  // ==================== 远程节点 HTTP 轮询 ====================

  /** 从远程节点获取状态 */
  private async fetchRemoteStatus(node: NodeConfig): Promise<NodeStatus> {
    const baseStatus: NodeStatus = {
      nodeId: node.id,
      name: node.name,
      kernel: node.kernel,
      location: node.location,
      online: false,
    };

    try {
      const json = await this.fetchRemoteJson(node, '/api/status');
      const data = json.data || json;

      const status: NodeStatus = {
        ...baseStatus,
        online: true,
        latency: 0, // will be set by health check
        nodesCount: data.nodesCount,
        subscriptionExists: data.subscriptionExists,
        clashExists: data.clashExists,
        mihomoAvailable: data.mihomoAvailable,
        kernelAccessible: data.kernelAccessible ?? data.singBoxAccessible,
        version: data.version,
        uptime: data.uptime,
        agent: node.agent,
      };

      this.nodeCache.set(node.id, status);
      return status;
    } catch (error: any) {
      const errorMsg = error.name === 'AbortError'
        ? '请求超时'
        : `连接失败: ${error.message}`;
      const status: NodeStatus = { ...baseStatus, online: false, error: errorMsg };
      this.nodeCache.set(node.id, status);
      return status;
    }
  }

  /** 触发远程节点更新 */
  private async fetchRemoteUpdate(node: NodeConfig): Promise<{ success: boolean; message: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS * 3); // update takes longer

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.signRequest(node, 'GET', '/api/update'),
      };

      const url = `${this.getRemoteBaseUrl(node)}/api/update`;
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return { success: false, message: `节点 ${node.name} HTTP ${response.status}` };
      }

      const json = await response.json();
      return { success: true, message: `节点 ${node.name}: ${json.message || '更新成功'}` };
    } catch (error: any) {
      const errorMsg = error.name === 'AbortError'
        ? '请求超时'
        : `节点 ${node.name} 离线: ${error.message}`;
      return { success: false, message: errorMsg };
    }
  }

  /** 远程节点健康检查（测延迟） */
  private async fetchRemoteHealth(node: NodeConfig): Promise<{ online: boolean; latency: number }> {
    try {
      const start = Date.now();
      await this.fetchRemoteJson(node, '/api/health');
      return { online: true, latency: Date.now() - start };
    } catch {
      return { online: false, latency: 0 };
    }
  }

  // ==================== 集群聚合操作 ====================

  /** 聚合集群状态 */
  async getClusterStatus(): Promise<ClusterStatus> {
    await this.loadNodes({ triggerDeploy: false });

    const allStatuses: NodeStatus[] = [];

    if (this.nodes.length > 0) {
      const remoteResults = await Promise.allSettled(
        this.nodes.map(node => this.fetchRemoteStatus(node))
      );

      for (const result of remoteResults) {
        if (result.status === 'fulfilled') {
          allStatuses.push(result.value);
        }
        // rejected results are silently skipped — the node will be missing from the cluster view
      }
    }

    return this.buildClusterStatus(allStatuses);
  }

  /** 构建 ClusterStatus */
  private buildClusterStatus(allStatuses: NodeStatus[]): ClusterStatus {
    const onlineNodes = allStatuses.filter(n => n.online);
    const totalProxies = allStatuses.reduce((sum, n) => sum + (n.nodesCount || 0), 0);
    return {
      totalNodes: allStatuses.length,
      onlineNodes: onlineNodes.length,
      totalProxies,
      nodes: allStatuses,
      lastUpdated: new Date().toISOString(),
    };
  }

  /** 触发主节点统一订阅更新 */
  async triggerUpdate(nodeId?: string): Promise<{
    results: Record<string, { success: boolean; message: string }>;
  }> {
    const results: Record<string, { success: boolean; message: string }> = {};

    // Update local
    try {
      const result = await this.localService.updateSubscription();
      results['local'] = {
        success: true,
        message: nodeId && nodeId !== 'local'
          ? `已由主节点统一更新订阅，包含节点 ${nodeId} 的可用来源: ${result.message}`
          : result.message,
      };
    } catch (error: any) {
      results['local'] = { success: false, message: error.message };
    }

    return { results };
  }

  /** 健康检查（本地 + 远程） */
  async healthCheck(nodeId?: string): Promise<
    Record<string, { online: boolean; latency: number }>
  > {
    const results: Record<string, { online: boolean; latency: number }> = {};

    await this.loadNodes({ triggerDeploy: false });

    // If a specific remote node is requested
    if (nodeId) {
      const targetNode = this.nodes.find(n => n.id === nodeId);
      if (targetNode) {
        results[nodeId] = await this.fetchRemoteHealth(targetNode);
      } else {
        results[nodeId] = { online: false, latency: 0 };
      }
      return results;
    }

    // Check all remote nodes concurrently
    if (this.nodes.length > 0) {
      const remoteResults = await Promise.allSettled(
        this.nodes.map(async (node) => {
          const r = await this.fetchRemoteHealth(node);
          return { nodeId: node.id, result: r };
        })
      );

      for (const r of remoteResults) {
        if (r.status === 'fulfilled') {
          results[r.value.nodeId] = r.value.result;
        }
      }
    }

    return results;
  }
}
