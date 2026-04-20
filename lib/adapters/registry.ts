import { createAgentReachAdapter } from "@/lib/adapters/agent-reach";
import { createCommunitySearchJsonAdapter } from "@/lib/adapters/community-search-json";
import { createGeocodingAdapter } from "@/lib/adapters/geocoding";
import { createOpenDataLoaderPdfAdapter } from "@/lib/adapters/opendataloader-pdf";
import type { AdapterName } from "@/lib/adapters/router";
import { createReclipAdapter } from "@/lib/adapters/reclip";
import { createCliExecutor, createScraplingAdapter } from "@/lib/adapters/scrapling";
import type { ResearchAdapter } from "@/lib/adapters/types";

export type AdapterRegistry = Partial<Record<AdapterName, ResearchAdapter>>;

export function createAdapterRegistry(): AdapterRegistry {
  return {
    "agent-reach": createAgentReachAdapter(),
    "community-search-json": createCommunitySearchJsonAdapter(),
    "opendataloader-pdf": createOpenDataLoaderPdfAdapter(),
    scrapling: createScraplingAdapter({
      exec: createCliExecutor()
    }),
    reclip: createReclipAdapter(),
    geocoding: createGeocodingAdapter()
  };
}
