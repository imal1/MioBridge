---
name: bug-fixes
description: Compact bug fixes and operational lessons for MioBridge
metadata:
  type: project
---

# Bug Fixes

- 2026-07-14: The one-line installer resolves and verifies a release without
  relying on its source path, then atomically installs both the CLI and dashboard;
  piped execution never looks for `/home/<user>/manage.sh`.
- 2026-07-14: Dashboard HTTP routes, SSH kernel detection, Agent deployment, and
  lifecycle actions run inside the compiled CLI instead of a browser framework
  runtime or shell management tree.
- 2026-07-14: Node kernel updates use a real `PUT /api/cluster/nodes` handler,
  cluster updates use POST consistently, and Agent action routes call their
  matching operation rather than silently succeeding.
- 2026-07-14: Core reads and writes YAML directly, so production no longer needs
  an external YAML command-line tool.
- 2026-07-14: The dashboard health indicator renders safely outside its optional
  provider context, and navigation uses stable browser URLs.
- 2026-07-12: Runtime paths and state are independent of cwd and remain under
  `~/.config/miobridge`; configured binaries are resolved independently.
