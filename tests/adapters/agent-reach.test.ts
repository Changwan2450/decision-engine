import { describe, expect, it } from "vitest";
import { createAgentReachAdapter } from "@/lib/adapters/agent-reach";
import { assertMetadataContract } from "@/lib/adapters/contract";
import type { ResearchPlan } from "@/lib/adapters/types";

const plan: ResearchPlan = {
  projectId: "project-1",
  runId: "run-1",
  title: "숏츠 시장조사",
  mode: "standard",
  normalizedInput: {
    title: "숏츠 시장조사",
    naturalLanguage:
      "목표: 숏츠 시장 진입 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스",
    pastedContent: "",
    urls: ["https://example.com/post"],
    goal: "숏츠 시장 진입 판단",
    target: "20대 크리에이터",
    comparisonAxis: "쇼츠 vs 릴스"
  },
  sourceTargets: ["web", "community", "video", "github"],
  kbContext: {
    operatorNotes: [
      {
        title: "User Working Profile",
        path: "wiki/concepts/user-working-profile.md",
        summary: "한국어, 짧게, 증거 우선으로 협업",
        reusableClaims: ["Language: answer in Korean unless the user directs otherwise."]
      }
    ],
    wikiNotes: [
      {
        title: "Short-Form Entry Decision Patterns",
        path: "wiki/concepts/short-form-entry-decision-patterns.md",
        summary: "숏폼 진입 판단 패턴",
        reusableClaims: ["진입 판단은 경쟁 압박과 차별화를 같이 봐야 한다."]
      }
    ],
    priorDecisions: [
      {
        runId: "run-0",
        title: "이전 숏츠 판단",
        decision: "go",
        why: "이전 근거는 수요 쪽이 강했다.",
        createdAt: "2026-04-10T00:00:00.000Z"
      }
    ],
    queryExpansion: ["Short-Form Entry Decision Patterns", "경쟁 압박과 차별화"],
    duplicateWarnings: ["이미 다룬 런: 이전 숏츠 판단 (go)"],
    freshEvidenceFocus: [
      "기존 내부 지식을 반복하지 말고 최신 official/primary_data 근거를 우선 수집"
    ],
    adaptivePolicy: null
  }
};

const FIXED_NOW = "2026-04-17T00:00:00.000Z";

describe("agent reach adapter — supports()", () => {
  it("supports plans that include its source targets", () => {
    const adapter = createAgentReachAdapter({ now: () => FIXED_NOW });
    expect(adapter.supports(plan)).toBe(true);
  });
});

describe("agent reach adapter — success path", () => {
  it("stores the raw item JSON and normalizes item content into markdown", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({
          items: [
            {
              sourceType: "web",
              title: "시장 조사 글",
              url: "https://example.com/post",
              content: "원문 본문"
            }
          ]
        }),
        stderr: "",
        exitCode: 0
      }),
      normalize: async ({ format, payload }) => {
        expect(format).toBe("text");
        expect(payload).toBe("원문 본문");
        return "정규화 본문";
      },
      storeRaw: async ({ projectId, runId, adapter, format, payload }) => {
        expect(projectId).toBe("project-1");
        expect(runId).toBe("run-1");
        expect(adapter).toBe("agent-reach");
        expect(format).toBe("json");
        expect(payload).toContain("\"title\":\"시장 조사 글\"");
        return "project-1/runs/run-1/raw/agent-reach/item.json";
      }
    });

    const [a] = await adapter.execute(plan);
    expect(a.content).toBe("정규화 본문");
    expect(a.snippet).toBe("정규화 본문");
    expect(a.rawRef).toBe("project-1/runs/run-1/raw/agent-reach/item.json");
  });

  it("passes inferred source type to the bridge based on URL host", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async (_command, args) => {
        expect(args[4]).toBe("community");
        return {
          stdout: JSON.stringify({
            items: [
              {
                sourceType: "community",
                title: "트윗",
                url: "https://x.com/user/status/1"
              }
            ]
          }),
          stderr: "",
          exitCode: 0
        };
      }
    });

    const communityPlan: ResearchPlan = {
      ...plan,
      normalizedInput: {
        ...plan.normalizedInput,
        urls: ["https://x.com/user/status/1"]
      }
    };

    const [artifact] = await adapter.execute(communityPlan);
    expect(artifact.sourceType).toBe("community");
  });

  it("converts executor items into artifacts with full metadata contract", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async (command, args) => {
        expect(command).toContain("python");
        expect(args.join(" ")).toContain("숏츠 시장조사");
        expect(args.join(" ")).toContain("kb_expand:");
        expect(args.join(" ")).toContain("avoid_repeat:");
        expect(args.join(" ")).toContain("fresh_focus:");
        return {
          stdout: JSON.stringify({
            items: [
              {
                sourceType: "web",
                title: "시장 조사 글",
                url: "https://example.com/post",
                snippet: "요약",
                metadata: {
                  retrieval_mode: "fresh_evidence"
                }
              }
            ]
          }),
          stderr: "",
          exitCode: 0
        };
      },
      storeRaw: async () => "project-1/runs/run-1/raw/agent-reach/item.json"
    });

    const artifacts = await adapter.execute(plan);

    expect(artifacts).toHaveLength(1);
    const [a] = artifacts;
    expect(a.id).toBe("agent-reach-0");
    expect(a.adapter).toBe("agent-reach");
    expect(a.sourceType).toBe("web");
    expect(a.title).toBe("시장 조사 글");
    expect(a.url).toBe("https://example.com/post");
    expect(a.canonicalUrl).toBe("https://example.com/post");
    expect(a.snippet).toBe("요약");
    expect(a.content).toBe("");
    expect(a.sourcePriority).toBe("analysis");
    expect(a.retrievedAt).toBe(FIXED_NOW);
    expect(a.rawRef).toBe("project-1/runs/run-1/raw/agent-reach/item.json");

    // Metadata contract — mandatory keys always present
    expect(a.metadata.fetcher).toBe("agent-reach");
    expect(a.metadata.fetch_status).toBe("success");
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("none");
    expect(a.metadata.login_required).toBe("false");
    expect(a.metadata.source_label).toBe("web/success");
    // Extra metadata from wire preserved
    expect(a.metadata.retrieval_mode).toBe("fresh_evidence");

    assertMetadataContract(a.metadata);
  });

  it("maps wire-level status/block_reason/bypass_level/login_required through", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({
          items: [
            {
              sourceType: "community",
              title: "블록 당함",
              url: "https://example.com/x",
              status: "blocked",
              block_reason: "captcha",
              bypass_level: "headers",
              login_required: true
            }
          ]
        }),
        stderr: "",
        exitCode: 0
      }),
      storeRaw: async () => "project-1/runs/run-1/raw/agent-reach/blocked.json"
    });

    const [a] = await adapter.execute(plan);
    expect(a.sourceType).toBe("community");
    expect(a.metadata.fetch_status).toBe("blocked");
    expect(a.metadata.block_reason).toBe("captcha");
    expect(a.metadata.bypass_level).toBe("headers");
    expect(a.metadata.login_required).toBe("true");
    assertMetadataContract(a.metadata);
  });
});

