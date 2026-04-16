import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  compareVersions,
  fetchLatestRelease,
  isCacheStale,
  isOutdated,
  normalizeVersion,
  readCache,
  writeCache,
  type UpdateCache,
} from "../../src/core/updater.js";
import {
  ensureFreshCacheOnColdStart,
  maybePrintBanner,
  shouldColdStartCheck,
  shouldPrintBanner,
} from "../../src/core/update-notifier.js";

describe("normalizeVersion", () => {
  it("strips leading v", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
  });

  it("leaves bare versions alone", () => {
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
  });

  it("strips pre-release suffix", () => {
    expect(normalizeVersion("v1.2.3-rc.1")).toBe("1.2.3");
  });

  it("strips build metadata suffix", () => {
    expect(normalizeVersion("1.2.3+build.7")).toBe("1.2.3");
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(compareVersions("0.1.2", "0.1.3")).toBe(-1);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("0.9.9", "1.0.0")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
  });

  it("handles multi-digit segments correctly", () => {
    // 0.1.10 > 0.1.9 (integer compare, not lexicographic)
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("1.20.0", "1.3.0")).toBe(1);
  });

  it("ignores pre-release suffixes", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe(0);
  });
});

describe("fetchLatestRelease", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses tag_name and picks the first .tgz asset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v0.1.3",
          assets: [
            { browser_download_url: "https://example.com/readme.md" },
            { browser_download_url: "https://example.com/dolibarr-cli-0.1.3.tgz" },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestRelease();

    expect(result.version).toBe("0.1.3");
    expect(result.assetUrl).toBe("https://example.com/dolibarr-cli-0.1.3.tgz");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/VidGuiCode/dolibarr-cli/releases/latest",
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": "dolibarr-cli" }),
      }),
    );
  });

  it("returns null assetUrl when no .tgz is attached", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: "v0.2.0", assets: [] }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestRelease();
    expect(result.version).toBe("0.2.0");
    expect(result.assetUrl).toBeNull();
  });

  it("throws when GitHub returns non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404 }),
    );

    await expect(fetchLatestRelease()).rejects.toThrow(/404/);
  });

  it("throws when tag_name is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(fetchLatestRelease()).rejects.toThrow(/tag_name/);
  });
});

