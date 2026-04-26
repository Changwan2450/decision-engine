import { describe, expect, it } from "vitest";

import { assertMetadataContract } from "@/lib/adapters/contract";
import { createOpenDataLoaderPdfAdapter } from "@/lib/adapters/opendataloader-pdf";
import { sourceArtifactSchema } from "@/lib/domain/claims";
import type { ResearchPlan } from "@/lib/adapters/types";

function makePlan(urls: string[]): ResearchPlan {
  return {
    projectId: "p",
    runId: "r",
    title: "pdf run",
    mode: "standard",
    normalizedInput: {
      title: "pdf run",
      naturalLanguage: "",
      pastedContent: "",
      urls,
      goal: "",
      target: "",
      comparisonAxis: ""
    },
    sourceTargets: ["pdf"],
    kbContext: null
  };
}

function fixedNow(): string {
  return "2026-04-18T00:00:00.000Z";
}

describe("createOpenDataLoaderPdfAdapter() — supports()", () => {
  it("supports direct pdf URLs", () => {
    const adapter = createOpenDataLoaderPdfAdapter({ now: fixedNow });
    expect(adapter.supports(makePlan(["https://example.com/file.pdf"]))).toBe(true);
  });

  it("supports arxiv abstract URLs", () => {
    const adapter = createOpenDataLoaderPdfAdapter({ now: fixedNow });
    expect(adapter.supports(makePlan(["https://arxiv.org/abs/2401.00001"]))).toBe(true);
  });

  it("returns false for non-pdf URLs", () => {
    const adapter = createOpenDataLoaderPdfAdapter({ now: fixedNow });
    expect(adapter.supports(makePlan(["https://example.com/article"]))).toBe(false);
  });
});

describe("createOpenDataLoaderPdfAdapter() — execute()", () => {
  it("downloads, stores raw PDF and bbox JSON, then returns markdown artifact", async () => {
    const stored: Array<{ format: string; payload: string | Buffer }> = [];
    const adapter = createOpenDataLoaderPdfAdapter({
      now: fixedNow,
      download: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-fake")
      }),
      exec: async ({ outputDir }) => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(
          path.join(outputDir, "input.md"),
          "# Paper title\n\nFirst paragraph."
        );
        await fs.writeFile(
          path.join(outputDir, "input.json"),
          JSON.stringify({ pages: 2, elements: [{ type: "paragraph" }] })
        );
      },
      storeRaw: async ({ format, payload }) => {
        stored.push({ format, payload });
        return `p/runs/r/raw/opendataloader-pdf/fake.${format}`;
      }
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://arxiv.org/abs/2401.00001"])
    );

    expect(artifact.adapter).toBe("opendataloader-pdf");
    expect(artifact.sourceType).toBe("pdf");
    expect(artifact.url).toBe("https://arxiv.org/abs/2401.00001");
    expect(artifact.canonicalUrl).toBe("https://arxiv.org/pdf/2401.00001.pdf");
    expect(artifact.sourcePriority).toBe("primary_data");
    expect(artifact.content).toBe("# Paper title\n\nFirst paragraph.");
    expect(artifact.rawRef).toBe("p/runs/r/raw/opendataloader-pdf/fake.pdf");
    expect(artifact.metadata.fetcher).toBe("opendataloader-pdf");
    expect(artifact.metadata.fetch_status).toBe("success");
    expect(artifact.metadata.source_label).toBe("pdf/arxiv");
    expect(artifact.metadata.bbox_ref).toBe(
      "p/runs/r/raw/opendataloader-pdf/fake.json"
    );
    expect(artifact.metadata.content_type).toBe("application/pdf");
    expect(artifact.retrievedAt).toBe(fixedNow());

    expect(stored).toHaveLength(2);
    expect(stored[0]?.format).toBe("pdf");
    expect(stored[1]?.format).toBe("json");

    assertMetadataContract(artifact.metadata);
    expect(sourceArtifactSchema.parse(artifact)).toBeTruthy();
  });

  it("marks official PDF hosts with official sourcePriority", async () => {
    const adapter = createOpenDataLoaderPdfAdapter({
      now: fixedNow,
      download: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-fake")
      }),
      exec: async ({ outputDir }) => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(path.join(outputDir, "input.md"), "Official PDF");
      },
      storeRaw: async ({ format }) => `p/runs/r/raw/opendataloader-pdf/official.${format}`
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.anthropic.com/research/report.pdf"])
    );

    expect(artifact.sourcePriority).toBe("official");
    expect(artifact.metadata.source_label).toBe("pdf/generic");
    assertMetadataContract(artifact.metadata);
    expect(sourceArtifactSchema.parse(artifact)).toBeTruthy();
  });

  it("keeps unknown PDF hosts as analysis sourcePriority", async () => {
    const adapter = createOpenDataLoaderPdfAdapter({
      now: fixedNow,
      download: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-fake")
      }),
      exec: async ({ outputDir }) => {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(path.join(outputDir, "input.md"), "Unknown PDF");
      },
      storeRaw: async ({ format }) => `p/runs/r/raw/opendataloader-pdf/unknown.${format}`
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://example.com/report.pdf"])
    );

    expect(artifact.sourcePriority).toBe("analysis");
    expect(artifact.metadata.source_label).toBe("pdf/generic");
    assertMetadataContract(artifact.metadata);
    expect(sourceArtifactSchema.parse(artifact)).toBeTruthy();
  });

  it("returns blocked artifact when the PDF requires login", async () => {
    const adapter = createOpenDataLoaderPdfAdapter({
      now: fixedNow,
      download: async (url) => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        url,
        contentType: "application/pdf"
      })
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://example.com/locked.pdf"])
    );

    expect(artifact.metadata.fetch_status).toBe("blocked");
    expect(artifact.metadata.block_reason).toBe("login");
    expect(artifact.metadata.login_required).toBe("true");
    assertMetadataContract(artifact.metadata);
  });

  it("returns error artifact when conversion fails", async () => {
    const adapter = createOpenDataLoaderPdfAdapter({
      now: fixedNow,
      download: async (url) => ({
        ok: true,
        status: 200,
        statusText: "OK",
        url,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-fake")
      }),
      exec: async () => {
        throw new Error("java not available");
      },
      storeRaw: async () => "p/runs/r/raw/opendataloader-pdf/fake.pdf"
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://example.com/fail.pdf"])
    );

    expect(artifact.metadata.fetch_status).toBe("error");
    expect(artifact.metadata.error).toContain("java not available");
    assertMetadataContract(artifact.metadata);
  });
});
