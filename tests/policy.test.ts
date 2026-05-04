// Tests for the AGP policy DSL evaluator (Flow B / L2).
//
// Mirrors tests/test_policy.py in the Python SDK. Same fixtures, same
// per-fixture decision tables, same expected outcomes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type Decision,
  PolicyEvaluationError,
  decisionToEventPolicyBlock,
  evaluate,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SPEC_POLICIES = join(__dirname, "..", "..", "spec", "fixtures", "policies");

function loadPolicy(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SPEC_POLICIES, name), "utf-8")) as Record<string, unknown>;
}

function buildEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    agp_version: "0.1",
    schema_version: "1.0",
    event_id: "evt_01JFXY8B5Z9RHQXM3WTNPK4VG2",
    occurred_at: "2026-08-12T14:23:11.412Z",
    actor: { vendor: "anthropic.com", agent_id: "agt_test" },
    action: { type: "tool_call" },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === "object"
    ) {
      base[k] = { ...(base[k] as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      base[k] = v;
    }
  }
  return base;
}

interface Case {
  name: string;
  overrides: Record<string, unknown>;
  expected_decision: Decision["decision"];
  expected_rule_id: string;
}

function runCases(policyName: string, cases: Case[]): void {
  const policy = loadPolicy(policyName);
  for (const c of cases) {
    it(`${c.name}`, () => {
      const event = buildEvent(c.overrides);
      const result = evaluate(policy, event);
      expect(result.decision).toBe(c.expected_decision);
      expect(result.rule_id).toBe(c.expected_rule_id);
    });
  }
}

describe("policy 01 — block external email", () => {
  runCases("01-block-external-email.json", [
    {
      name: "internal_email_passes",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "email.send",
          target_resource: "boss@acme.com",
        },
      },
      expected_decision: "logged_only",
      expected_rule_id: "fallback",
    },
    {
      name: "external_email_blocked",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "email.send",
          target_resource: "external@customer.com",
        },
      },
      expected_decision: "blocked",
      expected_rule_id: "rule_external_email_blocked",
    },
    {
      name: "subdomain_internal_passes",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "email.send",
          target_resource: "user@uk.acme.com",
        },
      },
      expected_decision: "logged_only",
      expected_rule_id: "fallback",
    },
    {
      name: "non_email_action_falls_through",
      overrides: { action: { type: "model_response" } },
      expected_decision: "logged_only",
      expected_rule_id: "fallback",
    },
  ]);
});

describe("policy 02 — block PII outbound", () => {
  runCases("02-block-pii-outbound.json", [
    {
      name: "pii_outbound_blocked",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "any.tool",
          target_resource: "https://external.com/api",
          input_summary: "user provided their ssn 123-45-6789",
        },
      },
      expected_decision: "blocked",
      expected_rule_id: "rule_pii_outbound_blocked",
    },
    {
      name: "pii_internal_passes",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "any.tool",
          target_resource: "https://acme.com/internal",
          input_summary: "user provided their ssn",
        },
      },
      expected_decision: "logged_only",
      expected_rule_id: "fallback",
    },
    {
      name: "credit-card_pattern_match",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "any.tool",
          target_resource: "https://external.com/api",
          input_summary: "user shared their credit-card details",
        },
      },
      expected_decision: "blocked",
      expected_rule_id: "rule_pii_outbound_blocked",
    },
  ]);
});

describe("policy 03 — log database writes", () => {
  runCases("03-log-database-writes.json", [
    {
      name: "write_v1_logged",
      overrides: { action: { type: "tool_call", tool_name: "database.write_v1" } },
      expected_decision: "logged_only",
      expected_rule_id: "rule_log_all_database_writes",
    },
    {
      name: "read_passes",
      overrides: { action: { type: "tool_call", tool_name: "database.read_users" } },
      expected_decision: "logged_only",
      expected_rule_id: "fallback",
    },
  ]);

  it("annotate carries SCF controls", () => {
    const policy = loadPolicy("03-log-database-writes.json");
    const event = buildEvent({ action: { type: "tool_call", tool_name: "database.write_users" } });
    const result = evaluate(policy, event);
    expect(result.annotate.scf_controls).toEqual(["DATA-08", "AUDIT-12"]);
  });
});

