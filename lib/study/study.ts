import prompts from "./prompts.json";

export type StudyCondition = "a" | "b";

export const STUDY_MODEL = "deepseek-flash";

export function isStudyCondition(value: string): value is StudyCondition {
  return value === "a" || value === "b";
}

export function getStudyPrompt(condition: StudyCondition) {
  return [prompts.common, prompts[condition]].join("\n\n");
}

export const studyWelcome = prompts.welcome;

export function getStudyMaxExchanges(): number | null {
  const value = Number(process.env.STUDY_MAX_EXCHANGES);
  return Number.isInteger(value) && value > 0 ? value : null;
}
