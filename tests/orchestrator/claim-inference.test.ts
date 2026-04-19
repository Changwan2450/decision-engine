import { describe, expect, it } from "vitest";
import {
  assignTopicKey,
  extractTopicAnchors,
  inferClaimStance
} from "@/lib/orchestrator/claim-inference";

describe("claim inference", () => {
  describe("inferClaimStance", () => {
    it("classifies oppose phrases from real-world text", () => {
      expect(inferClaimStance("I think the trade-off simply isn't worth it")).toBe("oppose");
      expect(inferClaimStance("massive mental overhead for little gain")).toBe("oppose");
      expect(
        inferClaimStance("React Server Components, maybe a mistake from the beginning?")
      ).toBe("oppose");
      expect(inferClaimStance("RSC는 추천하지 않는다")).toBe("oppose");
      expect(inferClaimStance("도입하지 말아야 한다")).toBe("oppose");
    });

    it("classifies support phrases", () => {
      expect(inferClaimStance("Worth it for large teams")).toBe("support");
      expect(inferClaimStance("I'd recommend RSC")).toBe("support");
      expect(inferClaimStance("RSC 도입을 권장한다")).toBe("support");
    });

    it("leaves descriptive text neutral", () => {
      expect(inferClaimStance("RSC is a React feature")).toBe("neutral");
      expect(inferClaimStance("서버 컴포넌트는 새로운 개념이다")).toBe("neutral");
    });

    it("prefers oppose when support and oppose both appear", () => {
      expect(inferClaimStance("it's great but not worth the complexity")).toBe("oppose");
    });
  });

  describe("extractTopicAnchors", () => {
    it("extracts repeated anchors and filters stopwords", () => {
      const anchors = extractTopicAnchors(
        [
          "RSC complexity is worth it for some teams",
          "RSC complexity is not worth the mental overhead",
          "Teams debate RSC complexity every quarter"
        ],
        { minOccurrences: 2, maxAnchors: 5 }
      );

      expect(anchors).toContain("rsc complexity");
      expect(anchors).not.toContain("the");
    });

    it("drops anchors below the minimum occurrence threshold", () => {
      const anchors = extractTopicAnchors(
        ["RSC is useful", "Remix is flexible", "Svelte is lightweight"],
        { minOccurrences: 2, maxAnchors: 5 }
      );

      expect(anchors).toEqual([]);
    });

    it("drops numeric-only tokens from anchors", () => {
      const anchors = extractTopicAnchors(
        [
          "React server components 15 are worth considering",
          "React server components 20 have different trade-offs"
        ],
        { minOccurrences: 2, maxAnchors: 10 }
      );

      expect(anchors).not.toContain("15");
      expect(anchors).not.toContain("20");
    });

    it("dedupes nested anchors when counts are identical", () => {
      const anchors = extractTopicAnchors(
        [
          "react server components are useful",
          "react server components can get complex",
          "react server components need care"
        ],
        { minOccurrences: 3, maxAnchors: 10 }
      );

      expect(anchors).toContain("react server components");
      expect(anchors).not.toContain("react server");
      expect(anchors).not.toContain("server components");
      expect(anchors).not.toContain("components");
    });

    it("strips full URLs before extracting anchors", () => {
      const anchors = extractTopicAnchors(
        [
          "Check https://reddit.com/r/singapore/apr_singapore_concerts",
          "Review https://reddit.com/r/singapore/apr_singapore_concerts"
        ],
        { minOccurrences: 2, maxAnchors: 10 }
      );

      expect(anchors).not.toContain("https");
      expect(anchors).not.toContain("com");
      expect(anchors).not.toContain("apr");
      expect(anchors).not.toContain("singapore");
      expect(anchors).not.toContain("concerts");
    });

    it("filters url protocol tokens while keeping nearby natural language", () => {
      const anchors = extractTopicAnchors(
        [
          "the https protocol is fine for monorepo",
          "https should not affect monorepo debate"
        ],
        { minOccurrences: 2, maxAnchors: 10 }
      );

      expect(anchors).not.toContain("https");
      expect(anchors).toContain("monorepo");
    });

    it("filters www and tld tokens", () => {
      const anchors = extractTopicAnchors(
        [
          "www.example.com is slow but monorepo is fine",
          "www.example.com often appears in monorepo examples"
        ],
        { minOccurrences: 2, maxAnchors: 10 }
      );

      expect(anchors).not.toContain("www");
      expect(anchors).not.toContain("com");
      expect(anchors).toContain("monorepo");
    });

    it("preserves meaningful product tokens after url filtering", () => {
      const anchors = extractTopicAnchors(
        [
          "monorepo vs polyrepo authentication",
          "polyrepo and monorepo both affect authentication"
        ],
        { minOccurrences: 2, maxAnchors: 10 }
      );

      expect(anchors).toContain("monorepo");
      expect(anchors).toContain("polyrepo");
      expect(anchors).toContain("authentication");
    });
  });

  describe("assignTopicKey", () => {
    it("prefers the longest matching anchor", () => {
      const topicKey = assignTopicKey("React server components add complexity", [
        "react",
        "react server components",
        "components"
      ]);

      expect(topicKey).toBe("react-server-components");
    });

    it("returns undefined when no anchor matches", () => {
      expect(assignTopicKey("totally unrelated sentence", ["rsc", "complexity"])).toBeUndefined();
    });
  });
});
