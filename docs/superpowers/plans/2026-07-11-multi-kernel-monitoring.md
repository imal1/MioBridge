# Multi-Kernel Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow every child node to monitor sing-box, Xray, and V2Ray simultaneously, deploy selected kernels after SSH detection, expose per-kernel health, and merge all usable sources into one region-prefixed Clash configuration.

**Architecture:** Replace every single `kernel` field with a validated `kernels` collection. The Agent discovers, parses, and reports each kernel independently; the main service retains source provenance through collection and applies Clash-only title normalization before conversion. Deployment detects all supported binaries, installs selected missing kernels sequentially, and persists only successful monitored kernels.

**Tech Stack:** TypeScript, Bun Agent HTTP service and tests, Next.js Pages Router, React 19, Vitest/Testing Library, YAML, ssh2, Mihomo.

## Global Constraints

- Do not add compatibility code for `kernel`, `kernel.type`, `kernelAccessible`, or `singBoxAccessible`.
- Supported kernel order is exactly `sing-box`, `xray`, `v2ray`.
- Every node and Agent configuration must contain at least one unique monitored kernel.
- `raw.txt` and `subscription.txt` retain deduplicated original URLs; region/title normalization applies only to Clash generation.
- Default Clash title is `地区 原标题`; conflicting different URLs append `[完整URL]`; identical URLs deduplicate; numeric suffixes are forbidden.
- Kernel installation is sequential and partial success is retained.
- Disabling monitoring never uninstalls a kernel.
- Use existing Botanical Garden tokens and component patterns; do not hard-code component colors.
- The current workspace is not a Git repository. Run every verification checkpoint, but skip `git add` and `git commit` until repository metadata is restored.

---

## File Structure

### New files

- `frontend/src/server/services/proxySources.ts` — source provenance, exact URL deduplication, and Clash-only title normalization.
- `frontend/src/pages/api/cluster/kernel/detect.ts` — thin SSH detection route.
- `frontend/src/components/cluster/KernelDetectionDialog.tsx` — detection results and install/monitor selection.
- `frontend/src/server/services/__tests__/proxySources.test.ts` — naming and deduplication behavior.
- `frontend/src/server/__tests__/api/cluster/kernel-detect.test.ts` — detection route contract.
- `frontend/src/components/cluster/__tests__/kernel-detection-dialog.test.tsx` — selection UI behavior.

### Primary modified files

- `agent/src/config.ts`, `agent/src/handlers/urls.ts`, `agent/src/handlers/status.ts`, `agent/src/server.ts` — multi-kernel Agent model and APIs.
- `frontend/src/server/types/index.ts`, `frontend/src/server/services/nodeManager.ts` — main configuration and status model.
- `frontend/src/server/services/deployManager.ts`, deployment APIs and tests — detect/install/configure several kernels.
- `frontend/src/server/services/mioBridgeService.ts`, `frontend/src/server/services/mihomoService.ts` — provenance-aware artifact generation.
- `frontend/src/pages/nodes.tsx`, cluster components, dashboard/config pages, API client — multi-kernel interaction and status display.
- `agent/agent.yaml.example`, `scripts/e2e-distributed.sh`, `scripts/e2e-browser.mjs`, and related fixtures — new schema and end-to-end coverage.

---

### Task 1: Define and validate the Agent multi-kernel configuration

**Files:**
- Modify: `agent/src/config.ts`
- Modify: `agent/src/__tests__/config.test.ts`
- Modify: `agent/agent.yaml.example`
- Modify: `agent/src/server.ts`

**Interfaces:**
- Produces: `KernelType`, `SUPPORTED_KERNELS`, `AgentKernelConfig`, and `AgentConfig.kernels` used by all later Agent tasks.

- [ ] **Step 1: Write failing configuration tests**

Replace single-kernel assertions with tests equivalent to:

```ts
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../config';

test('loads multiple unique kernels with independent paths', async () => {
  const cfg = await loadFixture(`
node:
  id: node-1
  name: 香港
  secret: secret
kernels:
  - type: sing-box
    configPath: /custom/sing-box.json
  - type: xray
    configPath: /custom/xray.json
