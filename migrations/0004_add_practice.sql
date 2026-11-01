CREATE TABLE "PracticeSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "condition" TEXT NOT NULL CHECK ("condition" IN ('low', 'high')),
  "phase" TEXT NOT NULL,
  "currentRequired" INTEGER NOT NULL DEFAULT 0,
  "currentExtra" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "trainingGoal" TEXT,
  "participantCode" TEXT,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "startedAt" INTEGER NOT NULL,
  "completedAt" INTEGER
);

CREATE UNIQUE INDEX "PracticeSession_user_condition_idx"
  ON "PracticeSession" ("userId", "condition");
CREATE INDEX "PracticeSession_condition_created_idx"
  ON "PracticeSession" ("condition", "createdAt");
CREATE UNIQUE INDEX "PracticeSession_participant_code_idx"
  ON "PracticeSession" ("participantCode");

CREATE TABLE "PracticeMessage" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL REFERENCES "PracticeSession"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "kind" TEXT NOT NULL,
  "questionId" TEXT,
  "grade" INTEGER CHECK ("grade" IN (0, 1)),
  "content" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX "PracticeMessage_session_sequence_idx"
  ON "PracticeMessage" ("sessionId", "sequence");
