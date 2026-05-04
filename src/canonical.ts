// RFC 8785 JCS (JSON Canonicalization Scheme) — thin wrapper.
//
// Per ADR 0001, AGP uses RFC 8785 to produce deterministic byte sequences
// for signing. This module wraps the `canonicalize` npm package — written by
// the RFC 8785 author — so the rest of the SDK imports `canonicalize` from
// one place; if we ever swap the implementation, only this file changes.

import canonicalizeImpl from "canonicalize";

/**
 * Return the RFC 8785 canonical JSON encoding of `obj` as UTF-8 bytes.
 *
 * The returned bytes are the input to AGP's signing algorithm. Cross-language
 * interop requires every implementation to produce identical bytes for the
 * same input — that's RFC 8785's whole purpose.
 */
export function canonicalize(obj: unknown): Uint8Array {
  const json = canonicalizeImpl(obj);
  if (json === undefined) {
    throw new TypeError("canonicalize: input cannot be undefined");
  }
  return new TextEncoder().encode(json);
}
