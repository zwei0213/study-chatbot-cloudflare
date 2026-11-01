import prompts from "./prompts.json";
import bank from "./questions.json";

export type PracticeCondition = "low" | "high";
export type PracticePhase =
  | "ready"
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
export const practiceQuestions = bank;
export type PracticeQuestion = (typeof bank)[number];

export function getPracticeQuestion(session: {
  phase: PracticePhase;
  currentRequired: number;
  currentExtra: number;
}) {
  return session.phase === "extra" ||
    ((session.phase === "retry-answer" || session.phase === "retry-choice") &&
      session.currentRequired >= 5)
    ? bank.find(
        (item) =>
          item.phase === "extra" && item.order === 6 + session.currentExtra
      )
    : bank.find(
        (item) =>
          item.phase === "required" &&
          item.order === 1 + session.currentRequired
      );
}

export function getPracticeSystemPrompt(condition: PracticeCondition) {
  const style = condition === "high" ? prompts.highWarmth : prompts.lowWarmth;
  return `${prompts.common}\n\n${style}`;
}

export function getPracticeWelcome(condition: PracticeCondition) {
  return condition === "high" ? prompts.welcomeHigh : prompts.welcomeLow;
}

export function isPracticeCondition(value: string): value is PracticeCondition {
  return value === "low" || value === "high";
}
