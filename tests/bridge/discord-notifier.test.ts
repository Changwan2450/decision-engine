import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscordNotifierPayload } from "@/lib/bridge/linkit-publish";

let tempRoot: string | null = null;

describe("discord notifier bridge", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("renders and sends discord notifier payload", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-discord-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { sendDiscordNotifierFromFile, renderDiscordNotifierMessage } = await import(
      "@/lib/bridge/discord-notifier"
    );

    const payload: DiscordNotifierPayload = {
      source: "linkit-publish",
      version: "2026-04-13",
      published_at: "2026-04-13T10:00:00.000Z",
      site_url: "https://linkit.site",
      counts: {
        published: 2,
        today: 2,
        github: 1,
      },
      highlights: [
        "오늘의 추천 2개 갱신",
        "추천 GitHub 1개 추가",
      ],
      top_items: [
        {
          title: "OpenAI Codex Plugin 관련 저장소",
          category: "codex-cli",
          url: "https://linkit.site/post/link_1",
        },
      ],
    };

    const bridgeDir = path.join(tempRoot, "project-1", "runs", "run-1", "bridge");
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(path.join(bridgeDir, "discord-notifier.json"), JSON.stringify(payload, null, 2), "utf8");

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("https://discord.com/api/webhooks/test?wait=true");
      const body = JSON.parse(String(init?.body)) as { content: string; allowed_mentions: { parse: string[] } };
      expect(body.content).toContain("Linkit 업데이트");
      expect(body.content).toContain("https://linkit.site");
      expect(body.allowed_mentions.parse).toEqual([]);

      return new Response(
        JSON.stringify({
          id: "discord-msg-1",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    });

    const result = await sendDiscordNotifierFromFile("project-1", "run-1", {
      webhookUrl: "https://discord.com/api/webhooks/test",
      fetchImpl,
    });

    const sendResult = JSON.parse(await readFile(result.resultPath, "utf8")) as { ok: boolean; webhook_message_id: string };

    expect(renderDiscordNotifierMessage(payload)).toContain("오늘의 추천 2개 갱신");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.webhookMessageId).toBe("discord-msg-1");
    expect(sendResult.ok).toBe(true);
    expect(sendResult.webhook_message_id).toBe("discord-msg-1");
  });
});
