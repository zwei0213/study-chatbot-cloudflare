import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  advanceAfterQuestion,
  completePractice,
  leavePractice,
  nextQuestion,
  withUserMessage,
} from "@/lib/practice/advance";
import {
  acknowledgePracticeGoal,
  createPracticeFeedback,
  judgePracticeAnswer,
} from "@/lib/practice/ai";
import { parsePracticeQuestionSnapshot } from "@/lib/practice/config";
import {
  getPracticeQuestion,
  getPracticeWelcome,
  type PracticePhase,
} from "@/lib/practice/flow";
import {
  getPracticeSessionForUser,
  savePracticeTurn,
} from "@/lib/practice/queries";
import { checkIpRateLimit, RateLimitError } from "@/lib/ratelimit";

export const maxDuration = 60;

const bodySchema = z.object({
  action: z
    .enum(["start", "ready", "retry", "skip", "continue", "stop"])
    .optional(),
  sessionId: z.uuid(),
  text: z.string().trim().max(2000).optional(),
});

type MessageRequest = z.infer<typeof bodySchema>;

type TurnState = {
  completedAt?: Date | null;
  currentExtra?: number;
  currentRequired?: number;
  participantCode?: string | null;
  phase: PracticePhase;
  trainingGoal?: string;
};

function streamFixedText(text: string, onText: (text: string) => void) {
  return (async () => {
    for (let index = 0; index < text.length; index += 12) {
      onText(text.slice(index, index + 12));
      if (index + 12 < text.length) {
        // biome-ignore lint/performance/noAwaitInLoops: Separate fixed text into visible stream chunks.
        await new Promise((resolve) => setTimeout(resolve, 18));
      }
    }
    return text;
  })();
}

async function processPracticeTurn(
  input: MessageRequest,
  session: NonNullable<Awaited<ReturnType<typeof getPracticeSessionForUser>>>,
  onText: (text: string) => void
) {
  const actionText: Record<NonNullable<MessageRequest["action"]>, string> = {
    continue: "继续加练",
    ready: "我准备好了",
    retry: "愿意重试",
    skip: "跳过本题",
    start: "开始对话",
    stop: "结束练习",
  };
  const phase = session.phase as PracticePhase;
  const questionBank = parsePracticeQuestionSnapshot(session.questionsJson);
  const text = input.text?.trim() ?? "";
  const submittedText = text || (input.action ? actionText[input.action] : "");
  const newMessages: Parameters<typeof savePracticeTurn>[1] = [];
  let next: TurnState;

  if (input.action === "stop" || /^(结束练习|退出实验|不再继续)$/.test(text)) {
    const result = leavePractice(session.currentRequired);
    const [exitMessage] = result.messages;
    await streamFixedText(exitMessage.content, onText);
    newMessages.push(
      withUserMessage(submittedText || "结束练习", "exit"),
      ...result.messages
    );
    next = { ...result };
  } else if (phase === "ready") {
    if (input.action !== "start") {
      throw new Error("请点击“开始对话”开始本次练习。");
    }
    const welcome =
      session.welcomeText ?? getPracticeWelcome(session.condition);
    await streamFixedText(welcome, onText);
    newMessages.push(withUserMessage(submittedText, "notice"), {
      content: welcome,
      kind: "welcome",
      role: "assistant",
    });
    next = { phase: "confirm-ready" };
  } else if (phase === "confirm-ready") {
    if (
      input.action !== "ready" &&
      !/^(准备好了|我准备好了|可以开始|好了)$/.test(text)
    ) {
      throw new Error("准备好后，请选择“我准备好了”。");
    }
    const goalQuestion = "请问你参加英语训练的主要目的是什么？";
    await streamFixedText(goalQuestion, onText);
    newMessages.push(withUserMessage(submittedText, "notice"), {
      content: goalQuestion,
      kind: "goal",
      role: "assistant",
    });
    next = { phase: "goal" };
  } else if (phase === "goal") {
    if (!text) {
      throw new Error("请简单说说你的训练目的。");
    }
    const acknowledgement = await acknowledgePracticeGoal(
      { goal: text, systemPrompt: session.systemPrompt },
      onText,
      session.model
    );
    const firstQuestion = nextQuestion(0, 0, "required", questionBank);
    newMessages.push(
      withUserMessage(text, "goal"),
      { content: acknowledgement, kind: "goal", role: "assistant" },
      ...firstQuestion.messages
    );
    next = { phase: "required", trainingGoal: text };
  } else if (phase === "retry-choice") {
    if (input.action === "retry") {
      const retryPrompt = "请提交修改后的英文答案。";
      await streamFixedText(retryPrompt, onText);
      newMessages.push(withUserMessage(submittedText, "notice"), {
        content: retryPrompt,
        kind: "notice",
        role: "assistant",
      });
      next = { phase: "retry-answer" };
    } else if (input.action === "skip") {
      const question = getPracticeQuestion({ ...session, phase }, questionBank);
      if (!question) {
        throw new Error("Practice question is missing.");
      }
      const resolved = advanceAfterQuestion(
        { ...session, phase },
        session.currentRequired >= 5 ? "extra" : "required",
        questionBank
      );
      const referenceMessage = `本题参考表达：${question.referenceEn}`;
      await streamFixedText(referenceMessage, onText);
      newMessages.push(
        withUserMessage(submittedText, "notice"),
        {
          content: referenceMessage,
          kind: "feedback",
          questionId: question.id,
          role: "assistant",
        },
        ...resolved.messages
      );
      next = {
        ...resolved,
        participantCode:
          "participantCode" in resolved ? resolved.participantCode : null,
        phase: resolved.phase,
      };
    } else {
      throw new Error("请选择重试或跳过。");
    }
  } else if (phase === "extra-choice") {
    if (input.action === "continue") {
      const firstExtra = nextQuestion(
        session.currentRequired,
        session.currentExtra,
        "extra",
        questionBank
      );
      newMessages.push(
        withUserMessage(submittedText, "notice"),
        ...firstExtra.messages
      );
      next = firstExtra;
    } else if (input.action === "skip") {
      const completed = completePractice();
      const [completionMessage] = completed.messages;
      await streamFixedText(completionMessage.content, onText);
      newMessages.push(
        withUserMessage(submittedText, "notice"),
        ...completed.messages
      );
      next = {
        ...completed,
        currentExtra: session.currentExtra,
        currentRequired: session.currentRequired,
      };
    } else {
      throw new Error("请选择是否继续加练。");
    }
  } else if (
    phase === "required" ||
    phase === "retry-answer" ||
    phase === "extra"
  ) {
    if (!text) {
      throw new Error("请输入你的英文翻译。");
    }
    const question = getPracticeQuestion({ ...session, phase }, questionBank);
    if (!question) {
      throw new Error("Practice question is missing.");
    }
    const grade = await judgePracticeAnswer(
      {
        answer: text,
        chinese: question.zhPrompt,
        reference: question.referenceEn,
      },
      session.model
    );
    const isRetry = phase === "retry-answer";
    const savedUser = withUserMessage(text, "answer");

    if (!grade.correct && !isRetry) {
      const issue = grade.issue.trim() || "有一处意思或语法需要调整";
      const feedback = await createPracticeFeedback(
        {
          answer: text,
          correct: false,
          firstAttempt: true,
          issue,
          question: question.zhPrompt,
          reference: grade.reference || question.referenceEn,
          showReference: false,
          systemPrompt: session.systemPrompt,
        },
        onText,
        session.model
      );
      newMessages.push(savedUser, {
        content: feedback,
        grade: false,
        kind: "feedback",
        questionId: question.id,
        role: "assistant",
      });
      next = { phase: "retry-choice" };
    } else {
      const feedback = await createPracticeFeedback(
        {
          answer: text,
          correct: grade.correct,
          firstAttempt: !isRetry,
          issue: grade.issue,
          question: question.zhPrompt,
          reference: grade.reference || question.referenceEn,
          showReference: isRetry,
          systemPrompt: session.systemPrompt,
        },
        onText,
        session.model
      );
      const resolved = advanceAfterQuestion(
        { ...session, phase },
        session.currentRequired >= 5 ? "extra" : "required",
        questionBank
      );
      newMessages.push(
        savedUser,
        {
          content: feedback,
          grade: grade.correct,
          kind: "feedback",
          questionId: question.id,
          role: "assistant",
        },
        ...resolved.messages
      );
      next = {
        ...resolved,
        participantCode:
          "participantCode" in resolved ? resolved.participantCode : null,
        phase: resolved.phase,
      };
    }
  } else {
    throw new Error("当前陪练状态无效，请刷新页面。");
  }

  const messages = await savePracticeTurn(session, newMessages, next);
  return {
    currentExtra: next.currentExtra ?? session.currentExtra,
    currentRequired: next.currentRequired ?? session.currentRequired,
    messages: messages.slice(-newMessages.length),
    participantCode: next.participantCode ?? null,
    phase: next.phase,
    trainingGoal: next.trainingGoal ?? session.trainingGoal,
  };
}

