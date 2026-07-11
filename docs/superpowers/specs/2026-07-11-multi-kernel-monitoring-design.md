# Multi-Kernel Monitoring and Clash Aggregation Design

## Goal

Replace MioBridge's single-kernel-per-node model with a structured multi-kernel model. A child node can monitor sing-box, Xray, and V2Ray at the same time; the main node aggregates proxy sources from every successfully monitored kernel into one Clash configuration; deployment detects existing kernels and lets the user choose which installed or uninstalled kernels to monitor.

The project has not been deployed, so this change intentionally provides no compatibility or migration path for the old `kernel` and `kernel.type` formats.

## Scope

This feature covers:

- child Agent configuration, URL extraction, and status reporting;
- main-node node configuration and remote status collection;
- SSH kernel detection and multi-kernel deployment;
- source aggregation and Clash proxy naming;
- node configuration, deployment, status, and dashboard UI;
- example configuration, scripts, API contracts, and automated tests.

It does not automatically uninstall an installed kernel when monitoring is disabled.

## Data Model

### Main-node configuration

Replace `NodeConfig.kernel` with a required, non-empty array:

```ts
export type KernelType = 'sing-box' | 'xray' | 'v2ray';

export interface NodeKernelConfig {
  type: KernelType;
  configPath?: string;
}

export interface NodeConfig {
  id: string;
  name: string;
  host: string;
  port?: number;
  secret: string;
  kernels: NodeKernelConfig[];
  location: string;
  enabled: boolean;
  ssh?: NodeSshConfig;
  agent?: NodeAgentInfo;
}
```

Kernel types must be unique within a node. Saving an empty list, a duplicate type, or an unsupported type is a validation error.

### Agent configuration

Replace the single `kernel` mapping with a required `kernels` sequence:

```yaml
kernels:
  - type: sing-box
    configPath: /etc/sing-box/config.json
  - type: xray
    configPath: /usr/local/etc/xray/config.json
```

An omitted `configPath` selects that kernel's default file and directory discovery rules. The Agent rejects an empty list, duplicate types, and unsupported types.

### Runtime status

Each monitored kernel reports independently:

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

export interface NodeStatus {
  nodeId: string;
  name: string;
  location: string;
  online: boolean;
  kernels: KernelRuntimeStatus[];
  nodesCount?: number;
  error?: string;
  latency?: number;
  version?: string;
  uptime?: number;
  agent?: NodeAgentInfo;
}
```

The Agent and main-node APIs remove the old single `kernel`, `kernelAccessible`, and `singBoxAccessible` representations.

## Deployment and Detection

### Detection API

Adding or redeploying a child node begins with SSH connection details. The UI then calls a thin API route backed by `DeployManager` to detect all three supported kernels in parallel.

```ts
export interface KernelDetection {
  type: KernelType;
  installed: boolean;
  version?: string;
  defaultConfigPath: string;
  error?: string;
}
```

Detection uses each kernel's version command and returns a result for every type. An SSH connection failure stops the flow and preserves the form. Failure to inspect one binary is represented on that kernel rather than hiding other results.

### Selection UI

The detection dialog always lists sing-box, Xray, and V2Ray:

- an installed kernel offers **加入监听**;
- an uninstalled kernel offers **安装并监听**;
- at least one kernel must be selected;
- currently monitored kernels are preselected during redeployment;
- newly detected but unmonitored kernels remain unselected.

Cancelling the dialog creates or modifies nothing.

### Deployment execution

The deployment request sends the selected kernel types. The server:

1. uses the detection result as advisory data and rechecks each selected binary;
2. skips installation for selected kernels already present;
3. installs selected missing kernels sequentially;
4. records a structured result for each selected kernel;
5. writes the Agent configuration with only successfully available selected kernels;
6. deploys and starts the Agent when at least one selected kernel succeeded;
7. persists only kernels actually included in the Agent configuration.

Installation failures do not roll back successful kernels. The overall result is `success`, `partial`, or `error`. A partial result identifies every failed kernel and leaves successful kernels monitored. If no selected kernel succeeds, the Agent configuration is not replaced and deployment fails.

Removing a monitored kernel rewrites and restarts the Agent but does not uninstall the kernel. Uninstallation remains a separate explicit action.

## Agent Collection and APIs

The Agent processes each configured kernel independently in stable order: sing-box, Xray, then V2Ray.

Each kernel owns its configuration discovery and parser selection. A malformed or inaccessible configuration for one kernel produces an error for that kernel without preventing collection from the others.

`GET /api/urls` returns structured sources and per-kernel status:

```ts
export interface KernelNodeSource {
  kernel: KernelType;
  url: string;
}

