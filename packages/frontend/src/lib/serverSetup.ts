import { apiService } from './api';
import type { DeployComponent, DeployOperation, KernelType } from './types';
import { errorMessage } from './errorMessage';

export async function deployAndWait(nodeId: string, component: DeployComponent, operation: DeployOperation, progress: (message: string) => void) {
  const response = await apiService.startComponentDeployment(nodeId, component, operation);
  if (!response.success || !response.data) throw new Error(errorMessage(response.error, '无法启动部署'));
  const deadline = Date.now() + 30 * 60_000;
  while (Date.now() < deadline) {
    const result = await apiService.getComponentDeployment(response.data.taskId);
    if (!result.success || !result.data) throw new Error(errorMessage(result.error, '无法读取部署进度'));
    progress(result.data.message);
    if (result.data.status === 'success') return;
    if (result.data.status === 'error' || result.data.status === 'cancelled') throw new Error(`${result.data.message}。Agent 健康验收失败时请放行 3001/tcp：ufw allow 3001/tcp，或 firewall-cmd --permanent --add-port=3001/tcp && firewall-cmd --reload，并检查云安全组。`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('等待超时，请在服务器任务列表查看进度');
}
export async function adoptAndGenerate(nodeId: string, types: KernelType[]) {
  const adopted = await apiService.updateNodeKernels(nodeId, types.map(type => ({ type })));
  if (!adopted.success) throw new Error(errorMessage(adopted.error, '纳管协议内核失败'));
  const generated = await apiService.startSubscriptionJob();
  if (!generated.success || !generated.data) throw new Error(errorMessage(generated.error, '无法生成订阅'));
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const result = await apiService.getSubscriptionJob(generated.data.jobId);
    if (!result.success || !result.data) throw new Error(errorMessage(result.error, '无法读取订阅进度'));
    if (result.data.status === 'succeeded' || result.data.status === 'partial') return result.data.nodesGenerated;
    if (result.data.status === 'failed' || result.data.status === 'blocked') throw new Error(result.data.message);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('订阅生成仍在进行，请在订阅页查看任务');
}
