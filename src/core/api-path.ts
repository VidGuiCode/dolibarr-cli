/**
 * Normalize a user-supplied `raw` API path, undoing MSYS/Git Bash path mangling.
 *
 * On Windows under Git Bash (MSYS), a POSIX-absolute argument like `/thirdparties`
 * is rewritten by the shell — before the CLI process ever starts — into a
 * Windows-absolute path rooted at the Git install dir, e.g.
 * `C:/Program Files/Git/thirdparties`. That mangled value then reaches Dolibarr as
 * `/api/index.php/C:/Program Files/Git/thirdparties` and is rejected with a 403
 * "injection protection" (or, worse, silently returns an all-null object).
 *
 * Setting `MSYS_NO_PATHCONV=1` avoids the mangling, but by the time our code runs
 * the argument is already rewritten, so we recover it here instead.
 */

export interface NormalizedPath {
  /** The cleaned API path to send (no leading slash, no `api/index.php/` prefix). */
  path: string;
  /** A non-fatal note to print to stderr when mangling was detected/handled. */
  warning?: string;
}

/** Strip a leading slash and an accidental `api/index.php/` prefix. */
function cleanupApiPath(p: string): string {
  return p.replace(/^\/+/, "").replace(/^api\/index\.php\//i, "");
}

/**
 * Given a Windows-absolute path that MSYS produced by prepending the Git/MSYS
 * install root to the intended API path, recover the intended path. Returns null
 * if the root couldn't be identified.
 */
function stripMsysRoot(winPath: string, env: NodeJS.ProcessEnv): string | null {
  const norm = (s: string): string => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = norm(winPath);

  // 1) Preferred: Git for Windows exports EXEPATH = the install dir (Windows form).
  const exePath = env.EXEPATH;
  if (exePath) {
    const root = norm(exePath);
    if (root && path.toLowerCase().startsWith(root.toLowerCase() + "/")) {
      return path.slice(root.length + 1);
    }
  }

  // 2) Fallback: strip through a `.../Git/` install-root marker (default installs).
  const gitMarker = path.match(/^[A-Za-z]:\/.*?\/Git\/(.+)$/i);
  if (gitMarker) return gitMarker[1];

  // 3) Fallback: strip through a usr/bin or mingw marker.
  const mingwMarker = path.match(/^[A-Za-z]:\/.*?\/(?:usr\/bin|mingw64|mingw32)\/(.+)$/i);
  if (mingwMarker) return mingwMarker[1];

  return null;
}

/**
 * Normalize a raw API path, undoing MSYS/Git Bash mangling when detected.
 *
 * A legitimate Dolibarr API path is always relative (`thirdparties`, `/invoices/18`)
 * — it never starts with a Windows drive letter. So a drive-letter prefix is a
 * reliable signal that the shell mangled a leading-slash path.
 */
export function normalizeApiPath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): NormalizedPath {
  const trimmed = input.trim();

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    const recovered = stripMsysRoot(trimmed, env);
    if (recovered !== null) {
      const path = cleanupApiPath(recovered);
      return {
        path,
        warning:
          `Detected Git Bash/MSYS path conversion; using "/${path}" ` +
          `(shell rewrote the argument to "${trimmed}"). ` +
          `Set MSYS_NO_PATHCONV=1 or drop the leading slash to silence this.`,
      };
    }
    return {
      path: cleanupApiPath(trimmed),
      warning:
        `Argument "${trimmed}" looks like a Git Bash/MSYS-mangled path but could ` +
        `not be un-mangled. If the request fails, re-run with MSYS_NO_PATHCONV=1 ` +
        `set, or omit the leading slash (e.g. "thirdparties/18").`,
    };
  }

  return { path: cleanupApiPath(trimmed) };
}

/**
 * True when a value is a non-empty plain object whose every own value is null.
 * Dolibarr returns such stubs when a read is routed but not actually served
 * (e.g. a mangled path or a permission gap) — a misleading "success" we surface.
 */
export function isAllNullObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.values(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every((v) => v === null);
}
