import "server-only";

import { randomUUID } from "node:crypto";
import { getDb } from "./client";
import { user } from "./schema";

export async function createGuestUser() {
  const db = await getDb();
  const email = `guest-${randomUUID()}`;
  const id = randomUUID();
  await db.insert(user).values({ email, id });
  return [{ email, id }];
}
