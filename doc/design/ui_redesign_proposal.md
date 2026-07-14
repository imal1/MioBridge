# MioBridge Signal Room - Frontend Redesign Proposal

## Design read

Reading this as: an existing technical operations product for subscription conversion, cluster health, deployment, and diagnostics, with a premium control-room language, leaning toward soft structuralism, dark graphite surfaces, one emerald signal accent, and cinematic but restrained motion.

This proposal is design-only. It does not modify `frontend/` code. The mockups in `doc/design/images/` are generated from `doc/design/design_mockups.html`.

Functional requirements now live in `./product_redesign_prd.md`. The visual system remains Signal Room / Signal Garden; the functional design changes the meaning and hierarchy of the screens, not the style.

## Applied design rules

- `design-taste-frontend`: used as an anti-generic filter, not as a landing-page generator. MioBridge is a product UI, so the rule set is applied to visual direction, typography discipline, palette restraint, and anti-template checks.
- `high-end-visual-design`: used for double-bezel panels, haptic buttons, glass-like command surfaces, dense whitespace, and agency-grade visual depth.
- `redesign-existing-projects`: used for audit-first redesign. Existing routes and business concepts are preserved.

## Dials

- `DESIGN_VARIANCE: 7`
- `MOTION_INTENSITY: 6`
- `VISUAL_DENSITY: 7`

Reasoning: this is a dense operations UI, so it cannot become a sparse marketing composition. The interface needs presence, but it still has to support repeated work. Motion is allowed to feel premium, but it must communicate hierarchy, state change, and live system activity.

## High-end motion audit

The current night concept mostly satisfies the visual half of `high-end-visual-design`, but the first design pass under-specified motion. The revised design treats motion as a first-class system.

| Rule | Status | Notes |
| --- | --- | --- |
| Double-bezel panels | Pass | Major cards use outer shell and inner core. |
| Button-in-button CTA | Pass | Primary CTAs include nested icon islands. |
| Deep glass / machined surfaces | Pass | Night mode uses graphite, moss glass, inner highlights, and tinted ambient shadows. |
| Non-generic layout | Pass | Pages use varied structures: signal map, pipeline, node grid, deployment ledger, config vault, terminal stream. |
| Fluid entry animation | Revised | Mockup source now defines a heavy fade-up using transform and opacity for rail, title, actions, and cards. |
| Magnetic button physics | Revised | Buttons now specify hover lift, active compression, and icon drift. |
| Card haptics | Revised | Cards now specify transform-only hover lift and inner glow. |
| Reduced motion | Revised | Mockup source includes a reduced-motion override. |
| Backdrop blur constraints | Pass | Blur is limited to rail-like fixed command surfaces in the design source. |

### Motion choreography

- Page load: command rail resolves first, then page title, then action pills, then content cards with a staggered delay.
- Primary CTA hover: pill lifts by 2px, icon island drifts 3px on the X axis, and the glow expands softly.
- Active press: CTA compresses to `scale(0.985)`.
- Card hover: shell lifts with `translateY(-4px)` and increases the inner highlight. No layout properties animate.
- Active navigation: command rail item uses a spring-like cubic curve and glow pulse.
- Live indicators: semantic status dots pulse slowly with opacity and box-shadow only.
- Logs and deployment rows: rows reveal in sequence to imply live telemetry without turning the product into a spectacle.
- Reduced motion: all transforms and keyframes collapse to static opacity.

Implementation target for a future code pass:

```css
transition:
  transform 720ms cubic-bezier(0.32, 0.72, 0, 1),
  opacity 720ms cubic-bezier(0.32, 0.72, 0, 1),
  box-shadow 720ms cubic-bezier(0.32, 0.72, 0, 1);
```

## Current audit

### Preserve

- Route structure: `/`, `/subscription`, `/nodes`, `/deploy`, `/config`, `/logs`, `/api-docs`.
- Chinese product copy and operational terms.
- Existing Botanical token vocabulary can remain as a previous-theme reference, but the new visual direction is not botanical.
- Thin status semantics: success, warning, danger, info.

### Retire

