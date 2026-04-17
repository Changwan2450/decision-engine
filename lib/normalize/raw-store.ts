import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";

export type RawPayloadFormat = "html" | "txt" | "pdf" | "json";

export async function storeRawPayload(input: {
  projectId: string;
  runId: string;
  adapter: string;
  format: RawPayloadFormat;
  payload: string | Buffer;
  rootDir?: string;
}): Promise<string> {
  const bytes = Buffer.isBuffer(input.payload)
    ? input.payload
    : Buffer.from(input.payload, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const relativePath = path.posix.join(
    input.projectId,
    "runs",
    input.runId,
    "raw",
    input.adapter,
    `${digest}.${input.format}`
  );
  const absolutePath = path.join(input.rootDir ?? WORKSPACE_ROOT, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return relativePath;
}
