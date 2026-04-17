import path from "node:path";

export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace");

export const OBSIDIAN_VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH ??
  path.join(process.env.HOME ?? "", "Antigravity WorkSpace", "LLM-KB-Core");

export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export type ResearchBudgetConfig = {
  totalMs: number;
  perAdapterMs: number;
  perUrlMs: number;
  fallbackBudgetRatio: number;
};

export function getResearchBudgetConfig(): ResearchBudgetConfig {
  return {
    totalMs: readPositiveInt("RESEARCH_TOTAL_MS", 30_000),
    perAdapterMs: readPositiveInt("RESEARCH_PER_ADAPTER_MS", 12_000),
    perUrlMs: readPositiveInt("RESEARCH_PER_URL_MS", 15_000),
    fallbackBudgetRatio: readRatio("RESEARCH_FALLBACK_BUDGET_RATIO", 0.4)
  };
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readRatio(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}
