import { describe, expect, it, vi } from "vitest";

import { assertMetadataContract } from "@/lib/adapters/contract";
import {
  createCommunitySearchJsonAdapter,
  isCommunitySearchJsonUrl,
  type CommunitySearchJsonExecutor
} from "@/lib/adapters/community-search-json";
import { sourceArtifactSchema } from "@/lib/domain/claims";
import type { ResearchPlan } from "@/lib/adapters/types";

function makePlan(urls: string[]): ResearchPlan {
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
    sourceTargets: ["community"],
    kbContext: null
  };
}

function fixedNow(): string {
  return "2026-04-19T00:00:00.000Z";
}

describe("isCommunitySearchJsonUrl()", () => {
  it("matches reddit search.json URLs", () => {
    expect(
      isCommunitySearchJsonUrl("https://www.reddit.com/search.json?q=monorepo")
    ).toBe(true);
  });

  it("matches hn algolia search URLs", () => {
    expect(
      isCommunitySearchJsonUrl(
        "https://hn.algolia.com/api/v1/search?query=monorepo"
      )
    ).toBe(true);
  });

  it("does not match reddit post URLs", () => {
    expect(
      isCommunitySearchJsonUrl("https://www.reddit.com/r/foo/comments/abc")
    ).toBe(false);
  });
});

