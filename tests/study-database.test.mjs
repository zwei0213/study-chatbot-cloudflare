import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { loadTypeScript } from "./load-typescript.mjs";

function setup(context) {
  const orm = { and, asc, count, desc, eq, isNotNull, isNull, like, or, sql };
  const sqliteCore = { index, integer, sqliteTable, text, uniqueIndex };
  const sqlite = new DatabaseSync(":memory:");
  context.after(() => sqlite.close());
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "0001_initial.sql",
    "0002_session_created_at_index.sql",
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8"
      )
    );
  }
  const schema = loadTypeScript("../lib/db/schema.ts", {
    "drizzle-orm": orm,
    "drizzle-orm/sqlite-core": sqliteCore,
  });
  // Exercise real Drizzle D1 queries against SQLite with D1's result shape.
  const d1 = {
    batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return Promise.resolve(results);
      } catch (error) {
        sqlite.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    prepare(query) {
      const statement = sqlite.prepare(query);
      const bound = (params = []) => ({
        all() {
          return Promise.resolve(this.execute());
        },
        bind: (...values) => bound(values),
        execute: () => ({ results: statement.all(...params), success: true }),
        raw: () => Promise.resolve(statement.all(...params).map(Object.values)),
        run: () => Promise.resolve(statement.run(...params)),
      });
      return bound();
    },
  };
  const database = drizzle(d1, { schema });
  const dbClient = { getDb: () => Promise.resolve(database) };
  const timing = loadTypeScript("../lib/study/timing.ts");
  const prompts = JSON.parse(
    readFileSync(new URL("../lib/study/prompts.json", import.meta.url), "utf8")
  );
  const study = loadTypeScript(
    "../lib/study/study.ts",
    { "./prompts.json": prompts },
    { process }
  );
  const queries = loadTypeScript("../lib/study/queries.ts", {
    "./study": study,
    "./timing": timing,
    "@/lib/db/client": dbClient,
    "@/lib/db/schema": schema,
    "drizzle-orm": orm,
    "node:crypto": { randomUUID },
    "server-only": {},
  });
  const users = loadTypeScript("../lib/db/users.ts", {
    "./client": dbClient,
    "./schema": schema,
    "node:crypto": { randomUUID },
    "server-only": {},
  });
  return { prompts, queries, sqlite, study, timing, users };
}

test("anonymous users and A/B sessions work with the existing database schema", async (context) => {
  const { users, queries, sqlite, prompts } = setup(context);
  const [user] = await users.createGuestUser();
  assert.equal(
    sqlite.prepare('SELECT password FROM "User" WHERE id = ?').get(user.id)
      .password,
    null
  );
  const a = await queries.getOrCreateStudySession(user.id, "a");
  const b = await queries.getOrCreateStudySession(user.id, "b");
  assert.notEqual(a.id, b.id);
  assert.ok(a.systemPrompt.includes(prompts.responseLength));
  assert.ok(b.systemPrompt.includes(prompts.responseLength));
  sqlite
    .prepare('UPDATE "StudySession" SET systemPrompt = ? WHERE id = ?')
    .run("saved prompt", a.id);
  const existing = await queries.getOrCreateStudySession(user.id, "a");
  assert.equal(existing.id, a.id);
  assert.equal(existing.systemPrompt, "saved prompt");
});

test("exchange batches preserve sequence and admin deletion cascades to messages", async (context) => {
  const { users, queries, sqlite } = setup(context);
  const [user] = await users.createGuestUser();
  const session = await queries.getOrCreateStudySession(user.id, "a");
  await queries.updateStudySession(session.id, user.id, "start");
  const first = await queries.saveStudyExchange(session.id, "问题一", "回答一");
  const second = await queries.saveStudyExchange(
    session.id,
    "问题二",
    "回答二"
  );
  assert.deepEqual(
    Array.from(first, (message) => message.sequence),
    [1, 2]
  );
  assert.deepEqual(
    Array.from(second, (message) => message.sequence),
    [3, 4]
  );
  const page = await queries.listStudyAdminSessions({
    condition: "all",
    page: 1,
    pageSize: 20,
    query: "",
  });
  assert.equal(page.total, 1);
  assert.equal(page.sessions[0].messageCount, 4);
  assert.equal(await queries.deleteStudyAdminSession(session.id), true);
  assert.equal(
    sqlite.prepare('SELECT count(*) AS total FROM "StudyMessage"').get().total,
    0
  );
  assert.equal(await queries.deleteStudyAdminSession(session.id), false);
});

test("the server enforces ownership and the ten-minute minimum", async (context) => {
  const { users, queries, sqlite } = setup(context);
  const [user] = await users.createGuestUser();
  const session = await queries.getOrCreateStudySession(user.id, "a");
  await assert.rejects(
    queries.updateStudySession(session.id, "other-user", "start"),
    /无权访问/
  );
  await queries.updateStudySession(session.id, user.id, "start");
  await assert.rejects(
    queries.updateStudySession(session.id, user.id, "end"),
    /10 分钟/
  );
  sqlite
    .prepare('UPDATE "StudySession" SET startedAt = ? WHERE id = ?')
    .run(Date.now() - 11 * 60_000, session.id);
  const ended = await queries.updateStudySession(session.id, user.id, "end");
  assert.ok(ended.endedAt);
  await assert.rejects(
    queries.saveStudyExchange(session.id, "问题", "回答"),
    /已经结束/
  );
});
