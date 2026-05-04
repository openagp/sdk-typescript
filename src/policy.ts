// AGP policy DSL evaluator (Flow B / L2).
//
// Mirror of openagp.policy in the Python SDK. Same matchers, same
// first-match-wins semantics, same fallback handling. Cross-language
// interop is verified against deterministic test vectors in
// openagp/spec/test-vectors/v0.1-policy-decisions.json.
//
// See openagp/spec/fixtures/policies/README.md for the matcher reference.

export class PolicyEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyEvaluationError";
  }
}

export interface Decision {
  decision: "allowed" | "blocked" | "logged_only";
  rule_id: string;
  reason: string;
  annotate: Record<string, unknown>;
}

// === Field-path resolution ===================================================

function resolvePath(event: Record<string, unknown>, path: string): unknown {
  let cur: unknown = event;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null || !(part in (cur as object))) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// === Matchers ================================================================

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function matchEquals(actual: unknown, expected: unknown): boolean {
  return deepEqual(actual, expected);
}

function matchNotEquals(actual: unknown, expected: unknown): boolean {
  return !deepEqual(actual, expected);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length) return false;
    return ka.every((k, i) =>
      k === kb[i] &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

function matchIn(actual: unknown, expected: unknown): boolean {
  return Array.isArray(expected) && expected.some((v) => deepEqual(actual, v));
}

function matchNotIn(actual: unknown, expected: unknown): boolean {
  return Array.isArray(expected) && !expected.some((v) => deepEqual(actual, v));
}

function matchStartsWith(actual: unknown, prefix: unknown): boolean {
  return isString(actual) && isString(prefix) && actual.startsWith(prefix);
}

function matchEndsWith(actual: unknown, suffix: unknown): boolean {
  return isString(actual) && isString(suffix) && actual.endsWith(suffix);
}

function matchContainsPattern(actual: unknown, pattern: unknown): boolean {
  if (!isString(actual) || !isString(pattern)) return false;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    throw new PolicyEvaluationError(
      `contains_pattern: invalid regex ${JSON.stringify(pattern)}: ${(err as Error).message}`,
    );
  }
  return re.test(actual);
}

function extractHost(value: string): string | null {
  // Email-like
  if (value.includes("@") && !value.includes("/")) {
    const host = value.split("@", 2)[1] ?? "";
    return host ? host.toLowerCase() : null;
  }
  // URL
  try {
    const url = new URL(value);
    if (url.hostname) return url.hostname.toLowerCase();
  } catch {
    // not a URL
  }
  // Bare hostname
  if (!value.includes("/") && value.includes(".")) {
    return value.toLowerCase();
  }
  return null;
}

function domainMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".acme.com"
    return h.endsWith(suffix) && h !== suffix.replace(/^\.+/, "");
  }
  return h === p;
}

function matchDomainIn(actual: unknown, patterns: unknown): boolean {
  if (!isString(actual) || !Array.isArray(patterns)) return false;
  const host = extractHost(actual);
  if (host === null) return false;
  return patterns.some((p) => isString(p) && domainMatches(host, p));
}

function matchDomainNotIn(actual: unknown, patterns: unknown): boolean {
  if (!isString(actual) || !Array.isArray(patterns)) return false;
  const host = extractHost(actual);
  if (host === null) return false;
  return !patterns.some((p) => isString(p) && domainMatches(host, p));
}

const MATCHERS: Record<string, (actual: unknown, arg: unknown) => boolean> = {
  equals: matchEquals,
  eq: matchEquals,
  not_equals: matchNotEquals,
  ne: matchNotEquals,
  in: matchIn,
  not_in: matchNotIn,
  starts_with: matchStartsWith,
  ends_with: matchEndsWith,
  contains_pattern: matchContainsPattern,
  domain_in: matchDomainIn,
  domain_not_in: matchDomainNotIn,
};

// === Rule evaluation =========================================================

