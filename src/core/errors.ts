import { printError, printErrorJson } from "./output.js";

export class DolibarrApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly method?: string,
    public readonly path?: string,
    public readonly details?: unknown,
    /**
     * Dolibarr's own `debug.source`, e.g. `Routes.php:457 at route stage` or
     * `api_products.class.php:212 at call stage`. Names the failing stage, which
     * is what distinguishes a missing route from a permission block.
     */
    public readonly debugSource?: string,
  ) {
    super(`API error ${status}: ${message}`);
    this.name = "DolibarrApiError";
  }
}

export class DolibarrAuthError extends DolibarrApiError {
  constructor(message = "Invalid API key. Run `dolibarr config init` to reconfigure.") {
    super(401, message);
    this.name = "DolibarrAuthError";
  }
}

export class DolibarrConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DolibarrConfigError";
  }
}

/**
 * The API answered successfully but the CLI could not make sense of the body.
 * Kept distinct from DolibarrApiError so users can tell "the server rejected this"
 * from "the server replied and we failed to read it" — the raw
 * `Unexpected end of JSON input` that used to escape gave no such signal.
 */
export class DolibarrParseError extends Error {
  constructor(
    message: string,
    public readonly method?: string,
    public readonly path?: string,
    public readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = "DolibarrParseError";
  }
}

/**
 * A mutating request was attempted while read-only mode was active.
 *
 * Carries its own exit code (6) so a caller can tell "this run was blocked by its
 * own safety setting" apart from a permission failure (2) or a validation error (3).
 */
export class ReadOnlyError extends Error {
  constructor(what: string) {
    super(
      `Blocked by read-only mode: ${what}\n` +
        `  This run cannot modify anything. Remove --read-only, or unset DOLIBARR_READ_ONLY,\n` +
        `  to allow writes.`,
    );
    this.name = "ReadOnlyError";
  }

  /** Blocked at the API client — the request that was about to go out. */
  static forRequest(method: string, path: string): ReadOnlyError {
    return new ReadOnlyError(`${method} /api/index.php/${path.replace(/^\//, "")}`);
  }

  /** Blocked before prompting, because the command is a write whatever its arguments. */
  static forCommand(path: string): ReadOnlyError {
    return new ReadOnlyError(`\`${path}\` is a write command`);
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NonInteractiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveError";
  }
}

export function getExitCode(error: unknown): number {
  if (error instanceof ReadOnlyError) return 6;
  if (error instanceof DolibarrApiError && error.status === 429) return 4;
  if (error instanceof DolibarrApiError && (error.status === 401 || error.status === 403))
    return 2;
  if (error instanceof ValidationError || error instanceof NonInteractiveError) return 3;
  return 1;
}

function getStatusHint(status: number, path?: string): string | null {
  switch (status) {
    case 401:
      return "Authentication failed. Your API key may be invalid. Run: dolibarr config init";
    case 403:
      return "Permission denied. Check API user permissions in Dolibarr.";
    case 404: {
      if (path?.includes("accountancy/exportdata"))
        return (
          "Dolibarr rejected the export format. `format` must be a NUMERIC export-model id " +
          "(e.g. 1000 = FEC), not a name.\n" +
          "        Run: dolibarr accounting formats"
        );
      if (path?.includes("thirdparties/"))
        return "Thirdparty not found. Check with: dolibarr thirdparties list";
      if (path?.includes("invoices/"))
        return "Invoice not found. Check with: dolibarr invoices list";
      if (path?.includes("orders/")) return "Order not found. Check with: dolibarr orders list";
      if (path?.includes("products/"))
        return "Product not found. Check with: dolibarr products list";
      return "Resource not found. Verify the ID or reference.";
    }
    case 429:
      return "Rate limited. Wait a moment and retry.";
    case 500:
      return "Server error. Check Dolibarr server logs for details.";
    default:
      return null;
  }
}

/**
 * What Dolibarr's `debug.source` tells us about *where* a request died.
 *
 * The REST layer runs stages in order (route → negotiate → authenticate →
 * validate → call), and the failing stage is far more diagnostic than the status
 * code alone. A 404 from the route stage means the endpoint does not exist on this
 * instance — almost always a disabled module. A 404 from the call stage means the
 * endpoint ran and did not find the record.
 */
