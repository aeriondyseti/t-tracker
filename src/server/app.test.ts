// Bearer-token auth middleware tests (§7).
import { describe, expect, test } from "bun:test";
import { Store } from "../core/store.ts";
import { createServerApp } from "./app.ts";

const TOKEN = "secret-test-token";

function makeApp() {
  const store = new Store(":memory:");
  return { app: createServerApp(store, TOKEN), store };
}

async function req(
  app: ReturnType<typeof makeApp>["app"],
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.fetch(new Request(`http://server${path}`, init));
}

describe("createServerApp", () => {
  test("constructor rejects empty token", () => {
    const store = new Store(":memory:");
    expect(() => createServerApp(store, "")).toThrow();
    expect(() => createServerApp(store, "   ")).toThrow();
  });

  test("/health is reachable without auth", async () => {
    const { app } = makeApp();
    const res = await req(app, "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("rejects requests with no Authorization header", async () => {
    const { app } = makeApp();
    const res = await req(app, "/tasks");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("rejects wrong scheme or token", async () => {
    const { app } = makeApp();
    const cases = [
      { Authorization: "Basic abc" },
      { Authorization: `Bearer ${TOKEN}wrong` },
      { Authorization: "Bearer " },
      { Authorization: TOKEN }, // missing "Bearer " prefix
    ];
    for (const headers of cases) {
      const res = await req(app, "/tasks", { headers });
      expect(res.status).toBe(401);
    }
  });

  test("accepts requests with a correct bearer token", async () => {
    const { app } = makeApp();
    const res = await req(app, "/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: unknown[]; projects: unknown[] };
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test("auth middleware applies to writes too", async () => {
    const { app } = makeApp();
    const noAuth = await req(app, "/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(noAuth.status).toBe(401);

    const withAuth = await req(app, "/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ title: "from server test" }),
    });
    expect(withAuth.status).toBe(200);
  });
});
