import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionPanel } from "@/components/run/decision-panel";
import { EvidencePanel } from "@/components/run/evidence-panel";
import { ExecuteRunButton } from "@/components/run/execute-run-button";
import { readRunRecord } from "@/lib/storage/workspace";

export default async function RunDetailPage({
  params
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;

  try {
    const record = await readRunRecord(projectId, runId);

    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
              Run Detail
            </p>
            <h1 className="mt-2 text-4xl">{record.run.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ExecuteRunButton projectId={projectId} runId={runId} />
            <Link
              href={`/projects/${projectId}`}
              className="rounded-full border border-[var(--border)] px-5 py-3 text-sm"
            >
              프로젝트로
            </Link>
          </div>
        </div>

        <section className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
          <h2 className="text-2xl">현재 상태</h2>
          <p className="mt-3 text-[var(--muted)]">
            {record.run.status} · {record.run.mode}
          </p>
        </section>

        <DecisionPanel decision={record.decision} />

        <section className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
          <h2 className="text-2xl">입력</h2>
          <div className="grid gap-2 text-sm text-[var(--muted)]">
            <p>natural language: {record.run.input.naturalLanguage ?? "-"}</p>
            <p>pasted content: {record.run.input.pastedContent ?? "-"}</p>
            <p>urls: {record.run.input.urls.length > 0 ? record.run.input.urls.join(", ") : "-"}</p>
          </div>
        </section>

        <EvidencePanel
          claims={record.claims}
          citations={record.citations}
          contradictions={record.contradictions}
          summary={record.evidenceSummary}
        />

        <section className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
          <h2 className="text-2xl">PRD Seed</h2>
          {record.prdSeed ? (
            <div className="grid gap-3 text-sm text-[var(--muted)]">
              <p>target user: {record.prdSeed.targetUser}</p>
              <p>problem: {record.prdSeed.problem}</p>
              <p>solution hypothesis: {record.prdSeed.solutionHypothesis}</p>
              <p>feature candidates: {record.prdSeed.featureCandidates.join(" / ")}</p>
              <p>risk: {record.prdSeed.risk.join(" / ")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">아직 PRD Seed가 없다.</p>
          )}
        </section>
      </main>
    );
  } catch {
    notFound();
  }
}
