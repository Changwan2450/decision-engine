import type { ProjectRecord } from "@/lib/storage/schema";

export function PromotionCandidates({
  candidates
}: {
  candidates: ProjectRecord["promotionCandidates"];
}) {
  return (
    <section className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          KB Promotion
        </p>
        <h2 className="mt-2 text-2xl">승격 추천 상태</h2>
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">아직 추천 후보가 없다.</p>
      ) : (
        <div className="grid gap-3">
          {candidates.map((candidate) => (
            <article
              key={candidate.id}
              className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold">{candidate.title}</p>
                <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
                  {candidate.status}
                </span>
              </div>
              <p className="mt-2 text-[var(--muted)]">{candidate.summary}</p>
              <p className="mt-2 text-[var(--muted)]">
                runs: {candidate.sourceRunIds.join(", ")}
              </p>
              <p className="mt-1 text-[var(--muted)]">reason: {candidate.reason}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
