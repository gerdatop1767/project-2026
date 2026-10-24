import { z } from 'zod';

export const mistakeStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export type MistakeStatus = z.infer<typeof mistakeStatusSchema>;

export const mistakeSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  subjectId: z.string(),
  taskNumber: z.number().int().positive(),
  topicName: z.string().nullable(),
  conditionMd: z.string(),
  userAnswer: z.string(),
  correctAnswer: z.string(),
  timesWrong: z.number().int().positive(),
  status: mistakeStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Mistake = z.infer<typeof mistakeSchema>;

export const mistakeListResponseSchema = z.object({
  items: z.array(mistakeSchema),
});
export type MistakeListResponse = z.infer<typeof mistakeListResponseSchema>;
