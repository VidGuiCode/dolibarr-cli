import { describe, it, expect, vi, beforeEach } from "vitest";
import { DolibarrApiClient } from "../../src/core/api-client.js";
import { DolibarrApiError, DolibarrAuthError } from "../../src/core/errors.js";

describe("DolibarrApiClient", () => {
  const baseOptions = {
    baseUrl: "https://erp.example.com",
    apiKey: "test_api_key_123",
    retries: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("URL construction", () => {
    it("builds correct URL from baseUrl and path", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await client.get("thirdparties");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://erp.example.com/api/index.php/thirdparties",
        expect.objectContaining({ headers: expect.objectContaining({ DOLAPIKEY: "test_api_key_123" }) }),
      );
    });

    it("strips trailing slash from baseUrl", async () => {
      const client = new DolibarrApiClient({ ...baseOptions, baseUrl: "https://erp.example.com/" });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      await client.get("status");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://erp.example.com/api/index.php/status",
        expect.any(Object),
      );
    });

    it("strips leading slash from path", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      await client.get("/invoices");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://erp.example.com/api/index.php/invoices",
        expect.any(Object),
      );
    });
  });

  describe("query parameters", () => {
    it("appends query params to GET requests", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await client.get("thirdparties", { limit: 10, page: 0, mode: "1" });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("limit=10");
      expect(url).toContain("page=0");
      expect(url).toContain("mode=1");
    });

    it("skips undefined and empty params", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await client.get("products", { limit: 50, category: undefined, sqlfilters: "" });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("limit=50");
      expect(url).not.toContain("category");
      expect(url).not.toContain("sqlfilters");
    });
  });

  describe("DOLAPIKEY header", () => {
    it("sends DOLAPIKEY header on every request", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      await client.get("status");

      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.DOLAPIKEY).toBe("test_api_key_123");
      expect(headers.Accept).toBe("application/json");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("HTTP methods", () => {
    it("sends POST with JSON body", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(42), { status: 200 }),
      );

      const result = await client.post<number>("thirdparties", { name: "Test Corp" });

      expect(result).toBe(42);
      expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
      expect(fetchSpy.mock.calls[0][1]?.body).toBe('{"name":"Test Corp"}');
    });

    it("sends PUT with JSON body", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: 1 }), { status: 200 }),
      );

      await client.put("thirdparties/1", { name: "Updated" });

      expect(fetchSpy.mock.calls[0][1]?.method).toBe("PUT");
    });

    it("sends DELETE without body", async () => {
      const client = new DolibarrApiClient(baseOptions);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 200 }),
      );

      await client.delete("thirdparties/1");

      expect(fetchSpy.mock.calls[0][1]?.method).toBe("DELETE");
    });
  });

  describe("error handling", () => {
    it("throws DolibarrAuthError on 401", async () => {
      const client = new DolibarrApiClient(baseOptions);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 401, message: "Unauthorized" } }), { status: 401 }),
      );

      await expect(client.get("status")).rejects.toThrow(DolibarrAuthError);
    });

    it("throws DolibarrApiError on 404", async () => {
      const client = new DolibarrApiClient(baseOptions);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 404, message: "Not found" } }), { status: 404 }),
      );

      await expect(client.get("thirdparties/999")).rejects.toThrow(DolibarrApiError);
    });

    it("parses Dolibarr error format with nested error object", async () => {
      const client = new DolibarrApiClient(baseOptions);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 403, message: "Permission denied" } }), { status: 403 }),
      );

      try {
        await client.get("invoices");
      } catch (err) {
        expect(err).toBeInstanceOf(DolibarrApiError);
        expect((err as DolibarrApiError).status).toBe(403);
        expect((err as DolibarrApiError).message).toContain("Permission denied");
      }
    });

    it("parses plain string error format", async () => {
      const client = new DolibarrApiClient(baseOptions);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify("Something went wrong"), { status: 400 }),
      );

      try {
        await client.post("invoices", {});
      } catch (err) {
        expect(err).toBeInstanceOf(DolibarrApiError);
        expect((err as DolibarrApiError).message).toContain("Something went wrong");
      }
    });
  });

  describe("retry logic", () => {
    it("retries on 500 and succeeds", async () => {
      const client = new DolibarrApiClient({ ...baseOptions, retries: 2, retryDelay: 10 });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response("", { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const result = await client.get<{ ok: boolean }>("status");

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting retries on 500", async () => {
      const client = new DolibarrApiClient({ ...baseOptions, retries: 1, retryDelay: 10 });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Server Error", { status: 500 }),
      );

      await expect(client.get("status")).rejects.toThrow(DolibarrApiError);
    });
  });
});
