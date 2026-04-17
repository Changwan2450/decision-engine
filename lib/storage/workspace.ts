import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { createProject, type Project } from "@/lib/domain/projects";
import { createRun, type Run } from "@/lib/domain/runs";
import {
  digestSchema,
  inboxItemSchema,
  projectRecordSchema,
  runRecordSchema,
  watchTargetSchema,
  type DigestRecord,
  type InboxItemRecord,
  type ProjectRecord,
  type RunRecord,
  type WatchTargetRecord
} from "@/lib/storage/schema";

function projectDir(projectId: string): string {
  return path.join(WORKSPACE_ROOT, projectId);
}

function projectFile(projectId: string): string {
  return path.join(projectDir(projectId), "project.json");
}

function runsDir(projectId: string): string {
  return path.join(projectDir(projectId), "runs");
}

function runFile(projectId: string, runId: string): string {
  return path.join(runsDir(projectId), `${runId}.json`);
}

function watchTargetsDir(projectId: string): string {
  return path.join(projectDir(projectId), "watch-targets");
}

function watchTargetFile(projectId: string, watchTargetId: string): string {
  return path.join(watchTargetsDir(projectId), `${watchTargetId}.json`);
}

function digestsDir(projectId: string): string {
  return path.join(projectDir(projectId), "digests");
}

function digestFile(projectId: string, digestId: string): string {
  return path.join(digestsDir(projectId), `${digestId}.json`);
}

function inboxDir(projectId: string): string {
  return path.join(projectDir(projectId), "inbox");
}

function inboxFile(projectId: string, itemId: string): string {
  return path.join(inboxDir(projectId), `${itemId}.json`);
}

async function readJsonFile<T>(filePath: string, schema: { parse: (value: unknown) => T }): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

export async function saveProjectRecord(record: ProjectRecord): Promise<void> {
  await writeJsonFile(projectFile(record.project.id), projectRecordSchema.parse(record));
}

export async function readProjectRecord(projectId: string): Promise<ProjectRecord> {
  return readJsonFile(projectFile(projectId), projectRecordSchema);
}

export async function saveRunRecord(record: RunRecord): Promise<void> {
  await writeJsonFile(runFile(record.run.projectId, record.run.id), runRecordSchema.parse(record));
}

export async function readRunRecord(projectId: string, runId: string): Promise<RunRecord> {
  return readJsonFile(runFile(projectId, runId), runRecordSchema);
}

export async function saveWatchTargetRecord(record: WatchTargetRecord): Promise<void> {
  await writeJsonFile(
    watchTargetFile(record.projectId, record.id),
    watchTargetSchema.parse(record)
  );
}

export async function readWatchTargetRecord(
  projectId: string,
  watchTargetId: string
): Promise<WatchTargetRecord> {
  return readJsonFile(watchTargetFile(projectId, watchTargetId), watchTargetSchema);
}

export async function updateWatchTargetRecord(
  projectId: string,
  watchTargetId: string,
  mutate: (record: WatchTargetRecord) => WatchTargetRecord
): Promise<WatchTargetRecord> {
  const current = await readWatchTargetRecord(projectId, watchTargetId);
  const next = watchTargetSchema.parse(mutate(current));
  await saveWatchTargetRecord(next);
  return next;
}

export async function saveDigestRecord(record: DigestRecord): Promise<void> {
  await writeJsonFile(digestFile(record.projectId, record.id), digestSchema.parse(record));
}

export async function readDigestRecord(
  projectId: string,
  digestId: string
): Promise<DigestRecord> {
  return readJsonFile(digestFile(projectId, digestId), digestSchema);
}

export async function saveInboxItemRecord(record: InboxItemRecord): Promise<void> {
  await writeJsonFile(inboxFile(record.projectId, record.id), inboxItemSchema.parse(record));
}

export async function readInboxItemRecord(
  projectId: string,
  itemId: string
): Promise<InboxItemRecord> {
  return readJsonFile(inboxFile(projectId, itemId), inboxItemSchema);
}

export async function updateInboxItemRecord(
  projectId: string,
  itemId: string,
  mutate: (record: InboxItemRecord) => InboxItemRecord
): Promise<InboxItemRecord> {
  const current = await readInboxItemRecord(projectId, itemId);
  const next = inboxItemSchema.parse(mutate(current));
  await saveInboxItemRecord(next);
  return next;
}

