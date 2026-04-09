import Link from "next/link";
import type { ProjectRecord } from "@/lib/storage/schema";

export function ProjectList({ projects }: { projects: ProjectRecord[] }) {
  if (projects.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-dashed border-[var(--border)] bg-[var(--panel)] p-6">
        <h2 className="text-2xl">아직 프로젝트가 없다.</h2>
        <p className="mt-2 text-[var(--muted)]">
          name과 description만으로 시작하고, 각 프로젝트 아래에 리서치 런이 쌓인다.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 md:grid-cols-2">
      {projects.map(({ project, insights }) => (
        <Link
          key={project.id}
          href={`/projects/${project.id}`}
          className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6 transition hover:-translate-y-0.5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl">{project.name}</h2>
              <p className="mt-3 leading-7 text-[var(--muted)]">{project.description}</p>
            </div>
            <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
              {insights.contradictionIds.length} conflicts
            </span>
          </div>
        </Link>
      ))}
    </section>
  );
}
