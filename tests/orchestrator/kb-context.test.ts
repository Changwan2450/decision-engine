import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKnowledgeContext,
  createQmdClientForTests,
  setQmdClientForTests,
  setQmdRunnerForTests
} from "@/lib/orchestrator/kb-context";

const decisionProvenance = {
  sourceRunIds: ["run-1"],
  claimIds: ["claim-1"],
  citationIds: ["citation-1"],
  contradictionIds: []
};

const topicProvenance = {
  sourceRunIds: ["run-1"],
  claimIds: ["claim-1"],
  citationIds: ["citation-1"]
};

const contradictionProvenance = {
  sourceRunIds: ["run-1"],
  claimIds: ["claim-1", "claim-2"],
  contradictionIds: ["contradiction-1"]
};

describe("kb-context qmd fallback", () => {
  afterEach(() => {
    setQmdClientForTests(null);
    setQmdRunnerForTests(null);
    vi.restoreAllMocks();
  });

  it("uses multi-get json directly when qmd returns valid json", async () => {
    const getCalls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setQmdRunnerForTests(async (args) => {
      if (args[0] === "query") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic"
          }
        ]);
      }

      if (args[0] === "multi-get") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic",
            body: [
              "# Example Topic",
              "",
              "## Summary",
              "",
              "valid summary",
              "",
              "## Reusable Claims",
              "",
              "- valid claim"
            ].join("\n")
          }
        ]);
      }

      if (args[0] === "get") {
        getCalls.push(args[1] ?? "");
      }

      throw new Error(`unexpected qmd args: ${args.join(" ")}`);
    });

    const client = createQmdClientForTests("/tmp");
    const notes = await client.queryNotes("example search");

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Example Topic",
      summary: "valid summary"
    });
    expect(getCalls).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to per-file get and warns when multi-get json is malformed", async () => {
    const getCalls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setQmdRunnerForTests(async (args) => {
      if (args[0] === "query") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic"
          }
        ]);
      }

      if (args[0] === "multi-get") {
        return '[{"file":"qmd://wiki/topics/example-topic.md","body":"# Example Topic';
      }

      if (args[0] === "get") {
        getCalls.push(args[1] ?? "");
        return [
          "# Example Topic",
          "",
          "## Summary",
          "",
          "fallback summary",
          "",
          "## Reusable Claims",
          "",
          "- fallback claim"
        ].join("\n");
      }

      throw new Error(`unexpected qmd args: ${args.join(" ")}`);
    });

    const client = createQmdClientForTests("/tmp");
    const notes = await client.queryNotes("example search");

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Example Topic",
      summary: "fallback summary"
    });
    expect(getCalls).toEqual(["qmd://wiki/topics/example-topic.md"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("qmd multi-get JSON parse failed");
  });

  it("reuses thin project memory in prior decisions and query expansion", async () => {
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [];
      }
    });

    const context = await buildKnowledgeContext({
      vaultRoot: "/tmp",
      record: {
        run: {
          id: "run-2",
          projectId: "project-1",
          title: "Next decision",
          mode: "standard",
          status: "draft",
          clarificationQuestions: [],
          input: {
            naturalLanguage: "next decision",
            pastedContent: "",
            urls: []
          },
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        watchContext: null,
        projectOrigin: null,
        normalizedInput: {
          title: "Next decision",
          naturalLanguage: "next decision",
          pastedContent: "",
          urls: [],
          goal: "결정",
          target: "팀",
          comparisonAxis: "장단점"
        },
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
      },
      projectRecord: {
        project: {
          id: "project-1",
          name: "Project",
          description: "desc",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        insights: {
          repeatedProblems: [],
          repeatedPatterns: [],
          competitorSignals: [],
          contradictionIds: []
        },
        memory: {
          decisionLedger: [
            {
              runId: "run-1",
              title: "Prior decision",
              decision: "go",
              confidence: "high",
              why: "근거가 충분했다.",
              createdAt: "2026-04-20T00:00:00.000Z",
              comparisonAxis: "monorepo vs polyrepo",
              runType: "comparison_tradeoff_analysis",
              contextClass: "comparison",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-20T00:00:00.000Z",
              status: "active",
              supersededByRunId: null,
              provenance: decisionProvenance
            }
          ],
          topicLedger: [
            {
              topicKey: "monorepo",
              count: 3,
              highTrustCount: 2,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "active",
              provenance: topicProvenance
            }
          ],
          contradictionLedger: [
            {
              topicKey: "ci-complexity",
              count: 2,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "active",
              provenance: contradictionProvenance
            }
          ]
        },
        promotionCandidates: []
      },
      runRecords: []
    });

    expect(context.priorDecisions).toEqual([
      expect.objectContaining({
        runId: "run-1",
        title: "Prior decision",
        decision: "go"
      })
    ]);
    expect(context.queryExpansion).toContain("monorepo (3)");
    expect(context.queryExpansion).toContain("monorepo vs polyrepo");
    expect(context.duplicateWarnings).toContain("이미 다룬 런: Prior decision (go)");
    expect(context.duplicateWarnings).toContain("반복 상충 토픽: ci-complexity (2)");
    expect(context.freshEvidenceFocus).toContain("우선 재검증 토픽: monorepo");
    expect(context.freshEvidenceFocus).toContain("상충 토픽 재검증: ci-complexity (2)");
    expect(context.adaptivePolicy).toEqual({
      mode: "project_adaptive",
      contextClass: "comparison",
      preferredComparisonAxes: ["monorepo vs polyrepo"],
      prioritizedTopics: ["monorepo"],
      trustQualifiedTopics: ["monorepo"],
      reviewBias: "contradiction_first",
      appliedAdjustments: [
        "comparison-axis-priority:monorepo vs polyrepo",
        "trust-topic-priority:monorepo",
        "topic-priority:monorepo",
        "contradiction-first-review"
      ]
    });
  });

  it("ignores expired or legacy thin memory when building context", async () => {
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [];
      }
    });

    const context = await buildKnowledgeContext({
      vaultRoot: "/tmp",
      record: {
        run: {
          id: "run-3",
          projectId: "project-1",
          title: "Fresh decision",
          mode: "standard",
          status: "draft",
          clarificationQuestions: [],
          input: {
            naturalLanguage: "fresh decision",
            pastedContent: "",
            urls: []
          },
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        watchContext: null,
        projectOrigin: null,
        normalizedInput: {
          title: "Fresh decision",
          naturalLanguage: "fresh decision",
          pastedContent: "",
          urls: [],
          goal: "결정",
          target: "팀",
          comparisonAxis: "장단점"
        },
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
      },
      projectRecord: {
        project: {
          id: "project-1",
          name: "Project",
          description: "desc",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        insights: {
          repeatedProblems: [],
          repeatedPatterns: [],
          competitorSignals: [],
          contradictionIds: []
        },
        memory: {
          decisionLedger: [
            {
              runId: "legacy-run",
              title: "Legacy decision",
              decision: "go",
              confidence: "high",
              why: "old",
              createdAt: "2026-04-10T00:00:00.000Z",
              comparisonAxis: null,
              runType: null,
              contextClass: null,
              contractVersion: "legacy",
              retainedAt: null,
              expiresAt: null,
              status: "active",
              supersededByRunId: null,
              provenance: {
                sourceRunIds: [],
                claimIds: [],
                citationIds: [],
                contradictionIds: []
              }
            },
            {
              runId: "deprecated-run",
              title: "Deprecated decision",
              decision: "no_go",
              confidence: "high",
              why: "replaced by newer evidence",
              createdAt: "2026-04-19T00:00:00.000Z",
              comparisonAxis: "장단점",
              runType: "comparison_tradeoff_analysis",
              contextClass: "comparison",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-19T00:00:00.000Z",
              expiresAt: "2026-05-19T00:00:00.000Z",
              status: "deprecated",
              supersededByRunId: null,
              provenance: decisionProvenance
            },
            {
              runId: "provenance-free-run",
              title: "Provenance-free decision",
              decision: "go",
              confidence: "high",
              why: "missing source run",
              createdAt: "2026-04-19T00:00:00.000Z",
              comparisonAxis: "장단점",
              runType: "comparison_tradeoff_analysis",
              contextClass: "comparison",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-19T00:00:00.000Z",
              expiresAt: "2026-05-19T00:00:00.000Z",
              status: "active",
              supersededByRunId: null,
              provenance: {
                sourceRunIds: [],
                claimIds: ["claim-x"],
                citationIds: ["citation-x"],
                contradictionIds: []
              }
            }
          ],
          topicLedger: [
            {
              topicKey: "expired-topic",
              count: 2,
              highTrustCount: 1,
              lastSeenAt: "2026-04-10T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-10T00:00:00.000Z",
              expiresAt: "2026-04-15T00:00:00.000Z",
              status: "active",
              provenance: topicProvenance
            },
            {
              topicKey: "deprecated-topic",
              count: 4,
              highTrustCount: 2,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "deprecated",
              provenance: topicProvenance
            },
            {
              topicKey: "provenance-free-topic",
              count: 4,
              highTrustCount: 2,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "active",
              provenance: {
                sourceRunIds: [],
                claimIds: ["claim-x"],
                citationIds: ["citation-x"]
              }
            }
          ],
          contradictionLedger: []
        },
        promotionCandidates: []
      },
      runRecords: []
    });

    expect(context.priorDecisions).toEqual([]);
    expect(context.queryExpansion).not.toContain("expired-topic (2)");
    expect(context.queryExpansion).not.toContain("deprecated-topic (4)");
    expect(context.queryExpansion).not.toContain("provenance-free-topic (4)");
    expect(context.adaptivePolicy).toEqual({
      mode: "fresh",
      contextClass: "comparison",
      preferredComparisonAxes: [],
      prioritizedTopics: [],
      trustQualifiedTopics: [],
      reviewBias: "fresh_first",
      appliedAdjustments: []
    });
  });

  it("keeps adaptive policy conservative when only low-trust topic memory exists", async () => {
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [];
      }
    });

    const context = await buildKnowledgeContext({
      vaultRoot: "/tmp",
      record: {
        run: {
          id: "run-4",
          projectId: "project-1",
          title: "Tradeoff review",
          mode: "standard",
          status: "draft",
          clarificationQuestions: [],
          input: {
            naturalLanguage: "tradeoff review",
            pastedContent: "",
            urls: []
          },
          createdAt: "2026-04-21T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        watchContext: null,
        projectOrigin: null,
        normalizedInput: {
          title: "Tradeoff review",
          naturalLanguage: "tradeoff review",
          pastedContent: "",
          urls: [],
          goal: "결정",
          target: "팀",
          comparisonAxis: "A vs B"
        },
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
      },
      projectRecord: {
        project: {
          id: "project-1",
          name: "Project",
          description: "desc",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-21T00:00:00.000Z"
        },
        insights: {
          repeatedProblems: [],
          repeatedPatterns: [],
          competitorSignals: [],
          contradictionIds: []
        },
        memory: {
          decisionLedger: [
            {
              runId: "run-1",
              title: "Low-confidence prior",
              decision: "go",
              confidence: "medium",
              why: "partial",
              createdAt: "2026-04-20T00:00:00.000Z",
              comparisonAxis: "legacy axis",
              runType: "comparison_tradeoff_analysis",
              contextClass: "comparison",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-20T00:00:00.000Z",
              status: "active",
              supersededByRunId: null,
              provenance: decisionProvenance
            }
          ],
          topicLedger: [
            {
              topicKey: "noisy-topic",
              count: 4,
              highTrustCount: 0,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "active",
              provenance: topicProvenance
            }
          ],
          contradictionLedger: [
            {
              topicKey: "noisy-topic",
              count: 2,
              lastSeenAt: "2026-04-20T00:00:00.000Z",
              contractVersion: "2026-04-22.v1",
              retainedAt: "2026-04-20T00:00:00.000Z",
              expiresAt: "2026-05-11T00:00:00.000Z",
              status: "active",
              provenance: contradictionProvenance
            }
          ]
        },
        promotionCandidates: []
      },
      runRecords: []
    });

    expect(context.adaptivePolicy).toEqual({
      mode: "project_adaptive",
      contextClass: "comparison",
      preferredComparisonAxes: [],
      prioritizedTopics: ["noisy-topic"],
      trustQualifiedTopics: [],
      reviewBias: "fresh_first",
      appliedAdjustments: ["topic-priority:noisy-topic"]
    });
  });
});
