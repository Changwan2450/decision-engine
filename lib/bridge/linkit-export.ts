import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceArtifact } from "@/lib/adapters/types";
import { WORKSPACE_ROOT } from "@/lib/config";
import { readRunRecord } from "@/lib/storage/workspace";

export type LinkitNormalizedItem = {
  digest_section: string;
  section: string;
  title: string;
  summary: string;
  url: string | null;
  canonical_url: string | null;
  source_type: string;
  source_name: string;
  category: string;
  author_handle: string | null;
  author_name: string | null;
  community_name: string | null;
  repo_name: string | null;
  repo_url: string | null;
  score: number;
  like_count: number | null;
  comment_count: number | null;
  stars: number | null;
  star_delta: number | null;
  published_at: string | null;
  raw_time_text: string | null;
  raw_digest_line: string;
  dedupe_key: string;
  needs_enrichment: boolean;
};

type LinkitItemBundle = {
  source: "agent-reach-digest";
  version: string;
  collected_at: string;
  items: LinkitNormalizedItem[];
};

function bridgeDir(projectId: string, runId: string): string {
  return path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
}

function parseNumber(value?: string): number | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d.-]/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRawTimeText(publishedAt?: string): string | null {
  if (!publishedAt) {
    return null;
  }

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/^[\s\-*•·]+/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/가 공유됐다$/u, "")
    .replace(/이 공유됐다$/u, "")
    .replace(/가 주목받고 있다$/u, "")
    .replace(/이 주목받고 있다$/u, "")
    .replace(/가 참고 후보로 수집됐다$/u, "")
    .replace(/이 참고 후보로 수집됐다$/u, "")
    .trim();
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

function inferSourceType(artifact: SourceArtifact): string {
  if (artifact.metadata.source_type) {
    return artifact.metadata.source_type;
  }

  if (artifact.url.includes("github.com")) {
    return "github";
  }

  if (artifact.url.includes("reddit.com")) {
    return "reddit";
  }

  if (artifact.url.includes("x.com") || artifact.url.includes("twitter.com")) {
    return "x";
  }

  if (artifact.sourceType === "github") {
    return "github";
  }

  if (artifact.sourceType === "community") {
    return artifact.metadata.community_name ? "reddit" : "community";
  }

  return artifact.sourceType;
}

function inferSourceName(sourceType: string): string {
  switch (sourceType) {
    case "github":
      return "GitHub";
    case "reddit":
      return "Reddit";
    case "x":
      return "X";
    case "video":
      return "Video";
    case "community":
      return "Community";
    default:
      return "Web";
  }
}

function inferDigestSection(sourceType: string, metadata: Record<string, string>): { digestSection: string; section: string } {
  if (metadata.digest_section && metadata.section) {
    return {
      digestSection: metadata.digest_section,
      section: metadata.section
    };
  }

  switch (sourceType) {
    case "github":
      return { digestSection: "프로젝트/리포", section: "project_repo" };
    case "reddit":
      return { digestSection: "실사용/Reddit", section: "reddit" };
    case "x":
      return { digestSection: "인사이트/X", section: "insight" };
    default:
      return { digestSection: "웹 참고", section: "web" };
  }
}

function inferCategory(artifact: SourceArtifact, sourceType: string): string {
  if (artifact.metadata.category) {
    return artifact.metadata.category;
  }

  const haystack = [
    artifact.title,
    artifact.snippet,
    artifact.content,
    artifact.url,
    artifact.metadata.repo_name ?? ""
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("codex")) {
    return "codex-cli";
  }

  if (haystack.includes("claude code")) {
    return "claude-code";
  }

  if (haystack.includes("vibe")) {
    return "vibe-coding";
  }

  if (haystack.includes("workflow") || haystack.includes("agent")) {
    return "workflow";
  }

  if (sourceType === "github") {
    return "github-radar";
  }

  return "insight";
}

