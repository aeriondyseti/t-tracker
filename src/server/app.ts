// Server Hono app: core API + bearer-token auth middleware (§7).
import { Hono } from "hono";
import { createAPI } from "../core/api.ts";
import type { Store } from "../core/store.ts";

const HEALTH_PATH = "/health";

/** Create the t-server app. The token is required and non-empty. */
export function createServerApp(store: Store, token: string): Hono {
  if (!token || token.trim() === "") {
    throw new Error("server token must be a non-empty string");
  }
  const expected = `Bearer ${token}`;
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (c.req.path === HEALTH_PATH) return next();
    const auth = c.req.header("Authorization") ?? "";
    if (auth !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  app.route("/", createAPI(store));
  return app;
}
