import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function makeDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url });
  return drizzle(pool, { schema });
}
