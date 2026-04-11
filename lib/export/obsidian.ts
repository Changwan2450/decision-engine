import { mkdir, writeFile as writeFileFs } from "node:fs/promises";
import path from "node:path";
import { OBSIDIAN_VAULT_PATH } from "@/lib/config";
import type { Project } from "@/lib/domain/projects";
import type { DecisionHistoryItem } from "@/lib/orchestrator/decision-history";
import type { ProjectRecord, RunRecord } from "@/lib/storage/schema";

function getVaultRoot(): string {
  return process.env.OBSIDIAN_VAULT_PATH ?? OBSIDIAN_VAULT_PATH;
}

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function decisionEngineProjectDir(project: Project): string {
  return path.join(
    getVaultRoot(),
    "DecisionEngine",
    "projects",
    safeSegment(project.name)
  );
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- 없음";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export async function ensureDir(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export async function writeFile(targetPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await writeFileFs(targetPath, content, "utf8");
}

export async function exportRunToObsidian(
  run: RunRecord,
  project: Project
): Promise<void> {
  const projectDir = decisionEngineProjectDir(project);
  const runFilePath = path.join(projectDir, "runs", `${run.run.id}.md`);
  const citationById = new Map(run.citations.map((citation) => [citation.id, citation]));
  const claimById = new Map(run.claims.map((claim) => [claim.id, claim]));

  const evidenceBlock =
    run.claims.length > 0
      ? run.claims
          .map((claim) => {
            const firstCitation = claim.citationIds
              .map((citationId) => citationById.get(citationId))
              .find(Boolean);
            const source = firstCitation?.url ?? firstCitation?.title ?? claim.artifactId;
            return `- claim: ${claim.text}\n  - source: ${source}`;
          })
          .join("\n")
      : "- 없음";

  const contradictionBlock =
    run.contradictions.length > 0
      ? run.contradictions
          .map((contradiction) => {
            const [leftId, rightId] = contradiction.claimIds;
            const left = claimById.get(leftId)?.text ?? leftId;
            const right = claimById.get(rightId)?.text ?? rightId;
            return `- A: ${left}\n- B: ${right}`;
          })
          .join("\n")
      : "- 없음";

  const content = [
    `# Run: ${run.run.id}`,
    "",
    "## Decision",
    `- decision: ${run.decision?.value ?? "-"}`,
    `- confidence: ${run.decision?.confidence ?? "-"}`,
    `- why: ${run.decision?.why ?? "-"}`,
    "",
    "## Evidence",
    evidenceBlock,
    "",
    "## Contradictions",
    contradictionBlock,
    "",
    "## PRD Seed",
    `- target_user: ${run.prdSeed?.targetUser ?? "-"}`,
    `- problem: ${run.prdSeed?.problem ?? "-"}`,
    `- solution: ${run.prdSeed?.solutionHypothesis ?? "-"}`,
    "",
    "## Metadata",
    `- created_at: ${run.run.createdAt}`,
    `- sources_count: ${run.citations.length}`
  ].join("\n");

  await writeFile(runFilePath, content);
}

export async function exportInsightsToObsidian(
  project: Project,
  insights: ProjectRecord["insights"]
): Promise<void> {
  const projectDir = decisionEngineProjectDir(project);
  const insightsFilePath = path.join(projectDir, "insights.md");

  const content = [
    "# Insights",
    "",
    "## Repeated Problems",
    formatList(insights.repeatedProblems),
    "",
    "## Solution Patterns",
    formatList(insights.repeatedPatterns),
    "",
    "## Competitor Signals",
    formatList(insights.competitorSignals),
    "",
    "## Conflicts",
    formatList(insights.contradictionIds)
  ].join("\n");

  await writeFile(insightsFilePath, content);
}

export async function exportDecisionHistoryToObsidian(
  project: Project,
  history: DecisionHistoryItem[]
): Promise<void> {
  const projectDir = decisionEngineProjectDir(project);
  const historyFilePath = path.join(projectDir, "decision-history.md");

  const content = [
    "# Decision History",
    "",
    history.length > 0
      ? history
          .map(
            (item) =>
              `- ${item.createdAt} — ${item.decision} (${item.confidence})\n  - why: ${item.why}\n  - run: ${item.runId}\n  - blocking unknowns: ${item.blockingUnknownCount}`
          )
          .join("\n")
      : "- 없음"
  ].join("\n");

  await writeFile(historyFilePath, content);
}