- Generic light card dashboard rhythm.
- Serif-heavy garden branding, which makes the product feel decorative instead of operational.
- Repeated equal card grids without a visual hierarchy.
- Loose mock content such as English sample names.
- Flat white panels with light borders only.
- Tool-page thinking where each route is isolated from the user's end-to-end task.
- Output files presented only as links or API endpoints instead of first-class product artifacts.
- Node health shown as static status without a lifecycle state or recommended action.

## New concept

**MioBridge Signal Room** treats subscription conversion as a signal operation:

- The product is a control room for routes, files, agents, and generated outputs.
- Navigation becomes a compact command rail instead of a bulky sidebar.
- Each page gets a different composition while sharing tokens and atmosphere.
- Status is shown through signal bars, rings, ledgers, and telemetry strips.

## Functional model

The app remains multi-page because pages will become future permission boundaries. The workflow, however, must be cross-page:

1. Add or verify node source.
2. Deploy or recover Agent.
3. Update subscription generation.
4. Validate generated artifacts.
5. Diagnose failures by source.

Core product principle:

> Pages are permission boundaries. The workflow is cross-page.

### Capability map

| Route | Product responsibility | Future permission scope |
| --- | --- | --- |
| `/` | Readiness console and next action | `overview:read` |
| `/subscription` | Output artifact center and generation pipeline | `subscription:read`, `subscription:update` |
| `/nodes` | Node lifecycle management | `nodes:read`, `nodes:operate` |
| `/deploy` | Agent deployment runbook and queue | `deploy:read`, `deploy:execute` |
| `/config` | Runtime profiles and guarded settings | `config:read`, `config:write` |
| `/logs` | Failure-source diagnostics | `logs:read` |
| `/api-docs` | Endpoint ledger and API capability mapping | `api:read`, `api:execute` |

## Visual system

The design has two modes. They do not need to be visually identical, but they share geometry, density, component behavior, and the same information architecture.

### Night mode

Night mode is the current Signal Room direction: high contrast, graphite, emerald signal accents, and deep glass surfaces.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| Graphite | `#080b09` | app background |
| Carbon | `#101511` | primary panel |
| Moss glass | `rgba(35, 57, 43, 0.62)` | nested surface |
| Signal | `#7ee2a8` | primary accent |
| Amber | `#d6a94a` | warning |
| Rust | `#c8664a` | failure |
| Frost | `#eaf5eb` | primary text |
| Mist | `#8ea097` | secondary text |

One accent color is used across the product: Signal green.

### Day mode

Day mode is **Signal Garden**: a cleaner daytime companion to Signal Room. It borrows Botanical Garden freshness without returning to the old decorative garden identity.

| Token | Value | Use |
| --- | --- | --- |
| Paper | `#f7f8ef` | app background |
| Mist green | `#e9f2e8` | ambient field |
| Porcelain | `rgba(255, 255, 250, 0.84)` | primary panel |
| Stem | `#3f8f5f` | primary accent |
| Sage text | `#526357` | secondary text |
| Ink leaf | `#142016` | primary text |
| Pollen | `#c9972f` | warning |
| Clay | `#b9573e` | failure |

Day mode keeps the same command rail and double-bezel structure, but surfaces become frosted porcelain instead of graphite glass. The accent remains green, slightly deeper and less neon for daytime contrast.

### Typography

- Display: Geist or a similar geometric grotesk.
- Body: Plus Jakarta Sans or system sans with medium weight.
- Numeric and code data: JetBrains Mono or SF Mono.
- Avoid decorative serif use in product screens.

### Shape and surface

- Primary frame radius: `28px`.
- Inner card radius: `22px`.
- Buttons: pill radius.
- Important surfaces use a double-bezel structure: outer shell, inner core, inner highlight.
- Shadows are green-tinted or ambient, never generic black shadow presets.

### Motion notes

Motion is specified, not implemented here:

- Page entry: heavy fade-up using transform and opacity only.
- Command rail: active item slides with spring timing.
- Cards: hover lift through transform and opacity only.
- Deployment and logs: timeline rows reveal with stagger.
- Respect reduced motion.

## Page directions

### 1. 总览 `/`

Purpose: readiness console and next action.

Composition:

