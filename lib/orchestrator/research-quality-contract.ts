export type ResearchRunType =
  | "exploratory_scan"
  | "comparison_tradeoff_analysis"
  | "longitudinal_watch"
  | "contradiction_resolution"
  | "pre_decision_verification";

export type ProxyBanId =
  | "user_satisfaction_alone"
  | "click_open_rate"
  | "inbox_clear_rate"
  | "reading_completion"
  | "time_saved_alone"
  | "operator_acceptance_without_audit"
  | "repeated_selection_without_downstream_verification";

export type ShipBlockerId =
  | "contradiction_exposure_regression"
  | "source_diversity_floor_collapse"
  | "freshness_minimum_violation"
  | "provenance_completeness_regression"
  | "cross_context_contamination";

export type ContextClass =
  | "exploratory"
  | "comparison"
  | "watch"
  | "contradiction"
  | "decision";

export type StateClassification =
  | "ephemeral"
  | "evidence_record"
  | "decision_state"
  | "adaptive_memory"
  | "promoted_knowledge";

export const RESEARCH_QUALITY_CONTRACT_VERSION = "2026-04-22.v1";

export const RUN_TYPE_QUALITY_MATRIX: Record<
  ResearchRunType,
  {
    purpose: string;
    successCriteria: string[];
    failureConditions: string[];
    proxyBanIds: ProxyBanId[];
    baselineWinConditions: string[];
  }
> = {
  exploratory_scan: {
    purpose: "초기 지형 파악과 넓은 evidence surface 확보",
    successCriteria: [
      "주요 source tier를 편중 없이 훑는다",
      "반복적으로 재사용 가능한 핵심 쟁점을 드러낸다"
    ],
    failureConditions: [
      "특정 source tier에 지나치게 집중된다",
      "fresh/no-memory baseline보다 evidence breadth가 줄어든다"
    ],
    proxyBanIds: [
      "click_open_rate",
      "reading_completion",
      "time_saved_alone"
    ],
    baselineWinConditions: [
      "baseline 대비 source diversity floor 유지",
      "baseline 대비 placeholder/auth leak 증가 없음"
    ]
  },
  comparison_tradeoff_analysis: {
    purpose: "선택지 간 장단점과 비교축을 구조적으로 정리",
    successCriteria: [
      "선택지 비교에 직접 기여하는 evidence만 남긴다",
      "tradeoff를 흐리는 off-topic noise를 낮춘다"
    ],
    failureConditions: [
      "비교축과 무관한 evidence가 남는다",
      "baseline 대비 contradiction surfacing이 감소한다"
    ],
    proxyBanIds: [
      "user_satisfaction_alone",
      "click_open_rate",
      "time_saved_alone"
    ],
    baselineWinConditions: [
      "baseline 대비 source diversity floor 유지",
      "baseline 대비 contradiction exposure 감소 없음"
    ]
  },
  longitudinal_watch: {
    purpose: "시간축 변화와 contradiction pressure delta를 추적",
    successCriteria: [
      "focus shift와 contradiction delta를 구조적으로 드러낸다",
      "새 근거가 기존 판단을 흔드는지 우선순위화한다"
    ],
    failureConditions: [
      "변화 없는 digest를 변화처럼 과장한다",
      "baseline 대비 delta signal의 provenance completeness가 낮아진다"
    ],
    proxyBanIds: [
      "inbox_clear_rate",
      "operator_acceptance_without_audit"
    ],
    baselineWinConditions: [
      "baseline 대비 contradiction pressure 누락 없음",
      "baseline 대비 freshness minimum 유지"
    ]
  },
  contradiction_resolution: {
    purpose: "상충 근거의 핵심 쟁점을 재검증해 해소 여부를 판단",
    successCriteria: [
      "서로 충돌하는 claim의 근거와 provenance를 명확히 남긴다",
      "follow-up action이 실제 충돌 해소를 향한다"
    ],
    failureConditions: [
      "형식적 contradiction만 늘리고 핵심 반증은 약하다",
      "baseline 대비 contradiction exposure가 줄어든다"
    ],
    proxyBanIds: [
      "user_satisfaction_alone",
      "operator_acceptance_without_audit"
    ],
    baselineWinConditions: [
      "baseline 대비 contradiction miss 증가 없음",
      "baseline 대비 provenance/citation completeness 유지"
    ]
  },
  pre_decision_verification: {
    purpose: "의사결정 직전 evidence sufficiency와 freshness를 최종 점검",
    successCriteria: [
      "최신 근거와 반증 가능성을 함께 드러낸다",
      "결정에 필요한 evidence sufficiency bar를 충족한다"
    ],
    failureConditions: [
      "freshness minimum을 만족하지 못한다",
      "evidence sufficiency를 약한 proxy로 대체한다"
    ],
    proxyBanIds: [
      "user_satisfaction_alone",
      "time_saved_alone",
      "repeated_selection_without_downstream_verification"
    ],
    baselineWinConditions: [
      "baseline 대비 freshness regression 없음",
      "baseline 대비 contradiction surfacing 감소 없음",
      "baseline 대비 provenance completeness 저하 없음"
    ]
  }
};

