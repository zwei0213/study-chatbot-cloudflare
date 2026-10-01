import { sql, type InferSelectModel } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = (name = "createdAt") =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const user = sqliteTable("User", {
  createdAt: createdAt(),
  email: text("email").notNull(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  id: text("id").primaryKey().notNull(),
  image: text("image"),
  isAnonymous: integer("isAnonymous", { mode: "boolean" })
    .notNull()
    .default(false),
  name: text("name"),
  password: text("password"),
  updatedAt: createdAt("updatedAt"),
});

export type User = InferSelectModel<typeof user>;

export const studySession = sqliteTable(
  "StudySession",
  {
    condition: text("condition", { enum: ["a", "b"] }).notNull(),
    createdAt: createdAt(),
    endedAt: integer("endedAt", { mode: "timestamp_ms" }),
    id: text("id").primaryKey().notNull(),
    model: text("model").notNull(),
    startedAt: integer("startedAt", { mode: "timestamp_ms" }),
    systemPrompt: text("systemPrompt").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => ({
    participantCondition: uniqueIndex("StudySession_user_condition_idx").on(
      table.userId,
      table.condition
    ),
  })
);

export type StudySession = InferSelectModel<typeof studySession>;

export const studyMessage = sqliteTable(
  "StudyMessage",
  {
    content: text("content").notNull(),
    createdAt: createdAt(),
    id: text("id").primaryKey().notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    sequence: integer("sequence").notNull(),
    sessionId: text("sessionId")
      .notNull()
      .references(() => studySession.id, { onDelete: "cascade" }),
  },
  (table) => ({
    sessionSequence: uniqueIndex("StudyMessage_session_sequence_idx").on(
      table.sessionId,
      table.sequence
    ),
  })
);

export type StudyMessage = InferSelectModel<typeof studyMessage>;

export const studyAdminSetting = sqliteTable("StudyAdminSetting", {
  key: text("key").primaryKey().notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  value: text("value").notNull(),
});
