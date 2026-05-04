# openagp/sdk-typescript

**Reference TypeScript SDK for AGP — vendor-side and plane-side.**

## Status

Scaffold. Implementation tracked in [§4.2 Phase 1](https://github.com/openagp/spec/blob/main/concept-and-spec.md#42-build-order--what-claude-code-should-build-first) of the spec.

## Planned API

```ts
import { Event, sign, verify } from "@openagp/sdk";
import { Policy, evaluate } from "@openagp/sdk";
import { vendorRouter, planeRouter } from "@openagp/sdk/server";
import { VendorClient, PlaneClient } from "@openagp/sdk/client";
```

Cross-language interop is verified in CI: events emitted by this SDK are verified by [`openagp/sdk-python`](https://github.com/openagp/sdk-python), and vice versa.

## Install

```bash
npm install @openagp/sdk
```

*(Stub package reserves the scope on npm; functional release pending Phase 1.)*

## Node support

20+

## License

[Apache-2.0](LICENSE).
