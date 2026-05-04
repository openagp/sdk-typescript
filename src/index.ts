// OpenAGP — reference TypeScript SDK for the Agent Governance Protocol.
//
// Public API for v0.1:
//   import { sign, verify, generateKeyPair, InvalidSignature } from "@openagp/sdk";
//   import { canonicalize, validate } from "@openagp/sdk";
//
// The signing protocol is specified in ADR 0001 of openagp/spec.

export { canonicalize } from "./canonical.js";
export {
  type KeyPair,
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
} from "./keys.js";
export {
  type MessageKind,
  SchemaValidationError,
  validate,
} from "./schema.js";
export {
  type SignOptions,
  type VerifyOptions,
  InvalidSignature,
  SIG_ALG,
  buildSigningInput,
  sign,
  verify,
} from "./events.js";

export const version = "0.0.0";
