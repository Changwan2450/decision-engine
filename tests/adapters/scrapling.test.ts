import { describe, expect, it } from "vitest";
import {
  createCliExecutor,
  createScraplingAdapter,
  type ScraplingExecutor
} from "@/lib/adapters/scrapling";
import { assertMetadataContract } from "@/lib/adapters/contract";
import { sourceArtifactSchema } from "@/lib/domain/claims";
import type { ResearchPlan } from "@/lib/adapters/types";

function makePlan(
  urls: string[],
  extras?: Partial<Pick<ResearchPlan, "sourceTargets">>
): ResearchPlan {
  return {
    projectId: "p",
    runId: "r",
    title: "t",
    mode: "standard",
    normalizedInput: {
      title: "t",
      naturalLanguage: "",
      pastedContent: "",
      urls,
      goal: "",
      target: "",
      comparisonAxis: ""
    },
    sourceTargets: extras?.sourceTargets ?? ["web"],
    kbContext: null
  };
}

function fixedNow(): string {
  return "2026-04-17T00:00:00.000Z";
}

function makeExec(response: Record<string, unknown>): ScraplingExecutor {
  return async () => ({
    stdout: JSON.stringify(response),
    stderr: "",
    exitCode: 0
  });
}

describe("createScraplingAdapter() — supports()", () => {
  it("supports plans with web target and at least one URL", () => {
    const adapter = createScraplingAdapter({ now: fixedNow });
    expect(adapter.supports(makePlan(["https://example.com"]))).toBe(true);
  });

  it("supports plans with community target", () => {
    const adapter = createScraplingAdapter({ now: fixedNow });
    expect(
      adapter.supports(
        makePlan(["https://reddit.com/r/foo"], { sourceTargets: ["community"] })
      )
    ).toBe(true);
  });

  it("returns false when no URLs are present", () => {
    const adapter = createScraplingAdapter({ now: fixedNow });
    expect(adapter.supports(makePlan([]))).toBe(false);
  });

  it("returns false when targets do not include web or community", () => {
    const adapter = createScraplingAdapter({ now: fixedNow });
    expect(
      adapter.supports(
        makePlan(["https://example.com"], { sourceTargets: ["video"] })
      )
    ).toBe(false);
  });
});

describe("createScraplingAdapter() — success path", () => {
  it("stores the raw payload and writes normalized markdown into content", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        title: "Hello world",
        html: "<h1>Hello world</h1><p>Page body text here.</p>"
      }),
      normalize: async ({ format, payload }) => {
        expect(format).toBe("html");
        expect(payload).toContain("<h1>Hello world</h1>");
        return "# Hello world\n\nPage body text here.";
      },
      storeRaw: async ({ projectId, runId, adapter, format, payload }) => {
        expect(projectId).toBe("p");
        expect(runId).toBe("r");
        expect(adapter).toBe("scrapling");
        expect(format).toBe("html");
        expect(payload).toContain("Page body text here.");
        return "p/runs/r/raw/scrapling/fake.html";
      }
    });

    const [a] = await adapter.execute(makePlan(["https://example.com/a"]));
    expect(a.content).toBe("# Hello world\n\nPage body text here.");
    expect(a.rawRef).toBe("p/runs/r/raw/scrapling/fake.html");
  });

  it("returns a success artifact with full metadata contract", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        title: "Hello world",
        text: "Page body text here.",
        snippet: "Page body...",
        language: "en",
        published_at: "2026-04-01T10:00:00.000Z",
        bypass_level: "headers",
        login_required: false
      }),
      normalize: async () => "Page body text here.",
      storeRaw: async () => "p/runs/r/raw/scrapling/fake.txt"
    });

    const [a] = await adapter.execute(makePlan(["https://example.com/a"]));
    expect(a).toBeDefined();
    expect(a.adapter).toBe("scrapling");
    expect(a.id).toMatch(/^scrapling-[a-f0-9]{8}$/);
    expect(a.sourceType).toBe("web");
    expect(a.title).toBe("Hello world");
    expect(a.content).toBe("Page body text here.");
    expect(a.url).toBe("https://example.com/a");
    expect(a.canonicalUrl).toBe("https://example.com/a");
    expect(a.retrievedAt).toBe(fixedNow());
    expect(a.publishedAt).toBe("2026-04-01T10:00:00.000Z");
    expect(a.language).toBe("en");
    expect(typeof a.confidence).toBe("number");
    expect(a.rawRef).toBe("p/runs/r/raw/scrapling/fake.txt");

    expect(a.metadata.fetcher).toBe("scrapling");
    expect(a.metadata.fetch_status).toBe("success");
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("headers");
    expect(a.metadata.login_required).toBe("false");
    expect(a.metadata.source_label).toBe("web/success");
    expect(a.metadata.rate_limit_bucket).toBe("scrapling/stealth");

    assertMetadataContract(a.metadata);
    expect(sourceArtifactSchema.parse(a)).toBeTruthy();
  });

  it("tags community URLs with sourceType=community", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "success", title: "t", text: "body" }),
      normalize: async () => "body",
      storeRaw: async () => "p/runs/r/raw/scrapling/community.txt"
    });

    const [a] = await adapter.execute(
      makePlan(["https://www.reddit.com/r/foo/comments/xyz"], {
        sourceTargets: ["community"]
      })
    );
    expect(a.sourceType).toBe("community");
    expect(a.metadata.source_label).toBe("community/success");
  });

  it("marks official docs hosts with official sourcePriority", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "success", title: "t", text: "body" }),
      normalize: async () => "body",
      storeRaw: async () => "p/runs/r/raw/scrapling/postgres.txt"
    });

    const [a] = await adapter.execute(
      makePlan(["https://www.postgresql.org/docs/current/ddl-rowsecurity.html"])
    );
    expect(a.sourcePriority).toBe("official");
  });

  it("uses distinct artifact ids for different urls in the same run", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "success", title: "t", text: "body" }),
      normalize: async () => "body",
      storeRaw: async () => "p/runs/r/raw/scrapling/fake.txt"
    });

    const [a] = await adapter.execute(makePlan(["https://example.com/a"]));
    const [b] = await adapter.execute(makePlan(["https://example.com/b"]));

    expect(a.id).not.toBe(b.id);
  });

  it("tags Korean community hosts as community", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "success", title: "t", text: "body" }),
      normalize: async () => "body",
      storeRaw: async () => "p/runs/r/raw/scrapling/korean.txt"
    });

    const [a] = await adapter.execute(
      makePlan(["https://gall.dcinside.com/board/view/?id=x"], {
        sourceTargets: ["community"]
      })
    );
    expect(a.sourceType).toBe("community");
  });

  it("downgrades success with no body to partial", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "success", title: "t" })
    });
    const [a] = await adapter.execute(makePlan(["https://example.com/empty"]));
    expect(a.metadata.fetch_status).toBe("partial");
  });
});

