import prompts from "./prompts.json";
import bank from "./questions.json";
import {
  type PracticeQuestion,
  practiceQuestionBankSchema,
} from "./validation";

export type PracticeCondition = "low" | "high";
export type PracticePhase =
  | "ready"
  | "confirm-ready"
  | "goal"
  | "required"
  | "retry-choice"
  | "retry-answer"
  | "extra-choice"
  | "extra"
  | "completed"
  | "incomplete";
export type PracticeMessageKind =
  | "welcome"
  | "question"
  | "answer"
  | "feedback"
  | "notice"
  | "goal"
  | "exit"
  | "completion";

export const PRACTICE_MODEL = prompts.model;
export const PRACTICE_PROMPT_VERSION = "1.0";
export const practiceQuestions: PracticeQuestion[] =
  practiceQuestionBankSchema.parse(bank);
export type { PracticeQuestion } from "./validation";

export function getPracticeQuestion(
  session: {
    phase: PracticePhase;
    currentRequired: number;
    currentExtra: number;
  },
  questionBank: PracticeQuestion[] = practiceQuestions
) {
  const isExtra =
    session.phase === "extra" ||
    ((session.phase === "retry-answer" || session.phase === "retry-choice") &&
      session.currentRequired >=
        questionBank.filter((item) => item.phase === "required").length);
  const questions = questionBank
    .filter((item) => item.phase === (isExtra ? "extra" : "required"))
    .sort((left, right) => left.order - right.order);
  const index = isExtra ? session.currentExtra : session.currentRequired;
  return questions[index];
}

export function getPracticeSystemPrompt(
  condition: PracticeCondition,
  settings: {
    commonPrompt: string;
    highWarmthPrompt: string;
    lowWarmthPrompt: string;
  } = {
    commonPrompt: prompts.common,
    highWarmthPrompt: prompts.highWarmth,
    lowWarmthPrompt: prompts.lowWarmth,
  },
  questions: PracticeQuestion[] = practiceQuestions
) {
  const style =
    condition === "high" ? settings.highWarmthPrompt : settings.lowWarmthPrompt;
  return `${settings.commonPrompt}\n\n${style}\n\n系统执行说明：练习流程、当前状态和题目顺序由网页后端管理。只能根据后端发送的当前题目和状态回应，不要自行规定题目数量、题号、练习步骤或改变流程。此轮以外的题目流程由后端安排。题库当前包含 ${questions.filter((question) => question.phase === "required").length} 道必做题和 ${questions.filter((question) => question.phase === "extra").length} 道加练题；不要主动向参与者说明题目总数。`;
}

export function getPracticeWelcome(
  condition: PracticeCondition,
  settings: { welcomeHigh: string; welcomeLow: string } = {
    welcomeHigh: prompts.welcomeHigh,
    welcomeLow: prompts.welcomeLow,
  }
) {
  return condition === "high" ? settings.welcomeHigh : settings.welcomeLow;
}

export function isPracticeCondition(value: string): value is PracticeCondition {
  return value === "low" || value === "high";
}
