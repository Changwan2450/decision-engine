import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildArtifact, buildFailureArtifact } from "@/lib/adapters/contract";
import {
  buildDomainTargetedSearchUrl,
  discoverDomainTargetedCandidates,
  type DomainTargetedDiscoveryResult
} from "@/lib/adapters/domain-targeted-search";
import { createAdapterRegistry, type AdapterRegistry } from "@/lib/adapters/registry";
import { routeUrl, type AdapterChain, type AdapterName } from "@/lib/adapters/router";
import { inferSourceTier } from "@/lib/adapters/source-tier";
import type { ResearchPlan, SourceArtifact, SourceTarget } from "@/lib/adapters/types";
import { getResearchBudgetConfig, type ResearchBudgetConfig } from "@/lib/config";
import { assertRunTransition } from "@/lib/domain/runs";
import {
  exportDecisionHistoryToObsidian,
  exportInsightsToObsidian,
  exportRunToObsidian,
  syncRunToKnowledgeBase
} from "@/lib/export/obsidian";
import { buildClarificationQuestions, shouldClarifyRun } from "@/lib/orchestrator/clarify";
import { classifyContradictionKind } from "@/lib/orchestrator/contradiction-kind";
import { planCounterevidenceRepair } from "@/lib/orchestrator/counterevidence-repair";
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import {
  derivePromotionCandidates,
  deriveProjectInsightPatch,
  deriveProjectMemoryPatch,
  synthesizeEvidenceFromArtifacts
} from "@/lib/orchestrator/insights";
import { buildKnowledgeArtifacts, buildKnowledgeContext } from "@/lib/orchestrator/kb-context";
import { planRun } from "@/lib/orchestrator/plan-run";
import { buildPrdSeed } from "@/lib/orchestrator/prd-seed";
import {
  RESEARCH_QUALITY_CONTRACT_VERSION,
  RETENTION_ELIGIBILITY_SCHEMA
} from "@/lib/orchestrator/research-quality-contract";
import {
  classifyRepairHost,
  extractAllowedRepairUrlsFromCandidates,
  extractAllowedUrlsFromCommunitySearchJson,
  extractAllowedRepairUrlsFromDiscovery,
  planSourceCoverageRepair
} from "@/lib/orchestrator/source-coverage-repair";
import {
  applyRunRetentionPolicy,
  findRunRecordById,
  listRunRecords,
  readProjectRecord,
  readRunRecord,
  updateProjectRecord,
  updateRunRecord
} from "@/lib/storage/workspace";
import type { ProjectRecord } from "@/lib/storage/schema";
import type { Claim, Citation, Contradiction, SourceArtifactRecord, SourceTier } from "@/lib/domain/claims";

type EmptyAdapterResultGap = {
  adapter: string;
  url?: string;
  rule?: string;
  sourceType?: string;
  isFallback: boolean;
  reason: "empty_adapter_result";
  timestamp?: string;
};

type RunResearchDeps = {
  registry?: AdapterRegistry;
  router?: (url: string) => AdapterChain;
  budgets?: Partial<ResearchBudgetConfig>;
  nowMs?: () => number;
  nowIso?: () => string;
  domainTargetedDiscover?: (query: string) => Promise<DomainTargetedDiscoveryResult>;
  onEmptyAdapterResult?: (gap: EmptyAdapterResultGap) => void;
};

export async function runResearch(
  plan: ResearchPlan,
  deps?: RunResearchDeps
): Promise<SourceArtifact[]> {
  const registry = deps?.registry ?? createAdapterRegistry();
  const router = deps?.router ?? routeUrl;
  const budget = {
    ...getResearchBudgetConfig(),
    ...deps?.budgets
  };
  const nowMs = deps?.nowMs ?? (() => Date.now());
  const totalStartedAt = nowMs();
  let fallbackSpentMs = 0;
  const artifacts: SourceArtifact[] = [];

  for (const url of plan.normalizedInput.urls) {
    const chain = router(url);
    const attempts: AdapterName[] = [chain.primary, ...chain.fallbacks];
    const urlStartedAt = nowMs();

    for (const [index, adapterName] of attempts.entries()) {
      const isFallback = index > 0;
      const allowedMs = computeAllowedMs({
        budget,
        nowMs,
        totalStartedAt,
        urlStartedAt,
        fallbackSpentMs,
        isFallback
      });

      if (allowedMs <= 0) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: isFallback ? "error" : "timeout",
            errorMessage: isFallback
              ? "fallback skipped: budget exhausted"
              : "primary skipped: budget exhausted"
          })
        );
        break;
      }

      const adapter = registry[adapterName];
      if (!adapter) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: `adapter not registered: ${adapterName}`
          })
        );
        continue;
      }

      const attemptPlan = singleUrlPlan(plan, url);
      if (!adapter.supports(attemptPlan)) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: `adapter does not support routed plan: ${adapterName}`
          })
        );
        continue;
      }

      const startedAt = nowMs();
      let attemptArtifacts: SourceArtifact[];
      try {
        attemptArtifacts = await adapter.execute(attemptPlan);
      } catch (error) {
        attemptArtifacts = [
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error)
          })
        ];
      }

      const elapsedMs = Math.max(0, nowMs() - startedAt);
      if (isFallback) fallbackSpentMs += elapsedMs;

      if (elapsedMs > allowedMs) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "timeout",
            errorMessage: `budget exceeded after ${elapsedMs}ms (limit ${allowedMs}ms)`
          })
        );
        continue;
      }

      if (attemptArtifacts.length === 0) {
        deps?.onEmptyAdapterResult?.({
          adapter: adapterName,
          url: truncateTelemetryValue(url),
          rule: chain.rule,
          sourceType: inferSourceType(chain),
          isFallback,
          reason: "empty_adapter_result",
          timestamp: (deps.nowIso ?? (() => new Date().toISOString()))()
        });
        console.warn(
          "[run-research] empty adapter result",
          JSON.stringify({
            adapter: adapterName,
            url,
            rule: chain.rule,
            isFallback
          })
        );
        continue;
      }

      artifacts.push(...attemptArtifacts);

      if (attemptArtifacts.some(isUsableArtifact)) {
        break;
      }
    }
  }

  return artifacts;
}

