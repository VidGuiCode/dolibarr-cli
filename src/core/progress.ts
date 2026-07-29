import { isNonInteractiveMode, isQuiet } from "./runtime.js";

/**
 * Progress indicators for long operations (v0.6.7).
 *
 * Hand-rolled — no `ora`. `commander` stays the only runtime dep.
 *
 * Two rules govern everything here, and both exist because a progress indicator that
 * gets them wrong is strictly worse than no indicator at all:
 *
 *  1. **Everything goes to stderr.** stdout is the data channel. A spinner frame in a
 *     piped JSON stream corrupts it.
 *  2. **Off unless stderr is an interactive terminal.** Redirected stderr would collect
 *     thousands of carriage-return frames, and a non-TTY cannot render an animation
 *     anyway.
 *
 * `--quiet` and `--no-interactive` also disable it, matching `--all`'s existing
 * page-progress behaviour in `paginate.ts`.
 */

/** Braille frames: one cell wide, so a redraw never wraps a narrow terminal. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const FRAME_INTERVAL_MS = 80;

/** Erase from the cursor to end of line, built from a char code (see color.ts). */
const CLEAR_LINE = `${String.fromCharCode(27)}[K`;

export interface ProgressContext {
  /** stderr TTY-ness. Progress is drawn to stderr, so this is what matters. */
  isTty?: boolean;
  quiet?: boolean;
  nonInteractive?: boolean;
}

/**
 * Whether to animate at all.
 *
 * Note this deliberately tests **stderr**, not stdout: `cmd > file.json` leaves stderr
 * a terminal, and showing progress there is exactly right.
 */
export function isProgressEnabled(ctx: ProgressContext = {}): boolean {
  if (ctx.quiet ?? isQuiet()) return false;
  if (ctx.nonInteractive ?? isNonInteractiveMode()) return false;
  return ctx.isTty ?? Boolean(process.stderr.isTTY);
}

export interface Progress {
  /** Update the trailing text without restarting the animation. */
  update(label: string): void;
  /** Stop and clear the line. `finalMessage` is printed to stderr if given. */
  stop(finalMessage?: string): void;
}

/** A Progress that does nothing, returned whenever animation is disabled. */
export function nullProgress(): Progress {
  return { update: () => {}, stop: () => {} };
}

type TimerHandle = ReturnType<typeof setInterval>;

/** Injected so tests can drive the animation without real timers or a real terminal. */
export interface SpinnerDeps {
  write: (s: string) => void;
  setInterval: (fn: () => void, ms: number) => TimerHandle;
  clearInterval: (h: TimerHandle) => void;
}

const defaultDeps: SpinnerDeps = {
  write: (s) => process.stderr.write(s),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

/**
 * Start a spinner. Always returns a Progress, so callers never branch — a disabled
 * spinner is a no-op object rather than a null check at every call site.
 */
export function startProgress(
  label: string,
  ctx: ProgressContext = {},
  deps: SpinnerDeps = defaultDeps,
): Progress {
  if (!isProgressEnabled(ctx)) return nullProgress();

  let frame = 0;
  let text = label;
  let stopped = false;

  const draw = () => {
    if (stopped) return;
    const line = `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${text}`;
    // \r returns to column 0; the trailing clear-to-end erases a previous longer line.
    deps.write(`\r${line}${CLEAR_LINE}`);
    frame += 1;
  };

  draw();
  const handle = deps.setInterval(draw, FRAME_INTERVAL_MS);
  // Never let a spinner hold the process open.
  (handle as unknown as { unref?: () => void }).unref?.();

  return {
    update(next: string) {
      text = next;
    },
    stop(finalMessage?: string) {
      if (stopped) return;
      stopped = true;
      deps.clearInterval(handle);
      deps.write(`\r${CLEAR_LINE}`);
      if (finalMessage) deps.write(`${finalMessage}\n`);
    },
  };
}

/**
 * Run `work` with a spinner, stopping it whether the work succeeds or throws.
 *
 * The `finally` matters: a spinner left running after an error would keep overwriting
 * the error message the user needs to read.
 */
export async function withProgress<T>(
  label: string,
  work: (progress: Progress) => Promise<T>,
  ctx: ProgressContext = {},
): Promise<T> {
  const progress = startProgress(label, ctx);
  try {
    return await work(progress);
  } finally {
    progress.stop();
  }
}

/** "3 of 10 (30%)" — a counter for operations whose total is known up front. */
export function formatCount(done: number, total: number, noun = "item"): string {
  if (total <= 0) return `${done} ${noun}${done === 1 ? "" : "s"}`;
  const pct = Math.floor((done / total) * 100);
  return `${done} of ${total} (${pct}%)`;
}

/** "1.2 MB of 5.0 MB" — byte progress for document transfers. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
