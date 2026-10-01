import "server-only";

import { randomUUID } from "node:crypto";
import { genSaltSync, hashSync } from "bcrypt-ts";
import { getDb } from "./client";
import { user } from "./schema";

export async function createGuestUser() {
  const db = await getDb();
  const email = `guest-${randomUUID()}`;
  const password = hashSync(randomUUID(), genSaltSync(10));
  const id = randomUUID();
  await db.insert(user).values({ email, id, password });
  return [{ email, id }];
}
