import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { loadPackV1, loadPackV2Draft } from "@/lib/eval/pack-loader";

export type EvalPackReport = {
  ok: boolean;
  packId: string;
  packVersion?: string;
  kind: "pack-v1" | "pack-v2-draft";
  sealed: boolean;
  auditMode: string | null;
  topicCount: number;
  caseCount: number;
  acceptanceFields?: string[];
  errors: string[];
};

function emptyReport(params: {
  packId?: string;
  kind?: EvalPackReport["kind"];
  errors: string[];
}): EvalPackReport {
  return {
    ok: false,
    packId: params.packId ?? "unknown",
    kind: params.kind ?? "pack-v2-draft",
    sealed: false,
    auditMode: null,
    topicCount: 0,
    caseCount: 0,
    errors: params.errors
  };
}

function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readPackId(absolutePath: string): string | null {
  const parsed = load(readFileSync(absolutePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !("packId" in parsed)) {
    return null;
  }
  const packId = (parsed as { packId?: unknown }).packId;
  return typeof packId === "string" ? packId : null;
}

export function buildEvalPackReport(absolutePath: string): EvalPackReport {
  let packId: string | null;
  try {
    packId = readPackId(absolutePath);
  } catch (error) {
    return emptyReport({ errors: [formatError(error)] });
  }

  if (packId === "pack-001") {
    try {
      const pack = loadPackV1(absolutePath);
      return {
        ok: true,
        packId: pack.packId,
        packVersion: pack.packVersion,
        kind: "pack-v1",
        sealed: pack.sealed,
        auditMode: pack.auditMode,
        topicCount: pack.topicCount,
        caseCount: pack.topics.length,
        acceptanceFields: Object.keys(pack.acceptanceSchema),
        errors: []
      };
    } catch (error) {
      return emptyReport({
        packId,
        kind: "pack-v1",
        errors: [formatError(error)]
      });
    }
  }

  if (packId === "pack-002") {
    try {
      const pack = loadPackV2Draft(absolutePath);
      return {
        ok: true,
        packId: pack.packId,
        packVersion: pack.packVersion,
        kind: "pack-v2-draft",
        sealed: pack.sealed,
        auditMode: pack.auditMode,
        topicCount: pack.topicCount,
        caseCount: pack.cases.length,
        acceptanceFields: Object.keys(pack.acceptance_fields),
        errors: []
      };
    } catch (error) {
      return emptyReport({
        packId,
        kind: "pack-v2-draft",
        errors: [formatError(error)]
      });
    }
  }

  return emptyReport({
    packId: packId ?? "unknown",
    errors: [`unknown packId: ${packId ?? "(missing)"}`]
  });
}
