"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExecuteRunButton({
  projectId,
  runId
}: {
  projectId: string;
  runId: string;
}) {
  const router = useRouter();
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function executeRun() {
    setError(null);
    setIsExecuting(true);

    try {
      const response = await fetch(`/api/runs/${runId}/execute?projectId=${projectId}`, {
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "실행 실패");
      }

      router.refresh();
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : "실행 실패");
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={executeRun}
        disabled={isExecuting}
        className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm text-white disabled:opacity-60"
      >
        {isExecuting ? "실행 중..." : "리서치 실행"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
