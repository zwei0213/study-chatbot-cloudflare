import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { checkIpRateLimit, RateLimitError } from "@/lib/ratelimit";
import { getStudyApiKey } from "@/lib/study/admin";
import {
  getStudyMessages,
  getStudySession,
  saveStudyExchange,
} from "@/lib/study/queries";
import { getStudyMaxExchanges } from "@/lib/study/study";
import { StudySessionError } from "@/lib/study/timing";
import { readModelStream } from "@/lib/study/upstream";

export const maxDuration = 60;

const requestSchema = z.object({
  participantId: z.uuid(),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
    }

    const parsed = requestSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return Response.json(
        { error: "消息格式无效或超过 2000 字。" },
        { status: 400 }
      );
    }

    try {
      await checkIpRateLimit(request, "chat");
    } catch (error) {
      if (error instanceof RateLimitError) {
        return Response.json(
          { error: "发送过于频繁，请稍后再试。" },
          { status: 429 }
        );
      }
      throw error;
    }

    const studySession = await getStudySession(parsed.data.participantId);
    if (!studySession || studySession.userId !== session.user.id) {
      return Response.json({ error: "无权访问该对话。" }, { status: 403 });
    }
    if (!studySession.startedAt || studySession.endedAt) {
      return Response.json(
        { error: "本次对话尚未开始或已经结束，请刷新页面。" },
        { status: 409 }
      );
    }

    let apiKey: string | null;
    try {
      apiKey = await getStudyApiKey();
    } catch (error) {
      console.error("Study API key unavailable:", error);
      return Response.json(
        { error: "管理员保存的 API Key 无法读取，请在后台重新保存。" },
        { status: 503 }
      );
    }
    if (!apiKey) {
      return Response.json(
        { error: "管理员尚未配置模型 API Key。" },
        { status: 503 }
      );
    }

    const history = await getStudyMessages(studySession.id);
    const maxExchanges = getStudyMaxExchanges();
    if (
      maxExchanges !== null &&
      history.filter((item) => item.role === "user").length >= maxExchanges
    ) {
      return Response.json(
        { error: "已达到设定的对话轮数，请在满 10 分钟后点击结束对话。" },
        { status: 409 }
      );
    }
    const upstreamAbort = new AbortController();
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      body: JSON.stringify({
        messages: [
          { content: studySession.systemPrompt, role: "system" },
          ...history.map(({ role, content }) => ({ content, role })),
          { content: parsed.data.text, role: "user" },
        ],
        model: studySession.model,
        stream: true,
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.any([
        request.signal,
        upstreamAbort.signal,
        AbortSignal.timeout(55_000),
      ]),
    });

    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      console.error("DeepSeek request failed with status", response.status);
      return Response.json(
        { error: "AI 暂时无法回复，请稍后重试。" },
        { status: 502 }
      );
    }

    const upstreamBody = response.body;
    if (!upstreamBody) {
      return Response.json(
        { error: "AI 暂时无法回复，请稍后重试。" },
        { status: 502 }
      );
    }

    const encoder = new TextEncoder();
    let disconnected = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        disconnected = true;
        upstreamAbort.abort();
      },
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          if (disconnected) {
            return;
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        };

        let answer = "";
        try {
          await readModelStream(upstreamBody, (text) => {
            answer += text;
            send({ text, type: "delta" });
          });
          if (disconnected) {
            return;
          }

          const finalAnswer = answer.trim();
          if (!finalAnswer) {
            send({ error: "AI 未返回有效回复，请重试。", type: "error" });
            return;
          }

          const messages = await saveStudyExchange(
            studySession.id,
            parsed.data.text,
            finalAnswer
          );
          send({ messages, type: "done" });
        } catch (error) {
          if (!disconnected) {
            console.error("Study chat stream failed:", error);
            send({
              error:
                error instanceof StudySessionError
                  ? error.message
                  : "AI 回复中断或保存失败，请稍后重试。",
              type: "error",
            });
          }
        } finally {
          if (!disconnected) {
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof StudySessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Study chat failed:", error);
    return Response.json({ error: "发送失败，请重试。" }, { status: 503 });
  }
}
