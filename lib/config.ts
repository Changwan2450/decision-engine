import path from "node:path";

export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace");

export const OBSIDIAN_VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH ??
  path.join(process.env.HOME ?? "", "Antigravity WorkSpace", "LLM-KB-Core");

export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";