describe("cache round-trip", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = path.join(
      os.tmpdir(),
      `dolibarr-cli-updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.DOLIBARR_UPDATE_CACHE = tmpPath;
  });

  afterEach(() => {
    delete process.env.DOLIBARR_UPDATE_CACHE;
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  });

  it("readCache returns null when file does not exist", () => {
    expect(readCache()).toBeNull();
  });

  it("writeCache + readCache round-trips all fields", () => {
    const data: UpdateCache = {
      lastCheck: "2026-04-16T12:00:00.000Z",
      latestVersion: "0.1.3",
      currentVersion: "0.1.2",
      assetUrl: "https://example.com/x.tgz",
    };

    writeCache(data);
    expect(readCache()).toEqual(data);
  });

  it("readCache returns null on malformed JSON", () => {
    fs.writeFileSync(tmpPath, "{not json");
    expect(readCache()).toBeNull();
  });
});

describe("isCacheStale", () => {
  const now = Date.parse("2026-04-16T12:00:00.000Z");

  it("returns true when cache is null", () => {
    expect(isCacheStale(null, 1000, now)).toBe(true);
  });

  it("returns true when lastCheck is malformed", () => {
    const cache: UpdateCache = {
      lastCheck: "not a date",
      latestVersion: "0.1.3",
      currentVersion: "0.1.2",
      assetUrl: null,
    };
    expect(isCacheStale(cache, 1000, now)).toBe(true);
  });

  it("returns false at 23h old (under 24h default)", () => {
    const cache: UpdateCache = {
      lastCheck: new Date(now - 23 * 3600 * 1000).toISOString(),
      latestVersion: "0.1.3",
      currentVersion: "0.1.2",
      assetUrl: null,
    };
    expect(isCacheStale(cache, 24 * 3600 * 1000, now)).toBe(false);
  });

  it("returns true at 25h old (over 24h default)", () => {
    const cache: UpdateCache = {
      lastCheck: new Date(now - 25 * 3600 * 1000).toISOString(),
      latestVersion: "0.1.3",
      currentVersion: "0.1.2",
      assetUrl: null,
    };
    expect(isCacheStale(cache, 24 * 3600 * 1000, now)).toBe(true);
  });
});

describe("isOutdated", () => {
  const base: UpdateCache = {
    lastCheck: "2026-04-16T12:00:00.000Z",
    latestVersion: "0.1.3",
    currentVersion: "0.1.2",
    assetUrl: null,
  };

  it("returns false when cache is null", () => {
    expect(isOutdated(null, "0.1.2")).toBe(false);
  });

  it("returns true when latest > current", () => {
    expect(isOutdated(base, "0.1.2")).toBe(true);
  });

  it("returns false when latest == current", () => {
    expect(isOutdated(base, "0.1.3")).toBe(false);
  });

  it("returns false when latest < current (dev version)", () => {
    expect(isOutdated(base, "0.1.4")).toBe(false);
  });
});

describe("shouldPrintBanner", () => {
  const outdatedCache: UpdateCache = {
    lastCheck: "2026-04-16T12:00:00.000Z",
    latestVersion: "0.1.3",
    currentVersion: "0.1.2",
    assetUrl: null,
  };

  it("returns true when all conditions met", () => {
    expect(
      shouldPrintBanner(outdatedCache, "0.1.2", ["node", "dolibarr", "status"], {}, true),
    ).toBe(true);
  });

  it("returns false when stdout is not a TTY", () => {
    expect(
      shouldPrintBanner(outdatedCache, "0.1.2", ["node", "dolibarr", "status"], {}, false),
    ).toBe(false);
  });

  it("returns false when --json is in argv", () => {
    expect(
      shouldPrintBanner(
        outdatedCache,
        "0.1.2",
        ["node", "dolibarr", "invoices", "list", "--json"],
        {},
        true,
      ),
    ).toBe(false);
  });

  it("returns false when DOLIBARR_NO_UPDATE_CHECK=1", () => {
    expect(
      shouldPrintBanner(
        outdatedCache,
        "0.1.2",
        ["node", "dolibarr", "status"],
        { DOLIBARR_NO_UPDATE_CHECK: "1" },
        true,
      ),
    ).toBe(false);
  });

  it("returns false for upgrade command itself", () => {
    expect(
      shouldPrintBanner(
        outdatedCache,
        "0.1.2",
        ["node", "dolibarr", "upgrade"],
        {},
        true,
      ),
    ).toBe(false);
    expect(
      shouldPrintBanner(
        outdatedCache,
        "0.1.2",
        ["node", "dolibarr", "upgrade", "check"],
        {},
        true,
      ),
    ).toBe(false);
  });

  it("returns false when cache is null", () => {
    expect(
      shouldPrintBanner(null, "0.1.2", ["node", "dolibarr", "status"], {}, true),
    ).toBe(false);
  });

  it("returns false when current version is up to date", () => {
    expect(
      shouldPrintBanner(outdatedCache, "0.1.3", ["node", "dolibarr", "status"], {}, true),
    ).toBe(false);
  });
});

describe("maybePrintBanner", () => {
  let tmpPath: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpPath = path.join(
      os.tmpdir(),
      `dolibarr-cli-banner-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.DOLIBARR_UPDATE_CACHE = tmpPath;
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.DOLIBARR_UPDATE_CACHE;
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    errSpy.mockRestore();
  });

  it("does not throw when cache is missing", () => {
    expect(() => maybePrintBanner("0.1.2")).not.toThrow();
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe("fetchLatestRelease timeout parameter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts when the request exceeds the provided timeout", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit)?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }
      });
    });

    await expect(fetchLatestRelease(50)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the default 5s timeout when unspecified", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v0.1.3",
          assets: [{ browser_download_url: "https://example.com/x.tgz" }],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestRelease();
    expect(result.version).toBe("0.1.3");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("shouldColdStartCheck", () => {
  it("returns true when cache is null and all gates pass", () => {
    expect(
      shouldColdStartCheck(null, ["node", "dolibarr", "status"], {}, true),
    ).toBe(true);
  });

  it("returns false when cache already exists", () => {
    const cache: UpdateCache = {
      lastCheck: "2026-04-16T12:00:00.000Z",
      latestVersion: "0.1.3",
      currentVersion: "0.1.2",
      assetUrl: null,
    };
    expect(
      shouldColdStartCheck(cache, ["node", "dolibarr", "status"], {}, true),
    ).toBe(false);
  });

  it("returns false on non-TTY", () => {
    expect(
      shouldColdStartCheck(null, ["node", "dolibarr", "status"], {}, false),
    ).toBe(false);
  });

  it("returns false when --json is in argv", () => {
    expect(
      shouldColdStartCheck(
        null,
        ["node", "dolibarr", "invoices", "list", "--json"],
        {},
        true,
      ),
    ).toBe(false);
  });

  it("returns false when DOLIBARR_NO_UPDATE_CHECK=1", () => {
    expect(
      shouldColdStartCheck(
        null,
        ["node", "dolibarr", "status"],
        { DOLIBARR_NO_UPDATE_CHECK: "1" },
        true,
      ),
    ).toBe(false);
  });

  it("returns false for upgrade subcommand", () => {
    expect(
      shouldColdStartCheck(
        null,
        ["node", "dolibarr", "upgrade", "check"],
        {},
        true,
      ),
    ).toBe(false);
  });
});

describe("ensureFreshCacheOnColdStart", () => {
  let tmpPath: string;
  let origTTY: boolean | undefined;

  beforeEach(() => {
    tmpPath = path.join(
      os.tmpdir(),
      `dolibarr-cli-coldstart-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.DOLIBARR_UPDATE_CACHE = tmpPath;
    origTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    delete process.env.DOLIBARR_UPDATE_CACHE;
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    Object.defineProperty(process.stdout, "isTTY", {
      value: origTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("writes the cache when fetch resolves within the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v0.3.0",
          assets: [
            { browser_download_url: "https://example.com/dolibarr-cli-0.3.0.tgz" },
          ],
        }),
        { status: 200 },
      ),
    );

    await ensureFreshCacheOnColdStart("0.2.0", 500);

    const cache = readCache();
    expect(cache).not.toBeNull();
    expect(cache!.latestVersion).toBe("0.3.0");
    expect(cache!.currentVersion).toBe("0.2.0");
    expect(cache!.assetUrl).toBe("https://example.com/dolibarr-cli-0.3.0.tgz");
  });

  it("does not throw when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    await expect(ensureFreshCacheOnColdStart("0.2.0", 500)).resolves.toBeUndefined();
    expect(readCache()).toBeNull();
  });

  it("is a no-op when cache already exists", async () => {
    const existing: UpdateCache = {
      lastCheck: "2026-04-16T12:00:00.000Z",
      latestVersion: "0.2.0",
      currentVersion: "0.2.0",
      assetUrl: null,
    };
    writeCache(existing);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await ensureFreshCacheOnColdStart("0.2.0", 500);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readCache()).toEqual(existing);
  });
});
