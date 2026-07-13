// Centralized version and build metadata
// Single source of truth for the application version
import pkg from '../../../package.json';

export const VERSION: string = pkg.version;

export const GIT_COMMIT: string =
  process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown';

export const BUILD_TIME: string =
  process.env.NEXT_PUBLIC_BUILD_TIME || 'unknown';
