import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { exportLinkitIngestBundle, type LinkitNormalizedItem } from "@/lib/bridge/linkit-export";

type LinkitPublishResponse = {
  published: number;
  items: Array<{
    id: string;
    title: string;
    category: string;
  }>;
};

export type DiscordNotifierPayload = {
  source: "linkit-publish";
  version: string;
  published_at: string;
  site_url: string;
  counts: {
    published: number;
    today: number;
    github: number;
  };
  highlights: string[];
  top_items: Array<{
    title: string;
    category: string;
    url: string;
  }>;
};

type FetchLike = typeof fetch;

function bridgeDir(projectId: string, runId: string): string {
  return path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
}

function siteOrigin(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

function postPath(siteUrl: string, id: string): string {
  return `${siteOrigin(siteUrl)}/post/${id}`;
}

function sortByScore(items: LinkitNormalizedItem[]): LinkitNormalizedItem[] {
  return items.slice().sort((left, right) => right.score - left.score);
}

export function buildDiscordNotifierPayload(
  publishedItems: LinkitNormalizedItem[],
  siteUrl: string,
  publishedRows: Array<{ id: string; title: string; category: string }>,
): DiscordNotifierPayload {
  const publishedAt = new Date().toISOString();
  const version = publishedAt.slice(0, 10);
  const topByScore = sortByScore(publishedItems).slice(0, 3);
  const todayCount = topByScore.length;
  const githubCount = publishedItems.filter((item) => item.category === "github-radar").length;
  const touchedCategories = Array.from(new Set(publishedItems.map((item) => item.category)));
  const categoryLabel = touchedCategories
    .slice(0, 2)
    .map((value) =>
      value === "claude-code"
        ? "Claude Code"
        : value === "codex-cli"
          ? "Codex CLI"
          : value === "github-radar"
            ? "GitHub Radar"
            : value === "workflow"
              ? "Workflow"
              : value === "vibe-coding"
                ? "Vibe Coding"
                : "Insight",
    );

  const highlights = [
    todayCount > 0 ? `오늘의 추천 ${todayCount}개 갱신` : null,
    githubCount > 0 ? `추천 GitHub ${githubCount}개 추가` : null,
    categoryLabel.length > 0 ? `${categoryLabel.join(" / ")} 섹션 반영` : null,
  ].filter((value): value is string => Boolean(value));

  const rowByTitle = new Map(publishedRows.map((row) => [row.title, row]));

  return {
    source: "linkit-publish",
    version,
    published_at: publishedAt,
    site_url: siteOrigin(siteUrl),
    counts: {
      published: publishedItems.length,
      today: todayCount,
      github: githubCount,
    },
    highlights,
    top_items: topByScore
      .map((item) => {
        const row = rowByTitle.get(item.title);
        if (!row) {
          return null;
        }

        return {
          title: item.title,
          category: item.category,
          url: postPath(siteUrl, row.id),
        };
      })
      .filter((value): value is { title: string; category: string; url: string } => Boolean(value)),
  };
}

async function writeJson(filePath: string, payload: unknown): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function publishLinkitBatch(
  projectId: string,
  runId: string,
  options: {
    apiBaseUrl: string;
    siteUrl: string;
    actorEmail: string;
    fetchImpl?: FetchLike;
  },
) {
  const exportResult = await exportLinkitIngestBundle(projectId, runId);
  const raw = await readFile(exportResult.readyPath, "utf8");
  const readyBundle = JSON.parse(raw) as {
    items: LinkitNormalizedItem[];
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.apiBaseUrl.replace(/\/+$/, "")}/api/prototypes/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Access-User-Email": options.actorEmail,
    },
    body: JSON.stringify({
      items: readyBundle.items,
    }),
  });

  if (!response.ok) {
    throw new Error(`Linkit publish failed: ${response.status} ${response.statusText}`);
  }

  const publishResult = (await response.json()) as LinkitPublishResponse;
  const notifier = buildDiscordNotifierPayload(readyBundle.items, options.siteUrl, publishResult.items);
  const dir = bridgeDir(projectId, runId);

  const publishResultPath = await writeJson(path.join(dir, "linkit-publish-result.json"), publishResult);
  const notifierPath = await writeJson(path.join(dir, "discord-notifier.json"), notifier);

  return {
    ...exportResult,
    publishResultPath,
    notifierPath,
    published: publishResult.published,
  };
}
