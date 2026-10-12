-- Expand the condition constraint while preserving every existing session and
-- message. Copy both tables before dropping either one, so ON DELETE CASCADE
-- cannot remove messages from the replacement tables.
CREATE TABLE "__StudySession_with_c" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "condition" TEXT NOT NULL CHECK ("condition" IN ('a', 'b', 'c')),
  "model" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "startedAt" INTEGER,
  "endedAt" INTEGER
);

CREATE TABLE "__StudyMessage_with_c" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL REFERENCES "__StudySession_with_c"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO "__StudySession_with_c"
  ("id", "userId", "condition", "model", "systemPrompt", "createdAt", "startedAt", "endedAt")
SELECT "id", "userId", "condition", "model", "systemPrompt", "createdAt", "startedAt", "endedAt"
FROM "StudySession";

INSERT INTO "__StudyMessage_with_c"
  ("id", "sessionId", "role", "content", "sequence", "createdAt")
SELECT "id", "sessionId", "role", "content", "sequence", "createdAt"
FROM "StudyMessage";

DROP TABLE "StudyMessage";
DROP TABLE "StudySession";

-- SQLite updates the replacement message table's foreign key when renaming its
-- referenced session table, keeping cascade deletion attached to StudySession.
ALTER TABLE "__StudySession_with_c" RENAME TO "StudySession";
ALTER TABLE "__StudyMessage_with_c" RENAME TO "StudyMessage";

CREATE UNIQUE INDEX "StudySession_user_condition_idx"
  ON "StudySession" ("userId", "condition");
CREATE INDEX "StudySession_createdAt_idx"
  ON "StudySession" ("createdAt");
CREATE UNIQUE INDEX "StudyMessage_session_sequence_idx"
  ON "StudyMessage" ("sessionId", "sequence");
