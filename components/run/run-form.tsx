"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [pastedContent, setPastedContent] = useState("");
  const [urls, setUrls] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const urlList = urls
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId,
          title,
          naturalLanguage,
          pastedContent,
          urls: urlList
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "런을 만들지 못했다.");
      }

      const payload = (await response.json()) as { run: { id: string } };
      router.push(`/projects/${projectId}/runs/${payload.run.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "런을 만들지 못했다.");
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
          New run
        </p>
        <h1 className="mt-2 text-3xl">리서치 런 시작</h1>
      </div>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">title</span>
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">natural language</span>
        <textarea
          value={naturalLanguage}
          onChange={(event) => setNaturalLanguage(event.target.value)}
          rows={4}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">pasted content</span>
        <textarea
          value={pastedContent}
          onChange={(event) => setPastedContent(event.target.value)}
          rows={6}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 outline-none"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--muted)]">urls</span>
        <textarea
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
          rows={4}
          placeholder={"https://example.com/post\nhttps://example.com/thread"}
          className="rounded-2xl border border-[var(--border)] bg-transparent px-4 py-3 font-mono text-sm outline-none"
        />
      </label>

      <p className="text-sm text-[var(--muted)]">기본 모드: standard</p>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-[var(--text)] px-5 py-3 text-sm text-white disabled:opacity-60"
      >
        {isSubmitting ? "생성 중..." : "런 만들기"}
      </button>
    </form>
  );
}
