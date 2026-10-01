CREATE TABLE IF NOT EXISTS "StudyAdminSetting" (
  "key" varchar(80) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
