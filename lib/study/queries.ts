import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
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
      id: randomUUID(),
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

export async function updateStudySession(
  id: string,
  userId: string,
  action: "start" | "end"
) {
  const db = await getDb();
  const [session] = await db
    .select()
    .from(studySession)
    .where(and(eq(studySession.id, id), eq(studySession.userId, userId)))
    .limit(1);

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

  const updateCondition =
    action === "start"
      ? and(
          eq(studySession.id, id),
          eq(studySession.userId, userId),
          isNull(studySession.startedAt),
          isNull(studySession.endedAt)
        )
      : and(
          eq(studySession.id, id),
          eq(studySession.userId, userId),
          isNotNull(studySession.startedAt),
          isNull(studySession.endedAt)
        );

  await db
    .update(studySession)
    .set(action === "start" ? { startedAt: now } : { endedAt: now })
    .where(updateCondition);

  const [updated] = await db
    .select()
    .from(studySession)
    .where(eq(studySession.id, id))
    .limit(1);
  return updated ?? session;
}

export async function saveStudyExchange(
  sessionId: string,
  userText: string,
  assistantText: string
) {
  const db = await getDb();
  const [session] = await db
    .select({ endedAt: studySession.endedAt, startedAt: studySession.startedAt })
    .from(studySession)
    .where(eq(studySession.id, sessionId))
    .limit(1);
  if (!session?.startedAt || session.endedAt) {
    throw new StudySessionError("本次对话尚未开始或已经结束，请刷新页面。");
  }

  const createdAt = new Date();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const nextSequence = sql<number>`COALESCE((SELECT MAX(${studyMessage.sequence}) FROM ${studyMessage} WHERE ${studyMessage.sessionId} = ${sessionId}), 0) + 1`;

  await db.batch([
    db.insert(studyMessage).values({
      content: userText,
      createdAt,
      id: userMessageId,
      role: "user",
      sequence: nextSequence,
      sessionId,
    }),
    db.insert(studyMessage).values({
      content: assistantText,
      createdAt,
      id: assistantMessageId,
      role: "assistant",
      sequence: nextSequence,
      sessionId,
    }),
  ]);

  const savedMessages = await db
    .select()
    .from(studyMessage)
    .where(
      or(eq(studyMessage.id, userMessageId), eq(studyMessage.id, assistantMessageId))
    )
    .orderBy(asc(studyMessage.sequence));
  if (savedMessages.length !== 2) {
    throw new Error("Unable to save the complete study exchange");
  }
  return savedMessages;
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
    const pattern = `%${query.toLowerCase()}%`;
    filters.push(
      or(
        like(sql`lower(${studySession.id})`, pattern),
        like(sql`lower(${studySession.userId})`, pattern)
      )!
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
      messageCount: sql<number>`count(${studyMessage.id})`,
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

export async function deleteStudyAdminSession(id: string) {
  const db = await getDb();
  const deleted = await db
    .delete(studySession)
    .where(eq(studySession.id, id))
    .returning({ id: studySession.id });
  return deleted.length > 0;
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
