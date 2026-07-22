import type { UseQueryResult } from '@tanstack/react-query'
import { Icon } from '@iconify/react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface QueryBoundaryProps<T> {
  query: Pick<UseQueryResult<T>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>
  skeleton?: React.ReactNode
  isEmpty?: (data: T) => boolean
  empty?: React.ReactNode
  children: (data: T) => React.ReactNode
}

export function QueryBoundary<T>({ query, skeleton, isEmpty, empty, children }: QueryBoundaryProps<T>) {
  if (query.isPending) {
    return <>{skeleton ?? <Skeleton className="h-40 w-full" />}</>
  }
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : '加载失败'
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <Icon icon="ph:warning-circle-light" className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{message}</p>
        <Button size="sm" variant="outline" onClick={() => { void query.refetch() }}>重试</Button>
      </div>
    )
  }
  const data = query.data as T
  if (isEmpty?.(data)) {
    return <>{empty ?? <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>}</>
  }
  return <>{children(data)}</>
}
