import "server-only";

import { and, asc, count, desc, eq, type SQL, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { studyAdminSetting, studyMessage, studySession } from "@/lib/db/schema";
import { getStudyPrompt, STUDY_MODEL, type StudyCondition } from "./study";
import {
  getStudyElapsedSeconds,
  STUDY_MIN_SECONDS,
  StudySessionError,
} from "./timing";

export async function getOrCreateStudySession(
  userId: string,
  condition: StudyCondition
) {
  const db = await getDb();
  await db
    .insert(studySession)
    .values({
      condition,
      model: STUDY_MODEL,
      systemPrompt: getStudyPrompt(condition),
      userId,
    })
    .onConflictDoNothing();

  const [session] = await db
    .select()
    .from(studySession)
    .where(
      and(
        eq(studySession.userId, userId),
        eq(studySession.condition, condition)
      )
    )
    .limit(1);

  if (!session) {
    throw new Error("Unable to create study session");
  }
  return session;
}

export async function getStudySession(id: string) {
  const db = await getDb();
  const [session] = await db
    .select()
    .from(studySession)
    .where(eq(studySession.id, id))
    .limit(1);
  return session;
}

export async function getStudyMessages(sessionId: string) {
  const db = await getDb();
  return db
    .select()
    .from(studyMessage)
    .where(eq(studyMessage.sessionId, sessionId))
    .orderBy(asc(studyMessage.sequence));
}

export function updateStudySession(
  id: string,
  userId: string,
  action: "start" | "end"
) {
  return getDb().then((db) => db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(studySession)
      .where(and(eq(studySession.id, id), eq(studySession.userId, userId)))
      .for("update");
    if (!session) {
      throw new StudySessionError("无权访问该对话。", 403);
    }
    if (session.endedAt || (action === "start" && session.startedAt)) {
      return session;
    }

    const now = new Date();
    if (
      action === "end" &&
      (!session.startedAt ||
        getStudyElapsedSeconds(session.startedAt, null, now.getTime()) <
          STUDY_MIN_SECONDS)
    ) {
      throw new StudySessionError("对话满 10 分钟后才能结束，请继续交流。");
    }
    const [updated] = await tx
      .update(studySession)
      .set(action === "start" ? { startedAt: now } : { endedAt: now })
      .where(eq(studySession.id, id))
      .returning();
    return updated;
  }));
}

export function saveStudyExchange(
  sessionId: string,
  userText: string,
  assistantText: string
) {
  return getDb().then((db) => db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(studySession)
      .where(eq(studySession.id, sessionId))
      .for("update");
    if (!session?.startedAt || session.endedAt) {
      throw new StudySessionError("本次对话尚未开始或已经结束，请刷新页面。");
    }
    const [{ total }] = await tx
      .select({ total: count() })
      .from(studyMessage)
      .where(eq(studyMessage.sessionId, sessionId));
    const [userMessage] = await tx
      .insert(studyMessage)
      .values({
        content: userText,
        role: "user",
        sequence: total + 1,
        sessionId,
      })
      .returning();
    const [assistantMessage] = await tx
      .insert(studyMessage)
      .values({
        content: assistantText,
        role: "assistant",
        sequence: total + 2,
        sessionId,
      })
      .returning();
    return [userMessage, assistantMessage];
  }));
}

export async function getStudyExportRows() {
  const db = await getDb();
  return db
    .select({
      condition: studySession.condition,
      content: studyMessage.content,
      endedAt: studySession.endedAt,
      messageCreatedAt: studyMessage.createdAt,
      messageId: studyMessage.id,
      model: studySession.model,
      participantId: studySession.id,
      role: studyMessage.role,
      sequence: studyMessage.sequence,
      sessionCreatedAt: studySession.createdAt,
      startedAt: studySession.startedAt,
      systemPrompt: studySession.systemPrompt,
    })
    .from(studySession)
    .leftJoin(studyMessage, eq(studyMessage.sessionId, studySession.id))
    .orderBy(asc(studySession.createdAt), asc(studyMessage.sequence));
}

export async function listStudyAdminSessions({
  condition,
  page,
  pageSize,
  query,
}: {
  condition: "all" | StudyCondition;
  page: number;
  pageSize: number;
  query: string;
}) {
  const filters: SQL[] = [];
  if (condition !== "all") {
    filters.push(eq(studySession.condition, condition));
  }
  if (query) {
    const pattern = `%${query}%`;
    filters.push(
      sql`(${studySession.id}::text ILIKE ${pattern} OR ${studySession.userId}::text ILIKE ${pattern})`
    );
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const db = await getDb();
  const [total] = await db
    .select({ value: count() })
    .from(studySession)
    .where(where);
  const sessions = await db
    .select({
      condition: studySession.condition,
      createdAt: studySession.createdAt,
      endedAt: studySession.endedAt,
      id: studySession.id,
      messageCount: sql<number>`count(${studyMessage.id})::int`,
      model: studySession.model,
      startedAt: studySession.startedAt,
      userId: studySession.userId,
    })
    .from(studySession)
    .leftJoin(studyMessage, eq(studyMessage.sessionId, studySession.id))
    .where(where)
    .groupBy(
      studySession.id,
      studySession.condition,
      studySession.createdAt,
      studySession.endedAt,
      studySession.model,
      studySession.startedAt,
      studySession.userId
    )
    .orderBy(desc(studySession.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { sessions, total: total.value };
}

export async function getStudyAdminSessionDetail(id: string) {
  const db = await getDb();
  const [session] = await db
    .select({
      condition: studySession.condition,
      createdAt: studySession.createdAt,
      endedAt: studySession.endedAt,
      id: studySession.id,
      model: studySession.model,
      startedAt: studySession.startedAt,
      userId: studySession.userId,
    })
    .from(studySession)
    .where(eq(studySession.id, id))
    .limit(1);
  if (!session) {
    return null;
  }
  const messages = await getStudyMessages(id);
  return { ...session, messages };
}

export function deleteStudyAdminSession(id: string) {
  return getDb().then((db) => db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: studySession.id })
      .from(studySession)
      .where(eq(studySession.id, id))
      .for("update");
    if (!session) {
      return false;
    }

    await tx.delete(studyMessage).where(eq(studyMessage.sessionId, id));
    await tx.delete(studySession).where(eq(studySession.id, id));
    return true;
  }));
}

export async function getStudyAdminSetting(key: string) {
  const db = await getDb();
  const [setting] = await db
    .select({
      updatedAt: studyAdminSetting.updatedAt,
      value: studyAdminSetting.value,
    })
    .from(studyAdminSetting)
    .where(eq(studyAdminSetting.key, key))
    .limit(1);
  return setting ?? null;
}

export async function setStudyAdminSetting(key: string, value: string) {
  const db = await getDb();
  const updatedAt = new Date();
  await db
    .insert(studyAdminSetting)
    .values({ key, updatedAt, value })
    .onConflictDoUpdate({
      set: { updatedAt, value },
      target: studyAdminSetting.key,
    });
}

export async function deleteStudyAdminSetting(key: string) {
  const db = await getDb();
  await db.delete(studyAdminSetting).where(eq(studyAdminSetting.key, key));
}
