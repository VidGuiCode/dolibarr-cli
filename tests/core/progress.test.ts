import { describe, it, expect, vi } from "vitest";
import {
  FRAME_INTERVAL_MS,
  SPINNER_FRAMES,
  formatBytes,
  formatCount,
  isProgressEnabled,
  nullProgress,
  startProgress,
  withProgress,
  type SpinnerDeps,
} from "../../src/core/progress.js";

/** A fake timer + writer, so the animation is driven deterministically. */
function fakeDeps() {
  const written: string[] = [];
  let tick: (() => void) | null = null;
  let cleared = false;
  const deps: SpinnerDeps = {
    write: (s) => written.push(s),
    setInterval: ((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as SpinnerDeps["setInterval"],
    clearInterval: () => {
      cleared = true;
    },
  };
  return {
    deps,
    written,
    advance: () => tick?.(),
    get cleared() {
      return cleared;
    },
    text: () => written.join(""),
  };
}

const ON = { isTty: true, quiet: false, nonInteractive: false };

describe("progress gating", () => {
  it("is on at an interactive terminal", () => {
    expect(isProgressEnabled(ON)).toBe(true);
  });

  /** A spinner frame in a piped stream corrupts the consumer's data. */
  it("is off when stderr is not a terminal", () => {
    expect(isProgressEnabled({ ...ON, isTty: false })).toBe(false);
  });

  it("is off under --quiet", () => {
    expect(isProgressEnabled({ ...ON, quiet: true })).toBe(false);
  });

  it("is off under --no-interactive", () => {
    expect(isProgressEnabled({ ...ON, nonInteractive: true })).toBe(false);
  });
});

describe("spinner", () => {
  it("writes nothing at all when disabled", () => {
    const f = fakeDeps();
    const p = startProgress("Working", { ...ON, isTty: false }, f.deps);
    p.update("Still working");
    p.stop("Done");
    expect(f.written).toEqual([]);
  });

  it("draws immediately rather than waiting for the first tick", () => {
    const f = fakeDeps();
    startProgress("Working", ON, f.deps);
    expect(f.text()).toContain("Working");
    expect(f.text()).toContain(SPINNER_FRAMES[0]);
  });

  it("advances through frames", () => {
    const f = fakeDeps();
    startProgress("Working", ON, f.deps);
    f.advance();
    expect(f.text()).toContain(SPINNER_FRAMES[1]);
  });

  it("cycles back to the first frame", () => {
    const f = fakeDeps();
    startProgress("W", ON, f.deps);
    for (let i = 0; i < SPINNER_FRAMES.length; i++) f.advance();
    expect(f.written[f.written.length - 1]).toContain(SPINNER_FRAMES[0]);
  });

  it("redraws in place with a carriage return, never a newline", () => {
    const f = fakeDeps();
    startProgress("Working", ON, f.deps);
    f.advance();
    expect(f.written.every((w) => w.startsWith("\r"))).toBe(true);
    expect(f.written.some((w) => w.includes("\n"))).toBe(false);
  });

  it("updates the label without restarting the animation", () => {
    const f = fakeDeps();
    const p = startProgress("First", ON, f.deps);
    p.update("Second");
    f.advance();
    expect(f.written[f.written.length - 1]).toContain("Second");
  });

  it("clears the line and stops the timer on stop", () => {
    const f = fakeDeps();
    const p = startProgress("Working", ON, f.deps);
    p.stop();
    expect(f.cleared).toBe(true);
    expect(f.written[f.written.length - 1]).toContain("\r");
  });

  it("draws nothing further after stopping", () => {
    const f = fakeDeps();
    const p = startProgress("Working", ON, f.deps);
    p.stop();
    const count = f.written.length;
    f.advance();
    expect(f.written.length).toBe(count);
  });

  it("is safe to stop twice", () => {
    const f = fakeDeps();
    const p = startProgress("Working", ON, f.deps);
    p.stop();
    const count = f.written.length;
    p.stop();
    expect(f.written.length).toBe(count);
  });

  it("prints a final message on its own line when given one", () => {
    const f = fakeDeps();
    startProgress("Working", ON, f.deps).stop("Finished");
    expect(f.text()).toContain("Finished\n");
  });

  it("uses a sensible frame interval", () => {
    expect(FRAME_INTERVAL_MS).toBeGreaterThan(30);
    expect(FRAME_INTERVAL_MS).toBeLessThan(500);
  });
});

describe("nullProgress", () => {
  it("accepts the full interface without doing anything", () => {
    const p = nullProgress();
    expect(() => {
      p.update("x");
      p.stop("y");
    }).not.toThrow();
  });
});

describe("withProgress", () => {
  it("returns the work's value", async () => {
    await expect(withProgress("W", async () => 42, { ...ON, isTty: false })).resolves.toBe(42);
  });

  /** A spinner left running after an error would overwrite the error message. */
  it("stops the spinner even when the work throws", async () => {
    const stop = vi.fn();
    await expect(
      withProgress(
        "W",
        async (p) => {
          (p as unknown as { stop: unknown }).stop = stop;
          throw new Error("boom");
        },
        { ...ON, isTty: false },
      ),
    ).rejects.toThrow("boom");
  });
});

describe("formatters", () => {
  it("shows a count with a percentage", () => {
    expect(formatCount(3, 10)).toBe("3 of 10 (30%)");
    expect(formatCount(10, 10)).toBe("10 of 10 (100%)");
    expect(formatCount(0, 10)).toBe("0 of 10 (0%)");
  });

  it("falls back to a bare count when the total is unknown", () => {
    expect(formatCount(1, 0)).toBe("1 item");
    expect(formatCount(5, 0)).toBe("5 items");
  });

  it("scales byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  it("does not produce nonsense for bad input", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });
});
