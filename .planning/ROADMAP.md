# Roadmap: MioBridge CLI-first Distribution

## Overview

This milestone separates MioBridge's converter from its current mandatory Next.js runtime, packages that capability as an installable Linux command, exposes complete headless workflows, then makes the existing Dashboard an optional lifecycle-managed component. The final phase reduces Vercel to a deliberately read-only frontend demo and proves both distribution paths through release verification.

## Phases

- [ ] **Phase 1: Headless Core Boundary** - Core converter behavior runs without Next.js while existing adapters share it.
- [ ] **Phase 2: Trusted Linux Installer** - Users install or upgrade a verified `miobridge` command with guided dependencies.
- [ ] **Phase 3: Complete CLI Workflow** - Users operate and diagnose the converter entirely from the command line.
- [ ] **Phase 4: Optional Dashboard Lifecycle** - Users opt into the Dashboard and control foreground or background operation.
- [ ] **Phase 5: Demo and Release Boundary** - Vercel is frontend-only and releases verify the complete supported story.

## Phase Details

### Phase 1: Headless Core Boundary
**Goal**: Users can run MioBridge's core converter independently of the web application.
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03
**Success Criteria** (what must be TRUE):
  1. Core configuration and conversion can execute successfully without starting or importing a Next.js server.
  2. The CLI and current API/SSR entry points produce equivalent converter results through shared services.
  3. Running from different working directories reads and writes the same state beneath `~/.config/miobridge`.
  4. Existing main-node artifact ownership and child-Agent HMAC source collection continue to work through the extracted core.
**Plans**: TBD

### Phase 2: Trusted Linux Installer
**Goal**: Linux users can safely install and upgrade the lightweight MioBridge command and its required capabilities.
**Depends on**: Phase 1
**Requirements**: INST-01, INST-02, INST-03, INST-04
**Success Criteria** (what must be TRUE):
  1. A clean supported Linux x64 or arm64 host gains a working `miobridge` command from one documented installation invocation.
  2. Missing Bun, mihomo, or yq is detected and resolved through clear guided choices, while existing compatible installations are reused.
  3. Installation refuses an artifact whose checksum does not match its pinned release metadata.
  4. Reinstalling or upgrading preserves configuration and reports the active command, dependency versions, and resolved paths.
**Plans**: TBD

### Phase 3: Complete CLI Workflow
**Goal**: Headless users can configure, operate, automate, and diagnose MioBridge entirely through `miobridge` commands.
**Depends on**: Phase 2
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04
**Success Criteria** (what must be TRUE):
  1. User can initialize, view, validate, atomically change, back up, and roll back configuration without editing repository files.
  2. User can update subscription sources and generate all three compatibility artifacts from the CLI.
  3. User can identify health, Agent/kernel capability, artifact paths, running version, service state, and remediation from redacted diagnostics.
  4. Automation can distinguish success and failure using stable exit codes and run supported commands without prompts.
**Plans**: TBD

### Phase 4: Optional Dashboard Lifecycle
**Goal**: Users who want a web interface can add and operate it without making it part of the core installation.
**Depends on**: Phase 3
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04
**Success Criteria** (what must be TRUE):
  1. Headless users can omit Dashboard assets, while another user can install them later without reinstalling the core CLI.
  2. User can run the Dashboard in the foreground on a chosen host and port and stop it with normal process control.
  3. User can start, stop, restart, query, and inspect logs for a persistent Dashboard service through `miobridge dashboard`.
  4. The installed Dashboard loads its static/public assets correctly and exposes management only on a local binding by default.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Demo and Release Boundary
**Goal**: Visitors can safely explore a frontend-only demo while users receive verified Linux releases and unambiguous deployment guidance.
**Depends on**: Phase 4
**Requirements**: DEMO-01, DEMO-02, REL-01, REL-02
**Success Criteria** (what must be TRUE):
  1. A Vercel CLI deployment builds only the frontend demo and presents representative synthetic/read-only MioBridge views.
  2. Demo visitors cannot trigger SSH, service lifecycle, host configuration mutation, filesystem persistence, or conversion processes.
  3. Release checks use the frontend-scoped TypeScript gate and exercise Agent tests, a fresh Linux install, a headless conversion, and Dashboard foreground/background lifecycle before publishing.
  4. A new user can clearly choose between CLI-only installation, optional Dashboard operation, and the non-operational Vercel demo without encountering obsolete `deploy.yml` or health-check instructions.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Headless Core Boundary | 0/TBD | Not started | - |
| 2. Trusted Linux Installer | 0/TBD | Not started | - |
| 3. Complete CLI Workflow | 0/TBD | Not started | - |
| 4. Optional Dashboard Lifecycle | 0/TBD | Not started | - |
| 5. Demo and Release Boundary | 0/TBD | Not started | - |
