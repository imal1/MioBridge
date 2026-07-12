/** Framework-neutral logging port used by core services. */
export interface CoreLogger {
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void;
}

/** Package identity for headless-runtime and tracing probes. */
export const CORE_PACKAGE_NAME = '@miobridge/core' as const;
