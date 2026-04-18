import type { ContradictionKind, SourceTier } from "@/lib/domain/claims";

export function classifyContradictionKind(
  tierA: SourceTier,
  tierB: SourceTier
): ContradictionKind {
  const pair = new Set([tierA, tierB]);

  if (pair.has("internal") && pair.has("community")) return "internal_vs_community";
  if (pair.has("internal") && pair.has("official")) return "internal_vs_official";
  if (pair.has("internal") && pair.has("primary")) return "internal_vs_primary";
  if (pair.has("official") && pair.has("community")) return "official_vs_community";
  if (pair.has("primary") && pair.has("community")) return "primary_vs_community";
  if (tierA === "aggregator" && tierB === "aggregator") return "aggregator_only";
  if (tierA === "community" && tierB === "community") return "community_only";

  return "mixed";
}
