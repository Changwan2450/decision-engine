import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ResearchAdapter,
  ResearchPlan,
  SourceArtifact,
  SourceTarget
} from "@/lib/adapters/types";

const execFileAsync = promisify(execFile);

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type AgentReachExecutor = (
  command: string,
  args: string[]
) => Promise<ExecResult>;

function defaultExecutor(command: string, args: string[]): Promise<ExecResult> {
  return execFileAsync(command, args).then(
    (result) => ({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    }),
    (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      exitCode: typeof error.code === "number" ? error.code : 1
    })
  );
}

function coerceSourceType(value: string): SourceTarget {
  if (value === "web" || value === "community" || value === "video" || value === "github") {
    return value;
  }

  return "web";
}

function normalizeArtifacts(stdout: string): SourceArtifact[] {
  const parsed = JSON.parse(stdout) as {
    items?: Array<{
      sourceType?: string;
      title?: string;
      url?: string;
      snippet?: string;
      content?: string;
      metadata?: Record<string, string>;
    }>;
  };

  return (parsed.items ?? []).map((item, index) => ({
    id: `agent-reach-${index}`,
    adapter: "agent-reach",
    sourceType: coerceSourceType(item.sourceType ?? "web"),
    title: item.title ?? "Untitled",
    url: item.url ?? "",
    snippet: item.snippet ?? "",
    content: item.content ?? "",
    sourcePriority: "analysis",
    metadata: item.metadata ?? {}
  }));
}

export function createAgentReachAdapter(deps?: {
  exec?: AgentReachExecutor;
}): ResearchAdapter {
  const exec = deps?.exec ?? defaultExecutor;

  return {
    name: "agent-reach",
    supports(plan: ResearchPlan) {
      return plan.sourceTargets.some((target) =>
        ["web", "community", "video", "github"].includes(target)
      );
    },
    async execute(plan: ResearchPlan) {
      const repoRoot = path.join(
        process.cwd(),
        "..",
        "git clone",
        "Agent-Reach"
      );
      const query = [
        plan.title,
        plan.normalizedInput.goal,
        plan.normalizedInput.target,
        plan.normalizedInput.comparisonAxis
      ]
        .filter(Boolean)
        .join(" | ");

      const script = [
        "import json, sys",
        "payload = {'items':[{'sourceType':'web','title':sys.argv[1],'url':(sys.argv[2] if len(sys.argv)>2 else ''),'snippet':'agent-reach placeholder'}]}",
        "print(json.dumps(payload, ensure_ascii=False))"
      ].join("; ");

      const result = await exec("python3", [
        "-c",
        script,
        query,
        plan.normalizedInput.urls[0] ?? "",
        repoRoot
      ]);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Agent-Reach execution failed");
      }

      return normalizeArtifacts(result.stdout);
    }
  };
}
