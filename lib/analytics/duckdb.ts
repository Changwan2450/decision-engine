import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DuckDBConnection } from "@duckdb/node-api";

type QueryRow = Record<string, unknown>;

function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace");
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(fullPath);
      }
      return [fullPath];
    })
  );
  return nested.flat();
}

function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlList(values: string[]): string {
  return `[${values.map(sqlString).join(", ")}]`;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, normalizeValue(inner)])
    );
  }
  return value;
}

async function listEventFiles(): Promise<string[]> {
  try {
    const files = await walkFiles(getWorkspaceRoot());
    return files.filter((file) => file.endsWith(`${path.sep}events.jsonl`));
  } catch {
    return [];
  }
}

async function listRunFiles(): Promise<string[]> {
  try {
    const files = await walkFiles(getWorkspaceRoot());
    return files.filter((file) => path.basename(path.dirname(file)) === "runs" && file.endsWith(".json"));
  } catch {
    return [];
  }
}

async function queryWithView(
  viewName: "events" | "runs",
  files: string[],
  createViewSql: string,
  sql: string
): Promise<QueryRow[]> {
  if (files.length === 0) {
    return [];
  }

  const connection = await DuckDBConnection.create();

  try {
    await connection.run(createViewSql);
    const reader = await connection.runAndReadAll(sql);
    await reader.readAll();
    return reader.getRowObjectsJS().map((row) => normalizeValue(row) as QueryRow);
  } finally {
    connection.closeSync();
  }
}

export async function queryEvents(sql: string): Promise<QueryRow[]> {
  const files = await listEventFiles();
  return queryWithView(
    "events",
    files,
    `CREATE OR REPLACE TEMP VIEW events AS
     SELECT * FROM read_json_auto(${sqlList(files)}, format='newline_delimited', records=true, union_by_name=true)`,
    sql
  );
}

export async function queryRuns(sql: string): Promise<QueryRow[]> {
  const files = await listRunFiles();
  if (files.length === 0) {
    return [];
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "decision-engine-runs-"));
  const tempFile = path.join(tempDir, "runs.jsonl");

  try {
    const payload = await Promise.all(
      files.map(async (file) => JSON.stringify(JSON.parse(await readFile(file, "utf8"))))
    );
    await writeFile(tempFile, `${payload.join("\n")}\n`);

    return await queryWithView(
      "runs",
      [tempFile],
      `CREATE OR REPLACE TEMP VIEW runs AS
       SELECT * FROM read_json_auto(${sqlList([tempFile])}, format='newline_delimited', records=true, union_by_name=true)`,
      sql
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
