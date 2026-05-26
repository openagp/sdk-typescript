# openagp/sdk-typescript

**Reference TypeScript SDK for AGP — vendor-side and plane-side.**

[![npm](https://img.shields.io/npm/v/@openagp/sdk.svg?style=flat-square&color=2a6db8)](https://www.npmjs.com/package/@openagp/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square)](LICENSE)
[![Spec](https://img.shields.io/badge/spec-v0.1%20draft-blue.svg?style=flat-square)](https://github.com/openagp/spec/blob/main/concept-and-spec.md)

## Install

```bash
npm install @openagp/sdk
```

Node.js 20+. Pure JavaScript at runtime — no native bindings, no build step on install.

Runtime deps: `@noble/curves` (Ed25519), `canonicalize` (RFC 8785 JCS), `ajv` + `ajv-formats` (JSON Schema validation).

## Quick start

```ts
import { generateKeyPair, sign, verify } from "@openagp/sdk";

// vendor side
const keys = generateKeyPair();

const event = {
  agp_version: "0.1",
  schema_version: "1.0",
  event_id: "evt_01JFXY8B5Z9RHQXM3WTNPK4VG2",
  occurred_at: "2026-08-12T14:23:11.412Z",
  actor: {
    vendor: "yourcompany.com",
    agent_id: "agt_42",
  },
  action: {
    type: "tool_call",
    tool_name: "browser.navigate",
  },
};

const signed = sign(event, {
  privateKeyB64: keys.privateKeyB64,
  keyId: "yourcompany-2026-q2",
});

// plane side
verify(signed, { publicKeyB64: keys.publicKeyB64 });   // throws InvalidSignature on tamper
```

## What the SDK does (and doesn't)

**Implements** — per [ADR 0001](https://github.com/openagp/spec/blob/main/decisions/0001-signature-canonicalization.md):

- RFC 8785 JCS canonicalization
- Ed25519 sign / verify
- JSON Schema validation against bundled v0.1 schemas (Draft 2020-12)
- Tamper detection via signature
- Algorithm-substitution rejection (only `Ed25519` is accepted)

**Does NOT implement yet** (Phase 1+):

- HTTP client / server scaffolds (Express / Fastify vendor + plane apps)
- Policy DSL evaluation
- Real-time decision callback (Flow C)
- Registry resolution and key rotation

## Cross-language interop

This SDK is interop-tested against the [Python reference SDK](https://github.com/openagp/sdk-python) using deterministic byte-level test vectors checked into [`openagp/spec/test-vectors/`](https://github.com/openagp/spec/tree/main/test-vectors). For the same input:

- `canonicalize()` MUST produce identical UTF-8 bytes (RFC 8785).
- `sign()` MUST produce identical signatures with the same key (Ed25519 is deterministic per RFC 8032).
- A signature produced by one SDK MUST verify in the other.

If any of those drift, CI fails. **That's the contract that makes AGP a real cross-vendor protocol** — not an implementation-specific dialect.

## Schemas

The SDK ships a bundled copy of every AGP JSON Schema under `src/_schemas/`. These are kept in lockstep with the canonical schemas in [`openagp/spec`](https://github.com/openagp/spec/tree/main/schemas) — CI fails if they drift. To sync after pulling the latest spec:

```bash
scripts/sync-schemas.sh
```

## Development

Clone alongside `openagp/spec` (tests load fixtures and test vectors from a sibling checkout — CI clones both repos automatically):

```bash
git clone https://github.com/openagp/spec
git clone https://github.com/openagp/sdk-typescript
cd sdk-typescript
npm install
```

Then:

```bash
npm test                 # vitest, including cross-language vectors
npm run build            # ESM + CJS dual output
scripts/sync-schemas.sh  # pull canonical schemas from ../spec/schemas/
```

Bundled schemas under `src/_schemas/` must stay in sync with `../spec/schemas/` — CI fails if they drift. Run `scripts/sync-schemas.sh` after pulling spec changes.

For cross-language sanity, also run the conformance suite locally:

```bash
cd ../cts && make vectors    # builds agp-cts + runs embedded test vectors
```

See [CONTRIBUTING.md](https://github.com/openagp/.github/blob/main/CONTRIBUTING.md) at the org level for DCO sign-off and PR conventions, and [SUPPORT.md](https://github.com/openagp/.github/blob/main/SUPPORT.md) for where to ask questions or file bugs.

## Status

Scaffold + Phase 0 sign/verify roundtrip with cross-language interop. The full Phase 1 SDK (HTTP scaffolds, policy evaluator) is in progress; see [§4.2 Phase 1](https://github.com/openagp/spec/blob/main/concept-and-spec.md#42-build-order--what-claude-code-should-build-first) of the spec.

## License

[Apache-2.0](LICENSE).
