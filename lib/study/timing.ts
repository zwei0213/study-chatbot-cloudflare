// Shared by the browser and server; never import the study prompts here.
export const STUDY_MIN_SECONDS = 10 * 60;
export const STUDY_REMINDER_SECONDS = 25 * 60;
export const STUDY_TARGET_SECONDS = 30 * 60;

export function getStudyElapsedSeconds(
  startedAt: Date | string | null,
  endedAt: Date | string | null,
  now: number
) {
  if (!startedAt) {
    return 0;
  }
  const end = endedAt ? new Date(endedAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
}

export class StudySessionError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "StudySessionError";
    this.status = status;
  }
}
