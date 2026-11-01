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
  return session.phase === "extra" ||
    ((session.phase === "retry-answer" || session.phase === "retry-choice") &&
      session.currentRequired >= 5)
    ? questionBank.find(
        (item) =>
          item.phase === "extra" && item.order === 6 + session.currentExtra
      )
    : questionBank.find(
        (item) =>
          item.phase === "required" &&
          item.order === 1 + session.currentRequired
      );
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
  }
) {
  const style =
    condition === "high" ? settings.highWarmthPrompt : settings.lowWarmthPrompt;
  return `${settings.commonPrompt}\n\n${style}`;
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
