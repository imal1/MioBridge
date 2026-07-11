# SSH Private Key Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict password-or-private-key SSH authentication, upload private keys as files, and persist key material separately through StateStore.

**Architecture:** The node API validates a discriminated SSH credential request and delegates private-key persistence to NodeManager. NodeManager stores key material under a separate StateStore key and serializes only the credential reference into nodes.yaml. The deploy API resolves that reference and DeployManager builds one explicit SSH authentication option without fallback.

**Tech Stack:** Next.js Pages Router, React 19, TypeScript, StateStore file/Redis abstraction, ssh2, Vitest, Testing Library.

## Global Constraints

- Password and private-key authentication are mutually exclusive.
- Private-key mode supports unencrypted private keys only, with a 64 KiB limit.
- Private-key material must not appear in nodes.yaml, API responses, or logs.
- New deployment behavior must not fall back to filesystem paths, SSH agent, or another credential.
- Use the existing JSON API; the browser file picker reads the selected file for transport.

---

### Task 1: SSH Credential Types And Validation

**Files:**
- Modify: `frontend/src/server/types/index.ts`
- Create: `frontend/src/server/services/sshCredential.ts`
- Create: `frontend/src/server/services/__tests__/sshCredential.test.ts`

**Interfaces:**
- Produces: `SshAuthMethod`, updated `NodeSshConfig`, and `validateUploadedPrivateKey(value: string): void`.

- [ ] Write failing tests for accepted OpenSSH/RSA/EC unencrypted PEM keys, encrypted-key rejection, malformed-key rejection, and the 64 KiB limit.
- [ ] Run `cd frontend && bun test src/server/services/__tests__/sshCredential.test.ts` and confirm failures are caused by the missing module.
- [ ] Add `SshAuthMethod = 'password' | 'privateKey'`; replace `keyPath` as the active credential with `authMethod` and optional `credentialRef`, retaining optional `keyPath` only for parsing legacy data.
- [ ] Implement `validateUploadedPrivateKey` with explicit supported PEM headers, encrypted PEM detection, and byte-size validation.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Separate Private-Key Persistence

**Files:**
- Modify: `frontend/src/server/services/nodeManager.ts`
- Modify: `frontend/src/server/services/stateStore.ts`
- Modify: `frontend/src/server/services/__tests__/nodeManager.test.ts`
- Modify: `frontend/src/server/services/__tests__/stateStore.test.ts`

**Interfaces:**
- Produces: `NodeManager.writeNodeWithPrivateKey(node: NodeConfig, privateKey?: string): Promise<NodeConfig>` and `NodeManager.getNodePrivateKey(node: NodeConfig): Promise<string>`.
- Consumes: `validateUploadedPrivateKey(value: string): void`.

- [ ] Write failing tests proving a private key is stored under `ssh-keys/<nodeId>`, nodes.yaml and the returned node omit key material, password nodes write no key record, and a failed node write deletes the key record.
- [ ] Write a failing file-store test proving nested secret files are mode `0600`.
- [ ] Run both focused suites and confirm expected failures.
- [ ] Update FileStateStore writes to use mode `0600` while retaining directory creation.
- [ ] Generate node IDs before duplicate checks, add private-key write/read helpers, and implement rollback around node-config persistence.
- [ ] Serialize and parse `authMethod` and `credentialRef`; continue parsing legacy `keyPath` without using it as a new credential.
- [ ] Re-run both focused suites and confirm they pass.

### Task 3: Strict Deploy Authentication

**Files:**
- Modify: `frontend/src/server/services/deployManager.ts`
- Modify: `frontend/src/pages/api/cluster/deploy.ts`
- Modify: `frontend/src/server/services/__tests__/deployManager.test.ts`
- Modify: `frontend/src/server/__tests__/api/deploy.test.ts`

**Interfaces:**
- `DeployTarget.ssh` consumes `authMethod`, optional `password`, and optional transient `privateKey`.
- The deploy API consumes `NodeManager.getNodePrivateKey(node)` for private-key nodes.

