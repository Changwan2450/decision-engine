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

  it("returns a failure artifact for malformed JSON", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({ status: 200, body: "{incomplete" }),
      now: fixedNow
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://www.reddit.com/search.json?q=bad"])
    );

    expect(artifact.metadata.fetch_status).toBe("error");
    expect(artifact.metadata.error).toContain("JSON");
  });

  it("returns a failure artifact for HTTP error responses", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => ({ status: 503, body: "" }),
      now: fixedNow
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=fail"])
    );

    expect(artifact.metadata.fetch_status).toBe("error");
    expect(artifact.metadata.error).toContain("503");
  });

  it("returns a failure artifact when the executor returns null", async () => {
    const adapter = createCommunitySearchJsonAdapter({
      exec: async () => null,
      now: fixedNow
    });

    const [artifact] = await adapter.execute(
      makePlan(["https://hn.algolia.com/api/v1/search?query=null"])
    );

    expect(artifact.metadata.fetch_status).toBe("error");
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

  it("returns a partial stub when every result is dropped by relevance", async () => {
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

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].metadata.fetch_status).toBe("partial");
    expect(artifacts[0].metadata.community_filter_dropped).toBe("3");
    expect(artifacts[0].metadata.error).toContain("no posts matched relevance filter");
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
});