function conditionMatches(
  fieldPath: string,
  condition: unknown,
  event: Record<string, unknown>,
): boolean {
  const actual = resolvePath(event, fieldPath);

  // Literal -> equality match.
  if (
    condition === null ||
    typeof condition !== "object" ||
    Array.isArray(condition)
  ) {
    return deepEqual(actual, condition);
  }

  const entries = Object.entries(condition as Record<string, unknown>);
  if (entries.length !== 1) {
    throw new PolicyEvaluationError(
      `matcher object on ${JSON.stringify(fieldPath)} must have exactly one key, got ${entries.length}`,
    );
  }
  const [matcherName, arg] = entries[0]!;
  const matcher = MATCHERS[matcherName];
  if (!matcher) {
    throw new PolicyEvaluationError(
      `unsupported matcher ${JSON.stringify(matcherName)} on ${JSON.stringify(fieldPath)}; ` +
        `v0.1 supports ${Object.keys(MATCHERS).sort().join(", ")}`,
    );
  }
  return matcher(actual, arg);
}

interface Rule {
  id?: string;
  when?: Record<string, unknown>;
  then?: { decision?: string; reason?: string; annotate?: Record<string, unknown> };
}

function ruleMatches(rule: Rule, event: Record<string, unknown>): boolean {
  const when = rule.when ?? {};
  if (typeof when !== "object" || when === null) {
    throw new PolicyEvaluationError(`rule ${rule.id ?? "?"}: when must be an object`);
  }
  return Object.entries(when).every(([path, cond]) => conditionMatches(path, cond, event));
}

function appliesTo(policy: Record<string, unknown>, event: Record<string, unknown>): boolean {
  const aRaw = policy["applies_to"];
  if (!aRaw || typeof aRaw !== "object") return true;
  const a = aRaw as Record<string, unknown>;

  const vendors = a.vendors as unknown[] | undefined;
  if (vendors && vendors.length > 0) {
    const evVendor = resolvePath(event, "actor.vendor");
    if (!vendors.some((v) => v === "*" || v === evVendor)) return false;
  }

  const agents = a.agents as unknown[] | undefined;
  if (agents && agents.length > 0) {
    const evAgent = resolvePath(event, "actor.agent_id");
    if (!agents.some((g) => g === "*" || g === evAgent)) return false;
  }

  const actions = a.actions as unknown[] | undefined;
  if (actions && actions.length > 0) {
    const evType = resolvePath(event, "action.type");
    if (!actions.includes(evType)) return false;
  }

  return true;
}

// === Public API ==============================================================

/**
 * Evaluate `policy` against `event` and return a Decision.
 *
 * Pure function: no I/O, no logging, no exceptions for normal control flow.
 * Throws PolicyEvaluationError only for malformed policies (unsupported
 * matcher, invalid regex, etc.).
 */
export function evaluate(
  policy: Record<string, unknown>,
  event: Record<string, unknown>,
): Decision {
  if (typeof policy !== "object" || policy === null) {
    throw new TypeError("evaluate: policy must be an object");
  }
  if (typeof event !== "object" || event === null) {
    throw new TypeError("evaluate: event must be an object");
  }

  if (!appliesTo(policy, event)) {
    return fallbackDecision(policy, "policy does not apply to this event");
  }

  const rules = (policy.rules as Rule[] | undefined) ?? [];
  for (const rule of rules) {
    if (ruleMatches(rule, event)) {
      const then = rule.then ?? {};
      return {
        decision: (then.decision as Decision["decision"]) ?? "allowed",
        rule_id: rule.id ?? "<unnamed>",
        reason: then.reason ?? "",
        annotate: { ...(then.annotate ?? {}) },
      };
    }
  }

  return fallbackDecision(policy, "no rule matched");
}

function fallbackDecision(policy: Record<string, unknown>, reason: string): Decision {
  const fb = (policy.fallback as { decision?: string } | undefined) ?? {};
  const raw = fb.decision;
  let decision: Decision["decision"];
  if (raw === "allow_with_log") decision = "logged_only";
  else if (raw === "block") decision = "blocked";
  else if (raw === "allowed" || raw === "blocked" || raw === "logged_only") decision = raw;
  else decision = "allowed";

  return {
    decision,
    rule_id: "fallback",
    reason,
    annotate: {},
  };
}

/**
 * Render a Decision as the `policy` block for an L2 event.
 */
export function decisionToEventPolicyBlock(
  d: Decision,
  policyHash: string,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    decision: d.decision,
    rule_id: d.rule_id,
    policy_hash: policyHash,
  };
  if (d.reason) block.rationale = d.reason;
  return block;
}
