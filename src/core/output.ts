import { isCompactMode } from "./runtime.js";
import { DolibarrApiError } from "./errors.js";

export function printInfo(message: string): void {
  console.log(message);
}

export function printError(message: string): void {
  console.error(`\u2717  ${message}`);
}

export function printErrorJson(error: unknown): void {
  const errorObj =
    error instanceof DolibarrApiError
      ? {
          status: "error",
          code: error.status === 429 ? "RATE_LIMITED" : "API_ERROR",
          message: error.message,
          details: {
            httpStatus: error.status,
            method: error.method,
            path: error.path,
            ...(typeof error.details === "object" && error.details !== null
              ? (error.details as Record<string, unknown>)
              : {}),
          },
        }
      : error instanceof Error
        ? {
            status: "error",
            code: error.name,
            message: error.message,
          }
        : {
            status: "error",
            code: "UNKNOWN_ERROR",
            message: String(error),
          };
  console.error(JSON.stringify(errorObj, null, 2));
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, isCompactMode() ? undefined : 2));
}

export function printTable(rows: string[][], headers?: string[]): void {
  if (rows.length === 0 && !headers) return;
  const allRows = headers ? [headers, ...rows] : rows;
  const widths = allRows[0].map((_, i) => Math.max(...allRows.map((r) => (r[i] ?? "").length)));
  if (headers) {
    console.log(headers.map((h, i) => h.padEnd(widths[i])).join("   "));
    console.log(widths.map((w) => "\u2500".repeat(w)).join("   "));
  }
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("   "));
  }
}

function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function printCsv(rows: string[][], headers?: string[]): void {
  const lines: string[] = [];
  if (headers) lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map((c) => csvEscape(c ?? "")).join(","));
  }
  if (lines.length === 0) return;
  process.stdout.write(lines.join("\r\n") + "\r\n");
}
