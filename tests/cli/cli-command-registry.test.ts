import { describe, expect, it } from "vitest";
import {
  AI_FIRST_COMMANDS,
  formatUsage
} from "@/scripts/cli";

describe("cli command registry", () => {
  it("includes the AI-first command set", () => {
    expect(AI_FIRST_COMMANDS).toEqual([
      "create-project",
      "create-run",
      "run-research",
      "export-run-bundle",
      "export-linkit-ingest",
      "publish-linkit-batch",
      "send-discord-notifier",
      "execute-external",
      "ingest-advisory",
      "show-run",
      "show-project"
    ]);
  });

  it("documents the standard command names in usage text", () => {
    const usage = formatUsage();

    expect(usage).toContain("show-run");
    expect(usage).toContain("show-project");
    expect(usage).toContain("export-run-bundle");
    expect(usage).toContain("export-linkit-ingest");
    expect(usage).toContain("publish-linkit-batch");
    expect(usage).toContain("send-discord-notifier");
    expect(usage).not.toContain("show-run-state");
  });
});
