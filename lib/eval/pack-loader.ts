import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import {
  PackV1Schema,
  PackV2DraftSchema,
  type PackV1,
  type PackV2Draft
} from "@/lib/eval/pack-schema";

function loadYamlFile(absolutePath: string): unknown {
  return load(readFileSync(absolutePath, "utf8"));
}

export function loadPackV1(absolutePath: string): PackV1 {
  return PackV1Schema.parse(loadYamlFile(absolutePath));
}

export function loadPackV2Draft(absolutePath: string): PackV2Draft {
  return PackV2DraftSchema.parse(loadYamlFile(absolutePath));
}
