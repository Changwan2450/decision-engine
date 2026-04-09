import { decisionSchema, type Decision } from "@/lib/domain/decision";
import type { EvidenceSynthesis } from "@/lib/orchestrator/insights";

function hasNegativeTilt(evidence: EvidenceSynthesis): boolean {
  const supportCount = evidence.claims.filter((claim) => claim.stance === "support").length;
  const opposeCount = evidence.claims.filter((claim) => claim.stance === "oppose").length;
  return opposeCount > supportCount;
}

function deriveBlockingUnknowns(evidence: EvidenceSynthesis): string[] {
  const blockingUnknowns: string[] = [];

  if (evidence.summary.reasons.includes("contradiction_detected")) {
    blockingUnknowns.push("충돌하는 핵심 주장을 해소해야 한다.");
  }

  if (evidence.summary.reasons.includes("recency_gap")) {
    blockingUnknowns.push("최신성 민감 주제라 최근 근거를 다시 확보해야 한다.");
  }

  if (evidence.summary.reasons.includes("insufficient_high_priority_support")) {
    blockingUnknowns.push("고우선 출처 근거가 부족하다.");
  }

  return blockingUnknowns;
}

export function buildDecision(
  evidence: EvidenceSynthesis,
  context: {
    runTitle: string;
    goal: string;
  }
): Decision {
  const blockingUnknowns = deriveBlockingUnknowns(evidence);

  let value: Decision["value"];
  if (evidence.summary.shouldRemainUnclear) {
    value = "unclear";
  } else if (hasNegativeTilt(evidence)) {
    value = "no_go";
  } else {
    value = "go";
  }

  let confidence: Decision["confidence"];
  if (value === "unclear") {
    confidence = "low";
  } else if (
    evidence.summary.highestPrioritySeen === "official" ||
    evidence.summary.highestPrioritySeen === "primary_data"
  ) {
    confidence = "high";
  } else {
    confidence = "medium";
  }

  const why =
    value === "go"
      ? `${context.goal}에 필요한 근거가 충분하고 치명적 충돌이 없다.`
      : value === "no_go"
        ? `${context.goal}에 대해 부정 근거가 우세하다.`
        : `${context.goal}을 확정하기에는 증거 공백이 남아 있다.`;

  const nextActions =
    value === "go"
      ? ["핵심 가설을 PRD Seed로 전환한다.", "가장 강한 근거를 기준으로 초기 범위를 좁힌다."]
      : value === "no_go"
        ? ["추진하지 않는 이유를 기록한다.", "대체 접근이나 다른 타깃을 검토한다."]
        : ["부족한 근거를 재수집한다.", "충돌 또는 최신성 공백을 먼저 해소한다."];

  return decisionSchema.parse({
    value,
    why,
    confidence,
    blockingUnknowns,
    nextActions
  });
}
