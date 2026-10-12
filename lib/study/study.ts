import prompts from "./prompts.json";

export const STUDY_CONDITIONS = ["a", "b", "c"] as const;

export type StudyCondition = (typeof STUDY_CONDITIONS)[number];

export const STUDY_MODEL = "deepseek-flash";

export function isStudyCondition(value: string): value is StudyCondition {
  return STUDY_CONDITIONS.some((condition) => condition === value);
}

export function getStudyPrompt(condition: StudyCondition) {
  const conditionPrompt = prompts[condition === "c" ? "b" : condition];
  return [prompts.common, conditionPrompt, prompts.responseLength].join("\n\n");
}

export const studyWelcome = prompts.welcome;

export function getStudyMaxExchanges(): number | null {
  const value = Number(process.env.STUDY_MAX_EXCHANGES);
  return Number.isInteger(value) && value > 0 ? value : null;
}