export async function fetchWeb(
  url: string,
  deps?: RunResearchDeps
): Promise<SourceArtifact> {
  try {
    const artifacts = await runResearch(
      {
        projectId: "mcp",
        runId: "fetch-web",
        title: url,
        mode: "standard",
        normalizedInput: {
          title: url,
          naturalLanguage: "",
          pastedContent: "",
          urls: [url],
          goal: "",
          target: "",
          comparisonAxis: ""
        },
        sourceTargets: ["web", "community", "video", "github", "pdf"],
        kbContext: null
      },
      deps
    );
    return selectRepresentativeArtifact(artifacts, url);
  } catch (error) {
    return buildFailureArtifact({
      id: "mcp-fetch-web-0",
      adapter: "mcp/fetch_web",
      fetcher: "mcp/fetch_web",
      url,
      sourceType: "web",
      outcome: { status: "error" },
      errorMessage: error instanceof Error ? error.message : String(error),
      sourceLabel: "web/error"
    });
  }
}

export async function gatherForRun(
  runId: string,
  deps?: RunResearchDeps
): Promise<SourceArtifact[]> {
  try {
    const found = await findRunRecordById(runId);
    if (!found) {
      return [
        buildFailureArtifact({
          id: "gather-for-run-0",
          adapter: "mcp/gather_for_run",
          fetcher: "mcp/gather_for_run",
          url: "",
          sourceType: "web",
          outcome: { status: "error" },
          errorMessage: `run not found: ${runId}`,
          sourceLabel: "web/error"
        })
      ];
    }

    const planned = planRun(found.record, found.record.kbContext);
    const plan: ResearchPlan = found.record.normalizedInput
      ? {
          ...planned,
          normalizedInput: found.record.normalizedInput
        }
      : planned;

    return runResearch(plan, deps);
  } catch (error) {
    return [
      buildFailureArtifact({
        id: "gather-for-run-0",
        adapter: "mcp/gather_for_run",
        fetcher: "mcp/gather_for_run",
        url: "",
        sourceType: "web",
        outcome: { status: "error" },
        errorMessage: error instanceof Error ? error.message : String(error),
        sourceLabel: "web/error"
      })
    ];
  }
}

function truncateTelemetryValue(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function buildSourceCoverageRepairPlan(
  plan: ResearchPlan,
  urls: string[]
): ResearchPlan {
  return {
    ...plan,
    sourceTargets: ["web"],
    normalizedInput: {
      ...plan.normalizedInput,
      urls
    }
  };
}

function markDiscoveryRepairArtifact(
  artifact: SourceArtifact,
  repairPlan: ReturnType<typeof planSourceCoverageRepair>,
  discoverySummary?: {
    source: string;
    candidateCount: number;
    allowedUrlCount: number;
    rawResultCount?: number;
    errors?: string[];
  },
  fallbackSummary?: {
    attempted: boolean;
    source: "community_search_json";
    candidateCount: number;
    allowedUrlCount: number;
    rawSourcesChecked: number;
  }
): SourceArtifact {
  const discovery = repairPlan.discovery;
  if (!discovery) return artifact;
  if ((artifact.canonicalUrl ?? artifact.url) !== discovery.url) return artifact;

  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      repair_pass: discovery.repairPass,
      repair_stage: discovery.repairStage,
      repair_reason: discovery.repairReason,
      ...(discoverySummary
        ? {
            repair_discovery_source: discoverySummary.source,
            repair_candidate_count: String(discoverySummary.candidateCount),
            repair_allowed_url_count: String(discoverySummary.allowedUrlCount),
            ...(discoverySummary.rawResultCount !== undefined
              ? { repair_raw_result_count: String(discoverySummary.rawResultCount) }
              : {}),
            repair_discovery_error_count: String(discoverySummary.errors?.length ?? 0),
            ...(discoverySummary.errors && discoverySummary.errors.length > 0
              ? {
                  repair_discovery_errors: discoverySummary.errors
                    .map((error) => truncateTelemetryValue(error))
                    .join(",")
                }
              : {})
          }
        : {}),
      repair_query: truncateTelemetryValue(discovery.query),
      ...(fallbackSummary?.attempted
        ? {
            repair_fallback_attempted: "true",
            repair_fallback_source: fallbackSummary.source,
            repair_fallback_candidate_count: String(fallbackSummary.candidateCount),
            repair_fallback_allowed_url_count: String(fallbackSummary.allowedUrlCount),
            repair_fallback_raw_sources_checked: String(fallbackSummary.rawSourcesChecked)
          }
        : {})
    }
  };
}

function markFollowedRepairArtifacts(
  artifacts: SourceArtifact[],
  discoveryArtifactId: string,
  followedUrls: string[],
  repairReason: "no_official_or_primary_evidence",
  discoverySource: string
): SourceArtifact[] {
  const followRankByUrl = new Map(followedUrls.map((url, index) => [url, index]));

  return artifacts.map((artifact) => {
    const url = artifact.canonicalUrl ?? artifact.url;
    const followRank = followRankByUrl.get(url);
    if (followRank === undefined) return artifact;

    const hostClass = classifyRepairHost(new URL(url).hostname);
    return {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        repair_pass: "source_coverage_v1",
        repair_stage: "evidence",
        repair_reason: repairReason,
        repair_discovery_source: discoverySource,
        repair_discovery_artifact_id: discoveryArtifactId,
        repair_follow_rank: String(followRank),
        repair_source_host_class: hostClass ?? ""
      }
    };
  });
}