- [ ] Add failing tests that inspect generated ssh2 connection options: password mode includes only `password`, private-key mode includes only `privateKey`, and missing selected credentials reject before connection without agent/path fallback.
- [ ] Add a failing deploy API test proving private-key references are resolved before calling DeployManager and never returned.
- [ ] Run the focused suites and confirm expected failures.
- [ ] Extract a testable `buildSshConnectOptions` method, validate the selected credential, and remove key-path/passphrase/SSH-agent fallback behavior.
- [ ] Resolve the key reference asynchronously in the deploy API and pass only the selected credential.
- [ ] Preserve password-based sudo only in password mode; private-key mode uses non-interactive sudo for non-root users.
- [ ] Re-run focused deploy tests and confirm they pass.

### Task 4: Add-Node API Contract

**Files:**
- Modify: `frontend/src/pages/api/cluster/nodes.ts`
- Create: `frontend/src/server/__tests__/api/cluster/nodes.test.ts`
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Request fields: `sshAuthMethod`, `sshPassword?`, `sshPrivateKey?`, `sshPrivateKeyName?`.
- Consumes: `NodeManager.writeNodeWithPrivateKey` and `validateUploadedPrivateKey`.

- [ ] Write failing API tests for missing credentials, mixed credentials, encrypted/malformed keys, valid password creation, valid private-key creation, and response redaction.
- [ ] Run the focused API suite and confirm expected failures.
- [ ] Parse and validate the discriminated request; return credential validation failures as HTTP 400.
- [ ] Construct a NodeConfig containing only the selected credential metadata and call `writeNodeWithPrivateKey`.
- [ ] Update `apiService.addNode` request typing to the new contract.
- [ ] Re-run the focused API suite and confirm it passes.

### Task 5: File-Upload User Interface

**Files:**
- Modify: `frontend/src/pages/nodes.tsx`
- Modify: `frontend/src/components/cluster/AddNodeForm.tsx`
- Modify: `frontend/src/components/cluster/__tests__/add-node.test.tsx`
- Create: `frontend/src/pages/__tests__/nodes.test.tsx`

**Interfaces:**
- The page form produces the add-node API request contract from Task 4.

- [ ] Write failing UI tests proving a segmented authentication choice is present, private-key mode renders a file input and no textarea, switching modes hides the other credential, and selected file content is submitted only in private-key mode.
- [ ] Run the focused UI tests and confirm expected failures.
- [ ] Replace `sshKey` state with `sshAuthMethod`, `sshPrivateKey`, and `sshPrivateKeyName`; read files with `File.text()` and clear the previous credential when switching modes.
- [ ] Render accessible Password/Private key controls using existing Tabs and form components, show only the selected credential field, and show the selected filename without key content.
- [ ] Apply the same contract to the retained AddNodeForm component so its tests and any future use cannot reintroduce text entry.
- [ ] Re-run focused UI tests and confirm they pass.

### Task 6: Compatibility, Documentation, And Verification

**Files:**
- Modify: affected fixtures under `frontend/src/server/**/__tests__`
- Modify: `.Codex/memory/config-patterns.md`
- Modify: `.Codex/memory/bug-fixes.md`

**Interfaces:**
- Existing fixtures use explicit `authMethod`; legacy parser coverage retains `keyPath` parsing only.

- [ ] Update compile-time fixtures and expectations to the explicit authentication model.
- [ ] Record the StateStore SSH key convention and prepend a concise bug-fix note.
- [ ] Run `cd frontend && bun test` and fix only regressions caused by this change.
- [ ] Run `bun run typecheck` from the repository root.
- [ ] Run `bun run lint` from the repository root.
- [ ] Run `bun run build` from the repository root.
- [ ] Run `git diff --check`, inspect `git diff --stat` and `git status --short`, and verify no credential fixture contains a real secret.
- [ ] Commit the implementation with a focused message.
