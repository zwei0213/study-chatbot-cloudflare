import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const user = pgTable("User", {
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  email: varchar("email", { length: 64 }).notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  name: text("name"),
  password: varchar("password", { length: 64 }),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export const studySession = pgTable(
  "StudySession",
  {
    condition: varchar("condition", { enum: ["a", "b"], length: 1 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    model: varchar("model", { length: 64 }).notNull(),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    systemPrompt: text("systemPrompt").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
  },
  (table) => ({
    participantCondition: uniqueIndex("StudySession_user_condition_idx").on(
      table.userId,
      table.condition
    ),
  })
);

export type StudySession = InferSelectModel<typeof studySession>;

export const studyMessage = pgTable(
  "StudyMessage",
  {
    content: text("content").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    role: varchar("role", { enum: ["user", "assistant"], length: 9 }).notNull(),
    sequence: integer("sequence").notNull(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => studySession.id),
  },
  (table) => ({
    sessionSequence: uniqueIndex("StudyMessage_session_sequence_idx").on(
      table.sessionId,
      table.sequence
    ),
  })
);

export type StudyMessage = InferSelectModel<typeof studyMessage>;

export const studyAdminSetting = pgTable("StudyAdminSetting", {
  key: varchar("key", { length: 80 }).primaryKey().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  value: text("value").notNull(),
});
