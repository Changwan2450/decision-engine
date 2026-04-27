import type { Claim, Contradiction, EvidenceSummary } from "@/lib/domain/claims";

export type CounterevidenceRepairPlan = {
  shouldAttempt: boolean;
  reasons: string[];
  queries: string[];
  maxFollowUrls: number;
  maxCandidates: number;
};

const MAX_QUERIES = 2;
const MAX_CANDIDATES = 5;
const MAX_FOLLOW_URLS = 2;
const MAX_QUERY_LENGTH = 180;

function sanitizeQuery(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s"'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function buildReasons(summary?: EvidenceSummary | null): string[] {
  const reasons: string[] = [];

  if (summary?.falseConvergenceRisk === true) reasons.push("false_convergence_risk");
  if (summary?.supportOnlyEvidence === true) reasons.push("support_only_evidence");
  if (summary?.weakEvidence === true) reasons.push("weak_evidence");
  if (summary?.counterevidenceChecked === false) reasons.push("counterevidence_not_checked");

  return reasons;
}

function buildQueries(input: { title: string; goal?: string }): string[] {
  const topic = sanitizeQuery(input.goal?.trim() || input.title);
  if (!topic) return [];

  return unique([
    sanitizeQuery(`${topic} limitations risks failure cases`),
    sanitizeQuery(`${topic} evaluation limitations benchmark disagreement known issues`)
  ]).slice(0, MAX_QUERIES);
}

export function planCounterevidenceRepair(input: {
  title: string;
  goal?: string;
  evidenceSummary?: EvidenceSummary | null;
  claims: Claim[];
  contradictions: Contradiction[];
}): CounterevidenceRepairPlan {
  const hasSupportClaim = input.claims.some((claim) => claim.stance === "support");
  const hasOpposeClaim = input.claims.some((claim) => claim.stance === "oppose");
  const hasContradiction = input.contradictions.length > 0;
  const alreadyChecked = input.evidenceSummary?.counterevidenceChecked === true;
  const shouldAttempt = hasSupportClaim && !hasOpposeClaim && !hasContradiction && !alreadyChecked;

  return {
    shouldAttempt,
    reasons: shouldAttempt ? buildReasons(input.evidenceSummary) : [],
    queries: shouldAttempt ? buildQueries(input) : [],
    maxFollowUrls: MAX_FOLLOW_URLS,
    maxCandidates: MAX_CANDIDATES
  };
}
