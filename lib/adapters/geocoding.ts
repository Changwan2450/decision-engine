import type { ResearchAdapter } from "@/lib/adapters/types";

export function createGeocodingAdapter(): ResearchAdapter {
  return {
    name: "geocoding",
    supports(plan) {
      return plan.sourceTargets.includes("geocoding");
    },
    async execute() {
      return [];
    }
  };
}
