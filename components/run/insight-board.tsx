export function InsightBoard({
  repeatedProblems,
  repeatedPatterns,
  competitorSignals,
  contradictionIds
}: {
  repeatedProblems: string[];
  repeatedPatterns: string[];
  competitorSignals: string[];
  contradictionIds: string[];
}) {
  return (
    <section className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Insight Board
        </p>
        <h2 className="mt-2 text-2xl">프로젝트 공통 인사이트</h2>
      </div>

      <div className="grid gap-4 text-sm text-[var(--muted)] md:grid-cols-2">
        <div>
          <p className="font-semibold text-[var(--text)]">반복 문제 정의</p>
          <ul className="mt-2 grid gap-2">
            {repeatedProblems.length > 0 ? repeatedProblems.map((item) => <li key={item}>- {item}</li>) : <li>- 없음</li>}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-[var(--text)]">반복 해결 패턴</p>
          <ul className="mt-2 grid gap-2">
            {repeatedPatterns.length > 0 ? repeatedPatterns.map((item) => <li key={item}>- {item}</li>) : <li>- 없음</li>}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-[var(--text)]">경쟁사/대체재 신호</p>
          <ul className="mt-2 grid gap-2">
            {competitorSignals.length > 0 ? competitorSignals.map((item) => <li key={item}>- {item}</li>) : <li>- 없음</li>}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-[var(--text)]">충돌 주장</p>
          <ul className="mt-2 grid gap-2">
            {contradictionIds.length > 0 ? contradictionIds.map((item) => <li key={item}>- {item}</li>) : <li>- 없음</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
