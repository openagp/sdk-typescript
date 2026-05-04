// AGP signed-event handling: sign and verify per ADR 0001.
//
// The signing protocol — every byte of it — is specified in
// `openagp/spec/decisions/0001-signature-canonicalization.md`. This module
// is the canonical reference TypeScript implementation. Cross-language
// interop is verified against deterministic test vectors checked into the
// spec repo.

import { ed25519 } from "@noble/curves/ed25519";

import { canonicalize } from "./canonical.js";
import { type MessageKind, SchemaValidationError, validate } from "./schema.js";
import { loadPrivateKey, loadPublicKey } from "./keys.js";

export const SIG_ALG = "Ed25519" as const;

/**
 * Raised when a message's signature does not verify.
 */
export class InvalidSignature extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignature";
  }
}

interface SignatureObject {
  key_id: string;
  alg: string;
  value?: string;
}

interface AgpMessage {
  signature?: SignatureObject;
  [key: string]: unknown;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Construct the canonical signing input per ADR 0001 §To sign step 1-2.
 *
 * Sets `signature` to `{ key_id, alg: "Ed25519" }` (no value field), then
 * JCS-canonicalizes the entire message. Returned bytes are what Ed25519
 * signs over.
 */
export function buildSigningInput(message: AgpMessage, keyId: string): Uint8Array {
  const msg: AgpMessage = structuredClone(message);
  msg.signature = { key_id: keyId, alg: SIG_ALG };
  return canonicalize(msg);
}

export interface SignOptions {
  privateKeyB64: string;
  keyId: string;
  kind?: MessageKind;
}

/**
 * Sign an AGP message in place per ADR 0001.
 *
 * Returns a new object with `signature.value` populated. Does not mutate the
 * input. The result is schema-validated AFTER signing — if you want
 * pre-validation, call validate(message, kind) yourself first.
 */
export function sign(message: AgpMessage, options: SignOptions): AgpMessage {
  const { privateKeyB64, keyId, kind = "event" } = options;

  const privateKey = loadPrivateKey(privateKeyB64);
  const signingInput = buildSigningInput(message, keyId);
  const sigBytes = ed25519.sign(signingInput, privateKey);
  const sigB64 = bytesToBase64(sigBytes);

  const signed: AgpMessage = structuredClone(message);
  signed.signature = {
    key_id: keyId,
    alg: SIG_ALG,
    value: sigB64,
  };

  validate(signed, kind);
  return signed;
}

export interface VerifyOptions {
  publicKeyB64: string;
  kind?: MessageKind;
}

/**
 * Verify an AGP message per ADR 0001.
 *
 * Steps:
 *   1. Schema-validate the message.
 *   2. Reject unsupported signature.alg values.
 *   3. Reconstruct the canonical signing input (signature without value).
 *   4. Verify the Ed25519 signature against `publicKeyB64`.
 *
 * Throws SchemaValidationError or InvalidSignature on failure.
 */
export function verify(message: AgpMessage, options: VerifyOptions): void {
  const { publicKeyB64, kind = "event" } = options;

  validate(message, kind);

  const sig = message.signature;
  if (!sig || typeof sig.value !== "string") {
    throw new InvalidSignature("message has no signature.value");
  }
  if (sig.alg !== SIG_ALG) {
    throw new InvalidSignature(
      `unsupported signature.alg ${JSON.stringify(sig.alg)}; v0.1 requires "${SIG_ALG}"`,
    );
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64ToBytes(sig.value);
  } catch (err) {
    throw new InvalidSignature(`signature.value is not valid base64: ${(err as Error).message}`);
  }
  if (sigBytes.length !== 64) {
    throw new InvalidSignature(`expected 64-byte Ed25519 signature, got ${sigBytes.length} bytes`);
  }

  const publicKey = loadPublicKey(publicKeyB64);
  const signingInput = buildSigningInput(message, sig.key_id);

  const ok = ed25519.verify(sigBytes, signingInput, publicKey);
  if (!ok) {
    throw new InvalidSignature("Ed25519 verification failed");
  }
}

export { SchemaValidationError };
