import Link from "next/link";
import { notFound } from "next/navigation";
import { RunForm } from "@/components/run/run-form";
import { readProjectRecord } from "@/lib/storage/workspace";

export default async function NewRunPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  try {
    const projectRecord = await readProjectRecord(projectId);

    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
              {projectRecord.project.name}
            </p>
            <h1 className="mt-2 text-4xl">새 리서치 런</h1>
          </div>
          <Link
            href={`/projects/${projectId}`}
            className="rounded-full border border-[var(--border)] px-5 py-3 text-sm"
          >
            프로젝트로
          </Link>
        </div>

        <RunForm projectId={projectId} />
      </main>
    );
  } catch {
    notFound();
  }
}