port: 3001
`);
  expect(cfg.kernels).toEqual([
    { type: 'sing-box', configPath: '/custom/sing-box.json' },
    { type: 'xray', configPath: '/custom/xray.json' },
  ]);
});

test.each([
  ['empty', 'kernels:\n'],
  ['duplicate', 'kernels:\n  - type: xray\n  - type: xray\n'],
  ['unsupported', 'kernels:\n  - type: clash\n'],
])('rejects %s kernel configuration', async (_name, yaml) => {
  await expect(loadFixture(`${baseNodeYaml}\n${yaml}`)).rejects.toThrow();
});
```

- [ ] **Step 2: Run the Agent config tests and verify RED**

Run: `cd agent && bun test src/__tests__/config.test.ts`

Expected: FAIL because `AgentConfig` still exposes `kernel` and the parser does not parse a YAML sequence.

- [ ] **Step 3: Implement the new configuration model**

Use these public definitions:

```ts
export const SUPPORTED_KERNELS = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof SUPPORTED_KERNELS[number];

export interface AgentKernelConfig {
  type: KernelType;
  configPath?: string;
}

export interface AgentConfig {
  node: AgentNodeConfig;
  kernels: AgentKernelConfig[];
  mihomo: AgentMihomoConfig;
  port: number;
}
```

Parse the `kernels:` sequence, fill an omitted path from `DEFAULT_CONFIG_PATHS`, and throw descriptive errors for empty, duplicate, or unsupported values. Do not silently return defaults on schema errors; only a missing file may use `getDefaultConfig()`.

Update the example to the exact sequence form in the design. Change the startup log to list `config.kernels.map(item => item.type).join(',')`.

- [ ] **Step 4: Run tests and Agent typecheck**

Run: `cd agent && bun test src/__tests__/config.test.ts && bun run typecheck`

Expected: config tests PASS; typecheck may still identify single-kernel handler references, which Task 2 removes.

---

### Task 2: Collect and report all Agent kernels independently

**Files:**
- Modify: `agent/src/handlers/urls.ts`
- Modify: `agent/src/handlers/status.ts`
- Modify: `agent/src/__tests__/handlers.test.ts`

**Interfaces:**
- Consumes: `KernelType`, `SUPPORTED_KERNELS`, and `AgentConfig.kernels` from Task 1.
- Produces:

```ts
export interface KernelRuntimeStatus {
  type: KernelType;
  detected: boolean;
  monitored: boolean;
  accessible: boolean;
  nodesCount: number;
  version?: string;
  configPaths: string[];
  error?: string;
}

export interface KernelNodeSource {
  kernel: KernelType;
  url: string;
}

export function collectKernelSources(config: AgentConfig, host: string): {
  sources: KernelNodeSource[];
  kernels: KernelRuntimeStatus[];
};
```

- [ ] **Step 1: Add failing handler tests**

Create temporary sing-box, Xray, and V2Ray JSON fixtures. Assert that one request returns sources from all three, exact duplicate URLs occur once, malformed Xray JSON produces only an Xray error, and the other two remain accessible. Assert `/api/status` contains exactly three kernel entries and unconfigured types have `monitored: false`.

Use response assertions shaped as:

```ts
expect(body.data.sources.map((item: any) => item.kernel)).toEqual([
  'sing-box', 'xray', 'v2ray',
]);
expect(body.data.kernels.find((item: any) => item.type === 'xray')).toMatchObject({
  monitored: true,
  accessible: false,
  nodesCount: 0,
});
```

- [ ] **Step 2: Run handler tests and verify RED**

Run: `cd agent && bun test src/__tests__/handlers.test.ts`

Expected: FAIL because discovery selects only `config.kernel.type` and responses contain `urls` plus a single accessibility boolean.

- [ ] **Step 3: Split discovery and parsing by kernel**

Change discovery to accept `(kernel: AgentKernelConfig)`. Keep existing path tables and parsers, but select them from the passed kernel type. Implement `collectKernelSources` by iterating `SUPPORTED_KERNELS`; configured types are monitored, unconfigured types are reported but not parsed. Catch file/discovery/parse errors inside each kernel iteration.

Deduplicate sources by exact URL with a `Set<string>` while preserving the first source and supported-kernel order.

- [ ] **Step 4: Replace Agent API response shapes**

`/api/urls` returns `{ sources, kernels }`. `/api/status` returns `{ kernels, nodesCount, uptime, version }`; remove subscription, Clash, Mihomo, `kernelAccessible`, and `singBoxAccessible` fields because child nodes only expose sources.

- [ ] **Step 5: Verify Agent behavior**

Run: `cd agent && bun test && bun run typecheck`

