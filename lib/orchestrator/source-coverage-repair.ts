export type SourceCoverageRepairTrigger = {
  hasOfficialOrPrimaryEvidence?: boolean;
  sourceCoverageWarnings?: string[];
};

export type SourceCoverageRepairPlan = {
  shouldRun: boolean;
  reason: "no_official_or_primary_evidence" | null;
  urls: Array<{
    url: string;
    query: string;
    repairPass: "source_coverage_v0";
    repairReason: "no_official_or_primary_evidence";
    repairAttemptIndex: number;
  }>;
};

const REPAIR_PASS = "source_coverage_v0" as const;
const REPAIR_REASON = "no_official_or_primary_evidence" as const;
const MAX_REPAIR_URLS = 3;

function buildJinaSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set("q", query);
  return `https://s.jina.ai/?${params.toString()}`;
}

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const value of values) {
    const query = value.replace(/\s+/g, " ").trim();
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }

  return queries;
}

export function planSourceCoverageRepair(input: {
  title: string;
  goal?: string;
  summary: SourceCoverageRepairTrigger;
}): SourceCoverageRepairPlan {
  const hasOfficialOrPrimaryEvidence = input.summary.hasOfficialOrPrimaryEvidence === true;
  const hasCoverageWarning =
    input.summary.sourceCoverageWarnings?.includes(REPAIR_REASON) === true;
  const shouldRun =
    hasOfficialOrPrimaryEvidence === false &&
    (input.summary.hasOfficialOrPrimaryEvidence === false || hasCoverageWarning);

  if (!shouldRun) {
    return {
      shouldRun: false,
      reason: null,
      urls: []
    };
  }

  const title = input.title.trim();
  const goalOrTitle = input.goal?.trim() || title;
  const queries = uniqueQueries([
    `${title} official documentation`,
    `${title} research paper benchmark report`,
    `${goalOrTitle} site:openai.com OR site:anthropic.com OR site:arxiv.org OR site:acm.org`
  ]).slice(0, MAX_REPAIR_URLS);

  return {
    shouldRun: true,
    reason: REPAIR_REASON,
    urls: queries.map((query, index) => ({
      url: buildJinaSearchUrl(query),
      query,
      repairPass: REPAIR_PASS,
      repairReason: REPAIR_REASON,
      repairAttemptIndex: index
    }))
  };
}
