import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/node-postgres";
import { cache } from "react";
import { Pool } from "pg";
import * as schema from "./schema";

type HyperdriveEnv = {
  HYPERDRIVE?: { connectionString: string };
};

export const getDb = cache(async () => {
  let connectionString = process.env.POSTGRES_URL;

  if (!connectionString) {
    const { env } = await getCloudflareContext({ async: true });
    connectionString = (env as HyperdriveEnv).HYPERDRIVE?.connectionString;
  }

  if (!connectionString) {
    throw new Error("Configure POSTGRES_URL locally or a Hyperdrive binding in Cloudflare.");
  }

  const pool = new Pool({ connectionString, max: 1, maxUses: 1 });
  return drizzle({ client: pool, schema });
});