function markFallbackDiscoveryArtifacts(
  artifacts: SourceArtifact[],
  candidateCountsByArtifactId: Map<string, number>
): SourceArtifact[] {
  return artifacts.map((artifact) => {
    const candidateCount = candidateCountsByArtifactId.get(artifact.id);
    if (candidateCount === undefined) return artifact;

    return {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        repair_pass: "source_coverage_v1",
        repair_stage: "discovery_fallback",
        repair_discovery_source: "community_search_json",
        repair_candidate_count: String(candidateCount)
      }
    };
  });
}

function inferCounterevidenceKind(query: string):
  | "limitation"
  | "risk"
  | "failure_case"
  | "methodological_caveat"
  | "benchmark_disagreement"
  | "unknown" {
  const normalized = query.toLowerCase();
  if (/benchmark|disagreement/.test(normalized)) return "benchmark_disagreement";
  if (/methodolog|evaluation limitation/.test(normalized)) return "methodological_caveat";
  if (/limitation|known issue/.test(normalized)) return "limitation";
  if (/risk/.test(normalized)) return "risk";
  if (/failure/.test(normalized)) return "failure_case";
  return "unknown";
}

function normalizeCounterevidenceCandidateUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "html.duckduckgo.com" ||
      host === "duckduckgo.com" ||
      host === "s.jina.ai" ||
      host === "r.jina.ai" ||
      host === "reddit.com" ||
      host.endsWith(".reddit.com") ||
      host === "news.ycombinator.com" ||
      host === "hn.algolia.com"
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractCounterevidenceFollowUrls(input: {
  candidates: DomainTargetedDiscoveryResult["candidates"];
  maxCandidates: number;
  maxFollowUrls: number;
  seenUrls: Set<string>;
}): { urls: string[]; allowedUrlCount: number; candidateCount: number } {
  const limitedCandidates = input.candidates.slice(0, input.maxCandidates);
  const allowedUrls: string[] = [];

  for (const candidate of limitedCandidates) {
    const normalized = normalizeCounterevidenceCandidateUrl(candidate.url);
    if (!normalized || input.seenUrls.has(normalized)) continue;
    allowedUrls.push(normalized);
  }

  return {
    urls: allowedUrls.slice(0, input.maxFollowUrls),
    allowedUrlCount: allowedUrls.length,
    candidateCount: limitedCandidates.length
  };
}

function buildCounterevidenceDiscoveryArtifact(input: {
  index: number;
  query: string;
  result: DomainTargetedDiscoveryResult;
  reason: string;
  candidateCount: number;
  allowedUrlCount: number;
  retrievedAt: string;
}): SourceArtifact {
  const lines = input.result.candidates
    .slice(0, input.candidateCount)
    .map((candidate) =>
      [candidate.title?.trim(), candidate.url, candidate.snippet?.trim()]
        .filter(Boolean)
        .join(" — ")
    );

  return buildArtifact({
    id: `counterevidence-discovery-${input.index}`,
    adapter: "domain-targeted-search",
    fetcher: "domain-targeted-search",
    sourceType: "web",
    url: buildDomainTargetedSearchUrl(input.query),
    title: "Counterevidence repair discovery",
    snippet: lines.slice(0, 3).join("\n"),
    content: lines.join("\n"),
    sourcePriority: "analysis",
    retrievedAt: input.retrievedAt,
    outcome: { status: input.result.errors.length > 0 ? "partial" : "success" },
    sourceLabel: "web/discovery",
    extra: {
      repair_pass: "counterevidence_v0",
      repair_stage: "discovery",
      repair_reason: input.reason,
      repair_query: truncateTelemetryValue(input.query),
      repair_candidate_count: String(input.candidateCount),
      repair_allowed_url_count: String(input.allowedUrlCount),
      repair_discovery_error_count: String(input.result.errors.length),
      ...(input.result.errors.length > 0
        ? {
            repair_discovery_errors: input.result.errors
              .map((error) => truncateTelemetryValue(error))
              .join(",")
          }
        : {}),
      repair_counterevidence_kind: inferCounterevidenceKind(input.query)
    }
  });
}

function markCounterevidenceArtifacts(
  artifacts: SourceArtifact[],
  followEntries: Array<{ url: string; query: string; rank: number; reason: string }>
): SourceArtifact[] {
  const entryByUrl = new Map(followEntries.map((entry) => [entry.url, entry]));

  return artifacts.map((artifact) => {
    const url = artifact.canonicalUrl ?? artifact.url;
    const entry = entryByUrl.get(url);
    if (!entry) return artifact;

    let hostClass = "analysis";
    try {
      hostClass = classifyRepairHost(new URL(url).hostname) ?? "analysis";
    } catch {
      hostClass = "analysis";
    }

    return {
      ...artifact,
      metadata: {
        ...artifact.metadata,
        repair_pass: "counterevidence_v0",
        repair_stage: "evidence",
        repair_reason: entry.reason,
        repair_query: truncateTelemetryValue(entry.query),
        repair_follow_rank: String(entry.rank),
        repair_counterevidence_kind: inferCounterevidenceKind(entry.query),
        repair_source_host_class: hostClass
      }
    };
  });
}

async function readArtifactRawPayload(artifact: SourceArtifact): Promise<string | null> {
  if (!artifact.rawRef) return null;

  try {
    const workspaceRoot = process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace");
    return await readFile(path.join(workspaceRoot, artifact.rawRef), "utf8");
  } catch {
    return null;
  }
}

