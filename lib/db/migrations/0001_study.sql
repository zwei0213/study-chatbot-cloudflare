CREATE TABLE IF NOT EXISTS "StudySession" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id"),
  "condition" varchar(1) NOT NULL,
  "model" varchar(64) NOT NULL,
  "systemPrompt" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "StudySession_condition_check" CHECK ("condition" IN ('a', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "StudySession_user_condition_idx" ON "StudySession" ("userId", "condition");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "StudyMessage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sessionId" uuid NOT NULL REFERENCES "StudySession"("id"),
  "role" varchar(9) NOT NULL,
  "sequence" integer NOT NULL,
  "content" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "StudyMessage_role_check" CHECK ("role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "StudyMessage_session_sequence_idx" ON "StudyMessage" ("sessionId", "sequence");
