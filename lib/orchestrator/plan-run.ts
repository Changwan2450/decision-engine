import { normalizeRunInputs } from "@/lib/orchestrator/clarify";
import { expandQuery } from "@/lib/orchestrator/query-expansion";
import type { RunRecord } from "@/lib/storage/schema";
import type { KnowledgeContext, ResearchPlan, SourceTarget } from "@/lib/adapters/types";
import type { ExpandedSource } from "@/lib/orchestrator/query-expansion";

function shouldDeprioritizeCommunity(record: RunRecord): boolean {
  const normalizedInput = normalizeRunInputs({
    title: record.run.title,
    naturalLanguage: record.run.input.naturalLanguage,
    pastedContent: record.run.input.pastedContent,
    urls: record.run.input.urls
  });
  const haystack = [
    normalizedInput.title,
    normalizedInput.naturalLanguage,
    normalizedInput.goal,
    normalizedInput.target,
    normalizedInput.comparisonAxis
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isComparative = !!normalizedInput.comparisonAxis || /\bvs\b|versus|대/.test(haystack);
  const hasEnterpriseAuthPattern =
    /(postgres|postgresql|database|db|sql)/.test(haystack) &&
    /(authorization|auth|access control|rbac|abac|permission|tenant|multi-tenant|security|rls|row level security)/.test(
      haystack
    );
  const hasObservabilityVendorPattern =
    /(opentelemetry|otel|observability|tracing|telemetry)/.test(haystack) &&
    /(vendor apm|apm|datadog|new relic|dynatrace|elastic)/.test(haystack);

  return isComparative && (hasEnterpriseAuthPattern || hasObservabilityVendorPattern);
}

function inferKnownSeedUrls(input: ReturnType<typeof normalizeRunInputs>): string[] {
  const haystack = [
    input.title,
    input.naturalLanguage,
    input.goal,
    input.target,
    input.comparisonAxis
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isPostgresRlsAuthorization =
    /(postgres|postgresql)/.test(haystack) &&
    /(rls|row level security)/.test(haystack) &&
    /(authorization|auth|access control|rbac|permission|tenant|multi-tenant)/.test(haystack);

  if (isPostgresRlsAuthorization) {
    return [
      "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
      "https://www.postgresql.org/docs/current/sql-grant.html"
    ];
  }

  const isOpenTelemetryVendorApm =
    /(opentelemetry|otel)/.test(haystack) &&
    /(vendor apm|apm|observability|tracing|telemetry)/.test(haystack);

  if (isOpenTelemetryVendorApm) {
    return [
      "https://opentelemetry.io/docs/concepts/observability-primer/",
      "https://opentelemetry.io/docs/collector/"
    ];
  }

  return [];
}

function inferSourceTargets(record: RunRecord): SourceTarget[] {
  const targets: SourceTarget[] = ["web"];

  if (!shouldDeprioritizeCommunity(record)) {
    targets.push("community");
  }

  if (record.run.input.urls.length > 0) {
    targets.push("video", "github");
  }

  return Array.from(new Set(targets));
}

function inferExpansionSources(targets: SourceTarget[]): ExpandedSource[] {
  return targets.includes("community")
    ? ["jina-search", "reddit-search", "hn-algolia"]
    : ["jina-search"];
}

export function planRun(
  record: RunRecord,
  kbContext: KnowledgeContext | null = null,
  options?: { now?: Date }
): ResearchPlan {
  const sourceTargets = inferSourceTargets(record);
  const normalizedInput = normalizeRunInputs({
    title: record.run.title,
    naturalLanguage: record.run.input.naturalLanguage,
    pastedContent: record.run.input.pastedContent,
    urls: record.run.input.urls
  });
  const expansion = expandQuery(normalizedInput, {
    now: options?.now,
    sources: inferExpansionSources(sourceTargets)
  });
  const seedUrls = inferKnownSeedUrls(normalizedInput);
  const mergedUrls = Array.from(
    new Set([
      ...normalizedInput.urls,
      ...seedUrls,
      ...expansion.expanded.map((entry) => entry.url)
    ])
  );

  return {
    projectId: record.run.projectId,
    runId: record.run.id,
    title: record.run.title,
    mode: record.run.mode,
    normalizedInput: {
      ...normalizedInput,
      urls: mergedUrls
    },
    expansion,
    sourceTargets,
    kbContext
  };
}

export type { ResearchPlan } from "@/lib/adapters/types";
