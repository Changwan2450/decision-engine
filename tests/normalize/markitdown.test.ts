import { describe, expect, it } from "vitest";
import { normalizeToMarkdown } from "@/lib/normalize/markitdown";

describe("normalizeToMarkdown()", () => {
  it("converts fixed HTML into deterministic markdown", async () => {
    const html = [
      "<html>",
      "<body>",
      "<h1>Hello &amp; World</h1>",
      "<p>First <strong>paragraph</strong> with <a href=\"https://example.com\">link</a>.</p>",
      "<ul><li>One</li><li>Two</li></ul>",
      "<p>Line 1<br/>Line 2</p>",
      "</body>",
      "</html>"
    ].join("");

    await expect(
      normalizeToMarkdown({
        format: "html",
        payload: html
      })
    ).resolves.toBe(
      [
        "# Hello & World",
        "",
        "First paragraph with [link](https://example.com).",
        "",
        "- One",
        "- Two",
        "",
        "Line 1",
        "Line 2"
      ].join("\n")
    );
  });

  it("normalizes plain text without adding markdown noise", async () => {
    await expect(
      normalizeToMarkdown({
        format: "text",
        payload: "alpha\r\n\r\nbeta  \n\n"
      })
    ).resolves.toBe("alpha\n\nbeta");
  });

  it("delegates pdf conversion to the injected executor", async () => {
    const calls: Array<{ format: string; payload: Buffer }> = [];

    await expect(
      normalizeToMarkdown(
        {
          format: "pdf",
          payload: Buffer.from("fake-pdf")
        },
        {
          exec: async (input) => {
            calls.push({ format: input.format, payload: Buffer.from(input.payload) });
            return "# PDF";
          }
        }
      )
    ).resolves.toBe("# PDF");

    expect(calls).toHaveLength(1);
    expect(calls[0].format).toBe("pdf");
    expect(calls[0].payload.toString("utf8")).toBe("fake-pdf");
  });
});