function buildSummary(artifact: SourceArtifact, title: string): string {
  const summary = artifact.metadata.summary ?? artifact.snippet ?? artifact.content;
  const compact = summary.replace(/\s+/g, " ").trim();

  if (compact) {
    return compact.slice(0, 180);
  }

  return `${title} 관련 참고 항목`;
}

function buildRawDigestLine(
  title: string,
  metadata: Record<string, string>,
  score: number,
  sourceType: string,
  rawTimeText: string | null
): string {
  if (metadata.raw_digest_line) {
    return metadata.raw_digest_line;
  }

  const parts: string[] = [];

  if (metadata.author_handle) {
    parts.push(metadata.author_handle);
  } else if (metadata.community_name) {
    parts.push(metadata.community_name);
  }

  if (sourceType === "github" && score > 0) {
    parts.push(`stars ${score}`);
  } else if (sourceType === "x" && score > 0) {
    parts.push(`좋아요 ${score}`);
  } else if (sourceType === "reddit" && score > 0) {
    parts.push(`점수 ${score}`);
  }

  if (metadata.comment_count) {
    parts.push(`댓글 ${metadata.comment_count}`);
  }

  if (rawTimeText) {
    parts.push(rawTimeText);
  }

  return parts.length > 0 ? `${title} (${parts.join(", ")})` : title;
}

function buildDedupeKey(
  sourceType: string,
  canonicalUrl: string | null,
  normalizedTitle: string,
  publishedAt: string | null
): string {
  if (canonicalUrl) {
    return `${sourceType}:${canonicalUrl}`;
  }

  const publishedDay = publishedAt ? publishedAt.slice(0, 10) : "unknown";
  return `${sourceType}:${slugify(normalizedTitle)}:${publishedDay}`;
}

function normalizeArtifact(artifact: SourceArtifact): LinkitNormalizedItem {
  const sourceType = inferSourceType(artifact);
  const sourceName = inferSourceName(sourceType);
  const { digestSection, section } = inferDigestSection(sourceType, artifact.metadata);
  const title = normalizeTitle(artifact.metadata.title ?? artifact.title);
  const treatUrlAsMissing =
    artifact.metadata.url_missing === "true" ||
    (artifact.metadata.needs_enrichment === "true" && !artifact.metadata.canonical_url);
  const exportedUrl = treatUrlAsMissing ? null : artifact.url || null;
  const canonicalUrl = artifact.metadata.canonical_url ?? (treatUrlAsMissing ? null : artifact.url || null);
  const repoUrl = artifact.metadata.repo_url ?? (sourceType === "github" ? canonicalUrl : null);
  const score =
    parseNumber(artifact.metadata.score) ??
    parseNumber(artifact.metadata.like_count) ??
    parseNumber(artifact.metadata.stars) ??
    parseNumber(artifact.metadata.comment_count) ??
    0;
  const rawTimeText = artifact.metadata.raw_time_text ?? formatRawTimeText(artifact.publishedAt);
  const needsEnrichment =
    artifact.metadata.needs_enrichment === "true" ||
    !exportedUrl ||
    !canonicalUrl ||
    !title ||
    !section ||
    !inferCategory(artifact, sourceType);
  const dedupeKey = buildDedupeKey(sourceType, canonicalUrl, title, artifact.publishedAt ?? null);

  return {
    digest_section: digestSection,
    section,
    title,
    summary: buildSummary(artifact, title),
    url: exportedUrl,
    canonical_url: canonicalUrl,
    source_type: sourceType,
    source_name: sourceName,
    category: inferCategory(artifact, sourceType),
    author_handle: artifact.metadata.author_handle ?? null,
    author_name: artifact.metadata.author_name ?? null,
    community_name: artifact.metadata.community_name ?? null,
    repo_name: artifact.metadata.repo_name ?? null,
    repo_url: repoUrl,
    score,
    like_count: parseNumber(artifact.metadata.like_count),
    comment_count: parseNumber(artifact.metadata.comment_count),
    stars: parseNumber(artifact.metadata.stars),
    star_delta: parseNumber(artifact.metadata.star_delta),
    published_at: artifact.publishedAt ?? null,
    raw_time_text: rawTimeText,
    raw_digest_line: buildRawDigestLine(title, artifact.metadata, score, sourceType, rawTimeText),
    dedupe_key: dedupeKey,
    needs_enrichment: needsEnrichment
  };
}

