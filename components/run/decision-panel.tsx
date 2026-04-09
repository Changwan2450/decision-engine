import type { Decision } from "@/lib/domain/decision";

export function DecisionPanel({ decision }: { decision: Decision | null }) {
  return (
    <section className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Decision
        </p>
        {decision ? (
          <>
            <h2 className="mt-2 text-3xl">{decision.value}</h2>
            <p className="mt-3 text-[var(--muted)]">{decision.why}</p>
          </>
        ) : (
          <>
            <h2 className="mt-2 text-3xl">pending</h2>
            <p className="mt-3 text-[var(--muted)]">아직 evidence 기반 결정이 없다.</p>
          </>
        )}
      </div>

      {decision ? (
        <div className="grid gap-4 text-sm">
          <p>confidence: {decision.confidence}</p>
          <div>
            <p className="font-semibold">blocking unknowns</p>
            <ul className="mt-2 grid gap-2 text-[var(--muted)]">
              {decision.blockingUnknowns.length > 0 ? (
                decision.blockingUnknowns.map((item) => <li key={item}>- {item}</li>)
              ) : (
                <li>- 없음</li>
              )}
            </ul>
          </div>
          <div>
            <p className="font-semibold">next actions</p>
            <ul className="mt-2 grid gap-2 text-[var(--muted)]">
              {decision.nextActions.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