export async function updateRunRecord(
  projectId: string,
  runId: string,
  mutate: (record: RunRecord) => RunRecord
): Promise<RunRecord> {
  const current = await readRunRecord(projectId, runId);
  const next = runRecordSchema.parse(mutate(current));
  await saveRunRecord(next);
  return next;
}

export async function updateProjectRecord(
  projectId: string,
  mutate: (record: ProjectRecord) => ProjectRecord
): Promise<ProjectRecord> {
  const current = await readProjectRecord(projectId);
  const next = projectRecordSchema.parse(mutate(current));
  await saveProjectRecord(next);
  return next;
}

export async function bootstrapWorkspace(project: Project, run?: Run): Promise<void> {
  await saveProjectRecord({
    project,
    insights: {
      repeatedProblems: [],
      repeatedPatterns: [],
      competitorSignals: [],
      contradictionIds: []
    },
    promotionCandidates: []
  });

  if (run) {
    await saveRunRecord({
      run,
      normalizedInput: null,
      kbContext: null,
      decision: null,
      prdSeed: null,
      artifacts: [],
      claims: [],
      citations: [],
      contradictions: [],
      evidenceSummary: null,
      advisory: null
    });
  }
}

export async function listProjectRecords(): Promise<ProjectRecord[]> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readProjectRecord(entry.name))
  );

  return records.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

export async function createProjectRecord(input: {
  name: string;
  description: string;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const record: ProjectRecord = {
    project: createProject({
      id: randomUUID(),
      name: input.name,
      description: input.description,
      now
    }),
    insights: {
      repeatedProblems: [],
      repeatedPatterns: [],
      competitorSignals: [],
      contradictionIds: []
    },
    promotionCandidates: []
  };

  await saveProjectRecord(record);
  return record;
}

export async function listRunRecords(projectId: string): Promise<RunRecord[]> {
  await mkdir(runsDir(projectId), { recursive: true });
  const entries = await readdir(runsDir(projectId), { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readRunRecord(projectId, entry.name.replace(/\.json$/, "")))
  );

  return records.sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt));
}

export async function listDigestRecords(projectId: string): Promise<DigestRecord[]> {
  await mkdir(digestsDir(projectId), { recursive: true });
  const entries = await readdir(digestsDir(projectId), { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readDigestRecord(projectId, entry.name.replace(/\.json$/, "")))
  );

  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listInboxItemRecords(projectId: string): Promise<InboxItemRecord[]> {
  await mkdir(inboxDir(projectId), { recursive: true });
  const entries = await readdir(inboxDir(projectId), { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readInboxItemRecord(projectId, entry.name.replace(/\.json$/, "")))
  );

  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findRunRecordById(
  runId: string
): Promise<{ projectId: string; record: RunRecord } | null> {
  const projects = await listProjectRecords();

  for (const project of projects) {
    const runs = await listRunRecords(project.project.id);
    const match = runs.find((record) => record.run.id === runId);
    if (match) {
      return {
        projectId: project.project.id,
        record: match
      };
    }
  }

  return null;
}

export async function createRunRecord(
  projectId: string,
  input: {
    title: string;
    naturalLanguage?: string;
    pastedContent?: string;
    urls?: string[];
  }
): Promise<RunRecord> {
  const now = new Date().toISOString();
  const record: RunRecord = {
    run: createRun({
      id: randomUUID(),
      projectId,
      title: input.title,
      naturalLanguage: input.naturalLanguage,
      pastedContent: input.pastedContent,
      urls: input.urls,
      now
    }),
    normalizedInput: null,
    kbContext: null,
    decision: null,
    prdSeed: null,
    artifacts: [],
    claims: [],
    citations: [],
    contradictions: [],
    evidenceSummary: null,
    advisory: null
  };

  await saveRunRecord(record);
  return record;
}

export async function createWatchTargetRecord(
  projectId: string,
  input: {
    title: string;
    naturalLanguage?: string;
    urls?: string[];
  }
): Promise<WatchTargetRecord> {
  const now = new Date().toISOString();
  const record: WatchTargetRecord = watchTargetSchema.parse({
    id: randomUUID(),
    projectId,
    title: input.title,
    query: {
      naturalLanguage: input.naturalLanguage,
      urls: input.urls ?? []
    },
    sourceFilter: {},
    delivery: {
      digest: true,
      alert: false,
      inbox: true
    },
    tags: [],
    status: "draft",
    createdAt: now,
    updatedAt: now
  });

  await saveWatchTargetRecord(record);
  return record;
}