Expected: all Agent tests PASS and typecheck exits 0.

---

### Task 3: Replace the main-node single-kernel configuration and status model

**Files:**
- Modify: `frontend/src/server/types/index.ts`
- Modify: `frontend/src/server/types/__tests__/types.test.ts`
- Modify: `frontend/src/server/services/nodeManager.ts`
- Modify: `frontend/src/server/services/__tests__/nodeManager.test.ts`
- Modify: `frontend/src/server/__tests__/api/cluster/nodes.test.ts`
- Modify: `frontend/src/pages/api/cluster/nodes.ts`

**Interfaces:**
- Produces `NodeKernelConfig`, `KernelRuntimeStatus`, `NodeConfig.kernels`, and `NodeStatus.kernels` matching the approved spec.
- Produces `validateKernelConfigs(kernels: unknown): NodeKernelConfig[]` for API and YAML loading.

- [ ] **Step 1: Write failing type, YAML, and API tests**

Add tests that write/read:

```yaml
nodes:
  - id: node-hk
    name: 香港
    host: hk.example.com
    kernels:
      - type: sing-box
      - type: xray
        configPath: /custom/xray.json
    location: 香港
    enabled: true
```

Assert round-trip equality. Add API 400 cases for absent, empty, duplicate, and unsupported `kernels`. Update type fixtures to use `kernels: [{ type: 'sing-box' }]` and runtime kernel arrays.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd frontend && bun test src/server/types/__tests__/types.test.ts src/server/services/__tests__/nodeManager.test.ts src/server/__tests__/api/cluster/nodes.test.ts`

Expected: FAIL on missing `kernels` types and the old scalar YAML serializer/parser.

- [ ] **Step 3: Implement types and strict validation**

Add:

```ts
export const KERNEL_TYPES = ['sing-box', 'xray', 'v2ray'] as const;
export type KernelType = typeof KERNEL_TYPES[number];
export interface NodeKernelConfig { type: KernelType; configPath?: string }
```

Implement validation that returns normalized configs in supported-kernel order. It must throw `至少选择一个内核`, `内核类型重复: xray`, or `不支持的内核类型: clash` as appropriate.

- [ ] **Step 4: Replace NodeManager YAML and remote status handling**

Serialize `kernels:` with nested `type` and optional `configPath`. Parse only that sequence. Remove scalar `kernel` branches and `NodeKernelInfo`. In `fetchRemoteStatus`, copy `data.kernels`, calculate node `nodesCount`, and reject malformed Agent responses with `Agent 返回了无效的内核状态`.

- [ ] **Step 5: Update the create-node API**

Accept `kernels`, validate before constructing `NodeConfig`, and remove the single `kernel` default. Preserve existing SSH credential behavior.

- [ ] **Step 6: Verify the main model**

Run: `cd frontend && bun test src/server/types/__tests__/types.test.ts src/server/services/__tests__/nodeManager.test.ts src/server/__tests__/api/cluster/nodes.test.ts`

Expected: all focused tests PASS.

---

### Task 4: Detect, install, and persist several kernels during deployment

**Files:**
- Modify: `frontend/src/server/services/deployManager.ts`
- Modify: `frontend/src/server/services/__tests__/deployManager.test.ts`
- Modify: `frontend/src/server/services/__tests__/deploy-integration.test.ts`
- Create: `frontend/src/pages/api/cluster/kernel/detect.ts`
- Create: `frontend/src/server/__tests__/api/cluster/kernel-detect.test.ts`
- Modify: `frontend/src/pages/api/cluster/deploy.ts`
- Modify: `frontend/src/server/__tests__/api/deploy.test.ts`
- Modify: `frontend/src/pages/api/cluster/kernel/install.ts`
- Modify: `frontend/src/pages/api/cluster/kernel/uninstall.ts`

**Interfaces:**
- Consumes `NodeKernelConfig[]` from Task 3.
- Produces:

```ts
export interface KernelDetection {
  type: KernelType;
  installed: boolean;
  version?: string;
  defaultConfigPath: string;
  error?: string;
}
export interface KernelDeployResult extends KernelDetection {
  selected: boolean;
  monitored: boolean;
  installedNow: boolean;
}
export interface DeployResult {
  outcome: 'success' | 'partial' | 'error';
  success: boolean;
  message: string;
  kernels: KernelDeployResult[];
}
```

- [ ] **Step 1: Write failing deployment service tests**

Mock the SSH executor and assert detection invokes `sing-box version`, `xray version`, and `v2ray version`. Assert missing selected kernels install in supported-kernel order, present selected kernels skip install, failed Xray installation does not prevent V2Ray, and only successful kernels appear in generated `agent.yaml`.

Assert generated YAML contains:

```yaml
kernels:
  - type: sing-box
    configPath: /etc/sing-box/config.json
  - type: v2ray
    configPath: /etc/v2ray/config.json
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `cd frontend && bun test src/server/services/__tests__/deployManager.test.ts src/server/services/__tests__/deploy-integration.test.ts`