describe("policy 04 — vendor allowlist", () => {
  runCases("04-vendor-allowlist.json", [
    {
      name: "approved_anthropic_passes",
      overrides: { actor: { vendor: "anthropic.com", agent_id: "agt_test" } },
      expected_decision: "blocked",
      expected_rule_id: "fallback",
    },
    {
      name: "unapproved_blocked",
      overrides: { actor: { vendor: "rogue-vendor.com", agent_id: "agt_test" } },
      expected_decision: "blocked",
      expected_rule_id: "rule_block_unapproved_vendor",
    },
  ]);
});

describe("policy 05 — multi-rule composite (first-match-wins)", () => {
  runCases("05-multi-rule-composite.json", [
    {
      name: "competitor_email_blocked",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "email.send",
          target_resource: "lead@competitor1.com",
        },
      },
      expected_decision: "blocked",
      expected_rule_id: "rule_block_email_to_competitors",
    },
    {
      name: "external_nav_logged",
      overrides: {
        action: {
          type: "tool_call",
          tool_name: "browser.navigate",
          target_resource: "https://news.ycombinator.com",
        },
      },
      expected_decision: "logged_only",
      expected_rule_id: "rule_log_external_browser_navigation",
    },
    {
      name: "internal_database_read_allowed",
      overrides: { action: { type: "tool_call", tool_name: "database.read_orders" } },
      expected_decision: "allowed",
      expected_rule_id: "rule_allow_internal_database_reads",
    },
  ]);
});

describe("evaluator unit tests", () => {
  it("Decision rendered as event policy block", () => {
    const d: Decision = {
      decision: "blocked",
      rule_id: "rule_x",
      reason: "why",
      annotate: {},
    };
    expect(decisionToEventPolicyBlock(d, "sha256:abcd")).toEqual({
      decision: "blocked",
      rule_id: "rule_x",
      policy_hash: "sha256:abcd",
      rationale: "why",
    });
  });

  it("unsupported matcher raises", () => {
    const bad = {
      rules: [
        {
          id: "r1",
          when: { "action.tool_name": { matches_dna_sequence: "AGCT" } },
          then: { decision: "blocked" },
        },
      ],
    };
    expect(() => evaluate(bad, buildEvent())).toThrow(PolicyEvaluationError);
  });

  it("invalid regex raises", () => {
    const bad = {
      rules: [
        {
          id: "r1",
          when: { "action.input_summary": { contains_pattern: "[unclosed" } },
          then: { decision: "blocked" },
        },
      ],
    };
    expect(() =>
      evaluate(
        bad,
        buildEvent({ action: { type: "tool_call", input_summary: "anything" } }),
      ),
    ).toThrow(PolicyEvaluationError);
  });

  it("no rules returns fallback", () => {
    const result = evaluate({ rules: [], fallback: { decision: "block" } }, buildEvent());
    expect(result.decision).toBe("blocked");
    expect(result.rule_id).toBe("fallback");
  });

  it("no fallback defaults to allowed", () => {
    const result = evaluate({ rules: [] }, buildEvent());
    expect(result.decision).toBe("allowed");
    expect(result.rule_id).toBe("fallback");
  });

  it("first-match-wins across rules", () => {
    const policy = {
      rules: [
        { id: "first", when: { "action.type": "tool_call" }, then: { decision: "logged_only" } },
        { id: "second", when: { "action.type": "tool_call" }, then: { decision: "blocked" } },
      ],
    };
    const result = evaluate(policy, buildEvent());
    expect(result.rule_id).toBe("first");
    expect(result.decision).toBe("logged_only");
  });
});