describe("agent reach adapter — failure absorption (never throws)", () => {
  it("exit != 0 returns an error failure stub instead of throwing", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: "",
        stderr: "python boom",
        exitCode: 3
      }),
      storeRaw: async ({ payload }) =>
        `project-1/runs/run-1/raw/agent-reach/${Buffer.from(String(payload))
          .toString("hex")
          .slice(0, 8)}.json`
    });

    const result = await adapter.execute(plan);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("error");
    expect(result[0].metadata.error).toContain("python boom");
    expect(result[0].url).toBe("https://example.com/post");
    assertMetadataContract(result[0].metadata);
  });

  it("executor timeout maps to fetch_status=timeout", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: "",
        stderr: "SIGTERM",
        exitCode: 124,
        timedOut: true
      })
    });
    const result = await adapter.execute(plan);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("timeout");
    assertMetadataContract(result[0].metadata);
  });

  it("thrown executor exception is absorbed into an error artifact", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => {
        throw new Error("ENOENT python3");
      }
    });

    const result = await adapter.execute(plan);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("error");
    expect(result[0].metadata.error).toContain("ENOENT");
    assertMetadataContract(result[0].metadata);
  });

  it("unparseable stdout yields an error failure stub", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: "<<<not json>>>",
        stderr: "",
        exitCode: 0
      })
    });
    const result = await adapter.execute(plan);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("error");
    expect(result[0].metadata.error).toContain("parse");
    assertMetadataContract(result[0].metadata);
  });

  it("empty items yields a partial failure stub (signals call-happened-but-no-data)", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({ items: [] }),
        stderr: "",
        exitCode: 0
      })
    });
    const result = await adapter.execute(plan);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.fetch_status).toBe("partial");
    expect(result[0].metadata.error).toContain("no items");
    assertMetadataContract(result[0].metadata);
  });
});

describe("agent reach adapter — multi-item contract", () => {
  it("every returned item independently carries the metadata contract", async () => {
    const adapter = createAgentReachAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({
          items: [
            { sourceType: "web", title: "a", url: "https://example.com/a" },
            {
              sourceType: "github",
              title: "b",
              url: "https://github.com/org/repo"
            },
            {
              sourceType: "community",
              title: "c",
              url: "https://reddit.com/r/x",
              status: "partial"
            }
          ]
        }),
        stderr: "",
        exitCode: 0
      })
    });

    const result = await adapter.execute(plan);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual([
      "agent-reach-0",
      "agent-reach-1",
      "agent-reach-2"
    ]);
    for (const a of result) {
      assertMetadataContract(a.metadata);
      expect(a.metadata.fetcher).toBe("agent-reach");
    }
    expect(result[0].metadata.fetch_status).toBe("success");
    expect(result[2].metadata.fetch_status).toBe("partial");
  });
});
