import { describe, expect, it } from "vitest";
import { canonicalize, hostnameOf } from "@/lib/adapters/url";

describe("canonicalize()", () => {
  it("returns empty string for empty / nullish input", () => {
    expect(canonicalize("")).toBe("");
    expect(canonicalize("   ")).toBe("");
  });

  it("returns the original string for unparseable URLs", () => {
    expect(canonicalize("not a url")).toBe("not a url");
    expect(canonicalize("foo/bar/baz")).toBe("foo/bar/baz");
  });

  it("lowercases scheme and hostname but not path", () => {
    expect(canonicalize("HTTPS://Example.COM/Path/Name")).toBe(
      "https://example.com/Path/Name"
    );
  });

  it("drops default ports", () => {
    expect(canonicalize("http://example.com:80/x")).toBe("http://example.com/x");
    expect(canonicalize("https://example.com:443/x")).toBe("https://example.com/x");
    // non-default ports preserved
    expect(canonicalize("https://example.com:8443/x")).toBe(
      "https://example.com:8443/x"
    );
  });

  it("strips URL fragment", () => {
    expect(canonicalize("https://example.com/a#section-2")).toBe(
      "https://example.com/a"
    );
  });

  it("strips trailing slash on non-root path", () => {
    expect(canonicalize("https://example.com/post/123/")).toBe(
      "https://example.com/post/123"
    );
  });

  it("preserves trailing slash on bare origin", () => {
    expect(canonicalize("https://example.com/")).toBe("https://example.com/");
  });

  it("strips utm_* tracking parameters", () => {
    expect(
      canonicalize(
        "https://example.com/a?utm_source=x&utm_medium=y&utm_campaign=z&real=keep"
      )
    ).toBe("https://example.com/a?real=keep");
  });

  it("strips common exact-name trackers (fbclid, gclid, igshid, spm)", () => {
    expect(
      canonicalize("https://example.com/p?fbclid=abc&gclid=xyz&spm=q&q=keep")
    ).toBe("https://example.com/p?q=keep");
    expect(canonicalize("https://example.com/p?igshid=abc")).toBe(
      "https://example.com/p"
    );
  });

  it("is case-insensitive for tracker names", () => {
    expect(canonicalize("https://example.com/a?UTM_Source=x&real=y")).toBe(
      "https://example.com/a?real=y"
    );
  });

  it("preserves non-tracker params that happen to contain tracker substrings", () => {
    // 'fbclid_override' is not a tracker, only exact 'fbclid' matches
    expect(
      canonicalize("https://example.com/a?fbclid_override=keep&fbclid=drop")
    ).toBe("https://example.com/a?fbclid_override=keep");
  });

  it("is idempotent", () => {
    const sample = "HTTPS://Example.COM:443/Post/?utm_source=x&real=1#frag";
    const once = canonicalize(sample);
    const twice = canonicalize(once);
    expect(twice).toBe(once);
  });

  it("two URLs that differ only in tracking / fragment collapse to the same form", () => {
    const a = canonicalize("https://example.com/p?utm_source=newsletter#top");
    const b = canonicalize("https://example.com/p#hero");
    expect(a).toBe(b);
  });
});

describe("hostnameOf()", () => {
  it("returns lowercased hostname", () => {
    expect(hostnameOf("https://EXAMPLE.com/x")).toBe("example.com");
  });

  it("returns null for non-URL strings", () => {
    expect(hostnameOf("not a url")).toBeNull();
  });
});
