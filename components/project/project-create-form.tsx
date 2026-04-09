"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ProjectCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, description })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "프로젝트를 만들지 못했다.");
      }

      const payload = (await response.json()) as { project: { id: string } };
      router.push(`/projects/${payload.project.id}`);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "프로젝트를 만들지 못했다."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] p-6"
    >
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          New project
        </p>
        <h2 className="mt-2 text-2xl">프로젝트 시작</h2>
      </div>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">name</span>
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">description</span>
        <textarea
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none"
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-[var(--text)] px-5 py-3 text-sm text-white disabled:opacity-60"
      >
        {isSubmitting ? "생성 중..." : "프로젝트 만들기"}
      </button>
    </form>
  );
}
