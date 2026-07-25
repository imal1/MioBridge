import { Ajv, type Schema } from 'ajv';
import { expect } from 'vitest';

const ajv = new Ajv({ allErrors: true, strict: true });

/**
 * The dashboard speaks two envelope dialects and both are load-bearing for
 * existing clients: `applicationEnvelope` (correlated, structured error) is the
 * newer surface, `legacyEnvelope` (bare string error) is what the original
 * status/compat routes still emit.
 */
export const applicationEnvelope: Schema = {
  type: 'object',
  required: ['success', 'timestamp', 'requestId', 'role'],
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    data: {},
    message: { type: 'string' },
    error: {
      type: 'object',
      required: ['code', 'message', 'retryable'],
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
        field: { type: 'string' },
      },
    },
    timestamp: { type: 'string', minLength: 1 },
    requestId: { type: 'string', minLength: 1 },
    role: { type: 'string' },
  },
};

export const legacyEnvelope: Schema = {
  type: 'object',
  required: ['success', 'timestamp'],
  properties: {
    success: { type: 'boolean' },
    data: {},
    message: { type: 'string' },
    error: { type: 'string' },
    timestamp: { type: 'string' },
  },
};

export const healthEnvelope: Schema = {
  type: 'object',
  required: ['status', 'timestamp', 'uptime', 'version'],
  properties: {
    status: { type: 'string', enum: ['healthy', 'unhealthy'] },
    timestamp: { type: 'string' },
    uptime: { type: 'number' },
    memory: { type: 'object' },
    version: { type: 'string' },
    error: { type: 'string' },
  },
};

/** Validates `body` and fails with ajv's messages instead of a bare boolean. */
export function assertSchema(schema: Schema, body: unknown, label: string): void {
  const validate = ajv.compile(schema);
  if (!validate(body)) {
    expect.fail(`${label} violated its schema: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body)}`);
  }
}

/** Either dialect is acceptable; the caller only cares that it is one of them. */
export function assertEnvelope(body: unknown, label: string): void {
  const application = ajv.compile(applicationEnvelope);
  if (application(body)) return;
  const legacy = ajv.compile(legacyEnvelope);
  if (legacy(body)) return;
  expect.fail(`${label} matched neither envelope dialect: ${ajv.errorsText(legacy.errors)}\n${JSON.stringify(body)}`);
}
