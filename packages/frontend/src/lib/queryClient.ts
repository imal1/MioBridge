import { QueryClient, QueryCache } from '@tanstack/react-query'
import { toast } from 'sonner'

// 后台刷新失败（该 query 已有缓存数据显示在屏上）弹 toast 提示。首次加载失败
// 由 <QueryBoundary> 渲染内联错误卡，因此这里必须跳过（data === undefined），
// 否则同一次失败会既弹 toast 又显示错误卡。
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.state.data === undefined) return
        const message = error instanceof Error ? error.message : '后台刷新失败'
        toast.error('数据刷新失败', { description: message })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 300_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export const queryClient = makeQueryClient()
