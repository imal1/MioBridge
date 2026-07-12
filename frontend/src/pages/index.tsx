import type { GetServerSideProps } from 'next'
import dynamic from 'next/dynamic'
import type { ClusterStatus } from '@/server/types'
import type { ApiStatus } from '@/lib/api'

const Dashboard = dynamic(() => import('@/components/Dashboard'), {
  ssr: false,
  loading: () => (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">总览</h1>
        <p className="mt-1 text-sm text-muted-foreground">正在加载订阅和集群状态。</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </main>
  ),
})

interface HomeProps {
  initialCluster: ClusterStatus | null
  initialStatus: ApiStatus | null
  initialError: string | null
}

export default function Home({ initialCluster, initialStatus, initialError }: HomeProps) {
  return <Dashboard initialCluster={initialCluster} initialStatus={initialStatus} initialError={initialError} />
}

// 服务端渲染：同进程内直接调用服务，不自调用 HTTP
export const getServerSideProps: GetServerSideProps<HomeProps> = async () => {
  try {
    const { mioBridgeCore, nodeAggregation } = await import('@/server/core')
    const [cluster, status] = await Promise.all([
      nodeAggregation.getClusterStatus(),
      mioBridgeCore.getStatus(),
    ])
    return {
      props: {
        initialCluster: JSON.parse(JSON.stringify(cluster)) as ClusterStatus,
        initialStatus: JSON.parse(JSON.stringify(status)) as ApiStatus,
        initialError: null,
      },
    }
  } catch (error) {
    return {
      props: {
        initialCluster: null,
        initialStatus: null,
        initialError: error instanceof Error ? error.message : '获取集群状态失败',
      },
    }
  }
}
