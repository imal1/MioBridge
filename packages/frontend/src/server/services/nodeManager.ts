import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { MioBridgeService } from './mioBridgeService';
import { logger } from '../utils/logger';
import { getMioBridgeBaseDir } from '../runtimePaths';
import { getStateStore } from './stateStore';
import { validateUploadedPrivateKey } from './sshCredential';
import { dedupeProxySources, type CollectedProxySource } from './proxySources';
import { NodeOperationsAdapter, type NodeDeployDelegate } from './nodeOperationsAdapter';
import {
  KERNEL_TYPES,
  validateKernelConfigs,
  type NodeConfig,
  type NodeStatus,
  type ClusterStatus,
  type NodesYaml,
  type NodeAgentInfo,
  type LogsResult,
  type SshAuthMethod,
  type KernelRuntimeStatus,
  type NodeKernelConfig,
} from '../types';

const CONFIG_DIR = getMioBridgeBaseDir();
/** StateStore key：文件后端下等价于 CONFIG_DIR/nodes.yaml，Redis 后端下跨实例共享 */
const NODES_KEY = 'nodes.yaml';
const NODES_YAML_PATH = path.join(CONFIG_DIR, NODES_KEY);
const REMOTE_TIMEOUT_MS = 10_000;
/** fs.watch 去抖延迟：文件可能连续触发多次 change 事件 */
const WATCH_DEBOUNCE_MS = 500;

function createUnavailableKernelStatuses(configuredKernels: NodeKernelConfig[]): KernelRuntimeStatus[] {
  const configuredByType = new Map(configuredKernels.map(kernel => [kernel.type, kernel]));
  return KERNEL_TYPES.map(type => {
    const configured = configuredByType.get(type);
    return {
      type,
      detected: false,
      monitored: configured !== undefined,
      accessible: false,
      nodesCount: 0,
      configPaths: configured?.configPath ? [configured.configPath] : [],
    };
  });
}

export class NodeManager {
  private static instance: NodeManager;
  private nodes: NodeConfig[] = [];
  private localService: Pick<MioBridgeService, 'updateSubscription'>;
  /** In-memory cache of last known remote node statuses */
  private nodeCache: Map<string, NodeStatus> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 部署委托：加载节点后，对有 SSH 配置但 agent 未部署的节点自动触发部署 */
  private readonly operations = new NodeOperationsAdapter();
  /** @deprecated Compatibility probe; operational behavior is owned by operations. */
  private deployDelegate: NodeDeployDelegate | null = null;

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
  setDeployDelegate(delegate: NodeDeployDelegate): void {
    this.deployDelegate = delegate;
    this.operations.setDeployDelegate(delegate);
  }

  /** 读取 nodes.yaml 原文（文件或 Redis 后端） */
  private readNodesRaw(): Promise<string | null> {
    return getStateStore().get(NODES_KEY);
  }

  /** 写回 nodes.yaml 原文（文件或 Redis 后端） */
  private writeNodesRaw(text: string): Promise<void> {
    return getStateStore().set(NODES_KEY, text);
  }