Expected: FAIL because `DeployTarget.kernel` and `ensureKernel` are scalar.

- [ ] **Step 3: Implement detection and sequential installation**

Change `DeployTarget` to `kernels: NodeKernelConfig[]`. Add `detectKernels(target)` that connects once and evaluates all version commands with `Promise.all`, then closes SSH. In deployment, iterate selected configs in `KERNEL_TYPES` order and call `ensureKernel` sequentially. Catch per-kernel failures, continue, and abort only if none succeeds.

Generate Agent configuration from successful kernels. Return structured `outcome` and results. Ensure `ssh.end()` executes in `finally`.

- [ ] **Step 4: Write and verify the detection API RED test**

Test POST-only behavior, missing SSH data, private-key resolution, sanitized response, and the three detection results.

Run: `cd frontend && bun test src/server/__tests__/api/cluster/kernel-detect.test.ts`

Expected: FAIL because the route is absent.

- [ ] **Step 5: Add the thin detection route**

The route loads the node or accepts unsaved connection data, resolves private keys through `NodeManager`, calls `DeployManager.detectKernels`, and returns `KernelDetection[]`. Never return password or private-key material.

- [ ] **Step 6: Update deployment API persistence and progress**

`createDeployTarget` passes `node.kernels`. After completion, persist only `result.kernels.filter(item => item.monitored)` as the node's kernels, then update Agent info. Treat `partial` as deployed/running with a warning final message. Extend progress steps so kernel messages identify the current type.

- [ ] **Step 7: Verify all deployment tests**

Run: `cd frontend && bun test src/server/services/__tests__/deployManager.test.ts src/server/services/__tests__/deploy-integration.test.ts src/server/__tests__/api/deploy.test.ts src/server/__tests__/api/cluster/kernel-detect.test.ts`

Expected: all focused tests PASS.

---

### Task 5: Preserve provenance and implement Clash-only region naming

**Files:**
- Create: `frontend/src/server/services/proxySources.ts`
- Create: `frontend/src/server/services/__tests__/proxySources.test.ts`
- Modify: `frontend/src/server/services/nodeManager.ts`
- Modify: `frontend/src/server/services/__tests__/nodeManager.test.ts`
- Modify: `frontend/src/server/services/mioBridgeService.ts`
- Modify: `frontend/src/server/services/mihomoService.ts`
- Modify: `frontend/src/server/services/__tests__/mihomoService.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CollectedProxySource {
  url: string;
  kernel: KernelType;
  nodeId: string;
  location: string;
}
export function dedupeProxySources(sources: CollectedProxySource[]): CollectedProxySource[];
export function buildClashSubscription(sources: CollectedProxySource[]): string;
```

- [ ] **Step 1: Write failing normalization tests**

Cover VLESS/Trojan/SS fragments and VMess `ps`. Required assertions:

```ts
expect(buildClashSubscription([
  source('vless://id@a.example:443#reality', '香港'),
])).toContain('#%E9%A6%99%E6%B8%AF%20reality');

const collision = buildClashSubscription([
  source('vless://id-a@a.example:443#node', '香港'),
  source('vless://id-b@b.example:443#node', '香港'),
]);
expect(decodeURIComponent(collision)).toContain('香港 node [vless://id-a@a.example:443#node]');
expect(decodeURIComponent(collision)).not.toMatch(/node \d+$/m);
```

Also assert identical full URLs collapse before naming and VMess JSON is re-encoded with the new `ps` while other fields are byte-equivalent after decoding.

- [ ] **Step 2: Run normalization tests and verify RED**

