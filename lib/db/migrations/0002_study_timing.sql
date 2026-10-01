ALTER TABLE "StudySession" ADD COLUMN "startedAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "StudySession" ADD COLUMN "endedAt" timestamp with time zone;
--> statement-breakpoint
-- Preserve existing conversations and use their first saved message as the start.
UPDATE "StudySession" AS session
SET "startedAt" = messages.first_message_at
FROM (
  SELECT "sessionId", min("createdAt") AS first_message_at
  FROM "StudyMessage"
  GROUP BY "sessionId"
) AS messages
WHERE session."id" = messages."sessionId";
