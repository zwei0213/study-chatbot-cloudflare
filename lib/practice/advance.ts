import { randomInt } from "node:crypto";
import {
  getPracticeQuestion,
  practiceQuestions,
  type PracticePhase,
} from "./flow";
import type { PracticeMessageInput } from "./queries";
import type { PracticeQuestion } from "./validation";

type SessionProgress = {
  currentExtra: number;
  currentRequired: number;
  phase: PracticePhase;
};

export function completePractice() {
  const code = createParticipantCode(15);
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

export function leavePractice(
  completedRequired: number,
  requiredCount = practiceQuestions.filter(
    (question) => question.phase === "required"
  ).length
) {
  if (completedRequired >= requiredCount) {
    return completePractice();
  }
  const code = createParticipantCode(10);
  return {
    completedAt: null,
    messages: [
      {
        content: `本次陪练已结束。您的10位退出编码是：${code}。请返回问卷并填写该编码。`,
        kind: "exit" as const,
        role: "assistant" as const,
      },
    ],
    participantCode: code,
    phase: "incomplete" as const,
  };
}

function createParticipantCode(length: number) {
  let code = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let index = 0; index < length; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

export function advanceAfterQuestion(
  progress: SessionProgress,
  questionType: "required" | "extra",
  questionBank?: PracticeQuestion[]
) {
  const questions = questionBank ?? practiceQuestions;
  const requiredCount = questions.filter(
    (question) => question.phase === "required"
  ).length;
  const extraCount = questions.filter(
    (question) => question.phase === "extra"
  ).length;
  if (questionType === "required") {
    const currentRequired = progress.currentRequired + 1;
    if (currentRequired >= requiredCount) {
      if (requiredCount === 0) {
        throw new Error("Practice requires at least one required question.");
      }
      if (extraCount === 0) {
        return {
          ...completePractice(),
          currentExtra: progress.currentExtra,
          currentRequired,
        };
      }
      return {
        currentExtra: progress.currentExtra,
        currentRequired,
        messages: [
          {
            content: "本阶段练习已完成。是否愿意继续做加练题？",
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
  if (currentExtra >= extraCount) {
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
  return {
    currentExtra,
    currentRequired,
    messages: [
      {
        content: `题目：${question.zhPrompt}`,
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
