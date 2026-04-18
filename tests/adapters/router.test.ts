import { describe, expect, it } from "vitest";
import { isPdfUrl, routeUrl, ruleCount } from "@/lib/adapters/router";

describe("routeUrl() — video track", () => {
  it("routes youtube.com to agent-reach with reclip fallback", () => {
    const chain = routeUrl("https://www.youtube.com/watch?v=abc");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.fallbacks).toEqual(["reclip"]);
    expect(chain.rule).toBe("video/youtube");
  });

  it("routes youtu.be short links the same way", () => {
    const chain = routeUrl("https://youtu.be/abc");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.fallbacks).toEqual(["reclip"]);
  });

  it("routes bilibili to agent-reach with reclip fallback", () => {
    const chain = routeUrl("https://www.bilibili.com/video/BV1xx");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.fallbacks).toEqual(["reclip"]);
    expect(chain.rule).toBe("video/bilibili");
  });

  it("routes b23.tv short links as bilibili", () => {
    expect(routeUrl("https://b23.tv/abc").rule).toBe("video/bilibili");
  });
});

describe("routeUrl() — community track", () => {
  it("routes reddit to agent-reach primary, scrapling fallback", () => {
    const chain = routeUrl("https://www.reddit.com/r/foo/comments/xyz");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.fallbacks).toEqual(["scrapling"]);
    expect(chain.rule).toBe("community/reddit");
  });

  it("routes x.com and twitter.com the same way", () => {
    expect(routeUrl("https://x.com/user/status/1").rule).toBe("community/x");
    expect(routeUrl("https://twitter.com/user/status/1").rule).toBe(
      "community/x"
    );
  });

  it("routes github to agent-reach primary", () => {
    const chain = routeUrl("https://github.com/org/repo/issues/1");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.rule).toBe("github");
  });

  it("routes xiaohongshu to agent-reach with scrapling fallback", () => {
    const chain = routeUrl("https://www.xiaohongshu.com/explore/abc");
    expect(chain.primary).toBe("agent-reach");
    expect(chain.fallbacks).toEqual(["scrapling"]);
  });
});

describe("routeUrl() — Korean community platforms", () => {
  it.each([
    ["https://gall.dcinside.com/board/view/?id=x", "community/korean"],
    ["https://arca.live/b/x/12345", "community/korean"],
    ["https://www.clien.net/service/board/park/1", "community/korean"],
    ["https://www.fmkorea.com/1234567", "community/korean"],
    ["https://www.ppomppu.co.kr/zboard/view.php?id=x", "community/korean"],
    ["https://bbs.ruliweb.com/community/board/1/read/1", "community/korean"],
    ["https://www.inven.co.kr/board/lol/abc", "community/korean"],
    ["https://www.instiz.net/pt/1", "community/korean"],
    ["https://theqoo.net/square/1", "community/korean"]
  ])("routes %s → scrapling primary (%s)", (url, expected) => {
    const chain = routeUrl(url);
    expect(chain.primary).toBe("scrapling");
    expect(chain.fallbacks).toEqual([]);
    expect(chain.rule).toBe(expected);
  });
});

describe("routeUrl() — PDF / papers", () => {
  it("routes .pdf URLs to opendataloader-pdf with markitdown fallback", () => {
    const chain = routeUrl("https://example.com/paper.pdf");
    expect(chain.primary).toBe("opendataloader-pdf");
    expect(chain.fallbacks).toEqual(["markitdown"]);
    expect(chain.rule).toBe("pdf/generic");
  });

  it("routes .pdf with query string", () => {
    expect(routeUrl("https://example.com/paper.pdf?v=2").rule).toBe(
      "pdf/generic"
    );
  });

  it("routes arxiv.org/abs/* to opendataloader-pdf with agent-reach metadata fallback", () => {
    const chain = routeUrl("https://arxiv.org/abs/2401.00001");
    expect(chain.primary).toBe("opendataloader-pdf");
    expect(chain.fallbacks).toEqual(["agent-reach"]);
    expect(chain.rule).toBe("pdf/arxiv");
  });

  it("routes arxiv.org/pdf/* the same way", () => {
    expect(routeUrl("https://arxiv.org/pdf/2401.00001v1.pdf").rule).toBe(
      "pdf/arxiv"
    );
  });
});

describe("routeUrl() — generic fallback", () => {
  it("routes RSS/feed endpoints through the public-feed policy", () => {
    const chain = routeUrl("https://example.com/feed");
    expect(chain.primary).toBe("scrapling");
    expect(chain.fallbacks).toEqual(["markitdown"]);
    expect(chain.rule).toBe("web/public-feed");
  });

  it("routes XML feeds through the public-feed policy", () => {
    expect(routeUrl("https://example.com/rss.xml").rule).toBe(
      "web/public-feed"
    );
  });

  it("routes Jina Reader mirrors through the public-mirror policy", () => {
    const chain = routeUrl("https://r.jina.ai/http://example.com/post");
    expect(chain.primary).toBe("scrapling");
    expect(chain.fallbacks).toEqual(["markitdown"]);
    expect(chain.rule).toBe("web/public-mirror");
  });

  it("routes unknown hosts to scrapling with markitdown fallback", () => {
    const chain = routeUrl("https://some-random-blog.dev/post");
    expect(chain.primary).toBe("scrapling");
    expect(chain.fallbacks).toEqual(["markitdown"]);
    expect(chain.rule).toBe("web/generic");
  });

  it("returns default chain for unparseable URLs", () => {
    const chain = routeUrl("not a url");
    expect(chain.primary).toBe("scrapling");
    expect(chain.rule).toBe("web/generic");
  });

  it("returns default chain for empty string", () => {
    expect(routeUrl("").primary).toBe("scrapling");
  });
});

describe("routeUrl() — precedence", () => {
  it("video rule wins over generic when host is youtube.com even if path suggests pdf", () => {
    // youtube is matched by hostname rule before pdf-ext rule, so a hypothetical
    // youtube URL ending in .pdf should still go through video/youtube
    const chain = routeUrl("https://www.youtube.com/bizarre.pdf");
    expect(chain.rule).toBe("video/youtube");
  });

  it("arxiv rule wins over generic pdf rule for arxiv.org/pdf/*", () => {
    const chain = routeUrl("https://arxiv.org/pdf/2401.00001.pdf");
    expect(chain.rule).toBe("pdf/arxiv");
  });
});

describe("isPdfUrl()", () => {
  it("matches trailing .pdf", () => {
    expect(isPdfUrl("https://example.com/foo.pdf")).toBe(true);
  });
  it("matches .pdf with query", () => {
    expect(isPdfUrl("https://example.com/foo.pdf?x=1")).toBe(true);
  });
  it("does not match non-pdf paths", () => {
    expect(isPdfUrl("https://example.com/foo")).toBe(false);
    expect(isPdfUrl("https://example.com/foo.pdf.txt")).toBe(false);
  });
});

describe("routing table integrity", () => {
  it("has a non-trivial number of rules (regression guard)", () => {
    expect(ruleCount()).toBeGreaterThanOrEqual(10);
  });
});
