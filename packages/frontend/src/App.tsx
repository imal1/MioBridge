import React, { Suspense, lazy } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './components/ThemeProvider';
import { AppProvider, useAppContext } from './context/AppContext';
import AppLayout from './components/layout/AppLayout';

const ConvertModal = lazy(() => import('./components/ConvertModal'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const ConfigPage = lazy(() => import('./pages/config'));
const NodesPage = lazy(() => import('./pages/nodes'));
const DeployPage = lazy(() => import('./pages/deploy'));
const AgentsPage = lazy(() => import('./pages/agents'));
const RuntimesPage = lazy(() => import('./pages/runtimes'));
const LogsPage = lazy(() => import('./pages/logs'));
const SubscriptionPage = lazy(() => import('./pages/subscription'));
const OutputsPage = lazy(() => import('./pages/outputs'));
const SubscriptionStatusPage = lazy(() => import('./pages/subscription-status'));
const ApiDocsPage = lazy(() => import('./pages/api-docs'));

const pageTransition = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.62, ease: [0.32, 0.72, 0, 1] },
} as const;

function PageLoader() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </main>
  );
}

function GlobalModals() {
  const { convertModalOpen, closeConvertModal } = useAppContext();
  return (
    <Suspense fallback={null}>
      <ConvertModal isOpen={convertModalOpen} onClose={closeConvertModal} />
    </Suspense>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AppLayout>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={location.pathname} {...pageTransition}>
          <Suspense fallback={<PageLoader />}>
            <Routes location={location}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/nodes" element={<NodesPage />} />
              <Route path="/deploy" element={<DeployPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/runtimes" element={<RuntimesPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/subscription" element={<SubscriptionPage />} />
              <Route path="/outputs" element={<OutputsPage />} />
              <Route path="/subscription-status" element={<SubscriptionStatusPage />} />
              <Route path="/actions" element={<Navigate replace to="/subscription" />} />
              <Route path="/api-docs" element={<ApiDocsPage />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <GlobalModals />
    </AppLayout>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AnimatedRoutes />
        <Toaster richColors position="top-center" />
      </AppProvider>
    </ThemeProvider>
  );
}
