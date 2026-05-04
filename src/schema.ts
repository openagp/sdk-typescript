// JSON Schema loading and validation for AGP messages.
//
// Schemas are bundled with the SDK under `src/_schemas/` and kept in sync
// with `openagp/spec/schemas/` via `scripts/sync-schemas.sh`. CI fails if
// the two diverge.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Raised when a message does not match its JSON Schema.
 */
export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export type MessageKind =
  | "event"
  | "policy"
  | "decision-request"
  | "decision-response"
  | "discovery";

const SCHEMA_NAMES = [
  "common.json",
  "event.json",
  "policy.json",
  "decision-request.json",
  "decision-response.json",
  "discovery.json",
] as const;

function loadBundled(name: string): Record<string, unknown> {
  // Schemas are colocated with the compiled output under dist/_schemas/ at
  // runtime. During TS dev/test runs from src/, they're at src/_schemas/.
  // We try both relative paths so the SDK works either way.
  const candidates = [
    join(__dirname, "_schemas", name),
    join(__dirname, "..", "src", "_schemas", name),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      // try next
    }
  }
  throw new Error(`bundled schema not found: ${name} (tried ${candidates.join(", ")})`);
}

let _ajvCache: Ajv2020 | null = null;

function getAjv(): Ajv2020 {
  if (_ajvCache) return _ajvCache;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  // Register all schemas. ajv resolves $ref by $id (which we set in each
  // schema), and also by the relative key we addSchema() under.
  for (const name of SCHEMA_NAMES) {
    const schema = loadBundled(name);
    ajv.addSchema(schema, name);
  }

  _ajvCache = ajv;
  return ajv;
}

function getValidator(kind: MessageKind): ValidateFunction {
  const ajv = getAjv();
  const validate = ajv.getSchema(`${kind}.json`);
  if (!validate) {
    throw new Error(`unknown message kind: ${kind}`);
  }
  return validate as ValidateFunction;
}

/**
 * Validate `message` against the bundled schema for `kind`.
 *
 * Throws SchemaValidationError on failure. Returns void on success.
 */
export function validate(message: unknown, kind: MessageKind = "event"): void {
  const validator = getValidator(kind);
  if (!validator(message)) {
    const errors = validator.errors ?? [];
    const first = errors[0];
    const path = first?.instancePath || "<root>";
    const more = errors.length > 1 ? `  (+${errors.length - 1} more error(s))` : "";
    throw new SchemaValidationError(
      `${kind} schema validation failed at ${path}: ${first?.message ?? "unknown error"}${more}`,
    );
  }
}