async function extractFallbackRepairUrlsFromCommunityArtifacts(
  artifacts: SourceArtifact[]
): Promise<{
  urls: string[];
  markedArtifacts: SourceArtifact[];
  rawSourcesChecked: number;
  candidateCount: number;
  allowedUrlCount: number;
}> {
  const candidateCountsByArtifactId = new Map<string, number>();
  const urls: string[] = [];
  const seen = new Set<string>();
  let rawSourcesChecked = 0;
  let candidateCount = 0;

  for (const artifact of artifacts) {
    if (artifact.adapter !== "community-search-json") continue;
    if (!artifact.rawRef) continue;

    const rawJson = await readArtifactRawPayload(artifact);
    if (!rawJson) continue;
    rawSourcesChecked += 1;

    const extracted = extractAllowedUrlsFromCommunitySearchJson({
      rawJson,
      limit: 3
    });
    candidateCount += extracted.length;

    if (extracted.length > 0) {
      candidateCountsByArtifactId.set(artifact.id, extracted.length);
    }

    for (const url of extracted) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 3) {
        return {
          urls,
          markedArtifacts: markFallbackDiscoveryArtifacts(artifacts, candidateCountsByArtifactId),
          rawSourcesChecked,
          candidateCount,
          allowedUrlCount: urls.length
        };
      }
    }
  }

  return {
    urls,
    markedArtifacts: markFallbackDiscoveryArtifacts(artifacts, candidateCountsByArtifactId),
    rawSourcesChecked,
    candidateCount,
    allowedUrlCount: urls.length
  };
}

function buildDomainDiscoveryArtifact(input: {
  query: string;
  searchUrl: string;
  result: DomainTargetedDiscoveryResult;
  retrievedAt: string;
}): SourceArtifact {
  const lines = input.result.candidates.map((candidate) =>
    [candidate.title?.trim(), candidate.url, candidate.snippet?.trim()]
      .filter(Boolean)
      .join(" — ")
  );

  return buildArtifact({
    id: "domain-targeted-search-discovery-0",
    adapter: "domain-targeted-search",
    fetcher: "domain-targeted-search",
    sourceType: "web",
    url: input.searchUrl,
    title: "Domain targeted search results",
    snippet: lines.slice(0, 3).join("\n"),
    content: lines.join("\n"),
    sourcePriority: "analysis",
    retrievedAt: input.retrievedAt,
    outcome: { status: input.result.errors.length > 0 ? "partial" : "success" },
    sourceLabel: "web/discovery",
    extra: {
      repair_query: truncateTelemetryValue(input.query),
      search_error_count: String(input.result.errors.length)
    }
  });
}

