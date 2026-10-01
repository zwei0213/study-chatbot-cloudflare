CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "isAnonymous" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS "StudySession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "condition" TEXT NOT NULL CHECK ("condition" IN ('a', 'b')),
  "model" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "startedAt" INTEGER,
  "endedAt" INTEGER
);

CREATE TABLE IF NOT EXISTS "StudyMessage" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL REFERENCES "StudySession"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS "StudyAdminSetting" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudySession_user_condition_idx"
  ON "StudySession" ("userId", "condition");

CREATE UNIQUE INDEX IF NOT EXISTS "StudyMessage_session_sequence_idx"
  ON "StudyMessage" ("sessionId", "sequence");
