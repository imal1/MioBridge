// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddNodeForm } from '@/components/cluster/AddNodeForm'

const passedPreflight = {
  success: true,
  data: {
    hostKey: 'sha256:fingerprint', architecture: 'x86_64',
    checks: [
      { key: 'ssh', label: 'SSH 认证', ok: true, detail: '连接与认证成功' },
      { key: 'systemd', label: 'systemd', ok: true, detail: '/usr/bin/systemctl' },
    ],
  },
  timestamp: '',
}

function fillPasswordForm() {
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新加坡' } })
  fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: 'sg.example.com' } })
  fireEvent.change(screen.getByLabelText('地域标签'), { target: { value: 'SG' } })
  fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } })
}

describe('AddNodeForm', () => {
  it('renders node and SSH fields without deployment controls', () => {
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} />)
    expect(screen.getByText('SSH 连接信息')).toBeDefined()
    expect(screen.getByRole('button', { name: '执行 SSH 预检' })).toBeDefined()
    expect(screen.queryByText('选择监听内核')).toBeNull()
  })

  it('uploads private-key files instead of accepting key text', async () => {
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '私钥' }))
    const file = new File(['private-key-content'], 'id_ed25519')
    fireEvent.change(screen.getByLabelText('SSH 私钥文件'), { target: { files: [file] } })
    await screen.findByText('id_ed25519')
    expect(screen.queryByLabelText('SSH 密码')).toBeNull()
  })

  it('runs SSH preflight, confirms host key, and creates only the node record', async () => {
    const preflightNode = vi.fn(async () => passedPreflight)
    const createNode = vi.fn(async () => ({ success: true, data: { id: 'node-sg' }, timestamp: '' }))
    const deployNode = vi.fn()
    const onComplete = vi.fn()
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={onComplete} preflightNode={preflightNode} createNode={createNode} deployNode={deployNode} />)
    fillPasswordForm()
    fireEvent.click(screen.getByRole('button', { name: '执行 SSH 预检' }))
    expect(await screen.findByText('主机指纹：')).toBeDefined()
    expect(preflightNode).toHaveBeenCalledWith({ host: 'sg.example.com', user: 'root', port: 22, authMethod: 'password', password: 'secret' })
    fireEvent.click(screen.getByRole('button', { name: '确认指纹并保存节点' }))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('node-sg'))
    expect(createNode).toHaveBeenCalledWith(expect.objectContaining({
      name: '新加坡', host: 'sg.example.com', location: 'SG', kernels: [], sshHostKey: 'sha256:fingerprint',
    }))
    expect(deployNode).not.toHaveBeenCalled()
  })

  it('keeps form values and creates nothing when preflight fails', async () => {
    const preflightNode = vi.fn(async () => { throw new Error('SSH 连接失败') })
    const createNode = vi.fn()
    render(<AddNodeForm isOpen onClose={() => {}} onComplete={() => {}} preflightNode={preflightNode} createNode={createNode} />)
    fillPasswordForm()
    fireEvent.click(screen.getByRole('button', { name: '执行 SSH 预检' }))
    expect(await screen.findByText('SSH 连接失败')).toBeDefined()
    expect((screen.getByLabelText('节点名称') as HTMLInputElement).value).toBe('新加坡')
    expect(createNode).not.toHaveBeenCalled()
  })
})

describe('DeployProgressDialog', () => {
  it('renders current agent deployment progress', async () => {
    const { DeployProgressDialog } = await import('@/components/cluster/DeployProgressDialog')
    render(<DeployProgressDialog isOpen nodeName="新加坡" status={{ nodeId: 'node-sg', deploymentId: 'deploy-sg', step: 'agent', status: 'running', message: '下载并安装已校验 Agent...', progress: 40, startedAt: Date.now() }} onClose={() => {}} />)
    expect(screen.getByText('正在部署 新加坡')).toBeDefined()
    expect(screen.getByText('下载并安装已校验 Agent...')).toBeDefined()
  })
})
