import { getUpdateCachePath, readJson, writeJson } from "./config-store.js";

export interface UpdateCache {
  lastCheck: string;
  latestVersion: string;
  currentVersion: string;
  assetUrl: string | null;
}

export interface LatestRelease {
  version: string;
  assetUrl: string | null;
}

const GITHUB_RELEASE_URL =
  "https://api.github.com/repos/VidGuiCode/dolibarr-cli/releases/latest";
const DEFAULT_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Strip a leading "v" and any pre-release / build suffix (e.g. "1.2.3-rc.1" → "1.2.3").
 * Returns the cleaned version string.
 */
export function normalizeVersion(v: string): string {
  const noV = v.startsWith("v") ? v.slice(1) : v;
  const core = noV.split(/[-+]/)[0];
  return core;
}

/**
 * Compare two semver-like version strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Only major.minor.patch are compared; pre-release / build suffixes are ignored.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = normalizeVersion(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Fetch the latest release metadata from GitHub. Returns the version (normalized)
 * and the first .tgz asset URL. Throws on network / parse error / timeout.
 *
 * @param timeoutMs abort the request if it runs longer than this. Defaults to 5s.
 */
export async function fetchLatestRelease(
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<LatestRelease> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GITHUB_RELEASE_URL, {
      headers: {
        "User-Agent": "dolibarr-cli",
        Accept: "application/vnd.github+json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`);
    }

    const data = (await res.json()) as {
      tag_name?: string;
      assets?: Array<{ browser_download_url?: string; name?: string }>;
    };

    if (!data.tag_name) {
      throw new Error("GitHub release missing tag_name");
    }

    const tgzAsset = (data.assets ?? []).find((a) =>
      (a.browser_download_url ?? "").endsWith(".tgz"),
    );

    return {
      version: normalizeVersion(data.tag_name),
      assetUrl: tgzAsset?.browser_download_url ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function readCache(): UpdateCache | null {
  return readJson<UpdateCache>(getUpdateCachePath());
}

export function writeCache(data: UpdateCache): void {
  writeJson(getUpdateCachePath(), data);
}

export function isCacheStale(
  cache: UpdateCache | null,
  maxAgeMs: number = DEFAULT_STALE_MS,
  now: number = Date.now(),
): boolean {
  if (!cache) return true;
  const last = Date.parse(cache.lastCheck);
  if (Number.isNaN(last)) return true;
  return now - last > maxAgeMs;
}

export function isOutdated(cache: UpdateCache | null, currentVersion: string): boolean {
  if (!cache) return false;
  return compareVersions(cache.latestVersion, currentVersion) > 0;
}