export type ApiFailureStage = "route" | "validate" | "call" | "auth" | "unknown";

export function classifyFailureStage(debugSource?: string): ApiFailureStage {
  if (!debugSource) return "unknown";
  const s = debugSource.toLowerCase();
  if (s.includes("at route stage")) return "route";
  if (s.includes("at validate stage")) return "validate";
  if (s.includes("at authenticate stage")) return "auth";
  if (s.includes("at call stage")) return "call";
  return "unknown";
}

/** The Dolibarr module a path belongs to, for "is the module enabled?" advice. */
function moduleForPath(path?: string): string | null {
  if (!path) return null;
  const top = path.replace(/^\//, "").split(/[/?]/)[0];
  return top || null;
}

/**
 * Build the actionable diagnostic block for an API error: what was requested,
 * which stage failed, and the specific next step to take.
 *
 * Report item 5.7 — a bare passthrough of Dolibarr's message ("Not Found") does not
 * tell a user whether the module is off, their key lacks rights, or they typed a bad id.
 */
export function explainApiError(error: DolibarrApiError): string[] {
  const lines: string[] = [];
  const stage = classifyFailureStage(error.debugSource);
  const mod = moduleForPath(error.path);

  if (error.method && error.path) {
    lines.push(`Request: ${error.method} /api/index.php/${error.path.replace(/^\//, "")}`);
  }
  if (error.debugSource) {
    lines.push(`Server:  ${error.debugSource}`);
  }

  if (error.status === 404 && stage === "route") {
    lines.push(
      `The endpoint does not exist on this Dolibarr instance — the route was never registered.`,
      mod
        ? `That normally means the "${mod}" module is disabled. Check: dolibarr setup modules`
        : `That normally means the owning module is disabled. Check: dolibarr setup modules`,
    );
  } else if (error.status === 404 && stage === "call") {
    if (error.path?.includes("accountancy/exportdata")) {
      lines.push(
        `Dolibarr rejected the export format. \`format\` must be a NUMERIC export-model id`,
        `(e.g. 1000 = FEC), not a name. Run: dolibarr accounting formats`,
      );
    } else {
      lines.push(
        `The endpoint exists and ran, but found no matching record. Verify the id or reference.`,
      );
    }
  } else if (error.status === 403) {
    lines.push(
      `The route exists, but the API user is not permitted to use it.`,
      mod
        ? `Grant rights on "${mod}" in Dolibarr: Home > Users & Groups > (your API user) > Permissions.`
        : `Grant the matching rights in Dolibarr: Home > Users & Groups > (your API user) > Permissions.`,
      `Confirm the module is enabled too: dolibarr setup modules`,
    );
  } else if (error.status === 400 && stage === "validate") {
    lines.push(
      `Dolibarr rejected the request parameters before running it — the message above names the field at fault.`,
    );
  } else if (error.status === 401) {
    lines.push(`Authentication failed. Your API key may be invalid. Run: dolibarr config init`);
  } else if (error.status === 429) {
    lines.push(`Rate limited. Wait a moment and retry.`);
  } else if (error.status >= 500) {
    lines.push(`Server error. Check the Dolibarr server logs for details.`);
  } else {
    const hint = getStatusHint(error.status, error.path);
    if (hint) lines.push(hint);
  }

  return lines;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof DolibarrApiError) {
    const detail = explainApiError(error);
    if (detail.length === 0) return error.message;
    return [error.message, ...detail.map((l) => `  ${l}`)].join("\n");
  }
  if (error instanceof DolibarrParseError) {
    const where = error.method && error.path ? ` from ${error.method} ${error.path}` : "";
    return (
      `Could not read the API response${where}: ${error.message}\n` +
      `  This is a CLI-side failure, not an error returned by Dolibarr.`
    );
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function exitWithError(error: unknown, json = false): never {
  if (json) {
    printErrorJson(error);
  } else {
    printError(getErrorMessage(error));
  }
  process.exit(getExitCode(error));
}
