import { z } from "zod";

export const practiceQuestionSchema = z.object({
  id: z.string().regex(/^(B|E)\d{2}$/),
  order: z.number().int().min(1).max(50),
  phase: z.enum(["required", "extra"]),
  referenceEn: z.string().trim().min(1).max(500),
  zhPrompt: z.string().trim().min(1).max(500),
});

export const practiceQuestionBankSchema = z
  .array(practiceQuestionSchema)
  .min(1)
  .max(50)
  .superRefine((questions, context) => {
    const ordered = [...questions].sort(
      (left, right) => left.order - right.order
    );
    const required = ordered.filter((question) => question.phase === "required");
    const extra = ordered.filter((question) => question.phase === "extra");
    const seenIds = new Set<string>();
    if (required.length === 0) {
      context.addIssue({ code: "custom", message: "至少保留一道必做题。" });
    }
    for (const [index, question] of ordered.entries()) {
      if (question.order !== index + 1 || seenIds.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "题目顺序必须连续，题号不能重复。",
          path: [index],
        });
      }
      seenIds.add(question.id);
    }
    for (const [index, question] of required.entries()) {
      if (question.id !== `B${String(index + 1).padStart(2, "0")}`) {
        context.addIssue({ code: "custom", message: "必做题题号需从 B01 起连续排列。", path: [index] });
      }
    }
    for (const [index, question] of extra.entries()) {
      if (question.id !== `E${String(index + 1).padStart(2, "0")}`) {
        context.addIssue({ code: "custom", message: "加练题题号需从 E01 起连续排列。", path: [index] });
      }
    }
    if (required.length > 25 || extra.length > 25) {
      context.addIssue({ code: "custom", message: "必做题和加练题分别最多 25 道。" });
    }
  });

export const practiceSettingsSchema = z.object({
  commonPrompt: z.string().trim().min(1).max(30_000),
  highWarmthPrompt: z.string().trim().min(1).max(20_000),
  lowWarmthPrompt: z.string().trim().min(1).max(20_000),
  model: z.string().regex(/^deepseek-[a-z0-9-]{1,56}$/),
  questions: practiceQuestionBankSchema,
  welcomeHigh: z.string().trim().min(1).max(2000),
  welcomeLow: z.string().trim().min(1).max(2000),
});

export type PracticeQuestion = z.infer<typeof practiceQuestionSchema>;
export type PracticeSettingsInput = z.infer<typeof practiceSettingsSchema>;
