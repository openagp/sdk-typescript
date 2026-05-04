// Ed25519 keypair generation and serialization helpers.
//
// AGP v0.1 uses Ed25519 only; see ADR 0001. Keys are stored as raw 32-byte
// seeds (private) / 32-byte public-key bytes. Higher-level identity, key
// rotation, and registry interaction live elsewhere — this module only
// manufactures and (de)serializes raw key material.

import { ed25519 } from "@noble/curves/ed25519";

/**
 * Ed25519 keypair. `privateKeyB64` and `publicKeyB64` are standard-base64-
 * encoded raw key bytes (32 bytes each, 44 base64 chars with padding). Use
 * these as the source of truth for storage and `.well-known/agp` discovery
 * documents.
 */
export interface KeyPair {
  readonly privateKeyB64: string;
  readonly publicKeyB64: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Generate a fresh Ed25519 keypair.
 *
 * Returned bytes are NOT secret-derived from any deterministic seed — real
 * callers should manage keys via a KMS / HSM. This helper exists for SDK
 * examples and tests.
 */
export function generateKeyPair(): KeyPair {
  const privateRaw = ed25519.utils.randomPrivateKey();
  const publicRaw = ed25519.getPublicKey(privateRaw);
  return {
    privateKeyB64: bytesToBase64(privateRaw),
    publicKeyB64: bytesToBase64(publicRaw),
  };
}

export function loadPrivateKey(privateKeyB64: string): Uint8Array {
  return base64ToBytes(privateKeyB64);
}

export function loadPublicKey(publicKeyB64: string): Uint8Array {
  return base64ToBytes(publicKeyB64);
}
