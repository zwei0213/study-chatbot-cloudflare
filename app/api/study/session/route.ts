import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  getOrCreateStudySession,
  getStudyMessages,
  updateStudySession,
} from "@/lib/study/queries";
import { getStudyMaxExchanges } from "@/lib/study/study";
import { StudySessionError } from "@/lib/study/timing";

const requestSchema = z.object({ condition: z.enum(["a", "b"]) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json({ error: "实验链接无效。" }, { status: 400 });
  }

  try {
    const studySession = await getOrCreateStudySession(
      session.user.id,
      parsed.data.condition
    );
    const messages = await getStudyMessages(studySession.id);
    return Response.json({
      endedAt: studySession.endedAt,
      maxExchanges: getStudyMaxExchanges(),
      messages: messages.map(({ id, role, content, createdAt, sequence }) => ({
        content,
        createdAt,
        id,
        role,
        sequence,
      })),
      participantId: studySession.id,
      serverNow: new Date().toISOString(),
      startedAt: studySession.startedAt,
    });
  } catch (error) {
    console.error("Unable to start study session:", error);
    return Response.json({ error: "暂时无法连接数据库。" }, { status: 503 });
  }
}

const updateSchema = z.object({
  action: z.enum(["start", "end"]),
  participantId: z.uuid(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "无效的对话操作。" }, { status: 400 });
  }
  try {
    const updated = await updateStudySession(
      parsed.data.participantId,
      session.user.id,
      parsed.data.action
    );
    return Response.json({
      endedAt: updated.endedAt,
      serverNow: new Date().toISOString(),
      startedAt: updated.startedAt,
    });
  } catch (error) {
    if (error instanceof StudySessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update study session:", error);
    return Response.json({ error: "暂时无法保存，请重试。" }, { status: 503 });
  }
}
