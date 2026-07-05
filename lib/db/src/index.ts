import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Node's pg driver now prints a "SECURITY WARNING: the SSL modes 'prefer'/'require'/'verify-ca' are
// treated as aliases for 'verify-full'" whenever the connection string carries ?sslmode=… . Set the ssl
// option EXPLICITLY (same effective behaviour — verify the server cert) and strip sslmode from the URL,
// so the warning disappears without changing how we connect. No sslmode (e.g. local Postgres) → no SSL.
function poolConfig(): pg.PoolConfig {
  const raw = process.env.DATABASE_URL as string;
  try {
    const u = new URL(raw);
    const sslmode = u.searchParams.get("sslmode");
    if (!sslmode) return { connectionString: raw };
    u.searchParams.delete("sslmode");
    const ssl = sslmode === "disable" ? false : { rejectUnauthorized: true };
    return { connectionString: u.toString(), ssl };
  } catch {
    return { connectionString: raw };
  }
}

export const pool = new Pool(poolConfig());
export const db = drizzle(pool, { schema });

export * from "./schema";
