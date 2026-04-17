import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setQmdClientForTests } from "@/lib/orchestrator/kb-context";

let tempRoot: string | null = null;
let tempVault: string | null = null;

describe("run research obsidian integration", () => {
  afterEach(async () => {
    setQmdClientForTests(null);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    if (tempVault) {
      await rm(tempVault, { recursive: true, force: true });
      tempVault = null;
    }
    delete process.env.WORKSPACE_ROOT;
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  it("writes run and insights markdown after a completed run", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-obsidian-"));
    tempVault = await mkdtemp(path.join(os.tmpdir(), "vault-obsidian-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
    await mkdir(path.join(tempVault, "scripts"), { recursive: true });
    await writeFile(
      path.join(tempVault, "scripts", "kb_gate.py"),
      [
        "from pathlib import Path",
        "import sys",
        "root = Path(sys.argv[sys.argv.index('--root') + 1])",
        "(root / 'script-calls.log').parent.mkdir(parents=True, exist_ok=True)",
        "with (root / 'script-calls.log').open('a', encoding='utf-8') as handle:",
        "    handle.write('kb_gate.py\\n')"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(tempVault, "scripts", "kb_absorb.py"),
      [
        "from pathlib import Path",
        "import sys",
        "root = Path(sys.argv[sys.argv.index('--root') + 1])",
        "with (root / 'script-calls.log').open('a', encoding='utf-8') as handle:",
        "    handle.write('kb_absorb.py\\n')"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(tempVault, "scripts", "kb_status.py"),
      [
        "from pathlib import Path",
        "import sys",
        "root = Path(sys.argv[sys.argv.index('--root') + 1])",
        "with (root / 'script-calls.log').open('a', encoding='utf-8') as handle:",
        "    handle.write('kb_status.py\\n')"
      ].join("\n"),
      "utf8"
    );
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [
          {
            title: "Short-Form Entry Decision Patterns",
            path: "wiki/concepts/short-form-entry-decision-patterns.md",
            summary: "숏폼 진입 판단은 경쟁 압박과 차별화를 같이 봐야 한다.",
            reusableClaims: ["경쟁 압박과 차별화를 같이 봐야 한다."]
          }
        ];
      }
    });

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "시장조사"
    });
    const run = await createRunRecord(project.project.id, {
      title: "숏츠 시장 진입",
      naturalLanguage:
        "목표: 숏츠 시장 진입 여부 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스",
      pastedContent: "경쟁사 패턴과 반복 문제를 봐야 함",
      urls: ["https://example.com/source"]
    });

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-09T12:00:00.000Z",
      gather: async () => [
        {
          id: "artifact-0",
          adapter: "agent-reach",
          sourceType: "web",
          title: "Official market note",
          url: "https://example.com/source",
          snippet: "시장 성장",
          content: "",
          sourcePriority: "official",
          publishedAt: "2026-04-09T00:00:00.000Z",
          metadata: {
            claims_json: JSON.stringify([
              {
                text: "Short-form demand is growing.",
                topicKey: "short-form-demand",
                stance: "support"
              }
            ]),
            repeated_problem: "차별화가 어렵다",
            repeated_pattern: "짧은 반복 루프로 retention을 높인다",
            competitor_signal: "릴스가 편집 자동화를 밀고 있다"
          }
        }
      ]
    });

    const runMarkdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "runs",
        `${run.run.id}.md`
      ),
      "utf8"
    );
    const insightsMarkdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "insights.md"
      ),
      "utf8"
    );
    const pendingKbNote = await readFile(
      path.join(
        tempVault,
        "intake",
        "pending",
        `decision-engine-Decision Engine-${run.run.id}.md`
      ),
      "utf8"
    );
    const scriptCalls = await readFile(path.join(tempVault, "script-calls.log"), "utf8");

    expect(runMarkdown).toContain("- decision: go");
    expect(insightsMarkdown).toContain("## Repeated Problems");
    expect(insightsMarkdown).toContain("차별화가 어렵다");
    expect(pendingKbNote).toContain(`kb_source_run_id: ${run.run.id}`);
    expect(pendingKbNote).toContain("suggested_wiki_target: concept");
    expect(pendingKbNote).toContain("## Solution Patterns");
    expect(scriptCalls).toContain("kb_gate.py");
    expect(scriptCalls).toContain("kb_absorb.py");
    expect(scriptCalls).toContain("kb_status.py");
  });
});