export interface AgentUrlsData {
  sources: KernelNodeSource[];
  kernels: KernelRuntimeStatus[];
}
```

`GET /api/status` returns the same kernel statuses plus Agent uptime and version. It reports all three supported kernels so the UI can show unmonitored types with `monitored: false`. Runtime binary detection supplies `detected`; configured membership supplies `monitored`; readable, parseable configuration supplies `accessible`.

The Agent HTTP service still starts when every monitored kernel is inaccessible so that the main node can diagnose it remotely.

## Main-node Aggregation

The main node retains provenance while collecting Agent results:

```ts
export interface CollectedProxySource {
  url: string;
  kernel: KernelType;
  nodeId: string;
  location: string;
}
```

Only sources from monitored and accessible kernels enter aggregation. A node or kernel failure becomes a warning while other sources continue. The update fails only when no usable source remains.

Sources retain stable order: configured node order first, then sing-box, Xray, and V2Ray within each node. Exact full URLs are globally deduplicated before artifact generation, even when different nodes or kernels report them.

`raw.txt` contains the deduplicated original URLs. `subscription.txt` is the Base64 encoding of that unchanged content.

## Clash Naming and Generation

Clash-only normalization happens between source aggregation and `MihomoService` parsing. It does not rewrite `raw.txt` or `subscription.txt`.

For each unique source:

1. read the original title from the URL fragment, or from VMess `ps`;
2. build the default name as `地区 原标题`, separated by one ASCII space;
3. if different full URLs produce the same default name, replace the conflicting names with `地区 原标题 [完整URL]`;
4. if the resulting names are still identical, the URLs are identical and the duplicate is removed;
5. never append a numeric suffix.

The normalization must preserve valid URL encoding and protocol credentials while changing only the title used by the Clash parser. The final unique proxy names are used consistently by proxy definitions and all proxy groups.

Three kernels have no priority. Exact URL deduplication, stable traversal order, and collision normalization fully determine the result.

## UI Design

The UI continues to use the Botanical Garden tokens and existing component patterns.

### Node configuration

- Replace single-kernel selection with three multi-select kernel options.
- Run SSH detection before showing the monitoring/install selection dialog.
- Allow editing an existing node by redetecting and adding or removing monitored kernels.
- Clearly distinguish disabling monitoring from uninstalling a binary.

### Node cards and details

- Show one label per kernel rather than a single node-level label.
- Each kernel label can display normal, configuration inaccessible, installation failed, unmonitored, or unknown while the node is offline.
- Node details show each kernel's monitored/detected state, version, discovered configuration paths, proxy count, and error.
- Node proxy totals equal the sum of successfully collected unique sources from its monitored kernels.

### Dashboard and configuration page

The overview displays online nodes, monitored kernels, healthy kernels, and total aggregated proxies. Per-kernel capability statistics use `healthy monitored nodes / nodes configured to monitor that kernel`.

### Deployment progress

Detection, selection, installation, Agent deployment, and startup have separate visible states. Kernel installers run sequentially. A partial result keeps successful items visible and lists failed kernels with their errors.

## Error Handling

- SSH failure blocks detection and deployment while preserving entered data.
- Invalid or empty kernel selections return a 400 response with a concrete validation message.
- Kernel detection, installation, discovery, and parsing errors are scoped to their kernel.
- A partial aggregation writes all three artifacts from successful sources and returns warnings.
- A total source failure writes no replacement artifacts.
- A Clash conversion failure preserves the successfully generated `raw.txt` and `subscription.txt` and returns the converter error.
- Agent configuration replacement is atomic so a failed write cannot leave a truncated configuration.

## Testing

### Agent

- parse a valid multi-kernel array with independent paths;
- reject empty, duplicate, and unsupported kernel lists;
- discover and parse all three kernels in one request;
- isolate malformed or inaccessible kernel configuration;
- report three independent runtime statuses;
- deduplicate exact URLs across kernels.

### Main-node services and APIs

- serialize and parse `nodes.yaml` with multiple kernels;
- reject invalid kernel arrays;
- detect all three kernels through SSH;
- install only selected missing kernels, sequentially;
- skip installation for selected existing kernels;
- persist successful monitored kernels after partial deployment;
- aggregate structured sources across nodes and kernels;
- apply `地区 原标题` names;
- append the full URL only on name collisions;
- deduplicate identical URLs without numeric suffixes;
- continue artifact generation on partial source failure;
- expose structured detection, deployment, URL, and status API responses.

### UI

- select multiple kernels and require at least one;
- render installed and uninstalled detection actions correctly;
- preselect currently monitored kernels on redeployment;
- render multiple kernel labels and detailed statuses;
- render partial deployment failures without hiding successes;
- render per-kernel capability counts.

### Verification commands

Run the Agent tests, focused frontend tests, frontend typecheck, lint, and production build. Also update the distributed end-to-end fixture to expose at least two kernels from one child node and assert that both appear in the merged artifacts.

## Acceptance Criteria

- One child Agent can simultaneously collect sources from sing-box, Xray, and V2Ray.
- Kernel failures and health are visible independently on the main node and web UI.
- Deployment detects all three kernels and lets the user choose installed kernels to monitor or missing kernels to install and monitor.
- Partial kernel installation or parsing failure does not discard successful kernels.
- `clash.yaml` combines all usable sources with the confirmed region/title/collision naming rules.
- Node forms, cards, details, dashboards, API types, scripts, examples, and tests no longer assume a single kernel.
- No old single-kernel configuration compatibility code remains.
