ALTER TABLE "PracticeSession" ADD COLUMN "questionsJson" TEXT;
ALTER TABLE "PracticeSession" ADD COLUMN "welcomeText" TEXT;

CREATE TABLE "PracticeAdminSetting" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