describe("createScraplingAdapter() — blocked path", () => {
  it("carries block_reason and bypass_level through to metadata", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "blocked",
        block_reason: "turnstile",
        bypass_level: "turnstile",
        login_required: false
      })
    });

    const [a] = await adapter.execute(makePlan(["https://protected.example/x"]));
    expect(a.metadata.fetch_status).toBe("blocked");
    expect(a.metadata.block_reason).toBe("turnstile");
    expect(a.metadata.bypass_level).toBe("turnstile");
    expect(a.metadata.login_required).toBe("false");
    expect(a.content).toBe("");
    assertMetadataContract(a.metadata);
  });

  it("carries login_required=true when the wire says so", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "blocked",
        block_reason: "login",
        login_required: true
      })
    });
    const [a] = await adapter.execute(makePlan(["https://login.example/x"]));
    expect(a.metadata.login_required).toBe("true");
    expect(a.metadata.block_reason).toBe("login");
  });

  it("suppresses s.jina.ai 401 JSON content", async () => {
    const payload = JSON.stringify({
      data: null,
      code: 401,
      name: "AuthenticationRequiredError",
      status: 40103,
      message: "Authentication is required..."
    });
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        html: `<html><body>${payload}</body></html>`
      }),
      normalize: async () => {
        throw new Error("normalize should not run");
      },
      storeRaw: async () => {
        throw new Error("storeRaw should not run");
      }
    });

    const [a] = await adapter.execute(makePlan(["https://s.jina.ai/?q=test"]));
    expect(a.metadata.fetch_status).toBe("blocked");
    expect(a.metadata.block_reason).toBe("login");
    expect(a.metadata.login_required).toBe("true");
    expect(a.content).toBe("");
    expect(a.rawRef).toBeUndefined();
    expect(a.metadata.error).toContain("authentication required");
  });

  it("passes through s.jina.ai JSON when no auth error code is present", async () => {
    const payload = JSON.stringify({
      data: [{ title: "rust" }],
      message: "ok"
    });
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        html: `<html><body>${payload}</body></html>`
      }),
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/scrapling/jina.json"
    });

    const [a] = await adapter.execute(makePlan(["https://s.jina.ai/?q=test"]));
    expect(a.metadata.fetch_status).toBe("success");
    expect(a.content).toContain("\"message\":\"ok\"");
    expect(a.rawRef).toBe("p/runs/r/raw/scrapling/jina.json");
  });

  it("does not suppress non-jina hosts with similar JSON", async () => {
    const payload = JSON.stringify({
      code: 401,
      message: "normal api response"
    });
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        html: `<html><body>${payload}</body></html>`
      }),
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/scrapling/api.json"
    });

    const [a] = await adapter.execute(makePlan(["https://example.com/api"]));
    expect(a.metadata.fetch_status).toBe("success");
    expect(a.content).toContain("\"code\":401");
    expect(a.rawRef).toBe("p/runs/r/raw/scrapling/api.json");
  });

  it("suppresses s.jina.ai 401 raw JSON without an HTML wrapper", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "success",
        html: JSON.stringify({
          data: null,
          code: 401,
          message: "Authentication is required..."
        })
      }),
      normalize: async () => {
        throw new Error("normalize should not run");
      },
      storeRaw: async () => {
        throw new Error("storeRaw should not run");
      }
    });

    const [a] = await adapter.execute(makePlan(["https://s.jina.ai/?q=test"]));
    expect(a.metadata.fetch_status).toBe("blocked");
    expect(a.content).toBe("");
    expect(a.rawRef).toBeUndefined();
  });
});

