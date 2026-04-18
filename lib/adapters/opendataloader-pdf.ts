import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { convert } from "@opendataloader/pdf";

import {
  buildArtifact,
  buildFailureArtifact,
  deriveTitleFromUrl,
  type FetchOutcome
} from "@/lib/adapters/contract";
import { canonicalize, hostnameOf } from "@/lib/adapters/url";
import type { ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { storeRawPayload } from "@/lib/normalize/raw-store";

const ADAPTER_NAME = "opendataloader-pdf";
const FETCHER_NAME = "opendataloader-pdf";

type DownloadResult = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  contentType: string | null;
  body?: Buffer;
};

export type PdfDownloader = (url: string) => Promise<DownloadResult>;
export type OpenDataLoaderExecutor = (input: {
  inputPath: string;
  outputDir: string;
}) => Promise<void>;

export function createOpenDataLoaderPdfAdapter(deps?: {
  now?: () => string;
  download?: PdfDownloader;
  exec?: OpenDataLoaderExecutor;
  storeRaw?: typeof storeRawPayload;
  tempRoot?: string;
}): ResearchAdapter {
  const now = deps?.now ?? (() => new Date().toISOString());
  const download = deps?.download ?? defaultDownloader;
  const exec = deps?.exec ?? defaultExecutor;
  const storeRaw = deps?.storeRaw ?? storeRawPayload;
  const tempRoot = deps?.tempRoot ?? os.tmpdir();

  return {
    name: ADAPTER_NAME,
    supports(plan: ResearchPlan): boolean {
      return plan.normalizedInput.urls.some(isPdfLikeUrl);
    },
    async execute(plan: ResearchPlan): Promise<SourceArtifact[]> {
      const artifacts: SourceArtifact[] = [];

      for (const originalUrl of plan.normalizedInput.urls.filter(isPdfLikeUrl)) {
        const retrievedAt = now();
        let tempDir: string | null = null;

        try {
          const downloadUrl = resolvePdfUrl(originalUrl);
          const downloaded = await download(downloadUrl);
          if (!downloaded.ok || !downloaded.body) {
            artifacts.push(
              buildFailureArtifact({
                id: `${ADAPTER_NAME}-${artifacts.length}`,
                adapter: ADAPTER_NAME,
                fetcher: FETCHER_NAME,
                url: originalUrl,
                sourceType: "pdf",
                outcome: outcomeFromStatus(downloaded.status),
                errorMessage: `${downloaded.status} ${downloaded.statusText}`.trim(),
                sourceLabel: "pdf/error",
                retrievedAt
              })
            );
            continue;
          }

          const rawRef = await storeRaw({
            projectId: plan.projectId,
            runId: plan.runId,
            adapter: ADAPTER_NAME,
            format: "pdf",
            payload: downloaded.body
          });

          tempDir = await mkdtemp(path.join(tempRoot, "opendataloader-pdf-"));
          const inputPath = path.join(tempDir, "input.pdf");
          const outputDir = path.join(tempDir, "output");
          await writeFile(inputPath, downloaded.body);

          await exec({ inputPath, outputDir });

          const output = await readOutputFiles(outputDir);
          const bboxRef = output.json
            ? await storeRaw({
                projectId: plan.projectId,
                runId: plan.runId,
                adapter: ADAPTER_NAME,
                format: "json",
                payload: output.json
              })
            : undefined;

          const markdown = output.markdown.trim();
          const snippet = markdown.replace(/\s+/g, " ").slice(0, 240);
          const outcome: FetchOutcome = {
            status: markdown.length > 0 ? "success" : "partial",
            blockReason: "unknown",
            bypassLevel: "none",
            loginRequired: false
          };

          artifacts.push(
            buildArtifact({
              id: `${ADAPTER_NAME}-${artifacts.length}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              sourceType: "pdf",
              url: originalUrl,
              canonicalUrl: canonicalize(downloaded.url) || undefined,
              title: deriveTitleFromUrl(downloaded.url),
              snippet,
              content: markdown,
              retrievedAt,
              rawRef,
              outcome,
              sourceLabel: isArxivHost(hostnameOf(originalUrl))
                ? "pdf/arxiv"
                : "pdf/generic",
              rateLimitBucket: "opendataloader-pdf/local",
              extra: {
                content_type: downloaded.contentType ?? undefined,
                bbox_ref: bboxRef,
                ocr: "no"
              }
            })
          );
        } catch (error) {
          artifacts.push(
            buildFailureArtifact({
              id: `${ADAPTER_NAME}-${artifacts.length}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url: originalUrl,
              sourceType: "pdf",
              outcome: { status: "error" },
              errorMessage: error instanceof Error ? error.message : String(error),
              sourceLabel: "pdf/error",
              retrievedAt
            })
          );
        } finally {
          if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
          }
        }
      }

      return artifacts;
    }
  };
}

async function defaultDownloader(url: string): Promise<DownloadResult> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "DecisionEngine/0.1 (+pdf-fetch)"
    },
    redirect: "follow"
  });

  const contentType = response.headers.get("content-type");
  const body = response.ok ? Buffer.from(await response.arrayBuffer()) : undefined;

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url || url,
    contentType,
    body
  };
}

async function defaultExecutor(input: {
  inputPath: string;
  outputDir: string;
}): Promise<void> {
  await convert(input.inputPath, {
    outputDir: input.outputDir,
    format: "markdown,json",
    quiet: true
  });
}

async function readOutputFiles(outputDir: string): Promise<{
  markdown: string;
  json: string | null;
}> {
  const entries = await readdir(outputDir);
  const markdownFile = entries.find((name) => name.endsWith(".md"));
  if (!markdownFile) {
    throw new Error("opendataloader-pdf produced no markdown output");
  }

  const jsonFile = entries.find((name) => name.endsWith(".json"));

  const markdown = await readFile(path.join(outputDir, markdownFile), "utf8");
  const json = jsonFile
    ? await readFile(path.join(outputDir, jsonFile), "utf8")
    : null;

  return { markdown, json };
}

function isPdfLikeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/\.pdf(?:$|[?#/])/i.test(parsed.pathname)) return true;
    if (hostnameOf(url) === "arxiv.org" || hostnameOf(url) === "www.arxiv.org") {
      return /^\/(abs|pdf)\//i.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function resolvePdfUrl(url: string): string {
  const parsed = new URL(url);
  const host = hostnameOf(url);
  if (isArxivHost(host) && parsed.pathname.startsWith("/abs/")) {
    const paperId = parsed.pathname.replace(/^\/abs\//, "");
    return `https://arxiv.org/pdf/${paperId}.pdf`;
  }
  return url;
}

function isArxivHost(host: string | null): boolean {
  return host === "arxiv.org" || host === "www.arxiv.org";
}

function outcomeFromStatus(status: number): FetchOutcome {
  if (status === 401) {
    return {
      status: "blocked",
      blockReason: "login",
      bypassLevel: "none",
      loginRequired: true
    };
  }
  if (status === 403) {
    return {
      status: "blocked",
      blockReason: "unknown",
      bypassLevel: "none",
      loginRequired: false
    };
  }
  if (status === 429) {
    return {
      status: "blocked",
      blockReason: "ratelimit",
      bypassLevel: "none",
      loginRequired: false
    };
  }
  return {
    status: "error",
    blockReason: "unknown",
    bypassLevel: "none",
    loginRequired: false
  };
}