Run: `cd frontend && bun test src/server/services/__tests__/proxySources.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement pure normalization helpers**

Deduplicate with `Map<string, CollectedProxySource>`. Extract/set names protocol-safely: URL fragments for URL-based protocols and decoded JSON `ps` for VMess. Compute all base names first, count them, then assign either the base name or `base [original full URL]`. Return newline-separated rewritten URLs for Clash conversion only.

- [ ] **Step 4: Change collection to return structured sources**

Replace `collectRemoteNodeUrls()` with:

```ts
collectRemoteNodeSources(): Promise<{
  sources: CollectedProxySource[];
  errors: string[];
}>;
```

Validate Agent `sources`, attach `node.id` and `node.location`, ignore sources whose matching runtime status is not both monitored and accessible, and preserve configured node/kernel order.

- [ ] **Step 5: Use separate raw and Clash content**

In `MioBridgeService.updateSubscription`, derive `rawContent` from deduplicated original URLs and `clashInput` from `buildClashSubscription`. Write raw/Base64 artifacts from `rawContent`; pass only `clashInput` to `MihomoService.convertToClashByContent`.

- [ ] **Step 6: Verify aggregation and converter behavior**

Run: `cd frontend && bun test src/server/services/__tests__/proxySources.test.ts src/server/services/__tests__/nodeManager.test.ts src/server/services/__tests__/mihomoService.test.ts`

Expected: all focused tests PASS; generated proxy-group references equal the final proxy names.

---

### Task 6: Add the detection dialog and multi-kernel node form

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/components/cluster/KernelDetectionDialog.tsx`
- Create: `frontend/src/components/cluster/__tests__/kernel-detection-dialog.test.tsx`
- Modify: `frontend/src/components/cluster/AddNodeForm.tsx`
- Modify: `frontend/src/components/cluster/__tests__/add-node.test.tsx`
- Modify: `frontend/src/pages/nodes.tsx`
- Modify: `frontend/src/server/__tests__/api/cluster/nodes.test.ts`

**Interfaces:**
- Consumes `KernelDetection`, `KernelType`, and `NodeKernelConfig`.
- Produces `onConfirm(kernels: NodeKernelConfig[]): void` from the dialog and submits `kernels` in node API payloads.

- [ ] **Step 1: Write failing dialog and form tests**

Render three detection rows. Assert installed text is `加入监听`, missing text is `安装并监听`, currently monitored items start checked, newly detected items do not, confirm is disabled with zero selections, and cancel submits nothing. Update add-node tests to assert the form detects before node creation/deployment and preserves values on detection failure.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `cd frontend && bun test src/components/cluster/__tests__/kernel-detection-dialog.test.tsx src/components/cluster/__tests__/add-node.test.tsx`

Expected: FAIL because the dialog and multi-kernel form do not exist.

- [ ] **Step 3: Add typed API methods**

Add `detectKernels(payload)`, change node creation payload to `kernels`, and type deployment results. Keep secrets in request bodies only and never store them in React-visible detection results.

- [ ] **Step 4: Implement the dialog**

Use existing Dialog, Checkbox-compatible controls, StatusBadge, Button, and design tokens. Each row shows name, installed state, version/error, default path, and the correct action label. Maintain selected types as a `Set<KernelType>` and emit supported-kernel ordered configs.

- [ ] **Step 5: Integrate the two-stage form flow**

The initial submit performs detection, opens the dialog, and does not create the node yet. Confirm creates/updates the node with selected kernels and starts deployment. Cancel returns to the intact form. Editing preselects currently monitored types.

- [ ] **Step 6: Verify node interaction tests**

Run: `cd frontend && bun test src/components/cluster/__tests__/kernel-detection-dialog.test.tsx src/components/cluster/__tests__/add-node.test.tsx src/server/__tests__/api/cluster/nodes.test.ts`

Expected: all focused tests PASS.

---

### Task 7: Render per-kernel health throughout the UI

**Files:**
- Modify: `frontend/src/components/cluster/NodeCard.tsx`
- Modify: `frontend/src/components/cluster/NodeDetail.tsx`
- Modify: `frontend/src/components/cluster/ClusterOverview.tsx`
- Modify: `frontend/src/components/cluster/__tests__/cluster-components.test.tsx`
- Modify: `frontend/src/components/cluster/__tests__/cluster-dashboard.test.tsx`
- Modify: `frontend/src/components/Dashboard.tsx`
- Modify: `frontend/src/pages/config.tsx`
- Modify: `frontend/src/pages/nodes.tsx`
- Modify: `frontend/src/lib/__tests__/useClusterSSE.test.ts`

