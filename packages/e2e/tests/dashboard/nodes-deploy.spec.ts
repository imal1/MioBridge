import type { APIRequestContext, Page, Request } from '@playwright/test'
import { expect, test } from '../../fixtures/e2e.js'

const COMPONENTS = ['agent', 'mihomo', 'sing-box', 'xray', 'v2ray'] as const
const OPERATIONS = ['install', 'reinstall', 'upgrade', 'repair', 'uninstall'] as const
const PREFLIGHT_CHECKS = [
  'DNS 解析',
  'TCP 连接',
  'SSH 认证',
  'Linux 系统',
  'CPU 架构',
  '磁盘空间',
  'systemd',
  '下载工具',
  '管理员权限',
] as const

const PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
e2e-fixture-private-key
-----END OPENSSH PRIVATE KEY-----
`

type SnapshotNode = {
  id?: string
  nodeId?: string
  name: string
  host?: string
  enabled?: boolean
  sshUser?: string
  sshPort?: number
  sshAuthMethod?: 'password' | 'privateKey'
  sshHostKey?: string
  ssh?: { hostKey?: string }
  configuredKernels?: Array<{ type: string; configPath?: string }>
  agent?: { deployed?: boolean; status?: string }
}

type DeploymentTask = {
  taskId: string
  idempotencyKey?: string
  nodeId: string
  component: string
  operation: string
  status: string
  step: string
  progress?: number
  message?: string
  actorRole?: string
  options?: { preserveConfig: boolean; preserveData: boolean }
  retryOf?: string
  beforeVersion?: string
  afterVersion?: string
  errorCode?: string
}

type DeploymentEvent = {
  eventId: string
  taskId: string
  status: string
  step: string
  progress: number
  message: string
  timestamp: string
}

type RecordedRequest = {
  method?: string
  path?: string
  url?: string
  body?: unknown
  json?: unknown
  headers?: Record<string, string>
}

type FixtureSnapshot = {
  readonly nodes: readonly SnapshotNode[]
  readonly deploymentTasks: readonly DeploymentTask[] | Readonly<Record<string, DeploymentTask>>
  readonly requests: readonly RecordedRequest[]
  readonly downloadedManualConfigs?: readonly unknown[] | Readonly<Record<string, unknown>> | number
}

function fixtureSnapshot(value: unknown): FixtureSnapshot {
  return value as FixtureSnapshot
}

function pathname(url: string): string {
  return new URL(url, 'http://e2e.invalid').pathname
}

function nodeId(node: SnapshotNode): string {
  const id = node.id ?? node.nodeId
  if (!id) throw new Error(`Fixture node ${node.name} has no id`)
  return id
}

function remoteNode(state: FixtureSnapshot, predicate: (node: SnapshotNode) => boolean = () => true): SnapshotNode {
  const node = state.nodes.find(candidate => nodeId(candidate) !== 'local' && predicate(candidate))
  if (!node) throw new Error('Fixture does not contain the required remote node')
  return node
}

function tasks(state: FixtureSnapshot): readonly DeploymentTask[] {
  return Array.isArray(state.deploymentTasks)
    ? state.deploymentTasks
    : Object.values(state.deploymentTasks ?? {})
}

function manualDownloadCount(state: FixtureSnapshot): number {
  if (typeof state.downloadedManualConfigs === 'number') return state.downloadedManualConfigs
  if (Array.isArray(state.downloadedManualConfigs)) return state.downloadedManualConfigs.length
  return Object.keys(state.downloadedManualConfigs ?? {}).length
}

function requestPath(request: RecordedRequest): string {
  return pathname(request.path ?? request.url ?? '/')
}

function expectNoSensitiveFields(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const key of ['secret', 'password', 'sudoPassword', 'sshPassword', 'privateKey', 'sshPrivateKey', 'credentialRef', 'sudoCredentialRef']) {
    expect(serialized).not.toMatch(new RegExp(`"${key}"\\s*:`, 'i'))
  }
}

async function fillPasswordNodeForm(page: Page, input: {
  name: string
  host: string
  location?: string
  tags?: string
  password?: string
}): Promise<void> {
  await page.getByLabel('节点名称').fill(input.name)
  await page.getByLabel('主机地址').fill(input.host)
  await page.getByLabel('地域标签').fill(input.location ?? 'E2E')
  await page.getByLabel('密码', { exact: true }).fill(input.password ?? 'fixture-password')
}

async function expectCompletePreflight(page: Page): Promise<void> {
  // 必须限定在预检结果面板内：'SSH 认证' 同时是表单里的认证方式标签，
  // 不限定范围会同时命中表单标签与预检结果行。
  const panel = page.locator('div').filter({ hasText: /^SSH 预检结果/ }).first()
  await expect(panel.getByText('全部通过', { exact: true })).toBeVisible()
  for (const label of PREFLIGHT_CHECKS) await expect(panel.getByText(label, { exact: true })).toBeVisible()
  await expect(panel.getByText('主机指纹：')).toBeVisible()
}

async function createPasswordNode(page: Page, input: {
  name: string
  host: string
  location?: string
  tags?: string
}): Promise<{ id: string; response: unknown }> {
  await page.goto('/nodes?intent=add')
  await expect(page.getByRole('dialog', { name: '添加节点' })).toBeVisible()
  await fillPasswordNodeForm(page, input)

  const preflightRequest = page.waitForRequest(request =>
    request.method() === 'POST' && pathname(request.url()) === '/api/cluster/nodes/preflight')
  await page.getByRole('button', { name: '执行 SSH 预检' }).click()
  const preflight = await preflightRequest
  expect(preflight.postDataJSON()).toMatchObject({
    ssh: {
      host: input.host,
      user: 'root',
      port: 22,
      authMethod: 'password',
      password: 'fixture-password',
    },
  })
  await expectCompletePreflight(page)

  const createRequest = page.waitForRequest(request =>
    request.method() === 'POST' && pathname(request.url()) === '/api/cluster/nodes')
  const createResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && pathname(response.url()) === '/api/cluster/nodes')
  await page.getByRole('button', { name: '确认指纹并保存节点' }).click()
  const [request, response] = await Promise.all([createRequest, createResponse])
  expect(request.postDataJSON()).toMatchObject({
    name: input.name,
    host: input.host,
    location: input.location ?? 'E2E',
    kernels: [],
    sshUser: 'root',
    sshPort: 22,
    sshAuthMethod: 'password',
    sshPassword: 'fixture-password',
  })
  expect(response.ok()).toBe(true)
  const envelope = await response.json() as { data?: { id?: string } }
  expectNoSensitiveFields(envelope)
  expect(envelope.data?.id).toEqual(expect.any(String))
  await expect(page.getByText(input.name, { exact: true }).first()).toBeVisible()
  return { id: envelope.data!.id!, response: envelope }
}

async function postDeployment(
  request: APIRequestContext,
  input: {
    nodeId: string
    component: typeof COMPONENTS[number]
    operation: typeof OPERATIONS[number]
    idempotencyKey: string
    preserveConfig: boolean
    preserveData: boolean
  },
) {
  return request.post('/api/deployments', {
    headers: { 'Idempotency-Key': input.idempotencyKey },
    data: {
      nodeId: input.nodeId,
      component: input.component,
      operation: input.operation,
      options: {
        preserveConfig: input.preserveConfig,
        preserveData: input.preserveData,
      },
    },
  })
}

test.describe('E02 — 添加节点与 SSH 预检', () => {
  test('密码认证：九项预检、确认 host key，并且只创建控制面档案', async ({ page, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const created = await createPasswordNode(page, {
      name: 'E2E 密码节点',
      host: 'password-node.e2e.invalid',
      location: 'LAB-PASSWORD',
      tags: 'e2e, password',
    })

    const after = fixtureSnapshot(await snapshot())
    expect(after.nodes).toHaveLength(before.nodes.length + 1)
    expect(after.nodes.some(node =>
      nodeId(node) === created.id &&
      node.name === 'E2E 密码节点' &&
      node.host === 'password-node.e2e.invalid')).toBe(true)
    expect(tasks(after)).toEqual(tasks(before))
    expect(after.requests.filter(request => requestPath(request) === '/api/deployments')).toHaveLength(0)
  })

  test('私钥认证：只从文件读取密钥，预检与保存响应不泄露敏感字段', async ({ page }) => {
    await page.goto('/nodes?intent=add')
    const dialog = page.getByRole('dialog', { name: '添加节点' })
    await dialog.getByLabel('节点名称').fill('E2E 私钥节点')
    await dialog.getByLabel('主机地址').fill('private-key-node.e2e.invalid')
    await dialog.getByLabel('地域标签').fill('LAB-KEY')
    await dialog.getByRole('button', { name: '私钥' }).click()
    await dialog.getByLabel('私钥文件').setInputFiles({
      name: 'id_e2e_ed25519',
      mimeType: 'text/plain',
      buffer: Buffer.from(PRIVATE_KEY),
    })
    await expect(dialog.getByText('id_e2e_ed25519', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('密码', { exact: true })).toHaveCount(0)

    const preflightRequest = page.waitForRequest(request =>
      request.method() === 'POST' && pathname(request.url()) === '/api/cluster/nodes/preflight')
    await dialog.getByRole('button', { name: '执行 SSH 预检' }).click()
    const preflight = await preflightRequest
    expect(preflight.postDataJSON()).toMatchObject({
      ssh: {
        host: 'private-key-node.e2e.invalid',
        authMethod: 'privateKey',
        privateKey: PRIVATE_KEY,
      },
    })
    expect(preflight.postDataJSON().ssh).not.toHaveProperty('password')
    await expectCompletePreflight(page)

    const createRequest = page.waitForRequest(request =>
      request.method() === 'POST' && pathname(request.url()) === '/api/cluster/nodes')
    const createResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && pathname(response.url()) === '/api/cluster/nodes')
    await dialog.getByRole('button', { name: '确认指纹并保存节点' }).click()
    const [request, response] = await Promise.all([createRequest, createResponse])
    expect(request.postDataJSON()).toMatchObject({
      sshAuthMethod: 'privateKey',
      sshPrivateKey: PRIVATE_KEY,
      sshPrivateKeyName: 'id_e2e_ed25519',
      kernels: [],
    })
    expect(request.postDataJSON()).not.toHaveProperty('sshPassword')
    expect(response.ok()).toBe(true)
    expectNoSensitiveFields(await response.json())
    await expect(page.getByText('E2E 私钥节点', { exact: true }).first()).toBeVisible()
  })

  test('预检失败：保留表单、不显示保存入口，也不创建节点', async ({ page, control, snapshot }) => {
    await control({ nodePreflightFailure: 'ssh' })
    await page.goto('/nodes?intent=add')
    await fillPasswordNodeForm(page, {
      name: '预检失败节点',
      host: 'ssh-failure.e2e.invalid',
      location: 'LAB-FAIL',
    })
    await page.getByRole('button', { name: '执行 SSH 预检' }).click()

    await expect(page.getByText(/存在阻塞|SSH 连接失败/).first()).toBeVisible()
    await expect(page.getByLabel('节点名称')).toHaveValue('预检失败节点')
    await expect(page.getByLabel('主机地址')).toHaveValue('ssh-failure.e2e.invalid')
    await expect(page.getByRole('button', { name: '确认指纹并保存节点' })).toHaveCount(0)
    const state = fixtureSnapshot(await snapshot())
    expect(state.nodes.some(node => node.host === 'ssh-failure.e2e.invalid')).toBe(false)
    expect(state.requests.filter(request =>
      request.method === 'POST' && requestPath(request) === '/api/cluster/nodes')).toHaveLength(0)
  })

  test('重复 host 保存失败时保留表单与预检结果，不新增节点', async ({ page, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const existing = remoteNode(before)
    await page.goto('/nodes?intent=add')
    await fillPasswordNodeForm(page, {
      name: 'E2E 重复主机',
      host: existing.host!,
      location: 'LAB-DUPLICATE',
    })
    await page.getByRole('button', { name: '执行 SSH 预检' }).click()
    await expectCompletePreflight(page)

    const createResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && pathname(response.url()) === '/api/cluster/nodes')
    await page.getByRole('button', { name: '确认指纹并保存节点' }).click()
    const response = await createResponse
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringMatching(/主机.*存在/) })
    await expect(page.getByRole('dialog', { name: '添加节点' })).toBeVisible()
    await expect(page.getByText('节点校验失败', { exact: true })).toBeVisible()
    await expect(page.getByLabel('节点名称')).toHaveValue('E2E 重复主机')
    await expect(page.getByLabel('主机地址')).toHaveValue(existing.host!)
    await expect(page.getByRole('button', { name: '确认指纹并保存节点' })).toBeVisible()

    const after = fixtureSnapshot(await snapshot())
    expect(after.nodes).toHaveLength(before.nodes.length)
    expect(after.nodes.filter(node => node.host === existing.host)).toHaveLength(1)
  })

  test('SSH 端口只接受 1..65535 的整数边界', async ({ request, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const payload = (port: number, suffix: string) => ({
      name: `E2E 端口 ${port}`,
      host: `port-${suffix}.e2e.invalid`,
      location: 'LAB-PORT',
      kernels: [],
      tags: ['e2e', 'port-boundary'],
      sshUser: 'root',
      sshPort: port,
      sshHostKey: 'SHA256:e2e-port-boundary',
      sshAuthMethod: 'password',
      sshPassword: 'fixture-password',
    })

    for (const [port, suffix] of [[0, 'zero'], [65536, 'overflow'], [22.5, 'fractional']] as const) {
      await test.step(`拒绝端口 ${port}`, async () => {
        const response = await request.post('/api/cluster/nodes', { data: payload(port, suffix) })
        expect(response.status()).toBeGreaterThanOrEqual(400)
        expect(await response.json()).toMatchObject({ success: false, error: expect.stringMatching(/SSH 端口无效/) })
      })
    }

    for (const [port, suffix] of [[1, 'minimum'], [65535, 'maximum']] as const) {
      await test.step(`接受端口 ${port}`, async () => {
        const response = await request.post('/api/cluster/nodes', { data: payload(port, suffix) })
        expect(response.status()).toBe(201)
        expect(await response.json()).toMatchObject({ success: true, data: { id: expect.any(String), sshPort: port } })
      })
    }

    const after = fixtureSnapshot(await snapshot())
    expect(after.nodes).toHaveLength(before.nodes.length + 2)
    expect(after.nodes.some(node => node.host === 'port-minimum.e2e.invalid' && node.sshPort === 1)).toBe(true)
    expect(after.nodes.some(node => node.host === 'port-maximum.e2e.invalid' && node.sshPort === 65535)).toBe(true)
    expect(tasks(after)).toEqual(tasks(before))
  })
})

test.describe('E03 — 节点档案管理', () => {
  test('搜索、筛选、编辑、启停、删除，以及已部署 Agent 的卸载引导', async ({ page, snapshot }) => {
    const baseline = fixtureSnapshot(await snapshot())
    const deployed = remoteNode(baseline, node => node.agent?.deployed === true)
    const created = await createPasswordNode(page, {
      name: 'E2E 管理节点',
      host: 'managed-node.e2e.invalid',
      location: 'LAB-MANAGE',
      tags: 'e2e, before-edit',
    })

    const search = page.getByLabel('搜索节点')
    await search.fill('不存在的节点')
    await expect(page.getByText('没有匹配的节点。')).toBeVisible()
    await search.fill('E2E 管理节点')
    await expect(page.getByText('E2E 管理节点', { exact: true })).toBeVisible()
    await page.getByLabel('筛选节点').selectOption('enabled')
    await expect(page.getByText('E2E 管理节点', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '编辑档案' }).click()
    const editor = page.getByRole('dialog', { name: '编辑节点档案' })
    await editor.getByLabel('名称', { exact: true }).fill('E2E 管理节点（已编辑）')
    await editor.getByLabel('主机', { exact: true }).fill('managed-node-updated.e2e.invalid')
    await editor.getByLabel('地域标签', { exact: true }).fill('LAB-UPDATED')
    const editRequest = page.waitForRequest(request =>
      request.method() === 'PATCH' && pathname(request.url()) === '/api/cluster/nodes')
    await editor.getByRole('button', { name: '保存档案' }).click()
    const patch = await editRequest
    expect(patch.postDataJSON()).toMatchObject({
      nodeId: created.id,
      name: 'E2E 管理节点（已编辑）',
      host: 'managed-node-updated.e2e.invalid',
      location: 'LAB-UPDATED',
    })
    await expect(editor).toBeHidden()
    await expect(page.getByText('E2E 管理节点（已编辑）', { exact: true })).toBeVisible()

    const editedState = fixtureSnapshot(await snapshot())
    const editedNode = remoteNode(editedState, node => nodeId(node) === created.id)
    expect(editedNode.sshHostKey ?? editedNode.ssh?.hostKey ?? '').toBe('')

    await page.getByLabel('筛选节点').selectOption('all')
    const pauseRequest = page.waitForRequest(request =>
      request.method() === 'PATCH' && pathname(request.url()) === '/api/cluster/nodes')
    await page.getByRole('button', { name: '暂停纳管' }).click()
    expect((await pauseRequest).postDataJSON()).toMatchObject({ nodeId: created.id, enabled: false })
    // 排除筛选下拉里的同名 <option>，只断言节点卡片上的状态徽章。
    await expect(page.getByText('已暂停', { exact: true }).and(page.locator(':not(option)'))).toBeVisible()
    await page.getByLabel('筛选节点').selectOption('disabled')
    await expect(page.getByText('E2E 管理节点（已编辑）', { exact: true })).toBeVisible()

    await page.getByLabel('筛选节点').selectOption('all')
    await page.getByRole('button', { name: '启用纳管' }).click()
    await expect(page.getByText('纳管中', { exact: true })).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    const deleteRequest = page.waitForRequest(request =>
      request.method() === 'DELETE' && pathname(request.url()) === '/api/cluster/nodes')
    await page.getByRole('button', { name: '删除' }).click()
    expect((await deleteRequest).postDataJSON()).toMatchObject({ nodeId: created.id, force: false })
    await expect(page.getByText('E2E 管理节点（已编辑）', { exact: true })).toHaveCount(0)

    await search.fill(deployed.name)
    const uninstall = page.getByRole('link', { name: '先卸载再删除' })
    await expect(uninstall).toBeVisible()
    await expect(uninstall).toHaveAttribute('href', new RegExp(`/deploy\\?node=${encodeURIComponent(nodeId(deployed))}.*operation=uninstall`))
    await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0)
  })

  test('节点编辑覆盖 SSH user、port、认证方式与替换凭据', async ({ page, snapshot }) => {
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state)

    await page.goto('/nodes')
    await page.getByLabel('搜索节点').fill(target.name)
    await page.getByRole('button', { name: '编辑档案' }).click()
    const editor = page.getByRole('dialog', { name: '编辑节点档案' })

    await expect.soft(editor.getByLabel('用户名', { exact: true })).toHaveValue(target.sshUser ?? 'root')
    await expect.soft(editor.getByLabel(/^(SSH )?端口$/)).toHaveValue(String(target.sshPort ?? 22))
    await expect.soft(editor.getByRole('button', { name: '密码', exact: true })).toBeVisible()
    await expect.soft(editor.getByRole('button', { name: '私钥', exact: true })).toBeVisible()
    const replacementCredential = editor.getByLabel('密码', { exact: true })
    await expect.soft(replacementCredential).toBeVisible()
    await expect.soft(replacementCredential).toHaveValue('')
  })

  test('本机档案可填写用户名和密码', async ({ page, snapshot }) => {
    const target = remoteNode(fixtureSnapshot(await snapshot()))
    const local = { ...target, id: 'local', nodeId: 'local', name: '本机节点', host: '127.0.0.1' }
    await page.route(url => url.pathname === '/api/cluster/status', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { totalNodes: 1, onlineNodes: 1, totalProxies: 0, nodes: [local], lastUpdated: new Date().toISOString() },
      }),
    }))
    await page.route(url => url.pathname === '/api/cluster/nodes', async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: local }) })
    })

    await page.goto('/nodes')
    await page.getByLabel('搜索节点').fill(local.name)
    await page.getByRole('button', { name: '编辑档案' }).click()
    const editor = page.getByRole('dialog', { name: '编辑节点档案' })
    await expect(editor.getByLabel('用户名', { exact: true })).toBeVisible()
    const password = editor.getByLabel('密码', { exact: true })
    await expect(password).toHaveValue('')
    await expect(password).toHaveAttribute('placeholder', /root 密码仅供下一次部署使用，不保存/)
    await password.fill('fixture-password')
    const editRequest = page.waitForRequest(request =>
      request.method() === 'PATCH' && pathname(request.url()) === '/api/cluster/nodes')
    await editor.getByRole('button', { name: '保存档案' }).click()
    expect((await editRequest).postDataJSON()).toMatchObject({ nodeId: 'local', sshUser: 'root', sshPassword: 'fixture-password' })
    await expect(editor).toBeHidden()
  })

  test('编辑私钥认证节点且不更换凭据时不得把它翻成密码认证', async ({ page, request, snapshot }) => {
    // 服务端只要收到 sshAuthMethod 就整体覆盖，因此界面不能在用户没有提供
    // 新凭据时擅自提交该字段——否则私钥节点会变成没有凭据的密码认证节点。
    const created = await request.post('/api/cluster/nodes', {
      data: {
        name: 'E2E 私钥节点', host: 'privatekey-node.e2e.invalid', location: 'E2E-LAB',
        sshUser: 'deploy', sshPort: 2222, sshAuthMethod: 'privateKey',
        sshPrivateKey: 'BEGIN E2E TEST KEY',
      },
    })
    expect(created.ok()).toBeTruthy()

    await page.goto('/nodes')
    await page.getByLabel('搜索节点').fill('E2E 私钥节点')
    await page.getByRole('button', { name: '编辑档案' }).click()
    const editor = page.getByRole('dialog', { name: '编辑节点档案' })
    // 界面必须反映节点真实的认证方式，而不是一律显示密码。
    await expect(editor.getByLabel('私钥', { exact: true })).toBeVisible()

    await editor.getByLabel('地域标签', { exact: true }).fill('E2E-LAB-2')
    await editor.getByRole('button', { name: '保存档案' }).click()
    await expect(editor).toBeHidden()

    const saved = fixtureSnapshot(await snapshot()).nodes
      .find(node => node.name === 'E2E 私钥节点') as Record<string, unknown> | undefined
    expect(saved?.location).toBe('E2E-LAB-2')
    expect(saved?.sshAuthMethod).toBe('privateKey')
    expect((saved?.ssh as { authMethod?: string } | undefined)?.authMethod).toBe('privateKey')
  })

  test('enabled 更新返回 success:false 时保留原状态且不得 toast 成功', async ({ page, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const target = remoteNode(before, node => node.enabled !== false)
    await page.route(url => url.pathname === '/api/cluster/nodes', async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: '节点更新失败（E2E fixture）' }),
      })
    }, { times: 1 })

    await page.goto('/nodes')
    await page.getByLabel('搜索节点').fill(target.name)
    const updateResponse = page.waitForResponse(response =>
      response.request().method() === 'PATCH' && pathname(response.url()) === '/api/cluster/nodes')
    await page.getByRole('button', { name: '暂停纳管' }).click()
    const response = await updateResponse
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ success: false })

    await expect.soft(page.getByText('节点操作失败', { exact: true })).toBeVisible()
    await expect.soft(page.getByText('节点已暂停纳管', { exact: true })).toHaveCount(0)
    await expect.soft(page.getByText('纳管中', { exact: true })).toBeVisible()
    const after = fixtureSnapshot(await snapshot())
    expect(remoteNode(after, node => nodeId(node) === nodeId(target)).enabled).toBe(target.enabled)
  })
})

test.describe('E04 — 五组件 × 五操作部署 API contract', () => {
  for (const component of COMPONENTS) {
    for (const operation of OPERATIONS) {
      test(`${component} / ${operation} 创建 202 幂等任务并持久化完整输入`, async ({ request, control, snapshot }) => {
        await control({ deploymentHoldAt: 'queued' })
        const before = fixtureSnapshot(await snapshot())
        const target = remoteNode(before)
        const id = nodeId(target)
        const preserve = operation !== 'uninstall'
        const idempotencyKey = `e2e-${component}-${operation}`

        const response = await postDeployment(request, {
          nodeId: id,
          component,
          operation,
          idempotencyKey,
          preserveConfig: preserve,
          preserveData: preserve,
        })
        expect(response.status()).toBe(202)
        const envelope = await response.json() as {
          success: boolean
          data?: { taskId?: string }
          requestId?: string
          role?: string
        }
        expect(envelope).toMatchObject({
          success: true,
          data: { taskId: expect.any(String) },
          requestId: expect.any(String),
          role: 'admin',
        })

        await expect.poll(async () => {
          const state = fixtureSnapshot(await snapshot())
          return tasks(state).find(task => task.taskId === envelope.data!.taskId)
        }).toMatchObject({
          taskId: envelope.data!.taskId,
          idempotencyKey,
          nodeId: id,
          component,
          operation,
          actorRole: 'admin',
          status: 'pending',
          step: 'queued',
          options: { preserveConfig: preserve, preserveData: preserve },
        })
      })
    }
  }

  test('同一个 Idempotency-Key 重放只返回原 taskId', async ({ request, control, snapshot }) => {
    await control({ deploymentHoldAt: 'queued' })
    const state = fixtureSnapshot(await snapshot())
    const id = nodeId(remoteNode(state))
    const input = {
      nodeId: id,
      component: 'agent' as const,
      operation: 'install' as const,
      idempotencyKey: 'e2e-idempotent-replay',
      preserveConfig: true,
      preserveData: true,
    }
    const first = await postDeployment(request, input)
    const second = await postDeployment(request, input)
    expect(first.status()).toBe(202)
    expect(second.status()).toBe(202)
    const firstBody = await first.json() as { data: { taskId: string } }
    const secondBody = await second.json() as { data: { taskId: string } }
    expect(secondBody.data.taskId).toBe(firstBody.data.taskId)
    const after = fixtureSnapshot(await snapshot())
    expect(tasks(after).filter(task => task.idempotencyKey === input.idempotencyKey)).toHaveLength(1)
  })

  test('缺少或不存在的节点拒绝创建任务且不污染任务历史', async ({ request, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const missing = await request.post('/api/deployments', {
      headers: { 'Idempotency-Key': 'e2e-missing-node-field' },
      data: {
        component: 'agent',
        operation: 'install',
        options: { preserveConfig: true, preserveData: true },
      },
    })
    expect(missing.status()).toBe(400)
    expect(await missing.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_FIELD', field: 'nodeId', message: expect.any(String) },
      requestId: expect.any(String),
      role: 'admin',
    })

    const unknown = await postDeployment(request, {
      nodeId: 'node-does-not-exist',
      component: 'agent',
      operation: 'install',
      idempotencyKey: 'e2e-unknown-node',
      preserveConfig: true,
      preserveData: true,
    })
    expect(unknown.status()).toBe(400)
    expect(await unknown.json()).toMatchObject({
      success: false,
      error: { code: 'REQUEST_FAILED', message: expect.stringMatching(/节点.*不存在/) },
    })
    expect(tasks(fixtureSnapshot(await snapshot()))).toEqual(tasks(before))
  })

  test('同组件并发与 Agent 卸载互斥均拒绝第二个任务', async ({ request, control, snapshot }) => {
    await control({ deploymentHoldAt: 'queued' })
    const before = fixtureSnapshot(await snapshot())
    const empty = remoteNode(before, node => node.agent?.deployed !== true)
    const ready = remoteNode(before, node => node.agent?.deployed === true)

    const first = await postDeployment(request, {
      nodeId: nodeId(empty), component: 'agent', operation: 'install',
      idempotencyKey: 'e2e-conflict-agent-first', preserveConfig: true, preserveData: true,
    })
    expect(first.status()).toBe(202)
    const sameComponent = await postDeployment(request, {
      nodeId: nodeId(empty), component: 'agent', operation: 'upgrade',
      idempotencyKey: 'e2e-conflict-agent-second', preserveConfig: true, preserveData: true,
    })
    expect(sameComponent.status()).toBe(400)
    expect(await sameComponent.json()).toMatchObject({
      success: false,
      error: { message: expect.stringMatching(/agent.*进行中的任务/) },
    })

    const kernel = await postDeployment(request, {
      nodeId: nodeId(ready), component: 'sing-box', operation: 'repair',
      idempotencyKey: 'e2e-conflict-kernel-first', preserveConfig: true, preserveData: true,
    })
    expect(kernel.status()).toBe(202)
    const uninstallAgent = await postDeployment(request, {
      nodeId: nodeId(ready), component: 'agent', operation: 'uninstall',
      idempotencyKey: 'e2e-conflict-agent-uninstall', preserveConfig: false, preserveData: false,
    })
    expect(uninstallAgent.status()).toBe(400)
    expect(await uninstallAgent.json()).toMatchObject({
      success: false,
      error: { message: expect.stringMatching(/Agent 卸载.*互斥/) },
    })

    const after = fixtureSnapshot(await snapshot())
    expect(tasks(after)).toHaveLength(tasks(before).length + 2)
    expect(tasks(after).filter(task => task.status === 'pending' && task.step === 'queued')).toHaveLength(2)
  })

  test('SSH 部署预检存在阻断项时不得创建任务', async ({ page, control, snapshot }) => {
    await control({ nodePreflightFailure: 'ssh', deploymentHoldAt: 'queued' })
    const before = fixtureSnapshot(await snapshot())
    const target = remoteNode(before, node => node.agent?.deployed !== true)
    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=agent&operation=install`)
    await page.getByRole('button', { name: '执行 SSH 预检' }).click()
    await expect(page.getByText('预检完成，存在阻断项', { exact: true })).toBeVisible()

    const create = page.getByRole('button', { name: '创建部署任务' })
    await expect.soft(create).toBeDisabled()
    if (await create.isEnabled()) {
      await create.click()
      await expect.poll(async () => tasks(fixtureSnapshot(await snapshot())).length)
        .toBeGreaterThan(tasks(before).length)
    }
    expect.soft(tasks(fixtureSnapshot(await snapshot()))).toHaveLength(tasks(before).length)
  })

  test('创建任务 API 失败显示错误且不得 toast 入队成功', async ({ page, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const target = remoteNode(before, node => node.agent?.deployed !== true)
    await page.route(url => pathname(url.toString()) === '/api/deployments', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'DEPLOYMENT_UNAVAILABLE', message: 'fixture deployment API failure', retryable: true },
          requestId: 'e2e-deployment-api-failure',
          role: 'admin',
          timestamp: new Date().toISOString(),
        }),
      })
    })

    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=agent&operation=install`)
    await page.getByRole('button', { name: '创建部署任务' }).click()
    await expect(page.getByText('部署操作失败', { exact: true })).toBeVisible()
    await expect(page.getByText('部署任务创建失败', { exact: true })).toBeVisible()
    await expect(page.getByText('部署任务已进入队列', { exact: true })).toHaveCount(0)
    expect(tasks(fixtureSnapshot(await snapshot()))).toEqual(tasks(before))
  })
})

test.describe('E05 — 部署 UI、取消与重试', () => {
  test('排队任务可取消，取消后可按原输入重试并保留 retryOf', async ({ page, control, snapshot }) => {
    await control({ deploymentHoldAt: 'queued' })
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=agent&operation=install`)
    await expect(page.getByRole('heading', { name: '部署中心' })).toBeVisible()

    const createRequest = page.waitForRequest(request =>
      request.method() === 'POST' && pathname(request.url()) === '/api/deployments')
    await page.getByRole('button', { name: '创建部署任务' }).click()
    const create = await createRequest
    expect(create.headers()['idempotency-key']).toEqual(expect.any(String))
    expect(create.postDataJSON()).toMatchObject({
      nodeId: nodeId(target),
      component: 'agent',
      operation: 'install',
      options: { preserveConfig: true, preserveData: true },
    })

    const taskCard = page.locator('article').filter({ hasText: `${target.name} · agent` }).first()
    await expect(taskCard).toBeVisible()
    await expect(taskCard.getByText('排队中', { exact: true })).toBeVisible()
    const originalTask = tasks(fixtureSnapshot(await snapshot())).find(task =>
      task.nodeId === nodeId(target) && task.component === 'agent' && task.operation === 'install')!

    const cancelRequest = page.waitForRequest(request =>
      request.method() === 'POST' && pathname(request.url()) === `/api/deployments/${originalTask.taskId}/cancel`)
    await taskCard.getByRole('button', { name: '取消任务' }).click()
    await cancelRequest
    await expect(taskCard.getByText('已取消', { exact: true })).toBeVisible()

    const retryRequest = page.waitForRequest(request =>
      request.method() === 'POST' && pathname(request.url()) === `/api/deployments/${originalTask.taskId}/retry`)
    await taskCard.getByRole('button', { name: '按原输入重试' }).click()
    await retryRequest
    await expect(page.getByText('已按原始输入创建重试任务')).toBeVisible()
    await expect.poll(async () => {
      const next = fixtureSnapshot(await snapshot())
      return tasks(next).some(task => task.retryOf === originalTask.taskId)
    }).toBe(true)
  })

  test('进入 installing 后取消入口消失', async ({ page, control, snapshot }) => {
    await control({ deploymentHoldAt: 'installing' })
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=sing-box&operation=install`)
    await page.getByRole('button', { name: '创建部署任务' }).click()

    await expect.poll(async () => {
      const current = fixtureSnapshot(await snapshot())
      return tasks(current).find(task => task.nodeId === nodeId(target) && task.component === 'sing-box')?.step
    }).toBe('installing')
    const taskCard = page.locator('article').filter({ hasText: `${target.name} · sing-box` }).first()
    await expect(taskCard).toBeVisible()
    await expect(taskCard.getByRole('button', { name: '取消任务' })).toHaveCount(0)
  })

  test('未知任务的读取、取消与重试均返回明确错误且不创建任务', async ({ request, snapshot }) => {
    const before = fixtureSnapshot(await snapshot())
    const missing = await request.get('/api/deployments/task-does-not-exist')
    expect(missing.status()).toBe(404)
    expect(await missing.json()).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: expect.stringMatching(/任务不存在/) },
      requestId: expect.any(String),
      role: 'admin',
    })

    for (const action of ['cancel', 'retry'] as const) {
      await test.step(`未知任务 ${action}`, async () => {
        const response = await request.post(`/api/deployments/task-does-not-exist/${action}`)
        expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({
          success: false,
          error: { code: 'REQUEST_FAILED', message: expect.stringMatching(/任务.*不存在/) },
        })
      })
    }
    expect(tasks(fixtureSnapshot(await snapshot()))).toEqual(tasks(before))
  })

  test('失败任务可按原输入重试并保留 errorCode 与 retryOf', async ({ page, control, snapshot }) => {
    await control({ deploymentOutcome: 'error' })
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=v2ray&operation=install`)
    await page.getByRole('button', { name: '创建部署任务' }).click()

    let failedTask: DeploymentTask | undefined
    await expect.poll(async () => {
      failedTask = tasks(fixtureSnapshot(await snapshot())).find(task =>
        task.nodeId === nodeId(target) && task.component === 'v2ray' && task.operation === 'install')
      return failedTask?.status
    }).toBe('error')
    expect(failedTask).toMatchObject({
      status: 'error',
      step: 'done',
      progress: 100,
      errorCode: 'FIXTURE_DEPLOYMENT_FAILED',
      options: { preserveConfig: true, preserveData: true },
    })

    await page.getByRole('button', { name: '刷新状态' }).click()
    const failedCard = page.locator('article').filter({ hasText: `${target.name} · v2ray` }).first()
    await expect(failedCard.getByText('失败', { exact: true })).toBeVisible()
    const retryResponse = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && pathname(response.url()) === `/api/deployments/${failedTask!.taskId}/retry`)
    await failedCard.getByRole('button', { name: '按原输入重试' }).click()
    expect((await retryResponse).status()).toBe(202)
    await expect(page.getByText('已按原始输入创建重试任务')).toBeVisible()

    await expect.poll(async () => tasks(fixtureSnapshot(await snapshot())).find(task =>
      task.retryOf === failedTask!.taskId)).toMatchObject({
      nodeId: nodeId(target),
      component: 'v2ray',
      operation: 'install',
      options: { preserveConfig: true, preserveData: true },
      retryOf: failedTask!.taskId,
    })
  })

  test('成功任务进度与 eventId 单调，并展示前后版本和唯一日志上下文', async ({ page, request, snapshot }) => {
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed === true)
    const response = await postDeployment(request, {
      nodeId: nodeId(target),
      component: 'agent',
      operation: 'upgrade',
      idempotencyKey: 'e2e-progress-version-log',
      preserveConfig: true,
      preserveData: true,
    })
    expect(response.status()).toBe(202)
    const body = await response.json() as { data: { taskId: string } }

    let completed: DeploymentTask | undefined
    await expect.poll(async () => {
      completed = tasks(fixtureSnapshot(await snapshot())).find(task => task.taskId === body.data.taskId)
      return completed?.status
    }).toBe('success')
    expect(completed).toMatchObject({
      taskId: body.data.taskId,
      status: 'success',
      step: 'done',
      progress: 100,
      beforeVersion: '1.0.0-e2e',
      afterVersion: '1.0.1-e2e',
    })

    const eventResponse = await request.get(`/api/deployments/${body.data.taskId}/events`, {
      headers: { Accept: 'application/json' },
    })
    expect(eventResponse.ok()).toBe(true)
    const eventBody = await eventResponse.json() as { data: { events: DeploymentEvent[] } }
    const events = eventBody.data.events
    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events[0]).toMatchObject({ eventId: '00000001', step: 'queued', progress: 0 })
    expect(events.at(-1)).toMatchObject({ step: 'done', progress: 100, status: 'success' })
    for (let index = 1; index < events.length; index += 1) {
      expect(Number(events[index]!.eventId)).toBeGreaterThan(Number(events[index - 1]!.eventId))
      expect(events[index]!.progress).toBeGreaterThanOrEqual(events[index - 1]!.progress)
      expect(Date.parse(events[index]!.timestamp)).not.toBeNaN()
    }

    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=agent&operation=upgrade`)
    const taskCard = page.locator('article').filter({ hasText: `${target.name} · agent` }).first()
    await expect(taskCard.getByText('成功', { exact: true })).toBeVisible()
    await expect(taskCard.getByText('版本 1.0.0-e2e → 1.0.1-e2e', { exact: true })).toBeVisible()
    await expect(taskCard.getByRole('link', { name: '查看日志' })).toHaveAttribute(
      'href',
      `/logs?node=${encodeURIComponent(nodeId(target))}&task=${encodeURIComponent(body.data.taskId)}`,
    )
  })

  test('部署任务渲染带时间戳的完整事件时间线', async ({ page, control, snapshot }) => {
    await control({ deploymentHoldAt: 'installing' })
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    const eventRequests: Request[] = []
    page.on('request', request => {
      if (request.method() === 'GET' && /\/api\/deployments\/[^/]+\/events$/.test(pathname(request.url()))) {
        eventRequests.push(request)
      }
    })

    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=xray&operation=install`)
    await page.getByRole('button', { name: '创建部署任务' }).click()

    let taskId: string | undefined
    await expect.poll(async () => {
      const current = fixtureSnapshot(await snapshot())
      taskId = tasks(current).find(task =>
        task.nodeId === nodeId(target) && task.component === 'xray' && task.operation === 'install')?.taskId
      return taskId
    }).toEqual(expect.any(String))
    if (!taskId) throw new Error('Fixture did not persist the xray deployment task')

    const taskEventRequests = () => eventRequests.filter(request =>
      pathname(request.url()) === `/api/deployments/${taskId}/events`)
    await expect.poll(() => taskEventRequests().length).toBeGreaterThan(0)

    const timeline = page.getByRole('region', { name: '部署任务事件' })
    await expect(timeline).toBeVisible()
    for (const message of ['任务已进入部署队列', '检查 SSH、架构与目标状态', '安装 xray']) {
      await expect(timeline.getByText(message, { exact: true })).toBeVisible()
    }
    await expect(timeline.locator('time[datetime]').first()).toBeVisible()
  })

  test('刷新活动任务后使用 Last-Event-ID 续传 SSE', async ({ page, control, snapshot }) => {
    await control({ deploymentHoldAt: 'installing' })
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    const eventRequests: Request[] = []
    page.on('request', request => {
      if (request.method() === 'GET' && /\/api\/deployments\/[^/]+\/events$/.test(pathname(request.url()))) {
        eventRequests.push(request)
      }
    })

    await page.goto(`/deploy?node=${encodeURIComponent(nodeId(target))}&component=xray&operation=install`)
    await page.getByRole('button', { name: '创建部署任务' }).click()
    let taskId: string | undefined
    await expect.poll(async () => {
      taskId = tasks(fixtureSnapshot(await snapshot())).find(task =>
        task.nodeId === nodeId(target) && task.component === 'xray' && task.operation === 'install')?.taskId
      return taskId
    }).toEqual(expect.any(String))
    if (!taskId) throw new Error('Fixture did not persist the xray deployment task')

    const taskEventRequests = () => eventRequests.filter(request =>
      pathname(request.url()) === `/api/deployments/${taskId}/events`)
    await expect.poll(() => taskEventRequests().length).toBeGreaterThan(0)

    const requestCountBeforeReload = taskEventRequests().length
    await page.reload()
    await expect.poll(() => taskEventRequests().length).toBeGreaterThan(requestCountBeforeReload)
    const resumedRequest = taskEventRequests().at(-1)
    expect(resumedRequest).toBeDefined()
    expect(resumedRequest?.headers()['last-event-id']).toMatch(/^\d{8}$/)
  })
})

