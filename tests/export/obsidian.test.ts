import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
        watchContext: null,
        projectOrigin: null,
        normalizedInput: null,
        expansion: null,
        kbContext: null,
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
        },
        advisory: null
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
            watchContext: null,
            projectOrigin: null,
            normalizedInput: null,
            expansion: null,
            kbContext: null,
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

  it("skips kb sync for low-value decided runs", async () => {
    tempVault = await mkdtemp(path.join(os.tmpdir(), "obsidian-export-"));
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
    await mkdir(path.join(tempVault, "scripts"), { recursive: true });
    await writeFile(
      path.join(tempVault, "scripts", "kb_gate.py"),
      "from pathlib import Path\nimport sys\nroot = Path(sys.argv[sys.argv.index('--root') + 1])\n(root / 'script-calls.log').write_text('kb_gate.py\\n', encoding='utf-8')\n",
      "utf8"
    );
    await writeFile(
      path.join(tempVault, "scripts", "kb_absorb.py"),
      "from pathlib import Path\nimport sys\nroot = Path(sys.argv[sys.argv.index('--root') + 1])\n(root / 'script-calls.log').write_text('kb_absorb.py\\n', encoding='utf-8')\n",
      "utf8"
    );

    const { shouldSyncRunToKnowledgeBase, syncRunToKnowledgeBase } = await import(
      "@/lib/export/obsidian"
    );

    const run: import("@/lib/storage/schema").RunRecord = {
      run: {
        id: "run-low-value",
        projectId: "project-1",
        title: "generic scan",
        mode: "standard" as const,
        status: "decided" as const,
        clarificationQuestions: [],
        input: { naturalLanguage: "", pastedContent: "", urls: [] },
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      },
      watchContext: null,
      projectOrigin: null,
      normalizedInput: null,
      expansion: null,
      kbContext: null,
      decision: {
        value: "go" as const,
        confidence: "medium" as const,
        why: "single weak signal",
        blockingUnknowns: [],
        nextActions: []
      },
      prdSeed: null,
      artifacts: [
        {
          id: "artifact-1",
          adapter: "agent-reach",
          sourceType: "web" as const,
          title: "Generic note",
          url: "https://example.com/generic",
          snippet: "generic",
          content: "",
          sourcePriority: "analysis" as const,
          metadata: {}
        }
      ],
      claims: [
        {
          id: "claim-1",
          artifactId: "artifact-1",
          text: "A generic claim",
          topicKey: "generic",
          stance: "support" as const,
          citationIds: ["citation-1"]
        }
      ],
      citations: [
        {
          id: "citation-1",
          artifactId: "artifact-1",
          url: "https://example.com/generic",
          title: "Generic source",
          priority: "analysis" as const
        }
      ],
      contradictions: [],
      evidenceSummary: {
        shouldRemainUnclear: false,
        reasons: [],
        highestPrioritySeen: "analysis" as const,
        claimCount: 1,
        contradictionCount: 0
      },
      advisory: null
    };

    expect(shouldSyncRunToKnowledgeBase(run)).toBe(false);

    await syncRunToKnowledgeBase(
      run,
      {
        id: "project-1",
        name: "Decision Engine",
        description: "desc",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      },
      {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      }
    );

    await expect(
      stat(
        path.join(
          tempVault,
          "intake",
          "pending",
          "decision-engine-Decision Engine-run-low-value.md"
        )
      )
    ).rejects.toThrow();
    await expect(stat(path.join(tempVault, "script-calls.log"))).rejects.toThrow();
  });
});
