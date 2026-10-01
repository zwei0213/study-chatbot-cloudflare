import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { checkIpRateLimit } from "@/lib/ratelimit";
import { getStudyApiKey } from "@/lib/study/admin";
import {
  getStudyMessages,
  getStudySession,
  saveStudyExchange,
} from "@/lib/study/queries";
import { getStudyMaxExchanges } from "@/lib/study/study";
import { StudySessionError } from "@/lib/study/timing";

export const maxDuration = 60;

const requestSchema = z.object({
  participantId: z.uuid(),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
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

  try {
    await checkIpRateLimit(request, "chat");
  } catch {
    return Response.json(
      { error: "发送过于频繁，请稍后再试。" },
      { status: 429 }
    );
  }

  try {
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
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
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
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        };

        let answer = "";
        try {
          const decoder = new TextDecoder();
          let buffer = "";
          let modelFinished = false;

          const handleEvent = (rawEvent: string) => {
            const data = rawEvent
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");

            if (!data) {
              return;
            }
            if (data === "[DONE]") {
              modelFinished = true;
              return;
            }

            const chunk = JSON.parse(data);
            const text = chunk?.choices?.[0]?.delta?.content;
            if (typeof text === "string" && text.length > 0) {
              answer += text;
              send({ text, type: "delta" });
            }
          };

          const handleChunk = (chunk: Uint8Array) => {
            if (modelFinished) {
              return;
            }
            buffer += decoder.decode(chunk, { stream: true });
            buffer = buffer.replace(/\r\n/g, "\n");

            let boundary = buffer.indexOf("\n\n");
            while (boundary !== -1) {
              handleEvent(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              if (modelFinished) {
                break;
              }
              boundary = buffer.indexOf("\n\n");
            }
          };

          await upstreamBody.pipeTo(
            new WritableStream<Uint8Array>({ write: handleChunk })
          );

          buffer += decoder.decode();
          buffer = buffer.replace(/\r\n/g, "\n");
          if (buffer.trim() && !modelFinished) {
            handleEvent(buffer);
          }
          if (!modelFinished) {
            send({ error: "AI 回复连接中断，请重试。", type: "error" });
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
          console.error("Study chat stream failed:", error);
          send({ error: "AI 暂时无法回复，请稍后重试。", type: "error" });
        } finally {
          controller.close();
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
