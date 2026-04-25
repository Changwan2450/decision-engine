import { execFileSync } from "node:child_process";

export type RuntimeProvenance = {
  gitHead: string | null;
  nodeVersion: string;
  processStartTime: string;
  entrypoint: string | null;
};

const processStartTime = new Date(
  Date.now() - process.uptime() * 1000
).toISOString();

function readGitHead(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function collectRuntimeProvenance(): RuntimeProvenance {
  return {
    gitHead: readGitHead(),
    nodeVersion: process.version,
    processStartTime,
    entrypoint: process.argv[1] ?? null
  };
}
