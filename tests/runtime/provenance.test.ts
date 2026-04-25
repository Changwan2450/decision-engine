import { describe, expect, it, vi } from "vitest";
import { collectRuntimeProvenance } from "@/lib/runtime/provenance";

describe("runtime provenance", () => {
  it("captures the current node version", () => {
    expect(collectRuntimeProvenance().nodeVersion).toBe(process.version);
  });

  it("captures process start time as a valid ISO string", () => {
    const provenance = collectRuntimeProvenance();
    const timestamp = Date.parse(provenance.processStartTime);

    expect(Number.isNaN(timestamp)).toBe(false);
    expect(new Date(timestamp).toISOString()).toBe(provenance.processStartTime);
  });

  it("captures entrypoint as a string or null", () => {
    const provenance = collectRuntimeProvenance();

    expect(
      typeof provenance.entrypoint === "string" || provenance.entrypoint === null
    ).toBe(true);
  });

  it("returns null gitHead when git lookup fails", async () => {
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        throw new Error("git unavailable");
      }
    }));

    const { collectRuntimeProvenance: collectWithGitFailure } = await import(
      "@/lib/runtime/provenance"
    );

    expect(collectWithGitFailure().gitHead).toBeNull();

    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
});
