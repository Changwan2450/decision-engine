export type NormalizedRunInput = {
  title: string;
  naturalLanguage: string;
  pastedContent: string;
  urls: string[];
  goal?: string;
  target?: string;
  comparisonAxis?: string;
};

function extractLabeledValue(source: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*(.+)`, "i");
    const match = source.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

export function normalizeRunInputs(input: {
  title: string;
  naturalLanguage?: string;
  pastedContent?: string;
  urls?: string[];
}): NormalizedRunInput {
  const naturalLanguage = input.naturalLanguage?.trim() ?? "";
  const pastedContent = input.pastedContent?.trim() ?? "";
  const combined = [input.title, naturalLanguage, pastedContent].filter(Boolean).join("\n");

  return {
    title: input.title.trim(),
    naturalLanguage,
    pastedContent,
    urls: input.urls ?? [],
    goal: extractLabeledValue(combined, ["목표", "goal"]),
    target: extractLabeledValue(combined, ["대상", "target"]),
    comparisonAxis: extractLabeledValue(combined, ["비교", "comparison", "comparison-axis"])
  };
}

export function buildClarificationQuestions(input: NormalizedRunInput): string[] {
  const questions: string[] = [];

  if (!input.goal) {
    questions.push("이번 리서치로 무엇을 결정하려는지 알려줘.");
  }

  if (!input.target) {
    questions.push("누구를 기준으로 조사할지 알려줘.");
  }

  if (!input.comparisonAxis) {
    questions.push("무엇과 비교해 판단할지 알려줘.");
  }

  return questions;
}

export function shouldClarifyRun(input: NormalizedRunInput): boolean {
  return buildClarificationQuestions(input).length > 0;
}
