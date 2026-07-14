import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)
  const healthCheckedRef = useRef(false)

  useEffect(() => {
    if (healthCheckedRef.current) return
    healthCheckedRef.current = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch('/health', { signal: controller.signal })
      .then(res => { setBackendReachable(res.ok); clearTimeout(timer) })
      .catch(() => { setBackendReachable(false); clearTimeout(timer) })
  }, [])

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
