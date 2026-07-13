import { Icon } from '@iconify/react'
import { useCallback, useState } from 'react'
import { apiService } from '@/lib/api'
import { useAppContext } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import SectionHeading from '@/components/shared/SectionHeading'

const FILES = [
  { name: 'subscription.txt', label: '订阅文件',   icon: 'ph:file-text-bold' },
  { name: 'clash.yaml',       label: 'Clash 配置',  icon: 'ph:shield-check-bold' },
  { name: 'raw.txt',          label: '原始链接',    icon: 'ph:link-bold' },
]

export default function ActionsPage() {
  const { updateResult, setUpdateResult, openConvertModal } = useAppContext()
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const handleUpdate = useCallback(async () => {
    setUpdating(true)
    setUpdateResult(null)
    setUpdateError(null)
    try {
      const result = await apiService.updateSubscription()
      setUpdateResult(result)
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : '更新失败')
    } finally {
      setUpdating(false)
    }
  }, [setUpdateResult])

  const handleDownload = (filename: string) => {
    window.open(apiService.getDownloadUrl(filename), '_blank')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      {/* Card 1: Update subscription */}
      <section>
        <SectionHeading icon="ph:arrows-clockwise-bold" title="更新订阅" desc="从源获取最新节点并重新生成配置文件" />
        <div className="garden-card p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              onClick={handleUpdate}
              disabled={updating}
              className="gap-2 h-10 px-5 text-sm font-medium rounded-lg active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: 'none',
              }}
            >
              <Icon
                icon={updating ? 'ph:spinner' : 'ph:arrows-clockwise-bold'}
                className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`}
              />
              {updating ? '更新中…' : '立即更新'}
            </Button>
            {updating && (
              <span className="animate-breathe text-sm" style={{ color: 'var(--muted-foreground)' }}>
                正在拉取最新节点…
              </span>
            )}
          </div>

          {updateError && (
            <div className="garden-alert garden-alert-danger">
              <Icon icon="ph:x-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">更新失败</p>
                <p className="text-sm mt-0.5 opacity-90">{updateError}</p>
              </div>
            </div>
          )}

          {updateResult && (
            <div className={`garden-alert ${updateResult.success ? 'garden-alert-success' : 'garden-alert-danger'}`}>
              <Icon
                icon={updateResult.success ? 'ph:check-circle-bold' : 'ph:x-circle-bold'}
                className="w-5 h-5 flex-shrink-0 mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-semibold">{updateResult.success ? '更新完成' : '更新失败'}</p>
                <p className="text-sm mt-0.5 opacity-90">{updateResult.message}</p>
                {updateResult.success && (
                  <div className="flex flex-wrap gap-3 mt-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                      节点: {updateResult.nodesCount}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                      Clash: {updateResult.clashGenerated ? '已生成' : '未生成'}
                    </span>
                    {updateResult.backupCreated && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                        备份: {updateResult.backupCreated}
                      </span>
                    )}
                  </div>
                )}
                {updateResult.errors && updateResult.errors.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {updateResult.errors.map((e, i) => (
                      <li key={i} className="text-xs opacity-80">· {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Card 2: Download files */}
      <section>
        <SectionHeading icon="ph:download-simple-bold" title="下载文件" desc="下载最新生成的配置文件" />
        <div className="garden-card overflow-hidden">
          {FILES.map((file, i) => (
            <div
              key={file.name}
              className="flex flex-col gap-3 px-5 py-4 transition-colors duration-150 sm:flex-row sm:items-center sm:justify-between"
              style={{
                marginBottom: i < FILES.length - 1 ? '0.25rem' : 0,
                backgroundColor: 'var(--surface-container-lowest)',
                borderRadius: '1rem',
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--muted)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: 'var(--secondary)' }}
                >
                  <Icon icon={file.icon} className="w-4 h-4" style={{ color: 'var(--fern)' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{file.label}</p>
                  <p className="truncate font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>{file.name}</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => handleDownload(file.name)}
                className="h-8 gap-1.5 rounded-lg px-3 text-xs sm:self-auto"
              >
                <Icon icon="ph:download-simple" className="w-3.5 h-3.5" />
                下载
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Card 3: Convert */}
      <section>
        <SectionHeading icon="ph:code-bold" title="订阅转换" desc="将原始订阅链接转换为 Clash 配置" />
        <div className="garden-card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'var(--secondary)' }}
            >
              <Icon icon="ph:magic-wand-bold" className="w-5 h-5" style={{ color: 'var(--fern)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>在线转换器</h3>
              <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
                粘贴原始订阅内容，即时转换为 Clash YAML 配置，支持多种协议。
              </p>
              <Button
                onClick={openConvertModal}
                className="gap-2 h-9 px-4 text-sm font-medium rounded-lg"
                style={{
                  backgroundColor: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  border: 'none',
                }}
              >
                <Icon icon="ph:code-bold" className="w-4 h-4" />
                打开转换器
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