export const NON_SIGNAL_PROXY_BAN_LIST: Record<
  ProxyBanId,
  {
    description: string;
    reason: string;
  }
> = {
  user_satisfaction_alone: {
    description: "사용자 만족도만으로 quality를 판정하지 않는다",
    reason: "선호는 진실성과 divergence할 수 있다"
  },
  click_open_rate: {
    description: "클릭/열람 비율은 quality signal이 아니다",
    reason: "높은 클릭은 curiosity를 의미할 뿐 epistemic gain을 보장하지 않는다"
  },
  inbox_clear_rate: {
    description: "inbox 소진 속도를 quality로 보지 않는다",
    reason: "빨리 처리된다고 더 좋은 research가 되지 않는다"
  },
  reading_completion: {
    description: "읽기 완료율은 quality signal이 아니다",
    reason: "끝까지 읽혔다는 사실만으로 evidence quality를 증명하지 못한다"
  },
  time_saved_alone: {
    description: "절약된 시간만으로 quality 개선을 주장하지 않는다",
    reason: "빠름은 정밀도, 다양성, 반증 노출을 대체할 수 없다"
  },
  operator_acceptance_without_audit: {
    description: "감사 없는 수용은 quality 근거가 아니다",
    reason: "operator acceptance는 audit 없이 확증 편향을 강화할 수 있다"
  },
  repeated_selection_without_downstream_verification: {
    description: "반복 선택만으로 adaptive policy를 정당화하지 않는다",
    reason: "반복 사용은 outcome quality 개선과 동치가 아니다"
  }
};

export const CONTEXT_BOUNDARY_SPEC = {
  classes: {
    exploratory_scan: "exploratory",
    comparison_tradeoff_analysis: "comparison",
    longitudinal_watch: "watch",
    contradiction_resolution: "contradiction",
    pre_decision_verification: "decision"
  } as Record<ResearchRunType, ContextClass>,
  triggerPolicy: {
    primary: "planner_or_classifier",
    fallbackOnUncertainty: "stricter_fresh_context",
    operatorOverrideAllowed: true,
    crossContextCarryoverDefault: "disabled",
    auditLogRequired: true
  }
} as const;

export const NON_COMPENSATORY_SHIP_BLOCKERS: Record<
  ShipBlockerId,
  {
    description: string;
  }
