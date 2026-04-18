import { describe, expect, it } from "vitest";
import { classifyContradictionKind } from "@/lib/orchestrator/contradiction-kind";

describe("classifyContradictionKind", () => {
  it("classifies internal and community regardless of order", () => {
    expect(classifyContradictionKind("internal", "community")).toBe("internal_vs_community");
    expect(classifyContradictionKind("community", "internal")).toBe("internal_vs_community");
  });

  it("classifies internal and official", () => {
    expect(classifyContradictionKind("internal", "official")).toBe("internal_vs_official");
  });

  it("classifies official and community", () => {
    expect(classifyContradictionKind("official", "community")).toBe("official_vs_community");
  });

  it("classifies aggregator pairs", () => {
    expect(classifyContradictionKind("aggregator", "aggregator")).toBe("aggregator_only");
  });

  it("classifies community pairs", () => {
    expect(classifyContradictionKind("community", "community")).toBe("community_only");
  });

  it("classifies internal and primary", () => {
    expect(classifyContradictionKind("internal", "primary")).toBe("internal_vs_primary");
  });

  it("classifies primary and community", () => {
    expect(classifyContradictionKind("primary", "community")).toBe("primary_vs_community");
  });

  it("falls back to mixed for unmatched pairs", () => {
    expect(classifyContradictionKind("internal", "aggregator")).toBe("mixed");
    expect(classifyContradictionKind("unknown", "community")).toBe("mixed");
  });
});
