import type { ResearchAdapter } from "@/lib/adapters/types";

export function createReclipAdapter(): ResearchAdapter {
  return {
    name: "reclip",
    supports(plan) {
      return plan.sourceTargets.includes("video");
    },
    async execute() {
      return [];
    }
  };
}
