import { describe, expect, it } from "vitest";
import {
  buildClarificationQuestions,
  normalizeRunInputs,
  shouldClarifyRun
} from "@/lib/orchestrator/clarify";

describe("clarification gate", () => {
  it("does not ask questions when goal, target, and comparison axis are present", () => {
    const normalized = normalizeRunInputs({
      title: "숏츠 시장조사",
      naturalLanguage:
        "목표: 숏츠 시장 진입 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스",
      pastedContent: "본문 요약",
      urls: ["https://example.com/source"]
    });

    expect(shouldClarifyRun(normalized)).toBe(false);
    expect(buildClarificationQuestions(normalized)).toEqual([]);
  });

  it("asks only for missing fields", () => {
    const normalized = normalizeRunInputs({
      title: "숏츠 조사",
      naturalLanguage: "목표: 숏츠 주제 결정",
      pastedContent: undefined,
      urls: []
    });

    expect(shouldClarifyRun(normalized)).toBe(true);
    expect(buildClarificationQuestions(normalized)).toEqual([
      "누구를 기준으로 조사할지 알려줘.",
      "무엇과 비교해 판단할지 알려줘."
    ]);
  });
});
