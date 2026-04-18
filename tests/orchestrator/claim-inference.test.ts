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

      expect(anchors).toContain("rsc");
      expect(anchors).toContain("complexity");
      expect(anchors).not.toContain("the");
    });

    it("drops anchors below the minimum occurrence threshold", () => {
      const anchors = extractTopicAnchors(
        ["RSC is useful", "Remix is flexible", "Svelte is lightweight"],
        { minOccurrences: 2, maxAnchors: 5 }
      );

      expect(anchors).toEqual([]);
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
