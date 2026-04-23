import { describe, expect, it } from "vitest";
import {
  BASELINE_HARNESS_RULE,
  classifyRunState,
  CONTEXT_BOUNDARY_SPEC,
  CONTRACT_VERSIONING_AND_STATE_MIGRATION_RULE,
  NON_COMPENSATORY_SHIP_BLOCKERS,
  NON_SIGNAL_PROXY_BAN_LIST,
  RETENTION_ELIGIBILITY_SCHEMA,
  RESEARCH_QUALITY_CONTRACT_VERSION,
  STATE_CLASSIFICATION_CONTRACT,
  STATE_CLASSIFICATION_RULES,
  RUN_TYPE_QUALITY_MATRIX
} from "@/lib/orchestrator/research-quality-contract";

describe("research-quality-contract", () => {
  it("covers every run type with a quality matrix entry", () => {
    expect(Object.keys(RUN_TYPE_QUALITY_MATRIX)).toEqual([
      "exploratory_scan",
      "comparison_tradeoff_analysis",
      "longitudinal_watch",
      "contradiction_resolution",
      "pre_decision_verification"
    ]);
  });

  it("keeps proxy bans and blockers explicit", () => {
    expect(Object.keys(NON_SIGNAL_PROXY_BAN_LIST)).toEqual([
      "user_satisfaction_alone",
      "click_open_rate",
      "inbox_clear_rate",
      "reading_completion",
      "time_saved_alone",
      "operator_acceptance_without_audit",
      "repeated_selection_without_downstream_verification"
    ]);
    expect(Object.keys(NON_COMPENSATORY_SHIP_BLOCKERS)).toEqual([
      "contradiction_exposure_regression",
      "source_diversity_floor_collapse",
      "freshness_minimum_violation",
      "provenance_completeness_regression",
      "cross_context_contamination"
    ]);
  });

  it("defaults uncertain context boundaries to stricter fresh context", () => {
    expect(CONTEXT_BOUNDARY_SPEC.triggerPolicy).toEqual({
      primary: "planner_or_classifier",
      fallbackOnUncertainty: "stricter_fresh_context",
      operatorOverrideAllowed: true,
      crossContextCarryoverDefault: "disabled",
      auditLogRequired: true
    });
  });

  it("requires retention to stay minimal, versioned, and revalidatable", () => {
    expect(RETENTION_ELIGIBILITY_SCHEMA).toEqual({
      gate: "eval_contract_only",
      requiredTraits: [
        "repeatability",
        "attributability",
        "scopeability",
        "non_core",
        "expiry_ready"
      ],
      hardRules: [
        "ttl_required",
        "revalidation_required",
        "contract_version_required",
        "inspectable_and_reversible"
      ],
      budgets: {
        maxAdaptiveEntriesPerProject: 12,
        maxAdaptiveEntriesPerRunType: 4
      }
    });
    expect(CONTRACT_VERSIONING_AND_STATE_MIGRATION_RULE).toEqual({
      version: RESEARCH_QUALITY_CONTRACT_VERSION,
      retainedStateMustCarryVersion: true,
      incompatibleVersionDefault: "invalidate_or_revalidate",
      silentMigrationAllowed: false
    });
  });

  it("pins baseline harness to fresh-no-memory comparison with non-compensatory fails", () => {
    expect(BASELINE_HARNESS_RULE).toEqual({
      baselines: ["fresh_no_memory", "project_memory_only", "adaptive_policy_on"],
      comparisonRule:
        "adaptive_policy_on must beat fresh_no_memory on allowed quality metrics",
      failRule:
        "any non-compensatory blocker breach fails regardless of packaging/helpfulness gains",
      rollbackTrigger: "adaptive policy loses to fresh_no_memory on guarded metrics"
    });
  });

  it("classifies retained state into explicit layers with discard default", () => {
    expect(Object.keys(STATE_CLASSIFICATION_CONTRACT)).toEqual([
      "ephemeral",
      "evidence_record",
      "decision_state",
      "adaptive_memory",
      "promoted_knowledge"
    ]);
    expect(STATE_CLASSIFICATION_RULES.ifUnclassified).toBe("discard");
    expect(STATE_CLASSIFICATION_RULES.runStatusMap).toEqual({
      draft: "ephemeral",
      awaiting_clarification: "ephemeral",
      collecting: "ephemeral",
      synthesizing: "ephemeral",
      failed: "ephemeral",
      decided: "decision_state"
    });
    expect(classifyRunState("draft")).toBe("ephemeral");
    expect(classifyRunState("failed")).toBe("ephemeral");
    expect(classifyRunState("decided")).toBe("decision_state");
  });
});
