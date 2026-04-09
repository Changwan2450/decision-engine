import type { Claim, Citation, Contradiction, EvidenceSummary } from "@/lib/domain/claims";

export function EvidencePanel({
  claims,
  citations,
  contradictions,
  summary
}: {
  claims: Claim[];
  citations: Citation[];
  contradictions: Contradiction[];
  summary: EvidenceSummary | null;
}) {
  return (
    <section className="grid gap-5 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Evidence
        </p>
        <h2 className="mt-2 text-2xl">Claim-based evidence</h2>
      </div>

      <div className="grid gap-2 text-sm text-[var(--muted)]">
        <p>claims: {claims.length}</p>
        <p>citations: {citations.length}</p>
        <p>contradictions: {contradictions.length}</p>
        <p>shouldRemainUnclear: {summary ? String(summary.shouldRemainUnclear) : "-"}</p>
      </div>

      <div className="grid gap-3">
        {claims.length > 0 ? (
          claims.map((claim) => (
            <article
              key={claim.id}
              className="rounded-2xl border border-[var(--border)] px-4 py-3 text-sm"
            >
              <p>{claim.text}</p>
              <p className="mt-2 text-[var(--muted)]">
                stance: {claim.stance} · citations: {claim.citationIds.join(", ")}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm text-[var(--muted)]">아직 추출된 claim이 없다.</p>
        )}
      </div>
    </section>
  );
}