> = {
  contradiction_exposure_regression: {
    description: "adaptive behavior가 contradiction surfacing을 감소시키면 ship 불가"
  },
  source_diversity_floor_collapse: {
    description: "adaptive behavior가 source diversity floor를 무너뜨리면 ship 불가"
  },
  freshness_minimum_violation: {
    description: "adaptive behavior가 freshness minimum을 위반하면 ship 불가"
  },
  provenance_completeness_regression: {
    description: "adaptive behavior가 provenance/citation completeness를 낮추면 ship 불가"
  },
  cross_context_contamination: {
    description: "adaptive state가 다른 context class로 새면 ship 불가"
  }
};

export const RETENTION_ELIGIBILITY_SCHEMA = {
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
} as const;

export const BASELINE_HARNESS_RULE = {
  baselines: ["fresh_no_memory", "project_memory_only", "adaptive_policy_on"],
  comparisonRule: "adaptive_policy_on must beat fresh_no_memory on allowed quality metrics",
  failRule:
    "any non-compensatory blocker breach fails regardless of packaging/helpfulness gains",
  rollbackTrigger: "adaptive policy loses to fresh_no_memory on guarded metrics"
} as const;

export const CONTRACT_VERSIONING_AND_STATE_MIGRATION_RULE = {
  version: RESEARCH_QUALITY_CONTRACT_VERSION,
  retainedStateMustCarryVersion: true,
  incompatibleVersionDefault: "invalidate_or_revalidate",
  silentMigrationAllowed: false
} as const;

export const STATE_CLASSIFICATION_CONTRACT: Record<
  StateClassification,
  {
    purpose: string;
    examples: string[];
    retentionRule: string;
  }
> = {
  ephemeral: {
    purpose: "중간 작업 상태와 재시도 대기 상태",
    examples: ["draft run", "awaiting clarification run", "failed retry state"],
    retentionRule: "short_ttl_then_prune"
  },
  evidence_record: {
    purpose: "재현과 감사에 필요한 원본 근거",
    examples: ["raw payload", "normalized artifact", "citation provenance"],
    retentionRule: "compact_and_keep_by_reference"
  },
  decision_state: {
    purpose: "한 run의 핵심 판단 상태",
    examples: ["claims", "contradictions", "evidence summary", "final decision"],
    retentionRule: "keep_compact_operator_ready_state"
  },
  adaptive_memory: {
    purpose: "반복 패턴 기반의 제한적 적응 상태",
    examples: ["topic ledger", "decision ledger", "contradiction ledger"],
    retentionRule: "retain_only_if_eval_gated"
  },
  promoted_knowledge: {
    purpose: "장기 재사용 가치가 검증된 판단",
    examples: ["KB note", "decision log", "promoted watch output"],
    retentionRule: "promote_only_after_validation"
  }
} as const;

export const STATE_CLASSIFICATION_RULES = {
  ifUnclassified: "discard",
  runStatusMap: {
    draft: "ephemeral",
    awaiting_clarification: "ephemeral",
    collecting: "ephemeral",
    synthesizing: "ephemeral",
    failed: "ephemeral",
    decided: "decision_state"
  } as const,
  artifactRule: "rawRef-backed artifacts are evidence_record; inline operator summary stays in decision_state",
  memoryRule: "project memory is adaptive_memory and can never replace evidence_record or decision_state",
  promotionRule: "only validated reusable outcomes may enter promoted_knowledge"
} as const;

export function classifyRunState(status: ResearchRunType | "draft" | "awaiting_clarification" | "collecting" | "synthesizing" | "decided" | "failed"): StateClassification {
  if (
    status === "draft" ||
    status === "awaiting_clarification" ||
    status === "collecting" ||
    status === "synthesizing" ||
    status === "failed"
  ) {
    return "ephemeral";
  }

  if (status === "decided") {
    return "decision_state";
  }

  return "decision_state";
}

export const RUN_RETENTION_POLICY = {
  pruneAfterHours: {
    draft: 24,
    awaiting_clarification: 24,
    failed: 72
  },
  compactAfterStatus: ["decided", "failed"] as const,
  maxInlineArtifactChars: 1200,
  compactMarker: "[compacted; see rawRef]"
} as const;