describe("createCommunitySearchJsonAdapter()", () => {
  it("fans out reddit t3 search hits into one artifact per post", async () => {
    const normalize = vi.fn(async ({ payload }) => String(payload));
    const storeRaw = vi.fn(async () => "p/runs/r/raw/community-search-json/x.json");
    const exec: CommunitySearchJsonExecutor = async () => ({
      status: 200,
      body: JSON.stringify({
        data: {
          children: [
            {
              kind: "t3",
              data: {
                id: "a1",
                title: "Monorepo is great",
                selftext: "monorepo is great for solo devs",
                permalink: "/r/programming/comments/a1/example",
                subreddit: "programming",
                author: "alice",
                score: 42,
                num_comments: 10,
                created_utc: 1_700_000_000
              }
            },
            {
              kind: "t3",
              data: {
                id: "a2",
                title: "Polyrepo scales better",
                selftext: "polyrepo scales better",
                permalink: "/r/programming/comments/a2/example",
                subreddit: "programming",
                author: "bob",
                score: 7,
                num_comments: 2,
                created_utc: 1_700_000_100
              }
            }
          ]
        }
      })
    });

    const adapter = createCommunitySearchJsonAdapter({
      exec,
      now: fixedNow,
      normalize,
      storeRaw
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo+polyrepo"])
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].title).toBe("Monorepo is great");
    expect(artifacts[0].content).toBe("monorepo is great for solo devs");
    expect(artifacts[0].url).toBe(
      "https://reddit.com/r/programming/comments/a1/example"
    );
    expect(artifacts[0].publishedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(artifacts[0].sourceType).toBe("community");
    expect(artifacts[0].sourcePriority).toBe("community");
    expect(artifacts[0].metadata.subreddit).toBe("programming");
    expect(artifacts[0].metadata.author).toBe("alice");
    expect(artifacts[0].metadata.score).toBe("42");
    expect(artifacts[0].metadata.num_comments).toBe("10");
    expect(artifacts[0].rawRef).toBe("p/runs/r/raw/community-search-json/x.json");
    assertMetadataContract(artifacts[0].metadata);
    expect(sourceArtifactSchema.parse(artifacts[0])).toBeTruthy();
    expect(storeRaw).toHaveBeenCalledTimes(1);
    expect(normalize).toHaveBeenCalledTimes(2);
  });

  it("keeps reddit link posts as empty-content success artifacts", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "External link post",
                  selftext: "",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=link"])
    );

    expect(artifact.content).toBe("");
    expect(artifact.metadata.fetch_status).toBe("success");
  });

  it("ignores reddit comments in MVP", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              { kind: "t1", data: { body: "comment only" } },
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Kept post",
                  selftext: "body",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=kept+post"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Kept post");
  });

  it("fans out hn stories and comments", async () => {
    const normalize = vi.fn(async ({ payload }) => String(payload).replace(/<[^>]+>/g, "").trim());
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          hits: [
            {
              objectID: "1",
              title: "Ask HN: Monorepo?",
              story_text: "Story body",
              _tags: ["story"],
              author: "alice",
              created_at_i: 1_700_000_000,
              num_comments: 3,
              points: 99
            },
            {
              objectID: "2",
              comment_text: "<p>polyrepo is easier</p>",
              _tags: ["comment"],
              author: "bob",
              created_at_i: 1_700_000_100,
              points: 5
            }
          ]
        })
      }),
      now: fixedNow,
      normalize,
      storeRaw: async () => "p/runs/r/raw/community-search-json/hn.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=monorepo+polyrepo"])
    );

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].title).toBe("Ask HN: Monorepo?");
    expect(artifacts[0].content).toBe("Story body");
    expect(artifacts[0].url).toBe("https://news.ycombinator.com/item?id=1");
    expect(artifacts[0].metadata.hn_kind).toBe("story");
    expect(artifacts[1].title).toContain("polyrepo is easier");
    expect(artifacts[1].content).toBe("polyrepo is easier");
    expect(artifacts[1].metadata.hn_kind).toBe("comment");
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ format: "html", payload: "<p>polyrepo is easier</p>" })
    );
  });

  it("returns zero artifacts for empty search results", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({ data: { children: [] } })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=none"])
    );

    expect(artifacts).toEqual([]);
  });

  it("returns an empty array and logs for malformed JSON", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({ status: 200, body: "{incomplete" }),
      now: fixedNow
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=bad"])
    );

    expect(artifacts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[community-search-json] failure",
      expect.stringContaining("\"reason\":\"parse_fail\"")
    );
  });

  it("returns an empty array and logs for HTTP error responses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({ status: 429, body: "" }),
      now: fixedNow
    });

    const artifacts = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=fail"])
    );

    expect(artifacts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[community-search-json] failure",
      expect.stringContaining("\"reason\":\"http_status\"")
    );
    expect(warn).toHaveBeenCalledWith(
      "[community-search-json] failure",
      expect.stringContaining("\"detail\":429")
    );
  });

  it("returns an empty array and logs when the executor returns null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => null,
      now: fixedNow
    });

    const artifacts = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=null"])
    );

    expect(artifacts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[community-search-json] failure",
      expect.stringContaining("\"reason\":\"executor_null\"")
    );
  });

  it("returns an empty array and logs when the executor throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => {
        throw new Error("boom");
      },
      now: fixedNow
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=boom"])
    );

    expect(artifacts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[community-search-json] failure",
      expect.stringContaining("\"reason\":\"executor_throw\"")
    );
  });

  it("drops irrelevant reddit posts by query relevance", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Monorepo is great",
                  selftext: "monorepo helps teams",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Skiing solo vs with friends",
                  selftext: "mountain trip",
                  permalink: "/r/skiing/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a3",
                  title: "Messi 800 goals",
                  selftext: "football analysis",
                  permalink: "/r/soccer/comments/a3/example",
                  created_utc: 1_700_000_200
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo+vs+polyrepo"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Monorepo is great");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("2");
    expect(artifacts[0].metadata.community_filter_tokens).toContain("monorepo");
  });

  it("keeps all reddit posts when all are relevant", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Monorepo tradeoffs",
                  selftext: "monorepo helps",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Polyrepo debate",
                  selftext: "polyrepo helps",
                  permalink: "/r/programming/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a3",
                  title: "Monorepo vs Polyrepo in practice",
                  selftext: "both monorepo and polyrepo have tradeoffs",
                  permalink: "/r/programming/comments/a3/example",
                  created_utc: 1_700_000_200
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo+vs+polyrepo"])
    );

    expect(artifacts).toHaveLength(3);
    expect(artifacts.every((artifact) => artifact.metadata.community_filter_dropped === "0")).toBe(
      true
    );
  });

  it("filters hn stories and comments by relevance", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          hits: [
            {
              objectID: "1",
              title: "Monorepo tradeoffs",
              story_text: "monorepo keeps tooling simple",
              _tags: ["story"],
              created_at_i: 1_700_000_000
            },
            {
              objectID: "2",
              story_title: "Skiing solo tips",
              comment_text: "great for a weekend trip",
              _tags: ["comment"],
              created_at_i: 1_700_000_100
            }
          ]
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/hn.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=monorepo+vs+polyrepo"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Monorepo tradeoffs");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("1");
  });

  it("disables filtering when distinctive tokens are empty", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Anything goes",
                  selftext: "random body",
                  permalink: "/r/test/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=vs+or+the"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBeUndefined();
    expect(artifacts[0].metadata.community_filter_dropped).toBe("0");
  });

  it("returns an empty array when every result is dropped by relevance", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Skiing solo vs with friends",
                  selftext: "mountain trip",
                  permalink: "/r/skiing/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Messi 800 goals",
                  selftext: "football analysis",
                  permalink: "/r/soccer/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a3",
                  title: "Weekend travel plan",
                  selftext: "solo travel ideas",
                  permalink: "/r/travel/comments/a3/example",
                  created_utc: 1_700_000_200
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo"])
    );

    expect(artifacts).toEqual([]);
  });

  it("drops long-anchor posts that match only one broad title token", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Windows Server 2025 setup guide",
                  selftext: "server administration walkthrough",
                  permalink: "/r/sysadmin/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "React Server Components vs SPA in production",
                  selftext: "tradeoffs from a real migration",
                  permalink: "/r/reactjs/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=React+Server+Components+vs+SPA"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("React Server Components vs SPA in production");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("1");
  });

  it("drops ambiguous broad-query posts that match only two title tokens", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "TypeScript server patterns for API routes",
                  selftext: "generic backend setup notes",
                  permalink: "/r/typescript/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "React Server Components in TypeScript",
                  selftext: "migration notes from production",
                  permalink: "/r/reactjs/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=React+Server+Components+TypeScript"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("React Server Components in TypeScript");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("1");
  });

  it("keeps ambiguous broad-query posts when three title tokens match", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "React Server Components architecture notes",
                  selftext: "production tradeoffs and migration lessons",
                  permalink: "/r/reactjs/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=React+Server+Components+TypeScript"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("React Server Components architecture notes");
    expect(artifacts[0].metadata.community_filter_tokens).toBe(
      "react;server;components;typescript"
    );
  });

  it("drops long-anchor posts that match only one long token from a multi-token query", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "TypeScript utility patterns for config loading",
                  selftext: "generic TypeScript tips",
                  permalink: "/r/typescript/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Monolith vs Microservices in TypeScript teams",
                  selftext: "architecture tradeoffs in practice",
                  permalink: "/r/softwarearchitecture/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=TypeScript+monolith+vs+microservices"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Monolith vs Microservices in TypeScript teams");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("1");
  });

  it("keeps Korean posts using Hangul tokens", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "개발자 선택 기준",
                  selftext: "solo 개발자 선택 고민",
                  permalink: "/r/korea/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "주말 여행 후기",
                  selftext: "부산 여행",
                  permalink: "/r/korea/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=%EA%B0%9C%EB%B0%9C%EC%9E%90+%EC%84%A0%ED%83%9D"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("개발자 선택 기준");
  });

  it("keeps short allowlisted rust and go tokens", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a0",
                  title: "Let's go to the store",
                  selftext: "",
                  permalink: "/r/programming/comments/a0/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Rust vs Go in backend systems",
                  selftext: "rust and go are both viable",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rust");
    expect(artifacts[0].metadata.community_filter_mode).toBe("short_fallback");
  });

  it("keeps short allowlisted spa token alongside longer topic terms", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "React Server Components vs SPA tradeoffs",
                  selftext: "spa migration regret",
                  permalink: "/r/reactjs/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=React+Server+Components+vs+SPA+%EB%8F%84%EC%9E%85+%ED%9B%84%ED%9A%8C"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBe(
      "react;server;components;spa;후회"
    );
  });

  it("keeps short allowlisted ai and ml tokens", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "AI vs ML in 2026",
                  selftext: "ai and ml are often confused",
                  permalink: "/r/MachineLearning/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=AI+vs+ML+in+2026"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBe("ai;ml");
    expect(artifacts[0].metadata.community_filter_mode).toBe("short_fallback");
  });

  it("preserves monorepo regression behavior", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Monorepo vs polyrepo in practice",
                  selftext: "solo 개발자 선택 기준",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=monorepo+vs+polyrepo+solo+개발자+선택"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBe(
      "monorepo;polyrepo;개발자"
    );
    expect(artifacts[0].metadata.community_filter_mode).toBe("long_anchor");
  });

  it("still drops generic words that are not allowlisted", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Random topic",
                  selftext: "nothing relevant here",
                  permalink: "/r/test/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=bad+or+old+stale"])
    );

    expect(artifacts).toEqual([]);
  });

  it("marks noop mode when filtering is disabled", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Anything goes",
                  selftext: "random body",
                  permalink: "/r/test/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=vs+or+the"])
    );

    expect(artifact.metadata.community_filter_mode).toBe("noop");
  });

  it("drops generic long tokens from rust/go queries", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a0",
                  title: "2026 Ferrari Roma Spider finally arrived",
                  selftext: "talks about systems",
                  permalink: "/r/cars/comments/a0/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Go vs Rust for long-term systems/finance infrastructure",
                  selftext: "",
                  permalink: "/r/golang/comments/a1/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe(
      "Go vs Rust for long-term systems/finance infrastructure"
    );
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rust");
    expect(artifacts[0].metadata.community_filter_generics_dropped).toBe("5");
    expect(artifacts[0].metadata.community_filter_mode).toBe("short_fallback");
  });

  it("drops Korean generic tokens from monorepo queries", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "monorepo setup guide",
                  selftext: "",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "unrelated post",
                  selftext: "generic body",
                  permalink: "/r/programming/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=monorepo+vs+polyrepo+%EA%B0%9C%EB%B0%9C%EC%9E%90+%EC%84%A0%ED%83%9D"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("monorepo setup guide");
    expect(artifacts[0].metadata.community_filter_tokens).toBe("monorepo;polyrepo;개발자");
    expect(artifacts[0].metadata.community_filter_generics_dropped).toBe("1");
  });

  it("falls back to noop when all tokens are generic", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Anything goes",
                  selftext: "random body",
                  permalink: "/r/test/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95+%EC%84%A0%ED%83%9D+%EC%82%AC%EC%9A%A9"
      ])
    );

    expect(artifact.metadata.community_filter_tokens).toBeUndefined();
    expect(artifact.metadata.community_filter_mode).toBe("noop");
    expect(artifact.metadata.community_filter_generics_dropped).toBe("5");
  });

  it("keeps short allowlist token after generic long tokens are removed", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "RSC migration notes",
                  selftext: "",
                  permalink: "/r/reactjs/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "marketing copy",
                  selftext: "",
                  permalink: "/r/marketing/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=rsc+systems+performance"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("RSC migration notes");
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rsc");
    expect(artifacts[0].metadata.community_filter_mode).toBe("short_fallback");
    expect(artifacts[0].metadata.community_filter_generics_dropped).toBe("2");
  });

  it("treats rust as the only distinctive token for Rust vs Go queries", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a0",
                  title: "2026 Ferrari Roma Spider finally arrived",
                  selftext: "sports car overview",
                  permalink: "/r/cars/comments/a0/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Let's GO! James Fox",
                  selftext: "release announcement",
                  permalink: "/r/UFOs/comments/a1/example",
                  created_utc: 1_700_000_100
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Go vs Rust for long-term systems/finance infrastructure",
                  selftext: "",
                  permalink: "/r/golang/comments/a2/example",
                  created_utc: 1_700_000_200
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe(
      "Go vs Rust for long-term systems/finance infrastructure"
    );
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rust");
    expect(artifacts[0].metadata.community_filter_mode).toBe("short_fallback");
  });

  it("keeps rsc alongside long non-generic tokens", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "RSC authentication migration notes",
                  selftext: "",
                  permalink: "/r/reactjs/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=rsc+authentication+%ED%8C%80+%EB%8F%84%EC%9E%85"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rsc;authentication");
  });

  it("drops ambiguous allowlist-only queries into noop mode", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Anything goes",
                  selftext: "random body",
                  permalink: "/r/test/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=go+rest+rag+cd+pm+mvp+r"])
    );

    expect(artifact.metadata.community_filter_tokens).toBeUndefined();
    expect(artifact.metadata.community_filter_mode).toBe("noop");
  });

  it("drops short-token substring matches like trust", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "why American democracy will likely withstand Trump",
                  selftext: "we need to trust our institutions",
                  permalink: "/r/politics/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifacts).toEqual([]);
  });

  it("keeps short-token word-boundary matches for rust", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Go vs Rust for long-term systems/finance infrastructure",
                  selftext: "",
                  permalink: "/r/golang/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifact.title).toBe(
      "Go vs Rust for long-term systems/finance infrastructure"
    );
    expect(artifact.metadata.community_filter_tokens).toBe("rust");
  });

  it("keeps short-token matches across hyphen boundaries", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "rust-lang community update",
                  selftext: "",
                  permalink: "/r/rust/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifact.title).toBe("rust-lang community update");
  });

  it("drops short-token suffix matches like rusty", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "my code feels rusty today",
                  selftext: "",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifacts).toEqual([]);
  });

  it("keeps only real items when one search result is dropped and another is kept", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Go vs Rust for long-term systems",
                  selftext: "",
                  permalink: "/r/rust/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              },
              {
                kind: "t3",
                data: {
                  id: "a2",
                  title: "Leftover Eggs [April Submission]",
                  selftext: "the pan has a rust stain",
                  permalink: "/r/cooking/comments/a2/example",
                  created_utc: 1_700_000_100
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=Rust+vs+Go+for+systems+programming+%ED%8C%80+%EB%8F%84%EC%9E%85+%EA%B2%B0%EC%A0%95"
      ])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Go vs Rust for long-term systems");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("1");
    expect(artifacts[0].metadata.community_filter_tokens).toBe("rust");
  });

  it("keeps long-token substring matches like monorepos", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "benefits of monorepos in 2026",
                  selftext: "",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan([
        "https://www.reddit.com/search.json?q=monorepo+vs+polyrepo+%EA%B0%9C%EB%B0%9C%EC%9E%90+%EC%84%A0%ED%83%9D"
      ])
    );

    expect(artifact.title).toBe("benefits of monorepos in 2026");
    expect(artifact.metadata.community_filter_tokens).toBe("monorepo;polyrepo;개발자");
  });

  it("keeps posts when a long token matches even if a short token only appears inside another word", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "authentication edge cases",
                  selftext: "we lost trust in the system",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=rust+authentication"])
    );

    expect(artifact.title).toBe("authentication edge cases");
    expect(artifact.metadata.community_filter_tokens).toBe("rust;authentication");
    expect(artifact.metadata.community_filter_mode).toBe("long_anchor");
  });

  it("drops body-only matches in long_anchor mode", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Best IDE for Python",
                  selftext: "we had a monorepo but moved away",
                  permalink: "/r/python/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo+vs+polyrepo"])
    );

    expect(artifacts).toEqual([]);
  });

  it("keeps title matches in long_anchor mode", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "a1",
                  title: "Monorepo vs Polyrepo debate",
                  selftext: "",
                  permalink: "/r/programming/comments/a1/example",
                  created_utc: 1_700_000_000
                }
              }
            ]
          }
        })
      }),
      now: fixedNow,
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "p/runs/r/raw/community-search-json/reddit.json"
    });

    const artifacts = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=monorepo+vs+polyrepo"])
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Monorepo vs Polyrepo debate");
  });
});
