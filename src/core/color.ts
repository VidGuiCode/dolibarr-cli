/**
 * Status colouring for table output (v0.6.4).
 *
 * Hand-rolled ANSI, no dependency: `commander` remains the only runtime dep.
 *
 * Colour is applied to the *rendered* status label, not to the raw Dolibarr code.
 * Each command already maps its own status vocabulary to words like "Draft" or
 * "Paid" via its ColumnSpec, so matching on the rendered text means this works for
 * every resource without threading resource identity through the render layer.
 *
 * Degrades correctly, which matters more than the colour itself: off when stdout is
 * piped, under any machine-readable `--output`, when `NO_COLOR` is set, and when
 * `--no-color` is passed. A colour escape in piped output is a regression, not a
 * feature.
 */

/**
 * Built from a char code rather than written as a literal escape byte, so the source
 * stays free of unprintable control characters, and the strip pattern is derived from
 * the same constant that produces the codes — they cannot drift apart.
 */
const ESC = `${String.fromCharCode(27)}[`;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
export const RESET = `${ESC}0m`;

export const COLORS = {
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  dim: `${ESC}2m`,
} as const;

export type ColorName = keyof typeof COLORS;

/**
 * Status label → colour, keyed by the lowercased rendered text.
 *
 * Grouped by meaning rather than by resource: "in progress" is yellow wherever it
 * appears, so the same colour means the same thing across every command.
 */
export const STATUS_COLORS: Record<string, ColorName> = {
  // Not yet committed
  draft: "yellow",
  open: "yellow",
  "in progress": "yellow",
  ongoing: "yellow",
  pending: "yellow",
  // Committed / in flight
  validated: "blue",
  approved: "blue",
  signed: "blue",
  ordered: "blue",
  "shipment started": "blue",
  received: "blue",
  processed: "blue",
  // Done, successfully
  paid: "green",
  closed: "green",
  done: "green",
  delivered: "green",
  billed: "green",
  active: "green",
  // Ended badly
  abandoned: "red",
  canceled: "red",
  cancelled: "red",
  refused: "red",
  rejected: "red",
  expired: "red",
  unpaid: "red",
  // Inert
  inactive: "dim",
  archived: "dim",
  unknown: "dim",
};

/** Strip ANSI so column widths measure what the user actually sees. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Visible width of a cell, ignoring any colour escapes it carries. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function colorize(text: string, color: ColorName): string {
  return `${COLORS[color]}${text}${RESET}`;
}

export interface ColorContext {
  /** Resolved `--output` value. Only "table" is a human surface. */
  output?: string;
  /** True when `--no-color` was passed. */
  noColor?: boolean;
  /** stdout TTY-ness; false when piped or redirected. */
  isTty?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Whether to emit colour at all.
 *
 * Every one of these conditions has to hold — the failure mode of getting this wrong
 * is corrupting someone's piped data, so the default is off unless clearly safe.
 */
export function isColorEnabled(ctx: ColorContext = {}): boolean {
  const env = ctx.env ?? process.env;
  // Read argv directly, as the other global flags do: `--no-color` is declared on the
  // program, so commander stores it in the program's opts, never the subcommand's.
  if (ctx.noColor ?? process.argv.includes("--no-color")) return false;
  // NO_COLOR is honoured by its presence, whatever the value (no-color.org).
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  const output = ctx.output ?? "table";
  if (output !== "table") return false;
  const isTty = ctx.isTty ?? Boolean(process.stdout.isTTY);
  return isTty;
}

/** Colour a rendered status label, leaving anything unrecognised untouched. */
export function colorizeStatus(text: string): string {
  const color = STATUS_COLORS[text.trim().toLowerCase()];
  return color ? colorize(text, color) : text;
}

/** True when a column holds a record's status, and is therefore worth colouring. */
export function isStatusColumn(spec: { key: string; label: string }): boolean {
  const key = spec.key.toLowerCase();
  const label = spec.label.toLowerCase();
  return (
    key === "status" ||
    key === "statut" ||
    key === "fk_statut" ||
    label === "status" ||
    label === "state"
  );
}
