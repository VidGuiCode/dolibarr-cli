import { printError, printErrorJson } from "./output.js";

export class DolibarrApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly method?: string,
    public readonly path?: string,
    public readonly details?: unknown,
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

export function getErrorMessage(error: unknown): string {
  if (error instanceof DolibarrApiError) {
    const hint = getStatusHint(error.status, error.path);
    return hint ? `${error.message}\n  Hint: ${hint}` : error.message;
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
