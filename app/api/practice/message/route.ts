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
import { getPracticeQuestion, type PracticePhase } from "@/lib/practice/flow";
import {
  getPracticeSessionForUser,
  savePracticeTurn,
} from "@/lib/practice/queries";
import { checkIpRateLimit, RateLimitError } from "@/lib/ratelimit";

const bodySchema = z.object({
  action: z.enum(["start", "retry", "skip", "continue", "stop"]).optional(),
  sessionId: z.uuid(),
  text: z.string().trim().max(2000).optional(),
});

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
    const input = parsed.data;
    const actionText: Record<string, string> = {
      continue: "继续加练",
      retry: "愿意重试",
      skip: "跳过本题",
      start: "开始训练",
      stop: "结束练习",
    };
    const session = await getPracticeSessionForUser(input.sessionId, user.id);
    if (!session) {
      return Response.json({ error: "找不到这条陪练记录。" }, { status: 404 });
    }
    if (session.phase === "completed" || session.phase === "incomplete") {
      return Response.json({ error: "本次陪练已经结束。" }, { status: 409 });
    }

    const phase = session.phase as PracticePhase;
    const text = input.text?.trim() ?? "";
    const submittedText =
      text || (input.action ? actionText[input.action] : "");
    if (
      input.action === "stop" ||
      /^(结束练习|退出实验|不再继续)$/.test(text)
    ) {
      const result = leavePractice(session.currentRequired);
      const messages = await savePracticeTurn(
        session,
        [
          withUserMessage(submittedText || "结束练习", "exit"),
          ...result.messages,
        ],
        {
          completedAt: result.completedAt,
          participantCode: result.participantCode,
          phase: result.phase,
        }
      );
      return Response.json({
        messages: messages.slice(-2),
        participantCode: result.participantCode,
        phase: result.phase,
      });
    }

    let next: {
      attempt?: number;
      completedAt?: Date | null;
      currentExtra?: number;
      currentRequired?: number;
      participantCode?: string | null;
      phase: PracticePhase;
      trainingGoal?: string;
    };
    let newMessages:
      | ReturnType<typeof withUserMessage>[]
      | {
          content: string;
          grade?: boolean;
          kind: "feedback" | "goal" | "notice" | "question" | "completion";
          questionId?: string;
          role: "assistant";
        }[];

    if (phase === "ready") {
      if (
        input.action !== "start" &&
        !/^(开始训练|开始练习|准备好了|准备好)$/.test(text)
      ) {
        return Response.json(
          { error: "准备好后，请选择“开始训练”。" },
          { status: 400 }
        );
      }
      newMessages = [
        withUserMessage(submittedText, "notice"),
        {
          content: "请问你参加英语训练的主要目的是什么？",
          kind: "goal",
          role: "assistant",
        },
      ];
      next = { phase: "goal" };
    } else if (phase === "goal") {
      if (!text) {
        return Response.json(
          { error: "请简单说说你的训练目的。" },
          { status: 400 }
        );
      }
      const acknowledgement = await acknowledgePracticeGoal({
        goal: text,
        systemPrompt: session.systemPrompt,
      });
      const firstQuestion = nextQuestion(0, 0, "required");
      newMessages = [
        withUserMessage(text, "goal"),
        { content: acknowledgement, kind: "goal", role: "assistant" },
        ...firstQuestion.messages,
      ];
      next = { phase: "required", trainingGoal: text };
    } else if (phase === "retry-choice") {
      if (input.action === "retry") {
        newMessages = [
          withUserMessage(submittedText, "notice"),
          {
            content: "请提交修改后的英文答案。",
            kind: "notice",
            role: "assistant",
          },
        ];
        next = { attempt: 2, phase: "retry-answer" };
      } else if (input.action === "skip") {
        const question = getPracticeQuestion({ ...session, phase });
        if (!question) {
          throw new Error("Practice question is missing.");
        }
        const questionType =
          session.currentRequired >= 5 ? "extra" : "required";
        const resolved = advanceAfterQuestion(
          { ...session, phase },
          questionType
        );
        newMessages = [
          withUserMessage(submittedText, "notice"),
          {
            content: `本题参考表达：${question.referenceEn}`,
            kind: "feedback",
            questionId: question.id,
            role: "assistant",
          },
          ...resolved.messages,
        ];
        next = { ...resolved, attempt: 1 };
      } else {
        return Response.json({ error: "请选择重试或跳过。" }, { status: 400 });
      }
    } else if (phase === "extra-choice") {
      if (input.action === "continue") {
        const firstExtra = nextQuestion(
          session.currentRequired,
          session.currentExtra,
          "extra"
        );
        newMessages = [
          withUserMessage(submittedText, "notice"),
          ...firstExtra.messages,
        ];
        next = firstExtra;
      } else if (input.action === "skip") {
        const completed = completePractice();
        newMessages = [
          withUserMessage(submittedText, "notice"),
          ...completed.messages,
        ];
        next = {
          ...completed,
          currentExtra: session.currentExtra,
          currentRequired: session.currentRequired,
        };
      } else {
        return Response.json(
          { error: "请选择是否继续加练。" },
          { status: 400 }
        );
      }
    } else if (
      phase === "required" ||
      phase === "retry-answer" ||
      phase === "extra"
    ) {
      if (!text) {
        return Response.json(
          { error: "请输入你的英文翻译。" },
          { status: 400 }
        );
      }
      const question = getPracticeQuestion({ ...session, phase });
      if (!question) {
        throw new Error("Practice question is missing.");
      }
      const grade = await judgePracticeAnswer({
        answer: text,
        chinese: question.zhPrompt,
        reference: question.referenceEn,
      });
      const isRetry = phase === "retry-answer";
      const feedback = await createPracticeFeedback({
        answer: text,
        correct: grade.correct,
        firstAttempt: !isRetry,
        issue: grade.issue,
        question: question.zhPrompt,
        reference: grade.reference || question.referenceEn,
        showReference: isRetry,
        systemPrompt: session.systemPrompt,
      });
      const savedUser = withUserMessage(text, "answer");
      const feedbackMessage = {
        content: feedback,
        grade: grade.correct,
        kind: "feedback" as const,
        questionId: question.id,
        role: "assistant" as const,
      };
      if (!grade.correct && !isRetry) {
        newMessages = [savedUser, feedbackMessage];
        next = { attempt: 1, phase: "retry-choice" };
      } else {
        const questionType =
          session.currentRequired >= 5 ? "extra" : "required";
        const resolved = advanceAfterQuestion(
          { ...session, phase },
          questionType
        );
        newMessages = [savedUser, feedbackMessage, ...resolved.messages];
        next = { ...resolved, attempt: 1 };
      }
    } else {
      return Response.json(
        { error: "当前陪练状态无效，请刷新页面。" },
        { status: 409 }
      );
    }

    const messages = await savePracticeTurn(session, newMessages, next);
    return Response.json(
      {
        currentExtra: next.currentExtra ?? session.currentExtra,
        currentRequired: next.currentRequired ?? session.currentRequired,
        messages: messages.slice(-newMessages.length),
        participantCode: next.participantCode ?? null,
        phase: next.phase,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Practice message failed:", error);
    return Response.json(
      { error: "暂时无法处理这条消息，请重试。" },
      { status: 503 }
    );
  }
}