describe("createScraplingAdapter() — timeout / error paths", () => {
  it("maps executor timedOut=true to fetch_status=timeout", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async () => ({
        stdout: "",
        stderr: "deadline exceeded",
        exitCode: 124,
        timedOut: true
      })
    });
    const [a] = await adapter.execute(makePlan(["https://slow.example/x"]));
    expect(a.metadata.fetch_status).toBe("timeout");
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("none");
    expect(a.metadata.login_required).toBe("false");
    expect(a.metadata.error).toContain("deadline");
    assertMetadataContract(a.metadata);
  });

  it("maps non-zero exit code to fetch_status=error", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async () => ({
        stdout: "",
        stderr: "boom",
        exitCode: 2
      })
    });
    const [a] = await adapter.execute(makePlan(["https://broken.example/x"]));
    expect(a.metadata.fetch_status).toBe("error");
    expect(a.metadata.error).toContain("boom");
    assertMetadataContract(a.metadata);
  });

  it("absorbs thrown executor exceptions into an error artifact", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async () => {
        throw new Error("ECONNREFUSED");
      }
    });
    const result = await adapter.execute(makePlan(["https://unreachable.example"]));
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("error");
    expect(result[0].metadata.error).toContain("ECONNREFUSED");
    assertMetadataContract(result[0].metadata);
  });

  it("absorbs unparseable JSON into an error artifact", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async () => ({
        stdout: "<<<not json>>>",
        stderr: "",
        exitCode: 0
      })
    });
    const [a] = await adapter.execute(makePlan(["https://example.com/bad"]));
    expect(a.metadata.fetch_status).toBe("error");
    expect(a.metadata.error).toContain("parse");
    assertMetadataContract(a.metadata);
  });

  it("default (unconfigured) executor never throws — always returns error artifacts", async () => {
    const adapter = createScraplingAdapter({ now: fixedNow });
    const result = await adapter.execute(makePlan(["https://example.com/a"]));
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("error");
    expect(result[0].metadata.error).toContain("not configured");
    assertMetadataContract(result[0].metadata);
  });

  it("coerces unknown wire status values to error", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({ status: "WEIRD", text: "body" })
    });
    const [a] = await adapter.execute(makePlan(["https://example.com/x"]));
    expect(a.metadata.fetch_status).toBe("error");
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("none");
  });

  it("coerces unknown block_reason / bypass_level to safe defaults", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: makeExec({
        status: "blocked",
        block_reason: "aliens",
        bypass_level: "magic"
      })
    });
    const [a] = await adapter.execute(makePlan(["https://example.com/x"]));
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("none");
  });
});

