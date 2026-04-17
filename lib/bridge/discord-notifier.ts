import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";
import type { DiscordNotifierPayload } from "@/lib/bridge/linkit-publish";

type FetchLike = typeof fetch;

type DiscordWebhookResponse = {
  id?: string;
  type?: number;
  content?: string;
};

function bridgeDir(projectId: string, runId: string): string {
  return path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
}

function withWaitParam(webhookUrl: string): string {
  const hasQuery = webhookUrl.includes("?");
  return `${webhookUrl}${hasQuery ? "&" : "?"}wait=true`;
}

export function renderDiscordNotifierMessage(payload: DiscordNotifierPayload): string {
  const lines = [
    "Linkit 업데이트",
    "",
    ...payload.highlights.map((line) => `- ${line}`),
    "",
    "보러가기:",
    payload.site_url,
  ];

  return lines.join("\n");
}

async function writeJson(filePath: string, payload: unknown): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function sendDiscordNotifierFromFile(
  projectId: string,
  runId: string,
  options: {
    webhookUrl: string;
    fetchImpl?: FetchLike;
  },
) {
  const filePath = path.join(bridgeDir(projectId, runId), "discord-notifier.json");
  const raw = await readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as DiscordNotifierPayload;
  const message = renderDiscordNotifierMessage(payload);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(withWaitParam(options.webhookUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: message,
      allowed_mentions: {
        parse: [],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord notifier failed: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json().catch(() => ({}))) as DiscordWebhookResponse;
  const resultPath = await writeJson(path.join(bridgeDir(projectId, runId), "discord-send-result.json"), {
    sent_at: new Date().toISOString(),
    webhook_message_id: result.id ?? null,
    ok: true,
  });

  return {
    projectId,
    runId,
    resultPath,
    message,
    webhookMessageId: result.id ?? null,
  };
}
