import { type InferSelectModel, sql } from "drizzle-orm";
import {
  index,
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
  email: text("email").notNull(),
  id: text("id").primaryKey().notNull(),
});

export const studySession = sqliteTable(
  "StudySession",
  {
    condition: text("condition", { enum: ["a", "b", "c"] }).notNull(),
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
    createdAtIndex: index("StudySession_createdAt_idx").on(table.createdAt),
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

export const practiceSession = sqliteTable(
  "PracticeSession",
  {
    attempt: integer("attempt").notNull().default(1),
    completedAt: integer("completedAt", { mode: "timestamp_ms" }),
    condition: text("condition", { enum: ["low", "high"] }).notNull(),
    createdAt: createdAt(),
    currentExtra: integer("currentExtra").notNull().default(0),
    currentRequired: integer("currentRequired").notNull().default(0),
    id: text("id").primaryKey().notNull(),
    model: text("model").notNull(),
    participantCode: text("participantCode"),
    phase: text("phase").notNull(),
    promptVersion: text("promptVersion").notNull(),
    questionsJson: text("questionsJson"),
    startedAt: integer("startedAt", { mode: "timestamp_ms" }).notNull(),
    systemPrompt: text("systemPrompt").notNull(),
    trainingGoal: text("trainingGoal"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(0),
    welcomeText: text("welcomeText"),
  },
  (table) => ({
    conditionCreated: index("PracticeSession_condition_created_idx").on(
      table.condition,
      table.createdAt
    ),
    participantCode: uniqueIndex("PracticeSession_participant_code_idx").on(
      table.participantCode
    ),
    participantCondition: uniqueIndex("PracticeSession_user_condition_idx").on(
      table.userId,
      table.condition
    ),
  })
);

export type PracticeSession = InferSelectModel<typeof practiceSession>;

export const practiceMessage = sqliteTable(
  "PracticeMessage",
  {
    content: text("content").notNull(),
    createdAt: createdAt(),
    grade: integer("grade", { mode: "boolean" }),
    id: text("id").primaryKey().notNull(),
    kind: text("kind").notNull(),
    questionId: text("questionId"),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    sequence: integer("sequence").notNull(),
    sessionId: text("sessionId")
      .notNull()
      .references(() => practiceSession.id, { onDelete: "cascade" }),
  },
  (table) => ({
    sessionSequence: uniqueIndex("PracticeMessage_session_sequence_idx").on(
      table.sessionId,
      table.sequence
    ),
  })
);

export type PracticeMessage = InferSelectModel<typeof practiceMessage>;

export const studyAdminSetting = sqliteTable("StudyAdminSetting", {
  key: text("key").primaryKey().notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  value: text("value").notNull(),
});

export const practiceAdminSetting = sqliteTable("PracticeAdminSetting", {
  key: text("key").primaryKey().notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  value: text("value").notNull(),
});