  private serializeNodesYaml(nodes: NodeConfig[]): string {
    const lines = ['nodes:'];
    for (const node of nodes) {
      lines.push(`  - id: ${this.quoteYamlValue(node.id)}`);
      lines.push(`    name: ${this.quoteYamlValue(node.name)}`);
      lines.push(`    host: ${this.quoteYamlValue(node.host)}`);
      lines.push(`    port: ${node.port ?? node.agent?.port ?? 3001}`);
      lines.push(`    secret: ${this.quoteYamlValue(node.secret)}`);
      if (node.kernels.length === 0) lines.push('    kernels: []');
      else {
        lines.push('    kernels:');
        for (const kernel of node.kernels) {
          lines.push(`      - type: ${this.quoteYamlValue(kernel.type)}`);
          if (kernel.configPath) lines.push(`        configPath: ${this.quoteYamlValue(kernel.configPath)}`);
        }
      }
      lines.push(`    location: ${this.quoteYamlValue(node.location)}`);
      lines.push(`    enabled: ${node.enabled}`);
      if (node.ssh) {
        lines.push('    ssh:');
        lines.push(`      user: ${this.quoteYamlValue(node.ssh.user)}`);
        if (node.ssh.port) lines.push(`      port: ${node.ssh.port}`);
        lines.push(`      authMethod: ${this.quoteYamlValue(node.ssh.authMethod)}`);
        if (node.ssh.credentialRef) lines.push(`      credentialRef: ${this.quoteYamlValue(node.ssh.credentialRef)}`);
        if (node.ssh.hostKey) lines.push(`      hostKey: ${this.quoteYamlValue(node.ssh.hostKey)}`);
        if (node.ssh.authMethod === 'password' && node.ssh.password) lines.push(`      password: ${this.quoteYamlValue(node.ssh.password)}`);
      }
      if (node.agent) {
        lines.push('    agent:');
        lines.push(`      deployed: ${node.agent.deployed}`);
        if (node.agent.version) lines.push(`      version: ${this.quoteYamlValue(node.agent.version)}`);
        lines.push(`      status: ${this.quoteYamlValue(node.agent.status)}`);
        if (node.agent.lastDeploy) lines.push(`      lastDeploy: ${this.quoteYamlValue(node.agent.lastDeploy)}`);
        if (node.agent.port) lines.push(`      port: ${node.agent.port}`);
        if (node.agent.deploymentId) lines.push(`      deploymentId: ${this.quoteYamlValue(node.agent.deploymentId)}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  async beginDeployment(nodeId: string, deploymentId: string): Promise<void> {
    await getStateStore().withLock(NODES_KEY, async () => {
      const raw = await this.readNodesRaw();
      if (raw === null) throw new Error(`节点 ${nodeId} 不存在`);
      const parsed = this.parseNodesYaml(raw);
      const node = parsed.nodes.find(item => item.id === nodeId);
      if (!node) throw new Error(`节点 ${nodeId} 不存在`);
      node.agent = {
        deployed: node.agent?.deployed ?? false,
        version: node.agent?.version ?? '',
        status: 'deploying',
        lastDeploy: node.agent?.lastDeploy ?? '',
        port: node.agent?.port ?? node.port ?? 3001,
        deploymentId,
      };
      await this.writeNodesRaw(this.serializeNodesYaml(parsed.nodes));
      await this.loadNodes({ triggerDeploy: false });
    });
  }

  async completeDeploymentIfCurrent(
    nodeId: string,
    deploymentId: string,
    completion: {
      kernels?: NodeKernelConfig[];
      agent: Partial<NodeAgentInfo>;
      hostKey?: string;
    },
  ): Promise<boolean> {
    return getStateStore().withLock(NODES_KEY, async () => {
      const raw = await this.readNodesRaw();
      if (raw === null) return false;
      const parsed = this.parseNodesYaml(raw);
      const node = parsed.nodes.find(item => item.id === nodeId);
      if (!node || node.agent?.deploymentId !== deploymentId) return false;
      if (completion.kernels) node.kernels = validateKernelConfigs(completion.kernels);
      node.agent = { ...node.agent, ...completion.agent, deploymentId };
      if (completion.hostKey && node.ssh && !node.ssh.hostKey) node.ssh.hostKey = completion.hostKey;
      await this.writeNodesRaw(this.serializeNodesYaml(parsed.nodes));
      await this.loadNodes({ triggerDeploy: false });
      return true;
    });
  }

  /** 持久化首次 SSH 连接记录到的 host key */
  async updateNodeSshHostKey(nodeId: string, hostKey: string): Promise<void> {
    if (!hostKey) return;
    // nodes.yaml 是"读-改-写"整体覆盖，必须持锁防止并发更新互相丢失
    await getStateStore().withLock(NODES_KEY, () => this.updateNodeSshHostKeyUnlocked(nodeId, hostKey));
  }

  private async updateNodeSshHostKeyUnlocked(nodeId: string, hostKey: string): Promise<void> {
    const raw = await this.readNodesRaw();
    if (raw === null) return;

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

    await this.writeNodesRaw(lines.join('\n').replace(/\n*$/, '\n'));
    logger.info(`NodeManager: 节点 ${nodeId} SSH host key 已写入 nodes.yaml`);
    await this.loadNodes();
  }

  /** 持久化 Agent 部署状态 */
  async updateNodeAgentInfo(nodeId: string, agent: Partial<NodeAgentInfo>): Promise<void> {
    await getStateStore().withLock(NODES_KEY, () => this.updateNodeAgentInfoUnlocked(nodeId, agent));
  }

  /** 原子替换目标节点的内核列表，并保留节点的其他持久化字段。 */
  async updateNodeKernels(nodeId: string, kernels: NodeKernelConfig[]): Promise<NodeConfig> {
    const normalized = validateKernelConfigs(kernels);
    return getStateStore().withLock(NODES_KEY, async () => {
      const raw = await this.readNodesRaw();
      if (raw === null) throw new Error(`节点 ${nodeId} 不存在`);

      const parsed = this.parseNodesYaml(raw);
      if (!parsed.nodes.some(node => node.id === nodeId)) {
        throw new Error(`节点 ${nodeId} 不存在`);
      }

      const lines = raw.split('\n');
      let nodeStart = -1;
      let nodeEnd = lines.length;
      for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        const indent = lines[index].length - lines[index].trimStart().length;
        if (indent !== 2 || !trimmed.startsWith('- id:')) continue;
        if (nodeStart !== -1) {
          nodeEnd = index;
          break;
        }
        if (this.extractYamlValue(trimmed, 'id') === nodeId) nodeStart = index;
      }

      if (nodeStart === -1) throw new Error(`节点 ${nodeId} 不存在`);
      let kernelsStart = -1;
      let kernelsEnd = nodeEnd;
      for (let index = nodeStart + 1; index < nodeEnd; index++) {
        const trimmed = lines[index].trim();
        const indent = lines[index].length - lines[index].trimStart().length;
        if (indent === 4 && trimmed === 'kernels:') {
          kernelsStart = index;
          continue;
        }
        if (kernelsStart !== -1 && trimmed && indent <= 4) {
          kernelsEnd = index;
          break;
        }
      }
      if (kernelsStart === -1) throw new Error(`节点 ${nodeId} 缺少 kernels`);

      const replacement = ['    kernels:'];
      for (const kernel of normalized) {
        replacement.push(`      - type: ${this.quoteYamlValue(kernel.type)}`);
        if (kernel.configPath) {
          replacement.push(`        configPath: ${this.quoteYamlValue(kernel.configPath)}`);
        }
      }
      lines.splice(kernelsStart, kernelsEnd - kernelsStart, ...replacement);
      const updatedRaw = lines.join('\n').replace(/\n*$/, '\n');
      await this.writeNodesRaw(updatedRaw);
      const updated = this.parseNodesYaml(updatedRaw).nodes.find(node => node.id === nodeId);
      if (!updated) throw new Error(`节点 ${nodeId} 不存在`);
      await this.loadNodes({ triggerDeploy: false });
      return updated;
    });
  }

  private async updateNodeAgentInfoUnlocked(nodeId: string, agent: Partial<NodeAgentInfo>): Promise<void> {
    const raw = await this.readNodesRaw();
    if (raw === null) return;

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

    await this.writeNodesRaw(lines.join('\n').replace(/\n*$/, '\n'));
    logger.info(`NodeManager: 节点 ${nodeId} Agent 状态已写入 nodes.yaml`);
    await this.loadNodes({ triggerDeploy: false });
  }

  /** 将节点写入 nodes.yaml（追加或创建） */
  async writeNodeWithPrivateKey(node: NodeConfig, privateKey?: string): Promise<NodeConfig> {
    if (!node.ssh) return this.writeNodeToYaml(node);

    if (!node.ssh.user.trim()) {
      throw new Error('SSH 用户名不能为空');
    }

    if (node.ssh.authMethod === 'password') {
      if (!node.ssh.password?.trim()) throw new Error('SSH 密码不能为空');
      if (privateKey) throw new Error('密码认证不能同时上传 SSH 私钥');
      delete node.ssh.credentialRef;
      delete node.ssh.keyPath;
      return this.writeNodeToYaml(node);
    }

    if (node.ssh.password) throw new Error('私钥认证不能同时提交 SSH 密码');
    if (!privateKey) throw new Error('请选择 SSH 私钥文件');
    validateUploadedPrivateKey(privateKey);

    if (!node.id) node.id = 'node-' + crypto.randomBytes(2).toString('hex');
    const credentialRef = `ssh-keys/${encodeURIComponent(node.id)}`;
    node.ssh.credentialRef = credentialRef;
    delete node.ssh.keyPath;

    const store = getStateStore();
    const previousPrivateKey = await store.get(credentialRef);
    await store.set(credentialRef, privateKey);
    try {
      return await this.writeNodeToYaml(node);
    } catch (error) {
      if (previousPrivateKey === null) await store.del(credentialRef);
      else await store.set(credentialRef, previousPrivateKey);
      throw error;
    }
  }

  async getNodePrivateKey(node: NodeConfig): Promise<string> {
    if (node.ssh?.authMethod !== 'privateKey' || !node.ssh.credentialRef) {
      throw new Error('节点未配置可用的 SSH 私钥文件');
    }

    const privateKey = await getStateStore().get(node.ssh.credentialRef);
    if (!privateKey) throw new Error('节点的 SSH 私钥文件不存在，请重新上传');
    validateUploadedPrivateKey(privateKey);
    return privateKey;
  }

  async writeNodeToYaml(node: NodeConfig): Promise<NodeConfig> {
    return getStateStore().withLock(NODES_KEY, () => this.writeNodeToYamlUnlocked(node));
  }

  private async writeNodeToYamlUnlocked(node: NodeConfig): Promise<NodeConfig> {
    node.kernels = validateKernelConfigs(node.kernels, { allowEmpty: true });
    // 重新加载现有节点以检查重复
    await this.loadNodes({ triggerDeploy: false });
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
    const existing = await this.readNodesRaw();

    if (existing !== null) {
      // Append to existing document
      lines.push(existing.trimEnd());
      if (!existing.endsWith('\n')) lines.push('');
    } else {
      lines.push('nodes:');
    }

    // Build node entry
    lines.push(`  - id: ${this.quoteYamlValue(node.id)}`);
    if (node.name) lines.push(`    name: ${this.quoteYamlValue(node.name)}`);
    if (node.host) lines.push(`    host: ${this.quoteYamlValue(node.host)}`);
    lines.push(`    port: ${node.port ?? node.agent?.port ?? 3001}`);
    if (node.secret) lines.push(`    secret: ${this.quoteYamlValue(node.secret)}`);
    if (node.kernels.length === 0) lines.push('    kernels: []');
    else {
      lines.push('    kernels:');
      for (const kernel of node.kernels) {
        lines.push(`      - type: ${this.quoteYamlValue(kernel.type)}`);
        if (kernel.configPath) lines.push(`        configPath: ${this.quoteYamlValue(kernel.configPath)}`);
      }
    }
    if (node.location) lines.push(`    location: ${this.quoteYamlValue(node.location)}`);
    lines.push(`    enabled: ${node.enabled}`);

    if (node.ssh) {
      lines.push(`    ssh:`);
      lines.push(`      user: ${this.quoteYamlValue(node.ssh.user)}`);
      if (node.ssh.port) lines.push(`      port: ${node.ssh.port}`);
      lines.push(`      authMethod: ${this.quoteYamlValue(node.ssh.authMethod)}`);
      if (node.ssh.credentialRef) lines.push(`      credentialRef: ${this.quoteYamlValue(node.ssh.credentialRef)}`);
      if (node.ssh.hostKey) lines.push(`      hostKey: ${this.quoteYamlValue(node.ssh.hostKey)}`);
      if (node.ssh.authMethod === 'password' && node.ssh.password) {
        lines.push(`      password: ${this.quoteYamlValue(node.ssh.password)}`);
      }
    }

    if (node.agent) {
      lines.push(`    agent:`);
      lines.push(`      deployed: ${node.agent.deployed}`);
      if (node.agent.version) lines.push(`      version: ${this.quoteYamlValue(node.agent.version)}`);
      lines.push(`      status: ${this.quoteYamlValue(node.agent.status)}`);
      if (node.agent.lastDeploy) lines.push(`      lastDeploy: ${this.quoteYamlValue(node.agent.lastDeploy)}`);
      if (node.agent.port) lines.push(`      port: ${node.agent.port}`);
      if (node.agent.deploymentId) lines.push(`      deploymentId: ${this.quoteYamlValue(node.agent.deploymentId)}`);
    }

    await this.writeNodesRaw(lines.join('\n') + '\n');
    logger.info(`NodeManager: 节点 ${node.id} 已写入 nodes.yaml`);

    // 重新加载节点
    await this.loadNodes({ triggerDeploy: false });

    // 如果有 SSH 配置且 agent 未部署，触发自动部署
    if (this.operations.canAutoDeploy(node)) {
      logger.info(`NodeManager: 触发自动部署节点 ${node.id}`);
      this.operations.deploy(node)?.catch(err => {
        logger.error(`NodeManager: 自动部署节点 ${node.id} 失败: ${err.message}`);
      });
    }

    return node;
  }

  /** 启动 nodes.yaml 文件监听（热加载，仅文件后端有意义） */
  startWatch(): void {
    if (this.watcher) return; // 防止重复启动
    if (getStateStore().kind !== 'file') {
      logger.info('NodeManager: 非文件后端，跳过 nodes.yaml 监听');
      return;
    }

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
          try {
            await this.loadNodes();
          } catch (error) {
            logger.error(
              `NodeManager: nodes.yaml 热加载失败，保留上次节点状态: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
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
    const raw = await this.readNodesRaw();
    if (raw === null) {
      this.nodes = [];
      logger.info('NodeManager: nodes.yaml 不存在，运行在单机模式');
      return [];
    }

    let parsed: NodesYaml;
    try {
      parsed = this.parseNodesYaml(raw);
    } catch (error) {
      logger.error(`NodeManager: 加载 nodes.yaml 失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    const loadedNodes = parsed.nodes.filter(n => n.enabled);
    this.nodes = loadedNodes;
    logger.info(`NodeManager: 加载了 ${this.nodes.length} 个节点`);

    // 自动部署：对已配置 SSH 但 agent 未部署的节点触发部署
    if (options.triggerDeploy !== false) {
      const deployable = this.nodes.filter(
        n => this.operations.canAutoDeploy(n),
      );
      for (const node of deployable) {
        logger.info(`NodeManager: 触发自动部署节点 ${node.id}`);
        this.operations.deploy(node)?.catch(err => {
          logger.error(`NodeManager: 自动部署节点 ${node.id} 失败: ${err.message}`);
        });
      }
    }

    return this.nodes;
  }

  /** 简易 YAML 解析（只解析 nodes 数组） */
  private parseNodesYaml(raw: string): NodesYaml {
    const nodes: NodeConfig[] = [];
    let current: Partial<NodeConfig> = {};
    let subSection = '';
    let currentKernel: Record<string, unknown> | null = null;
    let kernelsSectionSeen = false;
    let kernelsExplicitEmpty = false;
    const lines = raw.split('\n');

    const finishNode = () => {
      if (!current.id) return;
      if (Array.isArray(current.kernels) && current.kernels.length === 0 && !kernelsExplicitEmpty) {
        throw new Error('至少选择一个内核');
      }
      current.kernels = validateKernelConfigs(current.kernels, { allowEmpty: true });
      nodes.push(current as NodeConfig);
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;
      const indent = line.length - line.trimStart().length;

      if (indent === 2 && trimmed.startsWith('- id:')) {
        finishNode();
        current = { id: this.extractYamlValue(trimmed, 'id') };
        subSection = '';
        currentKernel = null;
        kernelsSectionSeen = false;
        kernelsExplicitEmpty = false;
      } else if (indent === 4 && trimmed === 'kernels: []') {
        if (kernelsSectionSeen) throw new Error('kernels 字段重复');
        kernelsSectionSeen = true;
        kernelsExplicitEmpty = true;
        subSection = '';
        current.kernels = [];
        currentKernel = null;
      } else if (indent === 4 && trimmed.startsWith('kernels:') && trimmed !== 'kernels:') {
        throw new Error('kernels 必须是 YAML 序列');
      } else if (indent === 4 && trimmed === 'kernels:') {
        if (kernelsSectionSeen) throw new Error('kernels 字段重复');
        kernelsSectionSeen = true;
        subSection = 'kernels';
        current.kernels = [];
        currentKernel = null;
      } else if (indent === 4 && trimmed === 'ssh:') {
        subSection = 'ssh';
        current.ssh = { user: 'root', authMethod: 'password', hostKey: '' };
      } else if (indent === 4 && trimmed === 'agent:') {
        subSection = 'agent';
        current.agent = { deployed: false, version: '', status: 'not_deployed', lastDeploy: '' };
      } else if (subSection === 'kernels' && indent === 6 && /^- type:\s+.+$/.test(trimmed)) {
        const rawType = trimmed.slice(trimmed.indexOf(':') + 1).trim();
        if (/^[[{!&*]/.test(rawType)) {
          throw new Error('内核类型必须是标量');
        }
        currentKernel = { type: this.extractYamlValue(trimmed, 'type') };
        (current.kernels as unknown[]).push(currentKernel);
      } else if (subSection === 'kernels' && indent === 8 && /^configPath:\s+.+$/.test(trimmed) && currentKernel) {
        if (Object.prototype.hasOwnProperty.call(currentKernel, 'configPath')) {
          throw new Error('内核配置字段重复: configPath');
        }
        const rawConfigPath = trimmed.slice(trimmed.indexOf(':') + 1).trim();
        if (/^[[{!&*]/.test(rawConfigPath)) {
          throw new Error('内核配置路径必须是标量');
        }
        currentKernel.configPath = this.extractYamlValue(trimmed, 'configPath');
      } else if (subSection === 'kernels' && indent > 4) {
        throw new Error(`无效的 kernels YAML: ${trimmed}`);
      } else if (subSection === 'ssh' && indent === 6) {
        if (trimmed.startsWith('user:')) current.ssh!.user = this.extractYamlValue(trimmed, 'user');
        else if (trimmed.startsWith('port:')) current.ssh!.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 22;
        else if (trimmed.startsWith('authMethod:')) current.ssh!.authMethod = this.extractYamlValue(trimmed, 'authMethod') as SshAuthMethod;
        else if (trimmed.startsWith('credentialRef:')) current.ssh!.credentialRef = this.extractYamlValue(trimmed, 'credentialRef');
        else if (trimmed.startsWith('keyPath:')) {
          current.ssh!.keyPath = this.extractYamlValue(trimmed, 'keyPath');
          current.ssh!.authMethod = 'privateKey';
        }
        else if (trimmed.startsWith('hostKey:')) current.ssh!.hostKey = this.extractYamlValue(trimmed, 'hostKey');
        else if (trimmed.startsWith('password:')) current.ssh!.password = this.extractYamlValue(trimmed, 'password');
      } else if (subSection === 'agent' && indent === 6) {
        if (trimmed.startsWith('deployed:')) current.agent!.deployed = this.extractYamlValue(trimmed, 'deployed') === 'true';
        else if (trimmed.startsWith('version:')) current.agent!.version = this.extractYamlValue(trimmed, 'version');
        else if (trimmed.startsWith('status:')) current.agent!.status = this.extractYamlValue(trimmed, 'status') as NodeAgentInfo['status'];
        else if (trimmed.startsWith('lastDeploy:')) current.agent!.lastDeploy = this.extractYamlValue(trimmed, 'lastDeploy');
        else if (trimmed.startsWith('port:')) current.agent!.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 3001;
        else if (trimmed.startsWith('deploymentId:')) current.agent!.deploymentId = this.extractYamlValue(trimmed, 'deploymentId');
      } else if (indent === 4 && trimmed.startsWith('name:')) {
        subSection = '';
        current.name = this.extractYamlValue(trimmed, 'name');
      } else if (indent === 4 && trimmed.startsWith('host:')) {
        subSection = '';
        current.host = this.extractYamlValue(trimmed, 'host');
      } else if (indent === 4 && trimmed.startsWith('port:')) {
        subSection = '';
        current.port = parseInt(this.extractYamlValue(trimmed, 'port'), 10) || 3001;
      } else if (indent === 4 && trimmed.startsWith('secret:')) {
        subSection = '';
        current.secret = this.extractYamlValue(trimmed, 'secret');
      } else if (indent === 4 && trimmed.startsWith('location:')) {
        subSection = '';
        current.location = this.extractYamlValue(trimmed, 'location');
      } else if (indent === 4 && trimmed.startsWith('enabled:')) {
        subSection = '';
        current.enabled = this.extractYamlValue(trimmed, 'enabled') !== 'false';
      }
    }
    finishNode();
    return { nodes };
  }

  private extractYamlValue(line: string, _key: string): string {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return '';
    const val = line.substring(colonIdx + 1).trim();
    if (val.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(val);
        if (typeof decoded !== 'string') throw new Error('值不是字符串');
        return decoded;
      } catch {
        throw new Error(`无效的 YAML 双引号字符串: ${_key}`);
      }
    }
    if (val.startsWith("'") && val.endsWith("'")) {
      return val.slice(1, -1).replace(/''/g, "'");
    }
    return val;
  }

  private quoteYamlValue(value: string): string {
    return JSON.stringify(value);
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

  async collectRemoteNodeSources(): Promise<{ sources: CollectedProxySource[]; errors: string[] }> {
    await this.loadNodes({ triggerDeploy: false });

    return this.collectRemoteNodeSourcesFrom(this.nodes);
  }

  private async collectRemoteNodeSourcesFrom(
    nodes: NodeConfig[],
  ): Promise<{ sources: CollectedProxySource[]; errors: string[] }> {
    const sources: CollectedProxySource[] = [];
    const errors: string[] = [];
    const results = await Promise.allSettled(
      nodes
        .filter(node => node.enabled !== false)
        .map(async (node) => {
          try {
            const json = await this.fetchRemoteJson(node, '/api/urls');
            const data = json.data || json;
            const kernels = this.validateRemoteKernelStatuses(data.kernels);
            const remoteSources = this.validateRemoteSources(data.sources);
            this.validateRemoteSourceConsistency(remoteSources, kernels);
            const availableKernels = new Set(
              kernels
                .filter(kernel => kernel.monitored && kernel.accessible)
                .map(kernel => kernel.type),
            );
            const orderedSources = remoteSources
              .filter(source => availableKernels.has(source.kernel))
              .sort((a, b) => KERNEL_TYPES.indexOf(a.kernel) - KERNEL_TYPES.indexOf(b.kernel));
            const kernelErrors = kernels
              .filter(kernel => (kernel.monitored && !kernel.accessible) || kernel.error)
              .map(kernel => this.formatRemoteSourceError(
                node,
                `内核 ${kernel.type}: ${kernel.error || '已监控但不可访问'}`,
              ));
            return {
              sources: orderedSources.map(source => ({
                ...source,
                nodeId: node.id,
                location: node.location,
              })),
              errors: kernelErrors,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { sources: [], errors: [this.formatRemoteSourceError(node, message)] };
          }
        }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sources.push(...result.value.sources);
        errors.push(...result.value.errors);
      } else {
        errors.push(result.reason?.message || String(result.reason));
      }
    }

    return { sources, errors };
  }

  private validateRemoteSources(value: unknown): Array<{ kernel: typeof KERNEL_TYPES[number]; url: string }> {
    if (!Array.isArray(value)) throw new Error('Agent 返回了无效的代理来源');
    return value.map(item => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('Agent 返回了无效的代理来源');
      }
      const source = item as Record<string, unknown>;
      if (Object.keys(source).some(key => key !== 'kernel' && key !== 'url') ||
          typeof source.kernel !== 'string' || !KERNEL_TYPES.includes(source.kernel as typeof KERNEL_TYPES[number]) ||
          typeof source.url !== 'string' || source.url.length === 0) {
        throw new Error('Agent 返回了无效的代理来源');
      }
      return {
        kernel: source.kernel as typeof KERNEL_TYPES[number],
        url: source.url,
      };
    });
  }

  private validateRemoteSourceConsistency(
    sources: Array<{ kernel: typeof KERNEL_TYPES[number]; url: string }>,
    kernels: KernelRuntimeStatus[],
  ): void {
    if (new Set(sources.map(source => source.url)).size !== sources.length) {
      throw new Error('Agent 返回了重复的代理来源');
    }
    for (const kernel of kernels) {
      const sourceCount = sources.filter(source => source.kernel === kernel.type).length;
      if (sourceCount !== kernel.nodesCount) {
        throw new Error(`Agent 内核 ${kernel.type} 的来源数量与 nodesCount 不一致`);
      }
    }
    for (const source of sources) {
      const status = kernels.find(kernel => kernel.type === source.kernel);
      if (!status || !status.monitored || !status.accessible) {
        throw new Error(`Agent 来源 ${source.kernel} 没有匹配的可用内核状态`);
      }
    }
  }

  private formatRemoteSourceError(node: NodeConfig, message: string): string {
    return `节点 ${node.name} (${node.id}): ${message}`;
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
      configuredKernels: node.kernels.map(kernel => ({
        type: kernel.type,
        ...(kernel.configPath ? { configPath: kernel.configPath } : {}),
      })),
      kernels: createUnavailableKernelStatuses(node.kernels),
      location: node.location,
      online: false,
    };

    try {
      const json = await this.fetchRemoteJson(node, '/api/status');
      const data = json.data || json;
      const kernels = this.validateRemoteKernelStatuses(data.kernels);

      const status: NodeStatus = {
        ...baseStatus,
        online: true,
        latency: 0, // will be set by health check
        kernels,
        nodesCount: kernels.reduce((sum, kernel) => sum + kernel.nodesCount, 0),
        subscriptionExists: data.subscriptionExists,
        clashExists: data.clashExists,
        mihomoAvailable: data.mihomoAvailable,
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

  private validateRemoteKernelStatuses(value: unknown): KernelRuntimeStatus[] {
    if (!Array.isArray(value) || value.length !== KERNEL_TYPES.length) {
      throw new Error('Agent 返回了无效的内核状态');
    }
    const seen = new Set<string>();
    const allowedKeys = new Set([
      'type', 'detected', 'monitored', 'accessible', 'nodesCount',
      'version', 'configPaths', 'error',
    ]);
    for (const item of value) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error('Agent 返回了无效的内核状态');
      }
      const status = item as Record<string, unknown>;
      if (Object.keys(status).some(key => !allowedKeys.has(key)) ||
          typeof status.type !== 'string' || !KERNEL_TYPES.includes(status.type as typeof KERNEL_TYPES[number]) ||
          seen.has(status.type) || typeof status.detected !== 'boolean' ||
          typeof status.monitored !== 'boolean' || typeof status.accessible !== 'boolean' ||
          typeof status.nodesCount !== 'number' || !Number.isInteger(status.nodesCount) || status.nodesCount < 0 ||
          !Array.isArray(status.configPaths) || !status.configPaths.every(path => typeof path === 'string') ||
          (status.version !== undefined && typeof status.version !== 'string') ||
          (status.error !== undefined && typeof status.error !== 'string')) {
        throw new Error('Agent 返回了无效的内核状态');
      }
      seen.add(status.type);
    }
    if (KERNEL_TYPES.some(type => !seen.has(type))) {
      throw new Error('Agent 返回了无效的内核状态');
    }
    return value as KernelRuntimeStatus[];
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

  async getRemoteLogs(
    nodeId: string,
    options: { file?: string; level?: string; query?: string } = {},
  ): Promise<LogsResult> {
    await this.loadNodes({ triggerDeploy: false });
    const node = this.nodes.find(item => item.id === nodeId);
    if (!node) {
      throw new Error(`节点 ${nodeId} 不存在`);
    }

    const params = new URLSearchParams();
    if (options.file) params.set('file', options.file);
    if (options.level && options.level !== 'all') params.set('level', options.level);
    if (options.query) params.set('q', options.query);
    const reqPath = `/api/logs${params.toString() ? `?${params.toString()}` : ''}`;
    const json = await this.fetchRemoteJson(node, reqPath);
    const data = json.data || json;
    return {
      file: data.file || options.file || 'journalctl',
      files: Array.isArray(data.files) ? data.files : ['journalctl'],
      lines: Array.isArray(data.lines) ? data.lines : [],
      updatedAt: data.updatedAt || new Date().toISOString(),
      nodeId: data.nodeId || node.id,
      nodeName: data.nodeName || node.name,
    };
  }

  // ==================== 集群聚合操作 ====================

  /** 聚合集群状态 */
  async getClusterStatus(): Promise<ClusterStatus> {
    await this.loadNodes({ triggerDeploy: false });

    const nodes = [...this.nodes];
    const allStatuses: NodeStatus[] = [];
    const sourcePromise = this.collectRemoteNodeSourcesFrom(nodes);

    if (nodes.length > 0) {
      const remoteResults = await Promise.allSettled(
        nodes.map(node => this.fetchRemoteStatus(node))
      );

      for (const result of remoteResults) {
        if (result.status === 'fulfilled') {
          allStatuses.push(result.value);
        }
        // rejected results are silently skipped — the node will be missing from the cluster view
      }
    }

    const { sources } = await sourcePromise;
    return this.buildClusterStatus(allStatuses, dedupeProxySources(sources).length);
  }

  /** 构建 ClusterStatus */
  private buildClusterStatus(allStatuses: NodeStatus[], totalProxies: number): ClusterStatus {
    const onlineNodes = allStatuses.filter(n => n.online);
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
