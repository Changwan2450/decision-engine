import { prdSeedSchema, type Decision, type PrdSeed } from "@/lib/domain/decision";
import type { EvidenceSynthesis } from "@/lib/orchestrator/insights";

export function buildPrdSeed(
  decision: Decision,
  evidence: EvidenceSynthesis,
  context: {
    runTitle: string;
    target?: string;
    comparisonAxis?: string;
  }
): PrdSeed {
  const targetUser = context.target ?? "미정 사용자";
  const problem = `${context.runTitle}에 대해 ${targetUser} 기준으로 실행 여부를 판단해야 한다.`;

  let solutionHypothesis: string;
  let featureCandidates: string[];

  if (decision.value === "go") {
    solutionHypothesis = `${targetUser}를 위한 초기 해법을 바로 실험해도 된다.`;
    featureCandidates = [
      "핵심 가치 제안 검증 화면",
      "가장 강한 근거를 반영한 MVP 기능",
      "비교축 기반 차별화 포인트 정리"
    ];
  } else if (decision.value === "no_go") {
    solutionHypothesis = `현재 방향은 중단하고 다른 가설로 전환하는 편이 낫다.`;
    featureCandidates = [
      "실패 원인 기록",
      "대체 타깃 검증",
      "다른 문제 정의 재탐색"
    ];
  } else {
    solutionHypothesis = `재검증을 거친 뒤에만 해법을 확정해야 한다.`;
    featureCandidates = [
      "부족한 근거 검증 실험",
      "충돌 주장 재검증",
      "최신성 보강 조사"
    ];
  }

  const risk = [
    ...decision.blockingUnknowns,
    ...(context.comparisonAxis ? [`비교 기준(${context.comparisonAxis}) 해석이 흔들릴 수 있다.`] : [])
  ];

  if (decision.value === "unclear" && evidence.summary.reasons.includes("recency_gap")) {
    risk.unshift("최신성 민감 주제인데 최근 근거가 약하다.");
  }

  return prdSeedSchema.parse({
    targetUser,
    problem,
    solutionHypothesis,
    featureCandidates,
    risk: risk.length > 0 ? risk : ["핵심 리스크를 다시 정의해야 한다."]
  });
}
