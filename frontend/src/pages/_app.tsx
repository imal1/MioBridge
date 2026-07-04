import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { AnimatePresence, motion } from 'motion/react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AppProvider, useAppContext } from '@/context/AppContext'
import AppLayout from '@/components/layout/AppLayout'
import { Toaster } from '@/components/ui/sonner'
import '@/styles/globals.css'

const ConvertModal = dynamic(() => import('@/components/ConvertModal'), {
  ssr: false,
})

const pageTransition = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.62, ease: [0.32, 0.72, 0, 1] },
} as const

function GlobalModals() {
  const { convertModalOpen, closeConvertModal } = useAppContext()
  return <ConvertModal isOpen={convertModalOpen} onClose={closeConvertModal} />
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()

  return (
    <ThemeProvider>
      <AppProvider>
        <AppLayout>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={router.asPath} {...pageTransition}>
              <Component {...pageProps} />
            </motion.div>
          </AnimatePresence>
        </AppLayout>
        <GlobalModals />
        <Toaster richColors position="top-center" />
      </AppProvider>
    </ThemeProvider>
  )
}
