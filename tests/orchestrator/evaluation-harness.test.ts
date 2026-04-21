import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVALUATION_CASES,
  evaluateSummary,
  summarizeEvaluationRun
} from "@/lib/orchestrator/evaluation-harness";
import type { RunRecord } from "@/lib/storage/schema";

describe("evaluation-harness", () => {
  it("summarizes run records into stable regression metrics", () => {
    const record = {
      run: {
        id: "run-1",
        projectId: "project-1",
        title: "React Server Components vs SPA — 실전 도입 후회",
        mode: "standard",
        status: "decided",
        clarificationQuestions: [],
        input: {
          naturalLanguage: "",
          pastedContent: "",
          urls: []
        },
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z"
      },
      watchContext: null,
      projectOrigin: null,
      normalizedInput: null,
      expansion: null,
      kbContext: null,
      decision: null,
      prdSeed: null,
      artifacts: [
        {
          id: "artifact-1",
          adapter: "community-search-json",
          sourceType: "community",
          title: "React Server Components: Do They Really Improve Performance?",
          url: "https://example.com/rsc",
          canonicalUrl: "https://example.com/rsc",
          snippet: "snippet",
          content: "content",
          sourcePriority: "community",
          metadata: {
            fetcher: "community-search-json",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        }
      ],
      claims: [
        {
          id: "claim-1",
          artifactId: "artifact-1",
          text: "React Server Components improve some rendering paths",
          topicKey: "server-components",
          stance: "support",
          citationIds: []
        }
      ],
      citations: [],
      contradictions: [],
      evidenceSummary: null,
      advisory: null
    } satisfies RunRecord;

    expect(summarizeEvaluationRun(record)).toEqual({
      runId: "run-1",
      title: "React Server Components vs SPA — 실전 도입 후회",
      communityCount: 1,
      contradictionCount: 0,
      leakedAuthClaimCount: 0,
      placeholderCount: 0,
      runAnchors: ["server-components"],
      communityTitles: ["React Server Components: Do They Really Improve Performance?"]
    });
  });

  it("fails when metrics exceed the expected noise budget", () => {
    const result = evaluateSummary(
      {
        runId: "run-1",
        title: "t",
        communityCount: 7,
        contradictionCount: 2,
        leakedAuthClaimCount: 1,
        placeholderCount: 1,
        runAnchors: [],
        communityTitles: []
      },
      {
        communityCount: { min: 3, max: 6 },
        contradictionCount: { max: 0 },
        leakedAuthClaimCount: { max: 0 },
        placeholderCount: { max: 0 }
      }
    );

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      "communityCount expected <= 6, got 7",
      "contradictionCount expected <= 0, got 2",
      "leakedAuthClaimCount expected <= 0, got 1",
      "placeholderCount expected <= 0, got 1"
    ]);
  });

  it("ships a fixed four-case generalization regression set", () => {
    expect(DEFAULT_EVALUATION_CASES.map((entry) => entry.id)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing"
    ]);
  });
});
