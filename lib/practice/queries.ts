import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { practiceMessage, practiceSession } from "@/lib/db/schema";
import { getPracticeRuntimeConfig } from "./config";
import {
  getPracticeSystemPrompt,
  getPracticeWelcome,
  type PracticeCondition,
  type PracticeMessageKind,
  type PracticePhase,
} from "./flow";

export async function getOrCreatePracticeSession(
  userId: string,
  condition: PracticeCondition
) {
  const db = await getDb();
  const config = await getPracticeRuntimeConfig();
  const existing = await db
    .select()
    .from(practiceSession)
    .where(
      and(
        eq(practiceSession.userId, userId),
        eq(practiceSession.condition, condition)
      )
    )
    .limit(1);
  if (existing[0]) {
    if (existing[0].phase === "ready") {
      const refreshed = {
        model: config.model,
        promptVersion: config.promptVersion,
        questionsJson: JSON.stringify(config.questions),
        systemPrompt: getPracticeSystemPrompt(
          condition,
          config,
          config.questions
        ),
        welcomeText: getPracticeWelcome(condition, config),
      };
      await db
        .update(practiceSession)
        .set(refreshed)
        .where(eq(practiceSession.id, existing[0].id));
      return { ...existing[0], ...refreshed };
    }
    return existing[0];
  }

  const id = randomUUID();
  await db
    .insert(practiceSession)
    .values({
      condition,
      id,
      model: config.model,
      phase: "ready",
      promptVersion: config.promptVersion,
      questionsJson: JSON.stringify(config.questions),
      startedAt: new Date(),
      systemPrompt: getPracticeSystemPrompt(condition, config, config.questions),
      userId,
      welcomeText: getPracticeWelcome(condition, config),
    })
    .onConflictDoNothing();

  const [session] = await db
    .select()
    .from(practiceSession)
    .where(
      and(
        eq(practiceSession.userId, userId),
        eq(practiceSession.condition, condition)
      )
    )
    .limit(1);
  if (!session) {
    throw new Error("Unable to create practice session");
  }
  return session;
}

export async function getPracticeSessionForUser(id: string, userId: string) {
  const db = await getDb();
  const [session] = await db
    .select()
    .from(practiceSession)
    .where(and(eq(practiceSession.id, id), eq(practiceSession.userId, userId)))
    .limit(1);
  return session ?? null;
}

export async function refreshReadyPracticeSessionForUser(
  id: string,
  userId: string,
  condition: PracticeCondition
) {
  const db = await getDb();
  const config = await getPracticeRuntimeConfig();
  await db
    .update(practiceSession)
    .set({
      model: config.model,
      promptVersion: config.promptVersion,
      questionsJson: JSON.stringify(config.questions),
      systemPrompt: getPracticeSystemPrompt(condition, config, config.questions),
      welcomeText: getPracticeWelcome(condition, config),
    })
    .where(
      and(
        eq(practiceSession.id, id),
        eq(practiceSession.userId, userId),
        eq(practiceSession.phase, "ready")
      )
    );
  const [session] = await db
    .select()
    .from(practiceSession)
    .where(and(eq(practiceSession.id, id), eq(practiceSession.userId, userId)))
    .limit(1);
  return session ?? null;
}

export async function getPracticeSessionMessages(sessionId: string) {
  const db = await getDb();
  return db
    .select()
    .from(practiceMessage)
    .where(eq(practiceMessage.sessionId, sessionId))
    .orderBy(asc(practiceMessage.sequence));
}

export type PracticeMessageInput = {
  content: string;
  grade?: boolean | null;
  kind: PracticeMessageKind;
  questionId?: string | null;
  role: "user" | "assistant";
};

export async function savePracticeTurn(
  session: { id: string },
  messages: PracticeMessageInput[],
  next: {
    attempt?: number;
    completedAt?: Date | null;
    currentExtra?: number;
    currentRequired?: number;
    participantCode?: string | null;
    phase: PracticePhase;
    trainingGoal?: string;
  }
) {
  const db = await getDb();
  const [lastMessage] = await db
    .select({
      value: sql<number>`COALESCE(MAX(${practiceMessage.sequence}), 0)`,
    })
    .from(practiceMessage)
    .where(eq(practiceMessage.sessionId, session.id));
  const update = db
    .update(practiceSession)
    .set({ ...next, version: sql`${practiceSession.version} + 1` })
    .where(eq(practiceSession.id, session.id));
  const inserts = messages.map((message, offset) =>
    db.insert(practiceMessage).values({
      content: message.content,
      grade: message.grade ?? null,
      id: randomUUID(),
      kind: message.kind,
      questionId: message.questionId ?? null,
      role: message.role,
      sequence: (lastMessage?.value ?? 0) + offset + 1,
      sessionId: session.id,
    })
  );
  await db.batch([update, ...inserts]);
  return getPracticeSessionMessages(session.id);
}

export async function listPracticeAdminSessions(code?: string) {
  const db = await getDb();
  const query = db.select().from(practiceSession);
  return (
    code
      ? query.where(like(practiceSession.participantCode, `%${code}%`))
      : query
  ).orderBy(desc(practiceSession.createdAt));
}

export async function deletePracticeAdminSession(id: string) {
  const db = await getDb();
  const deleted = await db
    .delete(practiceSession)
    .where(eq(practiceSession.id, id))
    .returning({ id: practiceSession.id });
  return deleted.length > 0;
}

export async function listPracticeAdminExportRows() {
  const db = await getDb();
  return db
    .select({
      answerGrade: practiceMessage.grade,
      condition: practiceSession.condition,
      createdAt: practiceSession.createdAt,
      message: practiceMessage.content,
      messageCreatedAt: practiceMessage.createdAt,
      messageId: practiceMessage.id,
      messageKind: practiceMessage.kind,
      participantCode: practiceSession.participantCode,
      phase: practiceSession.phase,
      promptVersion: practiceSession.promptVersion,
      questionId: practiceMessage.questionId,
      role: practiceMessage.role,
      sequence: practiceMessage.sequence,
      sessionId: practiceSession.id,
      systemPrompt: practiceSession.systemPrompt,
      userId: practiceSession.userId,
    })
    .from(practiceSession)
    .leftJoin(
      practiceMessage,
      eq(practiceMessage.sessionId, practiceSession.id)
    )
    .orderBy(asc(practiceSession.createdAt), asc(practiceMessage.sequence));
}

export async function getPracticeAdminDetail(id: string) {
  const db = await getDb();
  const [session] = await db
    .select()
    .from(practiceSession)
    .where(eq(practiceSession.id, id))
    .limit(1);
  if (!session) {
    return null;
  }
  return { ...session, messages: await getPracticeSessionMessages(id) };
}
