import type { RunRecord } from "@/lib/storage/schema";

export type CliAdvisoryInput = {
  external_summary?: string;
  suggested_next_actions?: string[];
  notes?: string[];
};

export function ingestCliAdvisoryResult(
  existingRun: RunRecord,
  advisoryResult: CliAdvisoryInput,
  meta: {
    provider: "claude" | "codex";
    mode?: "prompt_only" | "cli_execute";
    ingestedAt?: string;
    executedAt?: string;
    success?: boolean;
  }
): RunRecord {
  return {
    ...existingRun,
    advisory: {
      externalSummary: advisoryResult.external_summary ?? "",
      suggestedNextActions: advisoryResult.suggested_next_actions ?? [],
      notes: advisoryResult.notes ?? [],
      provider: meta.provider,
      mode: meta.mode,
      ingestedAt: meta.ingestedAt ?? new Date().toISOString(),
      executedAt: meta.executedAt,
      success: meta.success,
      schemaVersion: "cli-bridge-v1"
    }
  };
}
