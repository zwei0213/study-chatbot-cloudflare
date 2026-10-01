import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import { studyAdminSetting, studyMessage, studySession, user } from "./schema";

type D1Env = {
  DB?: unknown;
};

export const getDb = cache(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const database = (env as D1Env).DB;
  if (!database) {
    throw new Error("Configure the DB D1 binding in Cloudflare.");
  }

  return drizzle(database as never, {
    schema: { studyAdminSetting, studyMessage, studySession, user },
  });
});
