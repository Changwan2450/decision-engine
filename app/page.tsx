import { ProjectCreateForm } from "@/components/project/project-create-form";
import { ProjectList } from "@/components/project/project-list";
import { listProjectRecords } from "@/lib/storage/workspace";

export default async function HomePage() {
  const projects = await listProjectRecords();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      <section className="grid gap-6 rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-8 shadow-[0_24px_80px_rgba(57,44,26,0.08)] md:grid-cols-[1.4fr_0.8fr]">
        <div className="grid gap-4">
          <span className="inline-flex w-fit rounded-full border border-[var(--border)] px-4 py-1 text-sm text-[var(--muted)]">
            Decision-first local research
          </span>
          <h1 className="max-w-3xl text-5xl leading-tight tracking-tight">
            자료를 모으는 앱이 아니라,
            <br />
            결정을 끝내는 워크스페이스.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">
            프로젝트 아래에 리서치 런을 쌓고, 각 런마다 결정, 근거, 충돌,
            다음 액션까지 남긴다.
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-[var(--border)] bg-stone-950 p-6 text-stone-50">
          <p className="text-sm uppercase tracking-[0.25em] text-stone-400">
            Workspace root
          </p>
          <p className="mt-3 font-mono text-sm">./workspace</p>
          <div className="mt-6 grid gap-3 text-sm text-stone-300">
            <p>default mode: standard</p>
            <p>decision fields: go | no_go | unclear</p>
            <p>citation policy: 핵심 주장만 필수</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
        <ProjectCreateForm />
        <ProjectList projects={projects} />
      </section>
    </main>
  );
}
