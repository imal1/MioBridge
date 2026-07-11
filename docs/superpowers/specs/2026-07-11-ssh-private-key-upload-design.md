# SSH Private Key Upload Design

## Goal

Replace free-text SSH private-key entry with a file upload and make password
authentication and private-key authentication mutually exclusive for child
nodes.

## Scope

- Applies to the child-node add flow and remote Agent deployment.
- Supports username plus SSH login password, or username plus an unencrypted
  private-key file.
- Does not support passphrase-protected private keys in this change.
- Does not add node editing or credential rotation UI.

## User Experience

The add-node dialog presents a two-option authentication control:

- `Password`: shows SSH username and password inputs.
- `Private key`: shows SSH username and a file picker.

Only the fields for the selected method are mounted and submitted. Switching
methods clears the credential from the previous method. The private-key picker
accepts common SSH key files and displays the selected filename, but never
renders the key contents. Submission is blocked when the selected credential is
missing or when the uploaded file does not contain a supported unencrypted PEM
private-key header.

The browser reads the selected file and sends its contents through the existing
JSON API. This is still a file-upload interaction; the text is an internal
transport detail and is never exposed as an editable field.

## Data Model

`NodeSshConfig` gains an explicit `authMethod` value:

```ts
type SshAuthMethod = 'password' | 'privateKey';

interface NodeSshConfig {
  user: string;
  port?: number;
  authMethod: SshAuthMethod;
  credentialRef?: string;
  hostKey: string;
  password?: string;
}
```

Private-key contents are stored separately through `StateStore` under
`ssh-keys/<nodeId>`. With the file backend this is a separate runtime file;
with Redis it is a separate namespaced key. `nodes.yaml` stores only the
credential reference and never contains the uploaded private-key contents.

Password credentials remain in `nodes.yaml` for compatibility with the current
storage model. A private-key node has no password property. A password node has
no credential reference.

## API And Persistence Flow

The add-node request includes `sshAuthMethod` and exactly one of
`sshPassword` or `sshPrivateKey`, plus the selected filename for validation and
diagnostics.

The API validates the request before creating the node:

- username is required for both methods;
- password mode requires a non-empty password and rejects private-key content;
- private-key mode requires valid unencrypted private-key content and rejects a
  password;
- encrypted PEM keys are rejected with a clear unsupported-message;
- private-key uploads are size-limited to 64 KiB.

`NodeManager` generates the node ID before persistence. For private-key mode it
writes `ssh-keys/<nodeId>` first, writes the node config with a reference second,
and deletes the key if node-config persistence fails. The returned `NodeConfig`
contains only the reference, never the key contents.

## Deployment Flow

Before deployment, the deploy API resolves the selected credential:

- password mode passes only `password` to `DeployManager`;
- private-key mode reads the referenced StateStore key and passes only
  `privateKey` to `DeployManager`.

`DeployManager` builds SSH options from `authMethod` and fails immediately when
the selected credential is unavailable. It does not fall back to a password,
filesystem path, SSH agent, or another authentication method. Private-key mode
does not use the login password as a key passphrase or sudo password. Non-root
private-key deployments therefore require passwordless sudo.

Legacy `keyPath` data may still be parsed for compatibility, but it is not used
by the new add or deploy flow. Existing nodes must upload their key again before
private-key deployment can run through the new flow.

## Security And Error Handling

- Private-key content is never serialized into `nodes.yaml`, API responses, or
  logs.
- Validation errors identify the field or unsupported key type without echoing
  credential content.
- StateStore errors abort node creation.
- A partially written private-key record is deleted if the node write fails.
- File-backed key records inherit the StateStore runtime directory and are
  written with owner-only file permissions where supported.

## Testing

- API tests verify missing credentials, mixed credentials, invalid/encrypted
  keys, and valid password/private-key requests.
- NodeManager tests verify separate key persistence, key rollback, and no key
  material in `nodes.yaml` or returned node data.
- DeployManager tests verify each `authMethod` produces exactly one SSH
  credential and missing credentials fail without fallback.
- UI tests verify the file input replaces the textarea, switching methods hides
  and clears the previous credential, and submission contains only the selected
  credential.
- Run the focused tests, full frontend tests, typecheck, lint, and production
  build before completion.
