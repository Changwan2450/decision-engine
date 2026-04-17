import { execFile } from "node:child_process";
import { mkdir, stat, writeFile as writeFileFs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OBSIDIAN_VAULT_PATH } from "@/lib/config";
import type { Project } from "@/lib/domain/projects";
import type { DecisionHistoryItem } from "@/lib/orchestrator/decision-history";
import type { ProjectRecord, RunRecord } from "@/lib/storage/schema";

const execFileAsync = promisify(execFile);

function getVaultRoot(): string {
  return process.env.OBSIDIAN_VAULT_PATH ?? OBSIDIAN_VAULT_PATH;
}

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runKbScript(vaultRoot: string, scriptName: string, extraArgs: string[] = []) {
  const scriptPath = path.join(vaultRoot, "scripts", scriptName);
  const result = await execFileAsync("python3", [scriptPath, "--root", vaultRoot, ...extraArgs], {
    cwd: vaultRoot
  }).then(
    (value) => ({ stdout: value.stdout, stderr: value.stderr }),
    (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      const message = [error.stderr, error.stdout, error.message].filter(Boolean).join("\n");
      throw new Error(message || `${scriptName} failed`);
    }
  );
  return result;
}

function renderKbSyncNote(
  run: RunRecord,
  project: Project,
  insights: ProjectRecord["insights"]
): string {
  const claims = run.claims.slice(0, 5);
  const citations = run.citations.slice(0, 5);
  const repeatedProblems = unique(
    run.artifacts.map((artifact) => artifact.metadata.repeated_problem ?? "")
  ).slice(0, 5);
  const repeatedPatterns = unique(
    run.artifacts.map((artifact) => artifact.metadata.repeated_pattern ?? "")
  ).slice(0, 5);
  const competitorSignals = unique(
    run.artifacts.map((artifact) => artifact.metadata.competitor_signal ?? "")
  ).slice(0, 5);
  const contradictions = run.contradictions.slice(0, 5);

  const claimBlock =
    claims.length > 0
      ? claims
          .map((claim) => `- claim: ${claim.text}\n  - topic: ${claim.topicKey}\n  - stance: ${claim.stance}`)
          .join("\n")
      : "- claim: reusable evidence summary not available yet";
  const citationBlock =
    citations.length > 0
      ? citations
          .map(
            (citation) =>
              `- source: ${citation.title ?? citation.url ?? citation.id}\n  - url: ${citation.url ?? "n/a"}`
          )
          .join("\n")
      : "- source: n/a";
  const repeatedProblemBlock =
    repeatedProblems.length > 0
      ? repeatedProblems.map((value) => `- repeated_problem: ${value}`).join("\n")
      : "- repeated_problem: none";
  const repeatedPatternBlock =
    repeatedPatterns.length > 0
      ? repeatedPatterns.map((value) => `- repeated_pattern: ${value}`).join("\n")
      : "- repeated_pattern: none";
  const competitorSignalBlock =
    competitorSignals.length > 0
      ? competitorSignals.map((value) => `- competitor_signal: ${value}`).join("\n")
      : "- competitor_signal: none";
  const contradictionBlock =
    contradictions.length > 0
      ? contradictions
          .map((item) => `- contradiction: ${item.claimIds.join(" vs ")}\n  - why: ${item.reason}`)
          .join("\n")
      : "- contradiction: none";
  const suggestedTarget =
    run.contradictions.length > 0
      ? "synthesis"
      : repeatedProblems.length > 0 || repeatedPatterns.length > 0
        ? "concept"
      : "topic";

  return [
    "---",
    `title: Decision Engine KB Sync - ${project.name} - ${run.run.title}`,
    `canonical_wiki_title: ${run.run.title}`,
    `kb_source_type: decision-engine-run`,
    `suggested_wiki_target: ${suggestedTarget}`,
    `kb_source_project_id: ${project.id}`,
    `kb_source_run_id: ${run.run.id}`,
    `created_at: ${run.run.updatedAt}`,
    "---",
    "",
    `# Decision Engine KB Sync - ${project.name} - ${run.run.title}`,
    "",
    "## Workflow Summary",
    "",
    "- workflow: decision-first research export promoted into the LLM knowledge wiki",
    "- target: reusable knowledge, pattern, comparison, synthesis, and failure notes",
    `- project: ${project.name}`,
    `- run_id: ${run.run.id}`,
    `- decision: ${run.decision?.value ?? "-"}`,
    `- confidence: ${run.decision?.confidence ?? "-"}`,
    "",
    "## Decision Why",
    "",
    run.decision?.why ?? "No decision rationale recorded.",
    "",
    "## Reusable Evidence",
    "",
    claimBlock,
    "",
    "## Source Citations",
    "",
    citationBlock,
    "",
    "## Repeated Problems",
    "",
    repeatedProblemBlock,
    "",
    "## Solution Patterns",
    "",
    repeatedPatternBlock,
    "",
    "## Competitor Signals",
    "",
    competitorSignalBlock,
    "",
    "## Contradictions",
    "",
    contradictionBlock,
    "",
    "## KB Intent",
    "",
    "- This note exists so the gate and absorb workflow can compile research output into wiki concepts, topics, or syntheses.",
    "- Preserve useful heuristics, workflows, comparisons, and failure modes for future LLM reuse.",
    ""
  ].join("\n");
}

function hasReusableRunSignals(run: RunRecord): boolean {
  return run.artifacts.some((artifact) =>
    [
      artifact.metadata.repeated_problem,
      artifact.metadata.repeated_pattern,
      artifact.metadata.competitor_signal
    ].some((value) => Boolean(value && value !== "none"))
  );
}

function hasDurableEvidenceShape(run: RunRecord): boolean {
  if (!run.evidenceSummary || run.evidenceSummary.shouldRemainUnclear) {
    return false;
  }

  const hasHighPrioritySupport =
    run.evidenceSummary.highestPrioritySeen === "official" ||
    run.evidenceSummary.highestPrioritySeen === "primary_data";

  return hasHighPrioritySupport && run.claims.length >= 2;
}

export function shouldSyncRunToKnowledgeBase(run: RunRecord): boolean {
  if (run.run.status !== "decided" || !run.decision) {
    return false;
  }

  if (run.contradictions.length > 0) {
    return true;
  }

  if (hasReusableRunSignals(run)) {
    return true;
  }

  return hasDurableEvidenceShape(run);
}

export async function syncRunToKnowledgeBase(
  run: RunRecord,
  project: Project,
  insights: ProjectRecord["insights"]
): Promise<void> {
  if (!shouldSyncRunToKnowledgeBase(run)) {
    return;
  }

  const vaultRoot = getVaultRoot();
  const gateScript = path.join(vaultRoot, "scripts", "kb_gate.py");
  const absorbScript = path.join(vaultRoot, "scripts", "kb_absorb.py");

  if (!(await pathExists(gateScript)) || !(await pathExists(absorbScript))) {
    return;
  }

  const pendingFilePath = path.join(
    vaultRoot,
    "intake",
    "pending",
    `decision-engine-${safeSegment(project.name)}-${safeSegment(run.run.id)}.md`
  );

  await writeFile(pendingFilePath, renderKbSyncNote(run, project, insights));
  await runKbScript(vaultRoot, "kb_gate.py");
  await runKbScript(vaultRoot, "kb_absorb.py");

  const statusScript = path.join(vaultRoot, "scripts", "kb_status.py");
  if (await pathExists(statusScript)) {
    await runKbScript(vaultRoot, "kb_status.py", ["--write"]);
  }
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
