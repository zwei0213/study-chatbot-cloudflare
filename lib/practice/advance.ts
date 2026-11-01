import { randomInt } from "node:crypto";
import { getPracticeQuestion, type PracticePhase } from "./flow";
import type { PracticeMessageInput } from "./queries";
import type { PracticeQuestion } from "./validation";

type SessionProgress = {
  currentExtra: number;
  currentRequired: number;
  phase: PracticePhase;
};

export function completePractice() {
  let code = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let index = 0; index < 15; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return {
    completedAt: new Date(),
    messages: [
      {
        content: `本次陪练已结束。您的15位完成编码是：${code}。请返回问卷并填写该编码。`,
        kind: "completion" as const,
        role: "assistant" as const,
      },
    ],
    participantCode: code,
    phase: "completed" as const,
  };
}

export function leavePractice(completedRequired: number) {
  if (completedRequired >= 5) {
    return completePractice();
  }
  return {
    completedAt: null,
    messages: [
      {
        content: "本次常规练习尚未完成，因此无法提供实验完成编码。感谢参与。",
        kind: "exit" as const,
        role: "assistant" as const,
      },
    ],
    participantCode: null,
    phase: "incomplete" as const,
  };
}

export function advanceAfterQuestion(
  progress: SessionProgress,
  questionType: "required" | "extra",
  questionBank?: PracticeQuestion[]
) {
  if (questionType === "required") {
    const currentRequired = progress.currentRequired + 1;
    if (currentRequired >= 5) {
      return {
        currentExtra: progress.currentExtra,
        currentRequired,
        messages: [
          {
            content: "5道常规练习已完成。是否愿意继续做加练题？",
            kind: "notice" as const,
            role: "assistant" as const,
          },
        ],
        phase: "extra-choice" as const,
      };
    }
    return nextQuestion(
      currentRequired,
      progress.currentExtra,
      "required",
      questionBank
    );
  }

  const currentExtra = progress.currentExtra + 1;
  if (currentExtra >= 20) {
    const completed = completePractice();
    return {
      ...completed,
      currentExtra,
      currentRequired: progress.currentRequired,
    };
  }
  return {
    currentExtra,
    currentRequired: progress.currentRequired,
    messages: [
      {
        content: "这道加练题已完成。是否继续下一题？",
        kind: "notice" as const,
        role: "assistant" as const,
      },
    ],
    phase: "extra-choice" as const,
  };
}

export function nextQuestion(
  currentRequired: number,
  currentExtra: number,
  type: "required" | "extra",
  questionBank?: PracticeQuestion[]
) {
  const phase: PracticePhase = type === "required" ? "required" : "extra";
  const question = getPracticeQuestion(
    {
      currentExtra,
      currentRequired,
      phase,
    },
    questionBank
  );
  if (!question) {
    throw new Error("Practice question is missing.");
  }
  const number = type === "required" ? currentRequired + 1 : currentExtra + 1;
  return {
    currentExtra,
    currentRequired,
    messages: [
      {
        content: `${type === "required" ? "必做" : "加练"}第${number}题（${question.id}）：${question.zhPrompt}`,
        kind: "question" as const,
        questionId: question.id,
        role: "assistant" as const,
      },
    ],
    phase,
  };
}

export function withUserMessage(
  content: string,
  kind: PracticeMessageInput["kind"] = "answer"
): PracticeMessageInput {
  return { content, kind, role: "user" };
}