export async function POST(request: Request) {
  try {
    const user = (await auth())?.user;
    if (!user?.id) {
      return Response.json({ error: "请刷新页面后重试。" }, { status: 401 });
    }
    try {
      await checkIpRateLimit(request, "chat");
    } catch (error) {
      if (error instanceof RateLimitError) {
        return Response.json(
          { error: "操作过于频繁，请稍后再试。" },
          { status: 429 }
        );
      }
      throw error;
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (!parsed.data.action && !parsed.data.text)) {
      return Response.json(
        { error: "请输入回答或选择当前操作。" },
        { status: 400 }
      );
    }
    const session = await getPracticeSessionForUser(
      parsed.data.sessionId,
      user.id
    );
    if (!session) {
      return Response.json({ error: "找不到这条陪练记录。" }, { status: 404 });
    }
    if (session.phase === "completed" || session.phase === "incomplete") {
      return Response.json({ error: "本次陪练已经结束。" }, { status: 409 });
    }

    const encoder = new TextEncoder();
    let disconnected = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        disconnected = true;
      },
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          if (disconnected) {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          } catch {
            disconnected = true;
          }
        };
        try {
          const result = await processPracticeTurn(
            parsed.data,
            session,
            (text) => send({ text, type: "delta" })
          );
          send({ messages: result.messages, metadata: result, type: "done" });
        } catch (error) {
          console.error("Practice message failed:", error);
          send({
            error:
              error instanceof Error &&
              !(error instanceof SyntaxError) &&
              error.message !== "fetch failed"
                ? error.message
                : "暂时无法处理这条消息，请重试。",
            type: "error",
          });
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
    console.error("Practice message request failed:", error);
    return Response.json({ error: "发送失败，请重试。" }, { status: 503 });
  }
}