**Interfaces:**
- Consumes `NodeStatus.kernels` and `KernelRuntimeStatus` from Task 3.

- [ ] **Step 1: Replace fixtures and add failing rendering tests**

Use nodes containing all three runtime entries. Assert cards render multiple labels; offline nodes render unknown; details show version, config paths, proxy count, and error per kernel; overview shows online node, monitored kernel, healthy kernel, and proxy totals; config capability rows show `healthy/configured` per type.

- [ ] **Step 2: Run UI status tests and verify RED**

Run: `cd frontend && bun test src/components/cluster/__tests__/cluster-components.test.tsx src/components/cluster/__tests__/cluster-dashboard.test.tsx src/lib/__tests__/useClusterSSE.test.ts`

Expected: FAIL on scalar `node.kernel` and `node.kernelAccessible` assumptions.

- [ ] **Step 3: Implement reusable status mapping**

Use the exact priority: offline → unknown; `!monitored` → unmonitored; `error && !detected` → installation failed; `!accessible` → configuration inaccessible; otherwise normal. Render existing `StatusBadge` variants and CSS variables.

- [ ] **Step 4: Replace aggregate calculations**

Calculate monitored and healthy kernel counts by flattening `nodes.flatMap(node => node.kernels)`. Per-kernel capability denominator includes only nodes whose matching entry has `monitored: true`; numerator additionally requires node online and kernel accessible.

- [ ] **Step 5: Verify the UI suite**

Run: `cd frontend && bun test src/components/cluster/__tests__/cluster-components.test.tsx src/components/cluster/__tests__/cluster-dashboard.test.tsx src/lib/__tests__/useClusterSSE.test.ts`

Expected: all focused tests PASS.

---

### Task 8: Update examples, distributed fixtures, memory, and run full verification

**Files:**
- Modify: `scripts/e2e-distributed.sh`
- Modify: `scripts/e2e-browser.mjs`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `.Codex/memory/project-architecture.md`
- Modify: `.Codex/memory/config-patterns.md`
- Modify: `.Codex/memory/deployment-flow.md`
- Modify: affected test fixtures found by final scalar-field search.

**Interfaces:**
- Consumes all previous tasks and proves the complete feature.

- [ ] **Step 1: Update the distributed fixture before implementation verification**

Configure one Agent with at least Xray and V2Ray fixtures, give both sources distinct titles, and assert `/api/urls` reports both kernel types. Assert `raw.txt` contains both original URLs and `clash.yaml` contains both region-prefixed proxy names.

- [ ] **Step 2: Update browser fixture and documentation**

Replace scalar kernel YAML and payloads with `kernels`. Document the detection dialog, monitoring semantics, per-kernel health, and naming collision behavior. Keep memory entries short and scoped to architecture, config convention, and deployment flow as required by `AGENTS.md`.

- [ ] **Step 3: Remove every stale single-kernel assumption**

Run:

```bash
rg -n "node\.kernel\b|config\.kernel\b|kernelAccessible|singBoxAccessible|^[[:space:]]*kernel:" agent frontend scripts README.md README.zh-CN.md
```

Expected: no production or fixture matches. References explaining removal in the approved spec/plan are allowed outside these paths.

- [ ] **Step 4: Run Agent verification**

Run: `cd agent && bun test && bun run typecheck && bun build src/server.ts --compile --target=bun-linux-x64 --outfile /tmp/miobridge-agent-test`

Expected: all tests PASS, typecheck exits 0, and the binary build succeeds.

- [ ] **Step 5: Run frontend tests**

Run: `cd frontend && bun run test`

Expected: all Vitest suites PASS with no unhandled errors.

- [ ] **Step 6: Run project static and production checks**

Run: `bun run typecheck && bun run lint && bun run build`

Expected: all commands exit 0 and standalone output is prepared with static/public assets.

- [ ] **Step 7: Run distributed end-to-end verification when Linux tooling is available**

Run: `bun run e2e:distributed`

Expected: the child exposes multiple kernels and the main node produces merged `raw.txt`, `subscription.txt`, and `clash.yaml`. If the current macOS host cannot execute the Linux Agent fixture, record the exact environment error and retain the passing automated fixture assertions.

- [ ] **Step 8: Record the verification checkpoint**

Summarize exact commands, pass counts, and any environment-only limitation. Do not claim completion until the verification output has been read. Git commit steps remain skipped because this workspace has no `.git` metadata.
