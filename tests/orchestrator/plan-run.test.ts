import { describe, expect, it } from "vitest";

import { planRun } from "@/lib/orchestrator/plan-run";
import type { RunRecord } from "@/lib/storage/schema";

function makeRecord(input: {
  title: string;
  naturalLanguage?: string;
  comparisonAxis?: string;
  urls?: string[];
}): RunRecord {
  return {
    run: {
      id: "run-1",
      projectId: "project-1",
      title: input.title,
      mode: "standard",
      status: "draft",
      clarificationQuestions: [],
      input: {
        naturalLanguage: input.naturalLanguage ?? "",
        pastedContent: "",
        urls: input.urls ?? []
      },
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z"
    },
    watchContext: null,
    projectOrigin: null,
    normalizedInput: null,
    expansion: null,
    kbContext: null,
    decision: null,
    prdSeed: null,
    artifacts: [],
    claims: [],
    citations: [],
    contradictions: [],
    evidenceSummary: null,
    advisory: null
  };
}

describe("planRun source target policy", () => {
  it("keeps community target for general comparison research", () => {
    const plan = planRun(
      makeRecord({
        title: "TypeScript monolith vs microservices — 팀 생산성 판단",
        naturalLanguage: "목표: 아키텍처 비교"
      })
    );

    expect(plan.sourceTargets).toContain("community");
    expect(plan.sourceTargets).toContain("web");
  });

  it("drops community target for enterprise auth/database comparison queries", () => {
    const plan = planRun(
      makeRecord({
        title: "Postgres RLS vs app authorization — B2B SaaS access control",
        naturalLanguage: "목표: multi-tenant authorization architecture tradeoffs 판단"
      })
    );

    expect(plan.sourceTargets).toEqual(["web"]);
    expect(plan.expansion?.expanded.every((entry) => entry.source === "jina-search")).toBe(true);
    expect(plan.normalizedInput.urls).toEqual(
      expect.arrayContaining([
        "https://www.postgresql.org/docs/current/ddl-rowsecurity.html",
        "https://www.postgresql.org/docs/current/sql-grant.html"
      ])
    );
  });

  it("drops community target for observability vendor-vs-open-source comparative queries", () => {
    const plan = planRun(
      makeRecord({
        title: "OpenTelemetry vs vendor APM — platform observability choice",
        naturalLanguage: "goal: platform observability tradeoffs and lock-in"
      })
    );

    expect(plan.sourceTargets).toEqual(["web"]);
    expect(plan.expansion?.expanded.every((entry) => entry.source === "jina-search")).toBe(true);
    expect(plan.normalizedInput.urls).toEqual(
      expect.arrayContaining([
        "https://opentelemetry.io/docs/concepts/observability-primer/",
        "https://opentelemetry.io/docs/collector/"
      ])
    );
  });
});