function isRecencySensitive(plan: ResearchPlan): boolean {
  const haystack = [
    plan.title,
    plan.normalizedInput.goal,
    plan.normalizedInput.naturalLanguage,
    plan.normalizedInput.pastedContent
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(trend|news|latest|최근|트렌드|뉴스)/.test(haystack);
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function mergeDecisionLedger(
  left: NonNullable<ProjectRecord["memory"]>["decisionLedger"],
  right: NonNullable<ProjectRecord["memory"]>["decisionLedger"],
  now: string
): NonNullable<ProjectRecord["memory"]>["decisionLedger"] {
  const retained = [...left, ...right].filter((entry) => isGovernedEntryRetainable(entry, now));
  const byRunId = new Map<string, ProjectRecord["memory"]["decisionLedger"][number]>();
  for (const entry of retained) {
    byRunId.set(entry.runId, { ...entry });
  }
  const values = Array.from(byRunId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeByKey = new Map<string, ProjectRecord["memory"]["decisionLedger"][number]>();
  const governedValues = values.map((entry) => {
    const key = decisionMemoryKey(entry);
    const newer = activeByKey.get(key);
    if (!newer) {
      const activeEntry = { ...entry, status: "active" as const, supersededByRunId: null };
      activeByKey.set(key, activeEntry);
      return activeEntry;
    }
    return {
      ...entry,
      status: entry.decision === newer.decision ? "superseded" as const : "conflict" as const,
      supersededByRunId: newer.runId
    };
  });
  const byRunType = new Map<string, number>();
  const limited: typeof governedValues = [];
  for (const entry of governedValues) {
    if (entry.status !== "active") {
      limited.push(entry);
      continue;
    }
    const runType = entry.runType ?? "unknown";
    const count = byRunType.get(runType) ?? 0;
    if (count >= RETENTION_ELIGIBILITY_SCHEMA.budgets.maxAdaptiveEntriesPerRunType) {
      continue;
    }
    limited.push(entry);
    byRunType.set(runType, count + 1);
  }
  return limited.slice(0, RETENTION_ELIGIBILITY_SCHEMA.budgets.maxAdaptiveEntriesPerProject);
}

function mergeTopicLedger(
  left: NonNullable<ProjectRecord["memory"]>["topicLedger"],
  right: NonNullable<ProjectRecord["memory"]>["topicLedger"],
  now: string
): NonNullable<ProjectRecord["memory"]>["topicLedger"] {
  const retained = [...left, ...right].filter((entry) => isGovernedEntryActive(entry, now));
  const merged = new Map<string, ProjectRecord["memory"]["topicLedger"][number]>();
  for (const entry of retained) {
    const current = merged.get(entry.topicKey);
    if (!current) {
      merged.set(entry.topicKey, { ...entry });
      continue;
    }
    merged.set(entry.topicKey, {
      topicKey: entry.topicKey,
      count: current.count + entry.count,
      highTrustCount: current.highTrustCount + entry.highTrustCount,
      lastSeenAt: entry.lastSeenAt > current.lastSeenAt ? entry.lastSeenAt : current.lastSeenAt,
      contractVersion: RESEARCH_QUALITY_CONTRACT_VERSION,
      retainedAt: entry.retainedAt ?? current.retainedAt,
      expiresAt: laterIso(entry.expiresAt, current.expiresAt),
      status: "active",
      provenance: {
        sourceRunIds: mergeUnique(current.provenance.sourceRunIds, entry.provenance.sourceRunIds),
        claimIds: mergeUnique(current.provenance.claimIds, entry.provenance.claimIds),
        citationIds: mergeUnique(current.provenance.citationIds, entry.provenance.citationIds)
      }
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, RETENTION_ELIGIBILITY_SCHEMA.budgets.maxAdaptiveEntriesPerProject);
}

function mergeContradictionLedger(
  left: NonNullable<ProjectRecord["memory"]>["contradictionLedger"],
  right: NonNullable<ProjectRecord["memory"]>["contradictionLedger"],
  now: string
): NonNullable<ProjectRecord["memory"]>["contradictionLedger"] {
  const retained = [...left, ...right].filter((entry) => isGovernedEntryActive(entry, now));
  const merged = new Map<string, ProjectRecord["memory"]["contradictionLedger"][number]>();
  for (const entry of retained) {
    const current = merged.get(entry.topicKey);
    if (!current) {
      merged.set(entry.topicKey, { ...entry });
      continue;
    }
    merged.set(entry.topicKey, {
      topicKey: entry.topicKey,
      count: current.count + entry.count,
      lastSeenAt: entry.lastSeenAt > current.lastSeenAt ? entry.lastSeenAt : current.lastSeenAt,
      contractVersion: RESEARCH_QUALITY_CONTRACT_VERSION,
      retainedAt: entry.retainedAt ?? current.retainedAt,
      expiresAt: laterIso(entry.expiresAt, current.expiresAt),
      status: "active",
      provenance: {
        sourceRunIds: mergeUnique(current.provenance.sourceRunIds, entry.provenance.sourceRunIds),
        claimIds: mergeUnique(current.provenance.claimIds, entry.provenance.claimIds),
        contradictionIds: mergeUnique(
          current.provenance.contradictionIds,
          entry.provenance.contradictionIds
        )
      }
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, RETENTION_ELIGIBILITY_SCHEMA.budgets.maxAdaptiveEntriesPerProject);
}

function isGovernedEntryActive(
  entry: {
    contractVersion: string;
    expiresAt: string | null;
    status?: string;
    provenance?: { sourceRunIds?: string[] };
  },
  now: string
): boolean {
  return (
    isGovernedEntryRetainable(entry, now) &&
    (entry.status ?? "active") === "active"
  );
}

function isGovernedEntryRetainable(
  entry: {
    contractVersion: string;
    expiresAt: string | null;
    provenance?: { sourceRunIds?: string[] };
  },
  now: string
): boolean {
  return (
    entry.contractVersion === RESEARCH_QUALITY_CONTRACT_VERSION &&
    typeof entry.expiresAt === "string" &&
    entry.expiresAt > now &&
    (entry.provenance?.sourceRunIds?.length ?? 0) > 0
  );
}

function decisionMemoryKey(entry: ProjectRecord["memory"]["decisionLedger"][number]): string {
  return [
    entry.contextClass ?? "unknown",
    entry.comparisonAxis?.trim() || entry.title.trim()
  ].join("::");
}

function laterIso(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function singleUrlPlan(plan: ResearchPlan, url: string): ResearchPlan {
  return {
    ...plan,
    normalizedInput: {
      ...plan.normalizedInput,
      urls: [url]
    }
  };
}

function computeAllowedMs(args: {
  budget: ResearchBudgetConfig;
  nowMs: () => number;
  totalStartedAt: number;
  urlStartedAt: number;
  fallbackSpentMs: number;
  isFallback: boolean;
}): number {
  const totalRemaining =
    args.budget.totalMs - Math.max(0, args.nowMs() - args.totalStartedAt);
  const perUrlRemaining =
    args.budget.perUrlMs - Math.max(0, args.nowMs() - args.urlStartedAt);
  const fallbackRemaining = args.isFallback
    ? args.budget.totalMs * args.budget.fallbackBudgetRatio - args.fallbackSpentMs
    : Number.POSITIVE_INFINITY;

  return Math.floor(
    Math.min(args.budget.perAdapterMs, totalRemaining, perUrlRemaining, fallbackRemaining)
  );
}

function inferSourceType(chain: AdapterChain): SourceTarget {
  if (chain.rule.startsWith("video/")) return "video";
  if (chain.rule === "github") return "github";
  if (chain.rule.startsWith("community/")) return "community";
  if (chain.rule.startsWith("pdf/")) return "pdf";
  return "web";
}

function buildRoutingFailureArtifact(params: {
  adapter: string;
  url: string;
  sourceType: SourceTarget;
  status: "error" | "timeout";
  errorMessage: string;
}): SourceArtifact {
  return buildFailureArtifact({
    id: `${params.adapter}-0`,
    adapter: params.adapter,
    fetcher: params.adapter,
    url: params.url,
    sourceType: params.sourceType,
    outcome: { status: params.status },
    errorMessage: params.errorMessage,
    sourceLabel: `${params.sourceType}/${params.status}`
  });
}

function isUsableArtifact(artifact: SourceArtifact): boolean {
  return (
    artifact.metadata.fetch_status === "success" ||
    artifact.metadata.fetch_status === "partial"
  );
}

function selectRepresentativeArtifact(
  artifacts: SourceArtifact[],
  url: string
): SourceArtifact {
  const best = artifacts.find(isUsableArtifact) ?? artifacts.at(-1);
  if (best) return best;

  return buildFailureArtifact({
    id: "mcp-fetch-web-0",
    adapter: "mcp/fetch_web",
    fetcher: "mcp/fetch_web",
    url,
    sourceType: "web",
    outcome: { status: "error" },
    errorMessage: "no artifacts gathered",
    sourceLabel: "web/error"
  });
}

function attachSourceTiers(artifacts: SourceArtifact[]): SourceArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    sourceTier: artifact.sourceTier ?? inferSourceTier(artifact.canonicalUrl ?? artifact.url)
  }));
}

function dedupeGatheredArtifacts(artifacts: SourceArtifact[]): SourceArtifact[] {
  const deduped = new Map<string, SourceArtifact>();

  for (const artifact of artifacts) {
    const dedupeKey = artifact.canonicalUrl ?? artifact.url;
    if (!dedupeKey) {
      continue;
    }

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, artifact);
      continue;
    }

    deduped.set(dedupeKey, pickPreferredArtifact(existing, artifact));
  }

  return Array.from(deduped.values());
}

function pickPreferredArtifact(current: SourceArtifact, candidate: SourceArtifact): SourceArtifact {
  const currentRank = fetchStatusRank(current.metadata.fetch_status);
  const candidateRank = fetchStatusRank(candidate.metadata.fetch_status);

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }

  if (candidate.content.length !== current.content.length) {
    return candidate.content.length > current.content.length ? candidate : current;
  }

  if (candidate.snippet.length !== current.snippet.length) {
    return candidate.snippet.length > current.snippet.length ? candidate : current;
  }

  return candidate;
}

function fetchStatusRank(status: string | undefined): number {
  switch (status) {
    case "success":
      return 4;
    case "partial":
      return 3;
    case "blocked":
      return 2;
    case "timeout":
      return 1;
    default:
      return 0;
  }
}

function resolveTierForClaim(
  claim: Claim | undefined,
  citationById: Map<string, Citation>,
  artifactById: Map<string, SourceArtifactRecord>
): SourceTier | null {
  if (!claim) return null;

  // TODO(SI3-v2): consider multiple citation tiers instead of first-citation fallback.
  for (const citationId of claim.citationIds) {
    const citation = citationById.get(citationId);
    const artifact = citation ? artifactById.get(citation.artifactId) : undefined;
    if (artifact?.sourceTier) {
      return artifact.sourceTier;
    }
  }

  return null;
}

function attachContradictionKinds(
  contradictions: Contradiction[],
  claims: Claim[],
  citations: Citation[],
  artifacts: SourceArtifactRecord[]
): Contradiction[] {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return contradictions.map((contradiction) => {
    const [claimIdA, claimIdB] = contradiction.claimIds;
    const tierA = resolveTierForClaim(claimById.get(claimIdA), citationById, artifactById);
    const tierB = resolveTierForClaim(claimById.get(claimIdB), citationById, artifactById);

    if (!tierA || !tierB) {
      return contradiction;
    }

    return {
      ...contradiction,
      kind: classifyContradictionKind(tierA, tierB),
      tierA,
      tierB
    };
  });
}

export async function executeResearchRun(
  projectId: string,
  runId: string,
  deps?: {
    now?: string;
    gather?: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
    research?: RunResearchDeps;
  }
) {
  const now = deps?.now ?? new Date().toISOString();
  const nowDate = new Date(now);
  const initialRecord = await readRunRecord(projectId, runId);
  const projectRecord = await readProjectRecord(projectId);
  const existingRunRecords = await listRunRecords(projectId);
  const normalizedInputForContext = planRun(initialRecord, null, { now: nowDate }).normalizedInput;
  const kbContext = await buildKnowledgeContext({
    record: {
      ...initialRecord,
      normalizedInput: normalizedInputForContext
    },
    projectRecord,
    runRecords: existingRunRecords
  });
  const plan = planRun(
    {
      ...initialRecord,
      normalizedInput: normalizedInputForContext
    },
    kbContext,
    { now: nowDate }
  );
  const clarificationQuestions = buildClarificationQuestions(plan.normalizedInput);

  if (shouldClarifyRun(plan.normalizedInput)) {
    const clarified = await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "awaiting_clarification");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        expansion: plan.expansion ?? null,
        kbContext: plan.kbContext,
        run: {
          ...record.run,
          status: "awaiting_clarification",
          clarificationQuestions,
          updatedAt: now
        }
      };
    });
    await applyRunRetentionPolicy(projectId, { now });
    return clarified;
  }

  await updateRunRecord(projectId, runId, (record) => {
    assertRunTransition(record.run.status, "collecting");
    return {
      ...record,
      normalizedInput: plan.normalizedInput,
      expansion: plan.expansion ?? null,
      kbContext: plan.kbContext,
      run: {
        ...record.run,
        status: "collecting",
        clarificationQuestions: [],
        updatedAt: now
      }
    };
  });

  try {
    const emptyResults: EmptyAdapterResultGap[] = [];
    const gather =
      deps?.gather ??
      ((plan: ResearchPlan) =>
        runResearch(plan, {
          ...deps?.research,
          nowIso: () => now,
          onEmptyAdapterResult: (gap) => {
            deps?.research?.onEmptyAdapterResult?.(gap);
            emptyResults.push(gap);
          }
        }));
    const gatheredArtifacts = await gather(plan);
    const artifacts = attachSourceTiers([
      ...buildKnowledgeArtifacts(plan.kbContext, plan.runId),
      ...dedupeGatheredArtifacts(gatheredArtifacts)
    ]);

    await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "synthesizing");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        kbContext: plan.kbContext,
        artifacts,
        run: {
          ...record.run,
          status: "synthesizing",
          updatedAt: now
        }
      };
    });

    let synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now,
      recencySensitive: isRecencySensitive(plan)
    });
    let counterevidenceVisibilityArtifacts: SourceArtifact[] = [];
    const repairPlan = planSourceCoverageRepair({
      title: plan.title,
      goal: plan.normalizedInput.goal,
      summary: {
        hasOfficialOrPrimaryEvidence: synthesis.summary.hasOfficialOrPrimaryEvidence,
        sourceCoverageWarnings: synthesis.summary.sourceCoverageWarnings
      }
    });

    if (repairPlan.shouldRun && repairPlan.discovery) {
      const domainDiscovery = await (deps?.research?.domainTargetedDiscover ??
        discoverDomainTargetedCandidates)(repairPlan.discovery.query);
      const domainFollowedUrls = extractAllowedRepairUrlsFromCandidates(
        domainDiscovery.candidates,
        3
      );
      const domainDiscoveryArtifact = buildDomainDiscoveryArtifact({
        query: repairPlan.discovery.query,
        searchUrl: repairPlan.discovery.url,
        result: domainDiscovery,
        retrievedAt: now
      });
      let discoveryArtifacts: SourceArtifact[] = [domainDiscoveryArtifact];
      let discoveryRepresentative: SourceArtifact | undefined = domainDiscoveryArtifact;
      let primaryFollowedUrls = domainFollowedUrls;
      let primaryDiscoveryBlocked = false;

      if (primaryFollowedUrls.length === 0) {
        const fallbackDiscoveryArtifacts = await runResearch(
          buildSourceCoverageRepairPlan(plan, [
            `https://s.jina.ai/?q=${encodeURIComponent(repairPlan.discovery.query)}`
          ]),
          {
            ...deps?.research,
            nowIso: () => now,
            onEmptyAdapterResult: (gap) => {
              deps?.research?.onEmptyAdapterResult?.(gap);
              emptyResults.push(gap);
            }
          }
        );
        discoveryArtifacts = [...discoveryArtifacts, ...fallbackDiscoveryArtifacts];
        const fallbackRepresentative =
          fallbackDiscoveryArtifacts.find(isUsableArtifact) ?? fallbackDiscoveryArtifacts.at(-1);
        const fallbackFollowedUrls = fallbackRepresentative
          ? extractAllowedRepairUrlsFromDiscovery({
              content: fallbackRepresentative.content,
              snippet: fallbackRepresentative.snippet,
              title: fallbackRepresentative.title,
              metadata: fallbackRepresentative.metadata,
              limit: 3
            })
          : [];
        if (fallbackRepresentative) {
          discoveryRepresentative = fallbackRepresentative;
        }
        primaryFollowedUrls = fallbackFollowedUrls;
        primaryDiscoveryBlocked = fallbackRepresentative?.metadata.fetch_status === "blocked";
      }
      const discoveredArtifactsWithBlockFlag =
        primaryDiscoveryBlocked && discoveryRepresentative
          ? discoveryArtifacts.map((artifact) =>
              artifact.id === discoveryRepresentative.id
                ? {
                    ...artifact,
                    metadata: {
                      ...artifact.metadata,
                      repair_discovery_blocked: "true"
                    }
                  }
                : artifact
            )
          : discoveryArtifacts;
      const fallbackDiscovery =
        primaryDiscoveryBlocked || primaryFollowedUrls.length === 0
          ? await extractFallbackRepairUrlsFromCommunityArtifacts(artifacts)
          : {
              urls: [] as string[],
              markedArtifacts: artifacts,
              rawSourcesChecked: 0,
              candidateCount: 0,
              allowedUrlCount: 0
            };
      const markedDiscoveryArtifacts = discoveredArtifactsWithBlockFlag.map((artifact) =>
        markDiscoveryRepairArtifact(
          artifact,
          repairPlan,
          artifact.id === domainDiscoveryArtifact.id
            ? {
                source: "domain_targeted_search",
                candidateCount: domainDiscovery.rawResultCount,
                allowedUrlCount: domainDiscovery.allowedResultCount,
                rawResultCount: domainDiscovery.rawResultCount,
                errors: domainDiscovery.errors
              }
            : undefined,
          {
            attempted: primaryDiscoveryBlocked || primaryFollowedUrls.length === 0,
            source: "community_search_json",
            candidateCount: fallbackDiscovery.candidateCount,
            allowedUrlCount: fallbackDiscovery.allowedUrlCount,
            rawSourcesChecked: fallbackDiscovery.rawSourcesChecked
          }
        )
      );
      const followedUrls =
        primaryFollowedUrls.length > 0 ? primaryFollowedUrls : fallbackDiscovery.urls;
      const followedDiscoverySource =
        domainFollowedUrls.length > 0
          ? "domain_targeted_search"
          : primaryFollowedUrls.length > 0
            ? "jina_search"
            : "community_search_json";
      const followedArtifacts =
        followedUrls.length > 0
          ? markFollowedRepairArtifacts(
              await runResearch(buildSourceCoverageRepairPlan(plan, followedUrls), {
                ...deps?.research,
                nowIso: () => now,
                onEmptyAdapterResult: (gap) => {
                  deps?.research?.onEmptyAdapterResult?.(gap);
                  emptyResults.push(gap);
                }
              }),
              discoveryRepresentative?.id ?? "repair-discovery-0",
              followedUrls,
              repairPlan.reason ?? "no_official_or_primary_evidence",
              followedDiscoverySource
            )
          : [];
      const repairedArtifacts = attachSourceTiers(
        dedupeGatheredArtifacts([
          ...fallbackDiscovery.markedArtifacts,
          ...markedDiscoveryArtifacts,
          ...followedArtifacts
        ])
      );
      synthesis = synthesizeEvidenceFromArtifacts(repairedArtifacts, {
        now,
        recencySensitive: isRecencySensitive(plan)
      });
    }

    const counterevidencePlan = planCounterevidenceRepair({
      title: plan.title,
      goal: plan.normalizedInput.goal,
      evidenceSummary: synthesis.summary,
      claims: synthesis.claims,
      contradictions: synthesis.contradictions
    });

    if (counterevidencePlan.shouldAttempt) {
      const reason = counterevidencePlan.reasons[0] ?? "counterevidence_not_checked";
      const discoveryArtifacts: SourceArtifact[] = [];
      const followEntries: Array<{ url: string; query: string; rank: number; reason: string }> = [];
      const seenUrls = new Set(
        synthesis.artifacts
          .map((artifact) => normalizeCounterevidenceCandidateUrl(artifact.canonicalUrl ?? artifact.url))
          .filter((url): url is string => Boolean(url))
      );
      let remainingCandidateBudget = counterevidencePlan.maxCandidates;

      for (const [index, query] of counterevidencePlan.queries.entries()) {
        if (remainingCandidateBudget <= 0 || followEntries.length >= counterevidencePlan.maxFollowUrls) {
          break;
        }

        const domainDiscovery = await (deps?.research?.domainTargetedDiscover ??
          discoverDomainTargetedCandidates)(query);
        const remainingFollowBudget = counterevidencePlan.maxFollowUrls - followEntries.length;
        const selected = extractCounterevidenceFollowUrls({
          candidates: domainDiscovery.candidates,
          maxCandidates: remainingCandidateBudget,
          maxFollowUrls: remainingFollowBudget,
          seenUrls
        });

        discoveryArtifacts.push(
          buildCounterevidenceDiscoveryArtifact({
            index,
            query,
            result: domainDiscovery,
            reason,
            candidateCount: selected.candidateCount,
            allowedUrlCount: selected.allowedUrlCount,
            retrievedAt: now
          })
        );
        remainingCandidateBudget -= selected.candidateCount;

        for (const url of selected.urls) {
          seenUrls.add(url);
          followEntries.push({
            url,
            query,
            rank: followEntries.length,
            reason
          });
        }
      }

      const followedArtifacts =
        followEntries.length > 0
          ? markCounterevidenceArtifacts(
              await runResearch(
                buildSourceCoverageRepairPlan(
                  plan,
                  followEntries.map((entry) => entry.url)
                ),
                {
                  ...deps?.research,
                  nowIso: () => now,
                  onEmptyAdapterResult: (gap) => {
                    deps?.research?.onEmptyAdapterResult?.(gap);
                    emptyResults.push(gap);
                  }
                }
              ),
              followEntries
            )
          : [];
      const markedFollowedArtifacts = attachSourceTiers(followedArtifacts);
      const usableCounterevidenceArtifacts = markedFollowedArtifacts.filter(isUsableArtifact);
      const nonUsableCounterevidenceArtifacts = markedFollowedArtifacts.filter(
        (artifact) => !isUsableArtifact(artifact)
      );

      counterevidenceVisibilityArtifacts = attachSourceTiers([
        ...discoveryArtifacts,
        ...nonUsableCounterevidenceArtifacts
      ]);

      if (usableCounterevidenceArtifacts.length > 0) {
        synthesis = synthesizeEvidenceFromArtifacts(
          attachSourceTiers(
            dedupeGatheredArtifacts([
              ...synthesis.artifacts,
              ...usableCounterevidenceArtifacts
            ])
          ),
          {
            now,
            recencySensitive: isRecencySensitive(plan)
          }
        );
      }
    }
    const decision = buildDecision(synthesis, {
      runTitle: plan.title,
      goal: plan.normalizedInput.goal ?? plan.title
    });
    const prdSeed = buildPrdSeed(decision, synthesis, {
      runTitle: plan.title,
      target: plan.normalizedInput.target,
      comparisonAxis: plan.normalizedInput.comparisonAxis
    });
    const synthesizedArtifacts = attachSourceTiers(
      dedupeGatheredArtifacts([
        ...synthesis.artifacts,
        ...counterevidenceVisibilityArtifacts
      ])
    );
    const contradictions = attachContradictionKinds(
      synthesis.contradictions,
      synthesis.claims,
      synthesis.citations,
      synthesizedArtifacts
    );

    const finalRecord = await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "decided");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        kbContext: plan.kbContext,
        artifacts: synthesizedArtifacts,
        claims: synthesis.claims,
        citations: synthesis.citations,
        contradictions,
        retrievalAttemptGaps:
          emptyResults.length > 0
            ? {
                version: "v0",
                emptyResults,
                droppedAttempts: [],
                summary: {
                  emptyResultCount: emptyResults.length,
                  droppedAttemptCount: 0
                }
              }
            : null,
        evidenceSummary: synthesis.summary,
        decision,
        prdSeed,
        run: {
          ...record.run,
          status: "decided",
          updatedAt: now
        }
      };
    });

    const patch = deriveProjectInsightPatch(synthesis);
    const memoryPatch = deriveProjectMemoryPatch({
      record: finalRecord,
      synthesis,
      decision,
      now
    });
    const runRecords = await listRunRecords(projectId);
    const promotionCandidates = derivePromotionCandidates(runRecords);
    const updatedProject = await updateProjectRecord(projectId, (projectRecord) => ({
      ...projectRecord,
      insights: {
        repeatedProblems: mergeUnique(
          projectRecord.insights.repeatedProblems,
          patch.repeatedProblems
        ),
        repeatedPatterns: mergeUnique(
          projectRecord.insights.repeatedPatterns,
          patch.repeatedPatterns
        ),
        competitorSignals: mergeUnique(
          projectRecord.insights.competitorSignals,
          patch.competitorSignals
        ),
        contradictionIds: mergeUnique(
          projectRecord.insights.contradictionIds,
          patch.contradictionIds
        )
      },
      memory: {
        decisionLedger: mergeDecisionLedger(
          projectRecord.memory?.decisionLedger ?? [],
          memoryPatch.decisionLedger,
          now
        ),
        topicLedger: mergeTopicLedger(
          projectRecord.memory?.topicLedger ?? [],
          memoryPatch.topicLedger,
          now
        ),
        contradictionLedger: mergeContradictionLedger(
          projectRecord.memory?.contradictionLedger ?? [],
          memoryPatch.contradictionLedger,
          now
        )
      },
      promotionCandidates,
      project: {
        ...projectRecord.project,
        updatedAt: now
      }
    }));

    try {
      const decisionHistory = buildDecisionHistory(updatedProject.project, runRecords);
      await exportRunToObsidian(finalRecord, updatedProject.project);
      await exportInsightsToObsidian(updatedProject.project, updatedProject.insights);
      await exportDecisionHistoryToObsidian(updatedProject.project, decisionHistory);
      await syncRunToKnowledgeBase(finalRecord, updatedProject.project, updatedProject.insights);
    } catch (error) {
      console.error("Obsidian export failed", error);
    }

    await applyRunRetentionPolicy(projectId, { now });
    return finalRecord;
  } catch (error) {
    await updateRunRecord(projectId, runId, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "failed",
        updatedAt: now
      }
    }));
    await applyRunRetentionPolicy(projectId, { now });
    throw error;
  }
}
