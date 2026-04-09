import Link from "next/link";
import { notFound } from "next/navigation";
import { InsightBoard } from "@/components/run/insight-board";
import { PromotionCandidates } from "@/components/run/promotion-candidates";
import { listRunRecords, readProjectRecord } from "@/lib/storage/workspace";

export default async function ProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  try {
    const [projectRecord, runRecords] = await Promise.all([
      readProjectRecord(projectId),
      listRunRecords(projectId)
    ]);

    return (
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
        <section className="grid gap-4 rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-8">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Project
          </p>
          <h1 className="text-4xl">{projectRecord.project.name}</h1>
          <p className="max-w-3xl text-lg leading-8 text-[var(--muted)]">
            {projectRecord.project.description}
          </p>
          <div className="flex gap-3">
            <Link
              href={`/projects/${projectId}/runs/new`}
              className="rounded-full bg-[var(--text)] px-5 py-3 text-sm text-white"
            >
              새 런 만들기
            </Link>
            <Link
              href="/"
              className="rounded-full border border-[var(--border)] px-5 py-3 text-sm"
            >
              홈으로
            </Link>
          </div>
        </section>

        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl">리서치 런</h2>
            <span className="text-sm text-[var(--muted)]">{runRecords.length} runs</span>
          </div>

          {runRecords.length === 0 ? (
            <article className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-[var(--panel)] p-6 text-[var(--muted)]">
              아직 런이 없다.
            </article>
          ) : (
            runRecords.map(({ run }) => (
              <Link
                key={run.id}
                href={`/projects/${projectId}/runs/${run.id}`}
                className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl">{run.title}</h3>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {run.status} · {run.mode}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </section>

        <InsightBoard
          repeatedProblems={projectRecord.insights.repeatedProblems}
          repeatedPatterns={projectRecord.insights.repeatedPatterns}
          competitorSignals={projectRecord.insights.competitorSignals}
          contradictionIds={projectRecord.insights.contradictionIds}
        />

        <PromotionCandidates candidates={projectRecord.promotionCandidates} />
      </main>
    );
  } catch {
    notFound();
  }
}
