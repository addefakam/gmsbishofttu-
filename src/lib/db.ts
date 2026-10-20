import { PrismaClient } from "@prisma/client";

let _db: PrismaClient | null = null;

function getClient(): PrismaClient {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[db] DATABASE_URL is not set.");
    }
    let url = process.env.DATABASE_URL;

    // Ensure connection params for Neon compatibility.
    // Always set: connection_limit=1, pool_timeout=30, connect_timeout=30
    // These override any existing values in the URL.
    // pgbouncer=true is added for Neon's pooler endpoint (required for
    // serverless — prevents connection exhaustion).
    const params = new URLSearchParams();
    params.set("connection_limit", "1");
    params.set("pool_timeout", "30");
    params.set("connect_timeout", "30");
    // Only add pgbouncer if the URL uses Neon's pooler endpoint (-pooler in hostname)
    if (url.includes("-pooler") || url.includes("neon.tech")) {
      params.set("pgbouncer", "true");
    }

    // Parse existing URL and merge params
    try {
      const parsed = new URL(url);
      const existingParams = new URLSearchParams(parsed.search);
      // Our params take priority over existing ones
      for (const [key, value] of params.entries()) {
        existingParams.set(key, value);
      }
      parsed.search = existingParams.toString();
      url = parsed.toString();
    } catch {
      // URL parsing failed — append params directly
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}${params.toString()}`;
    }

    _db = new PrismaClient({
      log: ["warn", "error"],
      datasources: { db: { url } },
    });
  }
  return _db;
}

export const db = getClient();
