---
name: miobridge-testing-workflow
description: Standard MioBridge Playwright testing workflow focused on minimum token use and maximum development efficiency. Use when adding, updating, debugging, or reviewing MioBridge Playwright tests, dashboard E2E coverage, SOP chain tests, Page Objects, flows, fixtures, Playwright reports, traces, or browser-based verification for this repository.
---

# MioBridge Testing Workflow

## Core Rule

Treat source code as the source of truth. Use browser inspection only when code, reports, and traces cannot determine the answer, or when the user explicitly requests browser inspection.

Optimize for minimum useful context:

1. Read the user request.
2. Read the related Playwright spec.
3. Read the related Page Object.
4. Read the related business flow.
5. Read the related component object.
6. Read the fixture.
7. Read the utility.
8. Read the existing DSL.
9. Read existing JSON test data.
10. Read the Playwright JSON report.
11. Read one trace only if needed.
12. Use Browser MCP only if still needed.

Stop collecting context as soon as there is enough information to implement or explain the result.

## Workflow

Follow this order for MioBridge testing tasks:

1. Search for existing specs, Page Objects, flows, fixtures, components, utilities, DSL, and JSON data before creating anything.
2. Reuse the existing test architecture; do not create parallel helpers or duplicated locators.
3. Modify the smallest relevant implementation.
4. Run the smallest useful Playwright scope.
5. Inspect the Playwright JSON report before opening traces.
6. Inspect at most one trace when the JSON report is insufficient.
7. Use Browser MCP only for allowed cases.
8. Re-run affected tests only.
9. Stop when affected tests pass and the implementation is not duplicated.

## Playwright Commands

Never run `npx playwright test` unless explicitly requested.

Prefer this execution order:

1. Single test.
2. Single spec.
3. `--grep`.
4. Related folder.
5. Full suite only when explicitly required or genuinely necessary.

Use the repository commands and package scripts when available, especially:

- `bun run e2e:typecheck`
- `bun run e2e`
- workspace-local Playwright scripts under `packages/e2e`

## Failure Analysis

Inspect the Playwright JSON report first. If it explains the failure, fix from the report and source code.

Open a trace only for unclear assertion causes, timing issues, network issues, or locator ambiguity.

Use Browser MCP only when trace analysis is insufficient or the problem is visual, responsive, animation, canvas/WebGL, drag-and-drop, or locator behavior that cannot be inferred from code.

## Test Generation

Reuse existing abstractions:

- Page Objects
- business flows
- fixtures
- components
- utilities
- DSL
- JSON test data

Keep test cases data-oriented. Put business logic inside flows, Page Objects, or components.

Do not generate one Playwright spec per Excel row. Prefer:

Excel -> JSON -> DSL -> Playwright executor

If the same logic appears three or more times, extract a reusable abstraction.

## Limits

Keep repository exploration under 20 files unless the user authorizes deeper investigation.

Use at most:

- 1 browser session
- 1 trace file
- 2 screenshots

Ask before exceeding these limits.

Do not use Browser MCP commands by default, including browser snapshot, screenshot, click, hover, type, console, or navigate.

## Definition of Done

Finish when:

- affected Playwright tests pass
- duplicated code is reduced or avoided
- existing abstractions are reused
- browser interaction was avoided unless necessary
- only the minimum required tests were executed
- the final response states what changed, why, and what tests ran
