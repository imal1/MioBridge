# MioBridge Functional Redesign PRD

## Status

- Type: design-only product requirements
- Date: 2026-07-04
- Scope: frontend information architecture, page responsibilities, and mockup content
- Code changes: none

## Problem

MioBridge has grown from a subscription conversion tool into a distributed proxy control plane. It now handles subscription generation, remote Agent deployment, node health, runtime configuration, logs, and public outputs. The current product shape exposes these as separate technical modules, but the user's real task is end-to-end:

> Add or maintain node sources, deploy or recover Agents, regenerate subscription artifacts, verify outputs, and diagnose failures.

The existing functional design does not make that task obvious enough. A user can see many tools, but the product does not clearly answer:

- What is the next step?
- Is the system ready to generate a usable subscription?
- Which part failed when generation does not work?
- Which output artifact should I use now?
- Which future permission boundary does each page represent?

## Goals

1. Reduce the cold-start path from adding a node to getting a usable `clash.yaml` to under 10 minutes.
2. Let users locate the source of a failed subscription generation within 2 clicks.
3. Make the primary workflow clear: add node, deploy Agent, update subscription, verify outputs.
4. Keep separate pages because future multi-user permissions will map to page-level capabilities.
5. Preserve the Signal Room and Signal Garden visual language already defined in the design docs.

## Non-Goals

- Do not collapse the app into a single-page dashboard.
- Do not implement multi-user accounts in this design pass.
- Do not redesign the visual style, palette, typography, motion, or surface system.
- Do not change existing API routes or backend architecture.
- Do not replace advanced pages with a simplified consumer flow.

## Users

### Primary User

Personal self-hosting operator with 1 to many VPS machines. They maintain sing-box, Xray, V2Ray, or similar node sources and want one control plane to generate subscription artifacts, deploy Agents, observe status, and recover from failure.

### Secondary Future User

Small-team administrator. They may later invite users with different abilities: view subscription status, operate nodes, deploy Agents, edit configuration, inspect logs, or use API endpoints.

## Product Principle

The app should remain multi-page, but each page must participate in the same operational story.

> Pages are permission boundaries. The workflow is cross-page.

## Information Architecture

| Route | New Responsibility | Future Permission Scope |
| --- | --- | --- |
| `/` | Readiness console and next action | `overview:read` |
| `/subscription` | Output artifact center and generation pipeline | `subscription:read`, `subscription:update` |
| `/nodes` | Node lifecycle management | `nodes:read`, `nodes:operate` |
| `/deploy` | Agent deployment runbook and queue | `deploy:read`, `deploy:execute` |
| `/config` | Runtime profiles and guarded settings | `config:read`, `config:write` |
| `/logs` | Failure-source diagnostics | `logs:read` |
| `/api-docs` | Endpoint ledger and API capability mapping | `api:read`, `api:execute` |

## Key Flows

### Flow 1: Cold Start

1. User opens `/` and sees setup readiness.
2. User follows the next action to add a node.
3. User deploys Agent or marks the node as source-only.
4. User updates subscription.
5. User verifies output artifacts.

### Flow 2: Generation Failure

1. User sees generation is blocked or degraded.
2. User opens diagnostics from `/` or `/subscription`.
3. Failure is grouped by source: local kernel, remote Agent, source URL, mihomo conversion, file write.
4. User sees the recommended action and jumps to the correct page.

### Flow 3: Node Recovery

1. User sees node lifecycle state.
2. Product shows valid operations for that state only.
3. User restarts Agent, redeploys, skips node, or opens logs.

### Flow 4: Future Multi-User Readiness

1. Each page has a clear capability boundary.
2. Destructive or write actions are visually separate from read-only status.
3. API docs show endpoint capabilities so future permissions can map cleanly.

## Requirements

### R1. Readiness Console

The overview page must show:

- Subscription readiness score or state
- Required setup steps and current completion
- Active blockers with source category
- Next recommended action
- Output artifact summary

### R2. Output Artifact Center

The subscription page must promote generated artifacts to first-class product objects:

- `raw.txt`
- `subscription.txt`
- `clash.yaml`

Each artifact should show:

- generated or missing state
- last generated time
- source node count
- conversion status
- copy, download, and validate actions

### R3. Generation Pipeline

The subscription page must show the pipeline:

Source URLs -> raw output -> base64 subscription -> Clash YAML -> public endpoints.

Each step should expose status and failure source.

### R4. Node Lifecycle Model

Nodes must use a lifecycle model:

- draft
- ready to deploy
- deploying
- online
- degraded
- offline
- skipped

Each lifecycle state must show only relevant actions.

### R5. Deployment Runbook

The deployment page must show deployment as a runbook:

- SSH check
- upload Agent
- write config
- start service
- verify health
- report result

### R6. Diagnostics by Failure Source

Logs must not be only raw log tailing. The logs page must support failure-source diagnosis:

- local kernel
- remote Agent
- source URL
- mihomo conversion
- file write
- scheduler

### R7. Permission-Friendly Boundaries

Every page should explicitly reveal which actions are read-only and which require elevated permissions in the future. This does not require authentication yet, only clean design boundaries.

## Success Metrics

- A new user can explain the cold-start next step from the overview page without reading docs.
- A failed generation has a visible failure source category within 2 clicks.
- A user can find and use the correct output artifact without opening API docs.
- Node actions are understandable from the node lifecycle state.
- Future permission scopes can be mapped to existing pages without changing IA.

## Open Questions

1. Should source-only nodes be a first-class lifecycle state or a node type?
2. Should output validation include actual subscription client compatibility checks?
3. Should diagnostics store structured failure events separately from logs?
4. Should future permissions be page-based only, or action-based inside pages?
5. Should API docs remain user-facing, or become an admin/developer-only page later?

## Design Impact

The visual language stays unchanged. The mockups should update content and component meaning:

- Overview becomes a readiness console instead of a generic KPI dashboard.
- Subscription becomes an artifact center plus generation pipeline.
- Nodes become lifecycle cards rather than simple health cards.
- Deploy becomes a runbook.
- Config becomes guarded runtime profiles.
- Logs become diagnostics grouped by failure source.
- API docs become a capability ledger.
