import { z } from "zod";

export const practiceQuestionSchema = z.object({
  id: z.string().regex(/^(B0[1-5]|E(?:0[1-9]|1[0-9]|20))$/),
  order: z.number().int().min(1).max(25),
  phase: z.enum(["required", "extra"]),
  referenceEn: z.string().trim().min(1).max(500),
  zhPrompt: z.string().trim().min(1).max(500),
});

export const practiceQuestionBankSchema = z
  .array(practiceQuestionSchema)
  .length(25)
  .superRefine((questions, context) => {
    const ordered = [...questions].sort(
      (left, right) => left.order - right.order
    );
    for (const [index, question] of ordered.entries()) {
      const isRequired = index < 5;
      const expectedId = isRequired
        ? `B${String(index + 1).padStart(2, "0")}`
        : `E${String(index - 4).padStart(2, "0")}`;
      if (
        question.order !== index + 1 ||
        question.id !== expectedId ||
        question.phase !== (isRequired ? "required" : "extra")
      ) {
        context.addIssue({
          code: "custom",
          message: "题号、题目顺序和必做/加练分类必须保持 B01–B05、E01–E20。",
          path: [index],
        });
      }
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
