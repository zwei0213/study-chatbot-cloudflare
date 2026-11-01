import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { isPracticeCondition } from "@/lib/practice/flow";
import {
  getOrCreatePracticeSession,
  getPracticeSessionMessages,
} from "@/lib/practice/queries";

const schema = z.object({ condition: z.enum(["low", "high"]) });

export async function POST(request: Request) {
  try {
    const user = (await auth())?.user;
    if (!user?.id) {
      return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
    }
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success || !isPracticeCondition(body.data.condition)) {
      return Response.json({ error: "陪练链接无效。" }, { status: 400 });
    }
    const session = await getOrCreatePracticeSession(
      user.id,
      body.data.condition
    );
    const savedMessages = await getPracticeSessionMessages(session.id);
    const messages =
      session.phase === "ready"
        ? savedMessages.filter((message) => message.kind !== "welcome")
        : savedMessages;
    return Response.json(
      {
        condition: session.condition,
        currentExtra: session.currentExtra,
        currentRequired: session.currentRequired,
        id: session.id,
        messages,
        participantCode: session.participantCode,
        phase: session.phase,
        trainingGoal: session.trainingGoal,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Unable to load practice session:", error);
    return Response.json({ error: "暂时无法加载陪练记录。" }, { status: 503 });
  }
}
