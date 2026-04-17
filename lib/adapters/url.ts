// URL canonicalization utility for the Decision Engine adapter layer.
//
// Purpose: produce a stable, dedupe-friendly form of a URL. Two URLs that
// point to "the same resource" should canonicalize to the same string, so
// that artifacts from different adapters collapse in downstream dedupe.
//
// This is intentionally conservative — we don't try to know every site's
// routing semantics. We only strip things that are known to be safe:
//   1. tracking query params (utm_*, fbclid, gclid, igshid, mc_*, ref_src,
//      _hsenc, _hsmi, etc.)
//   2. URL fragments (#section) — they point inside a page, not to a different
//      resource for our synthesis purposes
//   3. trailing slash on the path (but preserving bare origin)
//   4. case-normalize scheme + host
//   5. default port removal (:80 for http, :443 for https)
//
// We do NOT:
//   - normalize path case (some sites are case-sensitive)
//   - reorder remaining query params (could break signed URLs)
//   - decode/encode percent-encoding (destructive)

const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^utm_/i,
  /^ga_/i,
  /^mc_/i,
  /^ref_src$/i,
  /^ref_url$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^hsCtaTracking$/i
];

const TRACKING_PARAM_EXACT: Set<string> = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "twclid",
  "igshid",
  "mkt_tok",
  "vero_id",
  "vero_conv",
  "oly_anon_id",
  "oly_enc_id",
  "spm"
]);

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443"
};

function isTrackingParam(name: string): boolean {
  if (TRACKING_PARAM_EXACT.has(name.toLowerCase())) return true;
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

function stripTrailingSlash(pathname: string): string {
  if (pathname === "/" || pathname === "") return pathname;
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Canonicalize a URL for dedupe and cache-key purposes.
 *
 * Returns the original string unchanged if it cannot be parsed as a URL
 * (so downstream code can still use it as an opaque identifier).
 */
export function canonicalize(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  const trimmed = rawUrl.trim();
  if (trimmed === "") return "";

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // 1. case-normalize scheme + host (per RFC 3986)
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // 2. drop default port
  const defaultPort = DEFAULT_PORTS[u.protocol];
  if (defaultPort && u.port === defaultPort) {
    u.port = "";
  }

  // 3. drop fragment
  u.hash = "";

  // 4. strip tracking params (preserve order of remaining)
  const paramsToDelete: string[] = [];
  u.searchParams.forEach((_value, key) => {
    if (isTrackingParam(key)) paramsToDelete.push(key);
  });
  for (const key of paramsToDelete) {
    u.searchParams.delete(key);
  }

  // 5. trailing slash on path
  u.pathname = stripTrailingSlash(u.pathname);

  // URL.toString() re-encodes; serialize manually to avoid surprises with
  // empty query when all params were stripped.
  const queryString = u.searchParams.toString();
  const port = u.port ? `:${u.port}` : "";
  const auth =
    u.username || u.password
      ? `${u.username}${u.password ? `:${u.password}` : ""}@`
      : "";
  return `${u.protocol}//${auth}${u.hostname}${port}${u.pathname}${
    queryString ? `?${queryString}` : ""
  }`;
}

/**
 * Domain extraction helper used by the router. Returns lowercased eTLD+1-ish
 * form (we don't pull in psl dep; naive 2-label suffix is enough for routing).
 */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
