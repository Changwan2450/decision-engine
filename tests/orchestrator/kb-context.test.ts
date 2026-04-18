import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQmdClientForTests,
  setQmdRunnerForTests
} from "@/lib/orchestrator/kb-context";

describe("kb-context qmd fallback", () => {
  afterEach(() => {
    setQmdRunnerForTests(null);
    vi.restoreAllMocks();
  });

  it("uses multi-get json directly when qmd returns valid json", async () => {
    const getCalls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setQmdRunnerForTests(async (args) => {
      if (args[0] === "query") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic"
          }
        ]);
      }

      if (args[0] === "multi-get") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic",
            body: [
              "# Example Topic",
              "",
              "## Summary",
              "",
              "valid summary",
              "",
              "## Reusable Claims",
              "",
              "- valid claim"
            ].join("\n")
          }
        ]);
      }

      if (args[0] === "get") {
        getCalls.push(args[1] ?? "");
      }

      throw new Error(`unexpected qmd args: ${args.join(" ")}`);
    });

    const client = createQmdClientForTests("/tmp");
    const notes = await client.queryNotes("example search");

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Example Topic",
      summary: "valid summary"
    });
    expect(getCalls).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to per-file get and warns when multi-get json is malformed", async () => {
    const getCalls: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    setQmdRunnerForTests(async (args) => {
      if (args[0] === "query") {
        return JSON.stringify([
          {
            file: "qmd://wiki/topics/example-topic.md",
            title: "Example Topic"
          }
        ]);
      }

      if (args[0] === "multi-get") {
        return '[{"file":"qmd://wiki/topics/example-topic.md","body":"# Example Topic';
      }

      if (args[0] === "get") {
        getCalls.push(args[1] ?? "");
        return [
          "# Example Topic",
          "",
          "## Summary",
          "",
          "fallback summary",
          "",
          "## Reusable Claims",
          "",
          "- fallback claim"
        ].join("\n");
      }

      throw new Error(`unexpected qmd args: ${args.join(" ")}`);
    });

    const client = createQmdClientForTests("/tmp");
    const notes = await client.queryNotes("example search");

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      title: "Example Topic",
      summary: "fallback summary"
    });
    expect(getCalls).toEqual(["qmd://wiki/topics/example-topic.md"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("qmd multi-get JSON parse failed");
  });
});
