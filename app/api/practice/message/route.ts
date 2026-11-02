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
  evaluatePracticeAnswer,
  generatePracticeReply,
} from "@/lib/practice/ai";
import { parsePracticeQuestionSnapshot } from "@/lib/practice/config";
import {
  getPracticeQuestion,
  getPracticeWelcome,
  type PracticePhase,
} from "@/lib/practice/flow";
import {
  getPracticeSessionForUser,
  refreshReadyPracticeSessionForUser,
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

type PracticeTurnResult = TurnState & {
  messages: Parameters<typeof savePracticeTurn>[1];
};

function generateFlowReply(
  session: NonNullable<Awaited<ReturnType<typeof getPracticeSessionForUser>>>,
  instruction: string,
  context: Record<string, unknown>,
  onText: (text: string) => void
) {
  return generatePracticeReply(
    { context, instruction, systemPrompt: session.systemPrompt },
    onText,
    session.model
  );
}

async function personalizeTransition<T extends PracticeTurnResult>(
  result: T,
  session: NonNullable<Awaited<ReturnType<typeof getPracticeSessionForUser>>>,
  reason: "required-complete" | "extra-complete" | "finish" | "exit",
  onText: (text: string) => void
): Promise<T> {
  if (result.phase === "extra-choice") {
    const instruction =
      reason === "required-complete"
        ? "参与者已经完成必做阶段。自然地简短说明已完成，并询问是否愿意自主加练。可选择的操作是‘继续加练’或‘结束训练’，不要替参与者决定，也不要提具体题数。最多两句话；不要重复上一条 AI 对答案的评价，不要堆叠赞美或作出陪伴承诺。"
        : "参与者完成了一道加练题。自然地简短询问是否继续加练或结束训练。可选择的操作是‘继续加练’或‘结束训练’，不要替参与者决定，也不要提具体题数。最多两句话；不要重复上一条 AI 对答案的评价，不要堆叠赞美或作出陪伴承诺。";
    const content = await generateFlowReply(
      session,
      instruction,
      { currentExtra: result.currentExtra, currentRequired: result.currentRequired },
      onText
    );
    return {
      ...result,
      messages: result.messages.map((message) =>
        message.kind === "notice" && message.role === "assistant"
          ? { ...message, content }
          : message
      ) as T["messages"],
    };
  }

  if (result.phase === "completed" || result.phase === "incomplete") {
    const isCompleted = result.phase === "completed";
    const content = await generateFlowReply(
      session,
      isCompleted
        ? "参与者已经完成实验流程。自然地表达感谢并结束对话，不要编造或提及完成编码；系统会在你的回复后附上准确编码。"
        : "参与者选择提前结束且尚未完成必做阶段。尊重其决定，自然地结束对话并说明本次无法获得完成编码。不要责备、挽留或编造编码。",
      {},
      onText
    );
    const codeSuffix =
      isCompleted && result.participantCode
        ? `\n\n完成编码：${result.participantCode}`
        : "";
    if (codeSuffix) {
      onText(codeSuffix);
    }
    return {
      ...result,
      messages: result.messages.map((message) =>
        message.role === "assistant" &&
        (message.kind === "completion" || message.kind === "exit")
          ? { ...message, content: `${content}${codeSuffix}` }
          : message
      ) as T["messages"],
    };
  }

  return result;
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
    stop: "结束训练",
  };
  const phase = session.phase as PracticePhase;
  const questionBank = parsePracticeQuestionSnapshot(session.questionsJson);
  const requiredCount = questionBank.filter(
    (question) => question.phase === "required"
  ).length;
  const text = input.text?.trim() ?? "";
  const submittedText =
    text ||
    (input.action === "skip" && phase === "extra-choice"
      ? "结束训练"
      : input.action
        ? actionText[input.action]
        : "");
  const newMessages: Parameters<typeof savePracticeTurn>[1] = [];
  let next: TurnState;

  if (input.action === "stop" || /^(结束训练|结束练习|退出实验|不再继续)$/.test(text)) {
    const result = await personalizeTransition(
      leavePractice(session.currentRequired, requiredCount),
      session,
      "exit",
      onText
    );
    newMessages.push(
      withUserMessage(submittedText || "结束训练", "exit"),
      ...result.messages
    );
    next = { ...result };
  } else if (phase === "ready") {
    if (input.action !== "start") {
      throw new Error("请点击“开始对话”开始本次练习。");
    }
    const welcome = await generateFlowReply(
      session,
      "生成自然的开场欢迎语，简要说明这是汉译英练习，并询问参与者是否准备好。参考管理员设置的欢迎语内容，但不要逐字照抄；遵循共同提示词和当前交流风格。",
      { welcomeGuidance: session.welcomeText ?? getPracticeWelcome(session.condition) },
      onText
    );
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
    const goalQuestion = await generateFlowReply(
      session,
      "参与者刚刚按下了“我准备好了”，而且上一条 AI 消息已经问过是否准备好。不要再次欢迎、自我介绍、鼓励或询问准备好了没有。现在只用一句简短自然的话询问：参加英语训练的主要目的是什么？不要出题或预判目的。",
      { participantHasConfirmedReady: true },
      onText
    );
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
      const retryPrompt = await generateFlowReply(
        session,
        "自然地邀请参与者根据刚才的反馈修改答案并再次提交英文译文。不要展示参考答案。",
        {},
        onText
      );
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
      const rawResolved = advanceAfterQuestion(
        { ...session, phase },
        session.currentRequired >= requiredCount ? "extra" : "required",
        questionBank
      );
      const referenceMessage = await generateFlowReply(
        session,
        "参与者选择跳过当前翻译。自然回应并给出完整、准确的英文参考答案。答案必须完整保留在下方 context 的 reference 字段中，不要自行改写或省略；简短解释即可，不要增加下一道题。",
        { chinese: question.zhPrompt, reference: question.referenceEn },
        onText
      );
      const resolved = await personalizeTransition(
        rawResolved,
        session,
        session.currentRequired >= requiredCount
          ? "extra-complete"
          : "required-complete",
        onText
      );
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
      const transition = await generateFlowReply(
        session,
        "参与者选择继续加练。自然回应其选择，简短鼓励即可，不要重复或改写题目；后端会在下一条消息发送下一题。",
        {},
        onText
      );
      newMessages.push(
        withUserMessage(submittedText, "notice"),
        { content: transition, kind: "notice", role: "assistant" },
        ...firstExtra.messages
      );
      next = firstExtra;
    } else if (input.action === "skip") {
      const completed = await personalizeTransition(
        completePractice(),
        session,
        "finish",
        onText
      );
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
    const isRetry = phase === "retry-answer";
    const evaluation = await evaluatePracticeAnswer(
      {
        answer: text,
        chinese: question.zhPrompt,
        isRetry,
        reference: question.referenceEn,
        systemPrompt: session.systemPrompt,
      },
      onText,
      session.model
    );
    const savedUser = withUserMessage(text, "answer");

    if (!evaluation.correct && !isRetry) {
      newMessages.push(savedUser, {
        content: evaluation.feedback,
        grade: false,
        kind: "feedback",
        questionId: question.id,
        role: "assistant",
      });
      next = { phase: "retry-choice" };
    } else {
      const resolved = await personalizeTransition(
        advanceAfterQuestion(
          { ...session, phase },
          session.currentRequired >= requiredCount ? "extra" : "required",
          questionBank
        ),
        session,
        session.currentRequired >= requiredCount
          ? "extra-complete"
          : "required-complete",
        onText
      );
      newMessages.push(
        savedUser,
        {
          content: evaluation.feedback,
          grade: evaluation.correct,
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
    let session = await getPracticeSessionForUser(
      parsed.data.sessionId,
      user.id
    );
    if (!session) {
      return Response.json({ error: "找不到这条陪练记录。" }, { status: 404 });
    }
    if (session.phase === "completed" || session.phase === "incomplete") {
      return Response.json({ error: "本次陪练已经结束。" }, { status: 409 });
    }
    if (parsed.data.action === "start" && session.phase === "ready") {
      session = await refreshReadyPracticeSessionForUser(
        session.id,
        user.id,
        session.condition as "high" | "low"
      );
      if (!session) {
        return Response.json({ error: "找不到这条陪练记录。" }, { status: 404 });
      }
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
