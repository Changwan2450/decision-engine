import { execSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBConnection } from "@duckdb/node-api";

export type HotspotRow = {
  file: string;
  churn: number;
  avg_ccn: number;
  nloc: number;
  hotspot_score: number;
};

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeValue(v)])
    );
  }
  return value;
}

function getChurnCsv(repoPath: string, since: string): string {
  // Returns CSV lines: file,churn (no header)
  const raw = execSync(
    `git -C ${JSON.stringify(repoPath)} log --format=format: --name-only --since=${JSON.stringify(since)}`,
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  const counts = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const f = line.trim();
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return (
    "file,churn\n" +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f, c]) => `${f},${c}`)
      .join("\n")
  );
}

const LIZARD_SCRIPT = [
  "import lizard, csv, sys, os",
  "repo = sys.argv[1]",
  "writer = csv.DictWriter(sys.stdout, fieldnames=['file','avg_ccn','nloc'])",
  "writer.writeheader()",
  "for f in lizard.analyze([repo]):",
  "    if f.function_list:",
  "        avg_ccn = sum(fn.cyclomatic_complexity for fn in f.function_list) / len(f.function_list)",
  "        rel = os.path.relpath(f.filename, repo)",
  "        writer.writerow({'file': rel, 'avg_ccn': round(avg_ccn, 2), 'nloc': f.nloc})"
].join("\n");

function getComplexityCsv(repoPath: string): string {
  const tmpDir = path.join(os.tmpdir(), `lizard-script-${process.pid}`);
  const scriptFile = `${tmpDir}.py`;
  try {
    writeFileSync(scriptFile, LIZARD_SCRIPT, "utf8");
    return execSync(`python3 ${JSON.stringify(scriptFile)} ${JSON.stringify(repoPath)}`, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
  } finally {
    try { rmSync(scriptFile); } catch { /* ignore */ }
  }
}

async function withClonedRepo<T>(
  repoUrl: string,
  fn: (repoPath: string) => Promise<T>
): Promise<T> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hotspot-clone-"));
  try {
    execSync(`git clone --depth=500 ${JSON.stringify(repoUrl)} ${JSON.stringify(tempDir)}`, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "ignore", "pipe"]
    });
    return await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function analyzeHotspots(
  repoPathOrUrl: string,
  since = "12.month",
  limit = 20
): Promise<HotspotRow[]> {
  const isUrl = repoPathOrUrl.startsWith("http://") || repoPathOrUrl.startsWith("https://") || repoPathOrUrl.startsWith("git@");
  if (isUrl) {
    return withClonedRepo(repoPathOrUrl, (p) => analyzeHotspots(p, since, limit));
  }

  const repoPath = repoPathOrUrl;
  const churnCsv = getChurnCsv(repoPath, since);
  const complexityCsv = getComplexityCsv(repoPath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hotspot-"));
  const churnFile = path.join(tempDir, "churn.csv");
  const complexityFile = path.join(tempDir, "complexity.csv");

  try {
    await writeFile(churnFile, churnCsv);
    await writeFile(complexityFile, complexityCsv);

    const conn = await DuckDBConnection.create();
    try {
      const sql = `
        WITH churn AS (
          SELECT file, CAST(churn AS INTEGER) AS churn
          FROM read_csv(${JSON.stringify(churnFile)}, header=true)
        ),
        complexity AS (
          SELECT file, CAST(avg_ccn AS DOUBLE) AS avg_ccn, CAST(nloc AS INTEGER) AS nloc
          FROM read_csv(${JSON.stringify(complexityFile)}, header=true)
        )
        SELECT
          ch.file,
          ch.churn,
          cx.avg_ccn,
          cx.nloc,
          ROUND(ch.churn * cx.avg_ccn, 2) AS hotspot_score
        FROM churn ch
        JOIN complexity cx
          ON cx.file = ch.file
             OR cx.file LIKE '%/' || ch.file
        ORDER BY hotspot_score DESC
        LIMIT ${limit}
      `;
      const reader = await conn.runAndReadAll(sql);
      await reader.readAll();
      return reader.getRowObjectsJS().map((row) => normalizeValue(row) as HotspotRow);
    } finally {
      conn.closeSync();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