function sortItems(items: LinkitNormalizedItem[]): LinkitNormalizedItem[] {
  return items.slice().sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if ((right.published_at ?? "") !== (left.published_at ?? "")) {
      return (right.published_at ?? "").localeCompare(left.published_at ?? "");
    }

    return left.title.localeCompare(right.title);
  });
}

function isReadyItem(item: LinkitNormalizedItem): boolean {
  return (
    !!item.url &&
    !!item.canonical_url &&
    !!item.title &&
    !!item.section &&
    !!item.category &&
    !item.needs_enrichment
  );
}

function pickPreferredItem(current: LinkitNormalizedItem, candidate: LinkitNormalizedItem): LinkitNormalizedItem {
  if (candidate.score !== current.score) {
    return candidate.score > current.score ? candidate : current;
  }

  if ((candidate.published_at ?? "") !== (current.published_at ?? "")) {
    return (candidate.published_at ?? "") > (current.published_at ?? "") ? candidate : current;
  }

  if ((candidate.comment_count ?? -1) !== (current.comment_count ?? -1)) {
    return (candidate.comment_count ?? -1) > (current.comment_count ?? -1) ? candidate : current;
  }

  return candidate.raw_digest_line.length > current.raw_digest_line.length ? candidate : current;
}

function buildReadyItems(items: LinkitNormalizedItem[]): LinkitNormalizedItem[] {
  const deduped = new Map<string, LinkitNormalizedItem>();

  for (const item of items) {
    if (!isReadyItem(item)) {
      continue;
    }

    const existing = deduped.get(item.dedupe_key);
    if (!existing) {
      deduped.set(item.dedupe_key, item);
      continue;
    }

    deduped.set(item.dedupe_key, pickPreferredItem(existing, item));
  }

  return sortItems(Array.from(deduped.values()));
}

function renderDigest(items: LinkitNormalizedItem[]): string {
  const sections = new Map<string, LinkitNormalizedItem[]>();

  for (const item of items) {
    const bucket = sections.get(item.digest_section) ?? [];
    bucket.push(item);
    sections.set(item.digest_section, bucket);
  }

  const lines = [
    "Agent Reach Digest",
    "X, Reddit, Web 기준 최신 핵심만 추림"
  ];

  for (const [sectionName, sectionItems] of sections) {
    lines.push(sectionName);
    for (const item of sortItems(sectionItems)) {
      lines.push(item.raw_digest_line);
    }
  }

  return lines.join("\n");
}

async function writeBundle(filePath: string, payload: LinkitItemBundle | string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function exportLinkitIngestBundle(projectId: string, runId: string) {
  const runRecord = await readRunRecord(projectId, runId);
  const normalizedItems = sortItems(runRecord.artifacts.map(normalizeArtifact));
  const readyItems = buildReadyItems(normalizedItems);
  const collectedAt = new Date().toISOString();
  const version = collectedAt.slice(0, 10);
  const dir = bridgeDir(projectId, runId);

  const normalizedBundle: LinkitItemBundle = {
    source: "agent-reach-digest",
    version,
    collected_at: collectedAt,
    items: normalizedItems
  };

  const readyBundle: LinkitItemBundle = {
    source: "agent-reach-digest",
    version,
    collected_at: collectedAt,
    items: readyItems
  };

  const digestPath = await writeBundle(path.join(dir, "digest.txt"), renderDigest(normalizedItems));
  const normalizedPath = await writeBundle(path.join(dir, "normalized-items.json"), normalizedBundle);
  const readyPath = await writeBundle(path.join(dir, "linkit-ready-items.json"), readyBundle);

  return {
    projectId,
    runId,
    digestPath,
    normalizedPath,
    readyPath,
    normalizedCount: normalizedItems.length,
    readyCount: readyItems.length
  };
}
