import type { Claim } from "@/lib/domain/claims";

const OPPOSE_PATTERNS = [
  "not worth",
  "isn't worth",
  "is not worth",
  "trade-off simply isn't worth",
  "trade off simply isn't worth",
  "mistake",
  "bad idea",
  "avoid",
  "don't recommend",
  "do not recommend",
  "regret",
  "mental overhead",
  "nightmare",
  "overhead",
  "bloat",
  "over-engineered",
  "over-engineering",
  "complexity explosion",
  "never again",
  "shouldn't use",
  "should not use",
  "안 좋",
  "좋지 않",
  "추천하지 않",
  "비추천",
  "반대",
  "실수",
  "후회",
  "과잉",
  "복잡도 폭발",
  "문제가 있",
  "쓰지 말",
  "도입하지 말",
  "피해야"
] as const;

const SUPPORT_PATTERNS = [
  "worth it",
  "should use",
  "great choice",
  "love it",
  "essential",
  "must use",
  "best choice",
  "추천",
  "좋다",
  "좋음",
  "훌륭",
  "필수",
  "도입할 만",
  "권장"
] as const;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
  "가",
  "것",
  "는",
  "도",
  "를",
  "에",
  "의",
  "이",
  "은",
  "하다",
  "하는"
]);

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function slugify(value: string): string {
  return normalize(value)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

function buildAcronym(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("");
}

function countLiteralMatches(text: string, patterns: readonly string[]): number {
  return patterns.reduce((count, pattern) => count + (text.includes(pattern) ? 1 : 0), 0);
}

export function inferClaimStance(text: string): Claim["stance"] {
  const normalized = normalize(text);
  const opposeCount = countLiteralMatches(normalized, OPPOSE_PATTERNS);
  const supportCount =
    countLiteralMatches(
      normalized,
      SUPPORT_PATTERNS.filter((pattern) => {
        if (pattern === "추천" && normalized.includes("추천하지")) {
          return false;
        }
        return true;
      })
    ) +
    (/\brecommend\b/u.test(normalized) &&
    !/\b(?:don't|do not)\s+recommend\b/u.test(normalized)
      ? 1
      : 0);

  if (opposeCount > supportCount) {
    return "oppose";
  }
  if (supportCount > opposeCount) {
    return "support";
  }
  return "neutral";
}

function tokenize(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function extractTopicAnchors(
  claimTexts: string[],
  options?: { maxAnchors?: number; minOccurrences?: number }
): string[] {
  const maxAnchors = options?.maxAnchors ?? 10;
  const minOccurrences = options?.minOccurrences ?? 2;
  const counts = new Map<string, number>();

  for (const text of claimTexts) {
    const tokens = tokenize(text).filter(
      (token) => token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/u.test(token)
    );
    const seen = new Set<string>();

    for (let start = 0; start < tokens.length; start += 1) {
      for (let size = 1; size <= 3 && start + size <= tokens.length; size += 1) {
        const anchor = tokens.slice(start, start + size).join(" ");
        if (seen.has(anchor)) continue;
        seen.add(anchor);
        counts.set(anchor, (counts.get(anchor) ?? 0) + 1);
      }
    }
  }

  const sorted = Array.from(counts.entries())
    .filter(([, count]) => count >= minOccurrences)
    .sort((left, right) => {
      const countDiff = right[1] - left[1];
      if (countDiff !== 0) return countDiff;
      const wordDiff = right[0].split(" ").length - left[0].split(" ").length;
      if (wordDiff !== 0) return wordDiff;
      return left[0].localeCompare(right[0]);
    });

  const nestedDeduped = sorted.filter(([anchor, count], index) => {
    const normalizedAnchor = anchor.trim();
    return !sorted.some(([candidate, candidateCount], candidateIndex) => {
      if (candidateIndex === index || candidateCount !== count) {
        return false;
      }

      const normalizedCandidate = candidate.trim();
      return (
        normalizedCandidate.length > normalizedAnchor.length &&
        normalizedCandidate.includes(normalizedAnchor)
      );
    });
  });

  return nestedDeduped.slice(0, maxAnchors).map(([anchor]) => anchor);
}

export function assignTopicKey(text: string, anchors: string[]): string | undefined {
  const normalized = normalize(text);
  const match = [...anchors]
    .sort((left, right) => {
      const wordDiff = right.split(" ").length - left.split(" ").length;
      if (wordDiff !== 0) return wordDiff;
      return right.length - left.length;
    })
    .find((anchor) => {
      if (normalized.includes(anchor)) {
        return true;
      }

      const acronym = buildAcronym(anchor);
      return acronym.length >= 2 && new RegExp(`\\b${acronym}\\b`, "u").test(normalized);
    });

  return match ? slugify(match) : undefined;
}
