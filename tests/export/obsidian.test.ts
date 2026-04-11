import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempVault: string | null = null;

describe("obsidian export", () => {
  afterEach(async () => {
    if (tempVault) {
      await rm(tempVault, { recursive: true, force: true });
      tempVault = null;
    }
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  it("exports run markdown into the vault structure", async () => {
    tempVault = await mkdtemp(path.join(os.tmpdir(), "obsidian-export-"));
    process.env.OBSIDIAN_VAULT_PATH = tempVault;

    const { exportDecisionHistoryToObsidian, exportRunToObsidian } = await import(
      "@/lib/export/obsidian"
    );
    const { buildDecisionHistory } = await import("@/lib/orchestrator/decision-history");

    await exportRunToObsidian(
      {
        run: {
          id: "run-1",
          projectId: "project-1",
          title: "숏츠 시장 진입",
          mode: "standard",
          status: "decided",
          clarificationQuestions: [],
          input: { naturalLanguage: "", pastedContent: "", urls: [] },
          createdAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z"
        },
        normalizedInput: null,
        decision: {
          value: "go",
          confidence: "high",
          why: "근거 충분",
          blockingUnknowns: [],
          nextActions: []
        },
        prdSeed: {
          targetUser: "20대 크리에이터",
          problem: "숏츠 시장 진입 판단",
          solutionHypothesis: "바로 실험 가능",
          featureCandidates: ["핵심 가치 제안 검증 화면"],
          risk: ["비교 기준 해석이 흔들릴 수 있다."]
        },
        artifacts: [],
        claims: [
          {
            id: "claim-1",
            artifactId: "artifact-1",
            text: "Short-form demand is growing.",
            topicKey: "short-form-demand",
            stance: "support",
            citationIds: ["citation-1"]
          }
        ],
        citations: [
          {
            id: "citation-1",
            artifactId: "artifact-1",
            url: "https://example.com/source",
            title: "Official source",
            priority: "official",
            publishedAt: "2026-04-09T00:00:00.000Z"
          }
        ],
        contradictions: [],
        evidenceSummary: {
          shouldRemainUnclear: false,
          reasons: [],
          highestPrioritySeen: "official",
          claimCount: 1,
          contradictionCount: 0
        }
      },
      {
        id: "project-1",
        name: "Decision Engine",
        description: "desc",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      }
    );

    const markdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "runs",
        "run-1.md"
      ),
      "utf8"
    );

    expect(markdown).toContain("# Run: run-1");
    expect(markdown).toContain("- decision: go");
    expect(markdown).toContain("- claim: Short-form demand is growing.");
    expect(markdown).toContain("- target_user: 20대 크리에이터");

    await exportDecisionHistoryToObsidian(
      {
        id: "project-1",
        name: "Decision Engine",
        description: "desc",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      },
      buildDecisionHistory(
        {
          id: "project-1",
          name: "Decision Engine",
          description: "desc",
          createdAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z"
        },
        [
          {
            run: {
              id: "run-1",
              projectId: "project-1",
              title: "t",
              mode: "standard",
              status: "decided",
              clarificationQuestions: [],
              input: { naturalLanguage: "", pastedContent: "", urls: [] },
              createdAt: "2026-04-09T00:00:00.000Z",
              updatedAt: "2026-04-09T00:00:00.000Z"
            },
            normalizedInput: null,
            decision: {
              value: "go",
              confidence: "high",
              why: "근거 충분",
              blockingUnknowns: ["a"],
              nextActions: []
            },
            prdSeed: null,
            artifacts: [],
            claims: [],
            citations: [],
            contradictions: [],
            evidenceSummary: null,
            advisory: null
          }
        ]
      )
    );

    const historyMarkdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "decision-history.md"
      ),
      "utf8"
    );

    expect(historyMarkdown).toContain("# Decision History");
    expect(historyMarkdown).toContain("run: run-1");
  });
});
