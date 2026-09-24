import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UpdateResult } from '@/lib/api'

interface AppContextValue {
  updateResult: UpdateResult | null
  setUpdateResult: (r: UpdateResult | null) => void
  convertModalOpen: boolean
  openConvertModal: () => void
  closeConvertModal: () => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  mobileDrawerOpen: boolean
  setMobileDrawerOpen: (v: boolean) => void
  backendReachable: boolean | null
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [convertModalOpen, setConvertModalOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const healthQuery = useQuery({
    queryKey: ['backend-health'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/health', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      })
      if (!response.ok) throw new Error('后端健康检查失败')
      const health: unknown = await response.json()
      if (!health || typeof health !== 'object' || !('status' in health) || health.status !== 'healthy') {
        throw new Error('后端健康检查响应无效')
      }
      return true
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const backendReachable = healthQuery.isPending ? null : !healthQuery.isError

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed')
      if (saved !== null) setSidebarCollapsedState(saved === 'true')
    } catch {}
  }, [])

  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v)
    try { localStorage.setItem('sidebar-collapsed', String(v)) } catch {}
  }, [])

  const openConvertModal = useCallback(() => setConvertModalOpen(true), [])
  const closeConvertModal = useCallback(() => setConvertModalOpen(false), [])

  return (
    <AppContext.Provider value={{
      updateResult, setUpdateResult,
      convertModalOpen, openConvertModal, closeConvertModal,
      sidebarCollapsed, setSidebarCollapsed,
      mobileDrawerOpen, setMobileDrawerOpen,
      backendReachable,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}

export function useBackendReachable() {
  return useContext(AppContext)?.backendReachable ?? null
}

// Provider-safe convert-modal opener: no-ops when rendered outside AppProvider
// (e.g. isolated component tests) instead of throwing.
export function useConvertModal() {
  return { open: useContext(AppContext)?.openConvertModal ?? (() => {}) }
}
