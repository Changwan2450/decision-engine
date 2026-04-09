import { NextResponse } from "next/server";
import { executeResearchRun } from "@/lib/orchestrator/run-research";
import { gatherE2EArtifacts } from "@/lib/testing/e2e-fixture";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const updated = await executeResearchRun(projectId, runId, {
      gather: process.env.PLAYWRIGHT_TEST ? gatherE2EArtifacts : undefined
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "런 실행 실패" },
      { status: 400 }
    );
  }
}