- Left command rail and top status strip.
- Large “总览” headline with setup readiness and generation state.
- A main workflow panel shows the cold-start path: 添加节点, 部署 Agent, 更新订阅, 验证输出.
- Blockers are grouped by source: 本机内核, 远端 Agent, 订阅源, mihomo 转换, 文件写入.
- Output artifact summary is visible above the fold so the user knows whether the system has produced usable files.

Night image: `./images/dashboard.jpg`

Day image: `./images/day-dashboard.jpg`

### 2. 订阅 `/subscription`

Purpose: output artifact center and generation pipeline.

Composition:

- `raw.txt`, `subscription.txt`, and `clash.yaml` are treated as first-class artifacts.
- Each artifact shows generated state, last update, source node count, conversion state, and copy/download/validate actions.
- The generation pipeline runs below the artifacts: source URLs, raw output, base64 subscription, Clash YAML, public endpoints.
- Manual conversion remains available, but it is secondary to the main artifact workflow.

Night image: `./images/subscription.jpg`

Day image: `./images/day-subscription.jpg`

### 3. 节点 `/nodes`

Purpose: node lifecycle management.

Composition:

- Node cards keep the existing 3 by 2 rhythm and premium surface treatment.
- Each card is organized around lifecycle state: 草稿, 待部署, 部署中, 在线, 降级, 离线, 已跳过.
- Each state exposes only the recommended next actions.
- Cards show node role, Agent state, source count, last heartbeat, and recovery route.

Night image: `./images/nodes.jpg`

Day image: `./images/day-nodes.jpg`

### 4. 部署 `/deploy`

Purpose: Agent deployment runbook and queue.

Composition:

- Deployment is shown as a runbook: SSH check, upload Agent, write config, start service, verify health.
- Queue cards show running, waiting, and failed deployments.
- Each failed step exposes retry, open logs, or skip node actions.
- Progress is visualized as runways and ticks, not generic bars only.

Night image: `./images/deploy.jpg`

Day image: `./images/day-deploy.jpg`

### 5. 配置 `/config`

Purpose: guarded runtime profiles.

Composition:

- Configuration is split into runtime profile, source discovery, output filenames, and future permission-sensitive settings.
- Read-only environment facts are visually separated from write actions.
- Config list appears as a dense code pad with line numbers.
- Capability chips indicate future permission boundaries without implementing users yet.

Night image: `./images/config.jpg`

Day image: `./images/day-config.jpg`

### 6. 日志 `/logs`

Purpose: failure-source diagnostics.

Composition:

- Filter controls sit in a narrow left diagnostics panel.
- Failure source groups sit above or beside the terminal stream: 本机内核, 远端 Agent, 订阅源, mihomo 转换, 文件写入, 定时任务.
- Terminal stream remains the dominant surface for advanced users.
- Log levels use one accent family plus semantic amber and rust.

Night image: `./images/logs.jpg`

Day image: `./images/day-logs.jpg`

### 7. API 接口 `/api-docs`

Purpose: endpoint and capability ledger.

Composition:

- Endpoint table becomes a ledger with method chips, action pills, and future capability scopes.
- Public compatibility endpoints are separated from admin control endpoints.
- Notes panel is compact and readable.
- Three primary output endpoints remain above the fold, with secondary endpoints visible below.

Night image: `./images/api-docs.jpg`

Day image: `./images/day-api-docs.jpg`

## Implementation guidance for a future pass

- Work with the existing Vite SPA, React Router, and Tailwind v4.
- Keep server behavior in the CLI dashboard API.
- Introduce the visual layer behind existing typed API clients.
- Use URL-stable routes and existing Chinese copy.
- Add the design system as tokens before component rewrites.
- Build one page first, likely `/nodes` or `/subscription`, then expand.

## Pre-flight checks for future implementation

- No code implementation in this design pass.
- No em dash characters in visible UI copy.
- One accent color across pages.
- No generic three equal feature cards as the dominant structure.
- No generic purple gradient language.
- No div-based fake product screenshots in the final app. Mockups are acceptable as design artifacts only.
- No `window.addEventListener("scroll")` for animation.
- All motion must support reduced motion.
- Inputs need labels and focus states.
- Dense tables and logs need tabular numerals.
