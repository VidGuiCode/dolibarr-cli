import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DolibarrApiClient } from "../../src/core/api-client.js";
import { ReadOnlyError, getExitCode } from "../../src/core/errors.js";
import { isReadOnlyMode } from "../../src/core/runtime.js";

const baseOptions = {
  baseUrl: "https://erp.example.com",
  apiKey: "test_api_key_123",
  retries: 0,
};

/** Turn read-only on the way `--read-only` does, without touching real argv semantics. */
function withReadOnlyFlag(): void {
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "dolibarr", "--read-only"]);
}

describe("read-only mode", () => {
  beforeEach(() => {
    delete process.env.DOLIBARR_READ_ONLY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DOLIBARR_READ_ONLY;
  });

  describe("isReadOnlyMode", () => {
    it("is off by default", () => {
      expect(isReadOnlyMode({})).toBe(false);
    });

    it("honours the --read-only flag", () => {
      withReadOnlyFlag();
      expect(isReadOnlyMode({})).toBe(true);
    });

    it("honours DOLIBARR_READ_ONLY in its truthy spellings", () => {
      for (const v of ["1", "true", "yes", "YES", " True "]) {
        expect(isReadOnlyMode({ DOLIBARR_READ_ONLY: v }), v).toBe(true);
      }
    });

    it("does not treat 0/false/empty as enabled", () => {
      for (const v of ["0", "false", "no", "", "  "]) {
        expect(isReadOnlyMode({ DOLIBARR_READ_ONLY: v }), v).toBe(false);
      }
    });
  });

  describe("enforcement at the API-client choke point", () => {
    /**
     * The point of enforcing here rather than per command: a write cannot escape by
     * going through `raw`, or through a command added after this was written.
     */
    it("blocks every mutating verb", async () => {
      process.env.DOLIBARR_READ_ONLY = "1";
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(client.post("thirdparties", { name: "x" })).rejects.toThrow(ReadOnlyError);
      await expect(client.put("invoices/1", { ref: "x" })).rejects.toThrow(ReadOnlyError);
      await expect(client.delete("invoices/1")).rejects.toThrow(ReadOnlyError);
      await expect(client.requestRaw("POST", "invoices", {})).rejects.toThrow(ReadOnlyError);
      await expect(client.requestRaw("PUT", "invoices/1", {})).rejects.toThrow(ReadOnlyError);
      await expect(client.requestRaw("DELETE", "invoices/1")).rejects.toThrow(ReadOnlyError);

      // Nothing was ever put on the wire.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("blocks raw POST specifically — the documented bypass route", async () => {
      process.env.DOLIBARR_READ_ONLY = "1";
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(client.requestRaw("POST", "invoices", { x: 1 })).rejects.toThrow(
        /Blocked by read-only mode/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("still allows reads", async () => {
      process.env.DOLIBARR_READ_ONLY = "1";
      const client = new DolibarrApiClient(baseOptions);
      // A fresh Response per call: a Response body can only be read once.
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
      );

      await expect(client.get("invoices")).resolves.toEqual([{ id: 1 }]);
      await expect(client.requestRaw("GET", "invoices")).resolves.toMatchObject({ ok: true });
    });

    it("allows writes again once read-only is off", async () => {
      const client = new DolibarrApiClient(baseOptions);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: 9 }), { status: 200 }),
      );

      await expect(client.post("thirdparties", { name: "x" })).resolves.toEqual({ id: 9 });
    });

    it("names the exact request it refused", async () => {
      process.env.DOLIBARR_READ_ONLY = "1";
      const client = new DolibarrApiClient(baseOptions);
      await expect(client.delete("invoices/7")).rejects.toThrow(
        "DELETE /api/index.php/invoices/7",
      );
    });
  });

  describe("exit code", () => {
    it("uses 6, distinct from permission (2) and validation (3)", () => {
      expect(getExitCode(ReadOnlyError.forRequest("POST", "invoices"))).toBe(6);
      expect(getExitCode(ReadOnlyError.forCommand("bank transfer"))).toBe(6);
    });
  });

  describe("error messages", () => {
    it("reads correctly for a blocked request", () => {
      expect(ReadOnlyError.forRequest("POST", "/invoices").message).toContain(
        "POST /api/index.php/invoices",
      );
    });

    it("reads correctly for a blocked command", () => {
      expect(ReadOnlyError.forCommand("bank transfer").message).toContain(
        "`bank transfer` is a write command",
      );
    });

    it("always says how to turn it off", () => {
      for (const e of [
        ReadOnlyError.forRequest("POST", "invoices"),
        ReadOnlyError.forCommand("bank transfer"),
      ]) {
        expect(e.message).toContain("--read-only");
        expect(e.message).toContain("DOLIBARR_READ_ONLY");
      }
    });
  });
});
