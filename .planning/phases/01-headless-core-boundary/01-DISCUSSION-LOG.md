# Phase 1: Headless Core Boundary - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-12
**Phase:** 1-headless-core-boundary
**Areas discussed:** Core package boundary

---

## Core Package Location

| Option | Description | Selected |
|--------|-------------|----------|
| `packages/core/` | Independent workspace package consumed by CLI and Dashboard | ✓ |
| `core/` | Lightweight top-level directory without a package namespace | |
| `src/core/` | Root-project source directory | |

**User's choice:** `packages/core/`
**Notes:** The user explicitly stated that keeping the backend core in `frontend/src/server/**` is no longer appropriate.

## Capability Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Conversion + node aggregation + Agent client | Core configuration, conversion, artifacts, node aggregation, and HMAC Agent communication; exclude deployment/lifecycle | ✓ |
| Conversion only | Leave node and Agent behavior in frontend | |
| All backend capabilities | Include SSH deployment and remote lifecycle behavior | |

**User's choice:** Conversion, node aggregation, and Agent client.
**Notes:** SSH deployment, systemd, and Dashboard lifecycle remain outside core.

## Public Consumer Contract

| Option | Description | Selected |
|--------|-------------|----------|
| `MioBridgeCore` facade + subservices | One composition root with focused narrower services where needed | ✓ |
| Independent services only | Every consumer composes services itself | |
| Command functions only | Export functions without service objects | |

**User's choice:** `MioBridgeCore` facade plus a small set of focused subservices.
**Notes:** CLI, API, and SSR should share this public core boundary.

## Migration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Switch consumers + temporary re-exports | Migrate API/SSR now and preserve deprecated old import paths temporarily | ✓ |
| Hard cutover | Delete all old paths in the same change | |
| Duplicate then switch later | Keep old and new implementations active temporarily | |

**User's choice:** Switch consumers in Phase 1 and retain temporary deprecated re-exports.
**Notes:** Compatibility paths must not retain duplicate business implementations.

## the agent's Discretion

- Internal subservice decomposition below `MioBridgeCore`.
- Exact deprecation annotations and equivalence-test organization.
- Placement of frontend-only logging and HTTP response helpers.

## Deferred Ideas

None.