test.describe('E06 — 手动 Agent 配置与敏感字段边界', () => {
  test('没有节点时禁用任务创建与手动 Agent 部署', async ({ page, control }) => {
    await control({ nodesEmpty: true })
    await page.goto('/deploy?component=agent&operation=install')
    await expect(page.getByText('请先在节点页添加节点', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '创建部署任务' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '手动 Shell 部署' })).toBeDisabled()
  })

  test('从部署页下载专用 YAML、复制安装命令，普通节点接口保持脱敏', async ({
    page, context, request, snapshot,
  }) => {
    const before = fixtureSnapshot(await snapshot())
    const target = remoteNode(before, node => node.agent?.deployed !== true)
    const id = nodeId(target)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`/deploy?node=${encodeURIComponent(id)}&component=agent`)
    await page.getByRole('button', { name: '手动 Shell 部署' }).click()

    const dialog = page.getByRole('dialog', { name: '手动 Shell 部署 Agent' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(id, { exact: true })).toBeVisible()
    await expect(dialog.getByText(target.name, { exact: true })).toBeVisible()
    const configLink = dialog.getByRole('link', { name: '下载 Agent 配置' })
    await expect(configLink).toHaveAttribute('href', `/api/deployments/agent/manual-config?nodeId=${encodeURIComponent(id)}`)

    await dialog.getByRole('button', { name: '复制安装命令' }).click()
    await expect(page.getByText('已复制安装命令')).toBeVisible()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('install-agent.sh --config /tmp/miobridge-agent.yaml')
    const installer = await page.evaluate(() => navigator.clipboard.readText())
    expect(installer).not.toMatch(/\bbun\b|mihomo|sing-box|\bxray\b|\bv2ray\b|miobridge\s+(?:setup|deploy)/i)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      configLink.click(),
    ])
    expect(download.suggestedFilename()).toMatch(/miobridge-agent-.*\.yaml|agent\.yaml/)
    await expect.poll(async () => manualDownloadCount(fixtureSnapshot(await snapshot())))
      .toBeGreaterThan(manualDownloadCount(before))

    const manual = await request.get(`/api/deployments/agent/manual-config?nodeId=${encodeURIComponent(id)}`)
    expect(manual.status()).toBe(200)
    expect(manual.headers()['content-disposition']).toContain('attachment')
    const yaml = await manual.text()
    expect(yaml).toMatch(/\bsecret:\s*["']?[^\s"']+/)
    expect(yaml).not.toMatch(/sshPassword|password:|private[_-]?key|credentialRef/i)

    const cluster = await request.get('/api/cluster/status')
    expect(cluster.ok()).toBe(true)
    expectNoSensitiveFields(await cluster.json())

    const after = fixtureSnapshot(await snapshot())
    expect(tasks(after)).toEqual(tasks(before))
    const beforeNode = remoteNode(before, node => nodeId(node) === id)
    const afterNode = remoteNode(after, node => nodeId(node) === id)
    expect(afterNode.configuredKernels).toEqual(beforeNode.configuredKernels)
    expect(afterNode.agent).toEqual(beforeNode.agent)
    expect(after.requests.filter(record =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(record.method ?? '')
      && (requestPath(record) === '/api/deployments' || requestPath(record).startsWith('/api/cluster/')))).toEqual([])
  })

  test('完成手动部署后立即调用目标节点健康检查并关闭对话框', async ({ page, snapshot }) => {
    const state = fixtureSnapshot(await snapshot())
    const target = remoteNode(state, node => node.agent?.deployed !== true)
    const id = nodeId(target)
    await page.goto(`/deploy?node=${encodeURIComponent(id)}&component=agent`)
    await page.getByRole('button', { name: '手动 Shell 部署' }).click()
    const dialog = page.getByRole('dialog', { name: '手动 Shell 部署 Agent' })
    await expect(dialog).toBeVisible()
    const healthRequests = (current: FixtureSnapshot) => current.requests.filter(record => {
      if (record.method !== 'GET' || requestPath(record) !== '/api/cluster/health') return false
      const url = new URL(record.path ?? record.url ?? '/', 'http://e2e.invalid')
      return url.searchParams.get('node') === id
    }).length
    const beforeHealth = healthRequests(fixtureSnapshot(await snapshot()))

    await dialog.getByRole('button', { name: '完成并检查健康' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => healthRequests(fixtureSnapshot(await snapshot())), { timeout: 2_000 })
      .toBeGreaterThan(beforeHealth)
  })
})
