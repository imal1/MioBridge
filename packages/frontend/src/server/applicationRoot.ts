import { createRequire } from 'node:module'
import * as path from 'node:path'

/** Resolve the repository/standalone root without depending on the launch cwd. */
export function resolveApplicationRoot(resolvePackage = createRequire(import.meta.url).resolve): string {
  const frontendPackage = resolvePackage('miobridge-dashboard/package.json')
  return path.dirname(path.dirname(frontendPackage))
}
