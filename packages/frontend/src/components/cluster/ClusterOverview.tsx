import StatCard from '@/components/shared/StatCard';
import SectionHeading from '@/components/shared/SectionHeading';
import type { ClusterStatus } from '@/lib/types';
import { getKernelDisplayStatus } from './KernelStatus';

interface ClusterOverviewProps {
  cluster: ClusterStatus;
}

export function ClusterOverview({ cluster }: ClusterOverviewProps) {
  const kernels = cluster.nodes.flatMap(node => node.kernels.map(kernel => ({ node, kernel })));
  const monitoredKernels = kernels.filter(({ kernel }) => kernel.monitored).length;
  const healthyKernels = kernels.filter(({ node, kernel }) => getKernelDisplayStatus(node.online, kernel) === 'normal').length;

  return (
    <section>
      <SectionHeading
        icon="ph:graph-bold"
        title="集群总览"
        desc={`${cluster.totalNodes} 个节点 · ${cluster.onlineNodes} 在线 · 最后更新 ${new Date(cluster.lastUpdated).toLocaleTimeString('zh-CN')}`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 stagger-slide-up">
        <StatCard
          label="在线节点"
          value={cluster.onlineNodes}
          sub={cluster.totalNodes > 0
            ? `${cluster.onlineNodes}/${cluster.totalNodes} 在线`
            : '无节点'}
          icon="ph:wifi-high"
          status={cluster.onlineNodes === cluster.totalNodes ? 'success' : 'warning'}
        />
        <StatCard
          label="监听内核"
          value={monitoredKernels}
          sub="已配置监听"
          icon="ph:cpu"
          status={monitoredKernels > 0 ? 'info' : 'warning'}
        />
        <StatCard
          label="健康内核"
          value={healthyKernels}
          sub={monitoredKernels > 0 ? `${healthyKernels}/${monitoredKernels} 正常` : '无监听内核'}
          icon="ph:heartbeat"
          status={monitoredKernels > 0 && healthyKernels === monitoredKernels ? 'success' : 'warning'}
        />
        <StatCard
          label="代理总数"
          value={cluster.totalProxies}
          sub="全集群代理节点"
          icon="ph:tree-structure"
          status={cluster.totalProxies > 0 ? 'success' : 'warning'}
        />
      </div>
    </section>
  );
}