describe("createScraplingAdapter() — multi-URL batching", () => {
  it("produces one artifact per URL with unique ids", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async ({ url }) => ({
        stdout: JSON.stringify({
          status: "success",
          title: url,
          text: `body for ${url}`
        }),
        stderr: "",
        exitCode: 0
      }),
      normalize: async ({ payload }) => String(payload),
      storeRaw: async ({ format, payload }) =>
        `p/runs/r/raw/scrapling/${format}-${Buffer.from(String(payload))
          .toString("hex")
          .slice(0, 8)}.txt`
    });

    const result = await adapter.execute(
      makePlan([
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c"
      ])
    );
    expect(result).toHaveLength(3);
    expect(new Set(result.map((r) => r.id)).size).toBe(3);
    expect(result.every((r) => /^scrapling-[a-f0-9]{8}$/.test(r.id))).toBe(true);
    for (const a of result) {
      assertMetadataContract(a.metadata);
      expect(a.metadata.fetch_status).toBe("success");
    }
  });

  it("failure on one URL does not prevent other URLs from yielding artifacts", async () => {
    const adapter = createScraplingAdapter({
      now: fixedNow,
      exec: async ({ url }) => {
        if (url.includes("bad")) {
          throw new Error("boom for bad url");
        }
        return {
          stdout: JSON.stringify({
            status: "success",
            title: url,
            text: "ok"
          }),
          stderr: "",
          exitCode: 0
        };
      }
    });

    const result = await adapter.execute(
      makePlan(["https://example.com/good", "https://example.com/bad"])
    );
    expect(result).toHaveLength(2);
    expect(result[0].metadata.fetch_status).toBe("success");
    expect(result[1].metadata.fetch_status).toBe("error");
    expect(result[1].metadata.error).toContain("boom");
  });
});

describe("createScraplingAdapter() — executor input contract", () => {
  it("passes url, mode, and timeoutMs to the executor", async () => {
    let captured: unknown = null;
    const adapter = createScraplingAdapter({
      now: fixedNow,
      mode: "dynamic",
      defaultTimeoutMs: 12_345,
      exec: async (input) => {
        captured = input;
        return {
          stdout: JSON.stringify({ status: "success", title: "t", text: "b" }),
          stderr: "",
          exitCode: 0
        };
      }
    });

    await adapter.execute(makePlan(["https://example.com/x"]));
    expect(captured).toEqual({
      url: "https://example.com/x",
      mode: "dynamic",
      timeoutMs: 12_345
    });
  });
});

describe("createCliExecutor()", () => {
  it("escalates get -> fetch -> stealthy-fetch for stealth mode", async () => {
    const calls: string[][] = [];
    const exec = createCliExecutor({
      tmpRoot: "/tmp",
      run: async ({ args }) => {
        calls.push(args);
        if (args[1] === "get") {
          return { stdout: "", stderr: "empty body", exitCode: 1 };
        }
        if (args[1] === "fetch") {
          return { stdout: "", stderr: "still blocked", exitCode: 1 };
        }
        return {
          stdout: "",
          stderr: "",
          exitCode: 0
        };
      }
    });

    const result = await exec({
      url: "https://example.com",
      mode: "stealth",
      timeoutMs: 30000
    });

    expect(calls.map((args) => args[1])).toEqual([
      "get",
      "fetch",
      "stealthy-fetch"
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("classifies Cloudflare-like stderr as blocked instead of raw process failure", async () => {
    const exec = createCliExecutor({
      tmpRoot: "/tmp",
      run: async () => ({
        stdout: "",
        stderr: "Blocked by Cloudflare Turnstile challenge",
        exitCode: 1
      })
    });

    const result = await exec({
      url: "https://protected.example.com",
      mode: "stealth",
      timeoutMs: 30000
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("blocked");
    expect(parsed.block_reason).toBe("turnstile");
  });

  it("uses a single get attempt with a capped timeout for s.jina.ai", async () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const exec = createCliExecutor({
      tmpRoot: "/tmp",
      run: async ({ args, timeoutMs }) => {
        calls.push({ args, timeoutMs });
        return {
          stdout: "",
          stderr: "timed out",
          exitCode: 124,
          timedOut: true
        };
      }
    });

    const result = await exec({
      url: "https://s.jina.ai/?q=monorepo",
      mode: "stealth",
      timeoutMs: 30000
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[1]).toBe("get");
    expect(calls[0]?.timeoutMs).toBe(5000);
    expect(result.timedOut).toBe(true);
  });

  it("keeps the normal stealth escalation for non-jina hosts", async () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const exec = createCliExecutor({
      tmpRoot: "/tmp",
      run: async ({ args, timeoutMs }) => {
        calls.push({ args, timeoutMs });
        if (args[1] === "get") {
          return { stdout: "", stderr: "empty body", exitCode: 1 };
        }
        if (args[1] === "fetch") {
          return { stdout: "", stderr: "still blocked", exitCode: 1 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    await exec({
      url: "https://example.com",
      mode: "stealth",
      timeoutMs: 30000
    });

    expect(calls.map((call) => call.args[1])).toEqual(["get", "fetch", "stealthy-fetch"]);
    expect(calls[0]?.timeoutMs).toBe(30000);
  });
});
