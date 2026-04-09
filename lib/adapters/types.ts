import type { RunMode } from "@/lib/domain/runs";
import type { NormalizedRunInput } from "@/lib/orchestrator/clarify";

export type SourceTarget = "web" | "community" | "video" | "github" | "geocoding";

export type ResearchPlan = {
  projectId: string;
  runId: string;
  title: string;
  mode: RunMode;
  normalizedInput: NormalizedRunInput;
  sourceTargets: SourceTarget[];
};

export type SourcePriority = "official" | "primary_data" | "analysis" | "community";

export type SourceArtifact = {
  id: string;
  adapter: string;
  sourceType: SourceTarget;
  title: string;
  url: string;
  snippet: string;
  content: string;
  sourcePriority: SourcePriority;
  publishedAt?: string;
  metadata: Record<string, string>;
};

export type ResearchAdapter = {
  name: string;
  supports: (plan: ResearchPlan) => boolean;
  execute: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
};
