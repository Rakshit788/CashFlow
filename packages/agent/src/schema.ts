import { z } from 'zod';

export const SuggestedAdjustmentSchema = z.object({
  type: z.enum(['apply_payment', 'unapply_payment', 'write_off', 'credit', 'noop']),
  invoice_id: z.number().nullable().optional(),
  payment_id: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  note: z.string().optional(),
});

export const RecommendationSchema = z.object({
  action: z.enum(['hold', 'release', 'adjust', 'approve_manual', 'write_off']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence_refs: z.array(z.string()).default([]),
  suggested_adjustments: z.array(SuggestedAdjustmentSchema).default([]),
});

export type RecommendationInput = z.infer<typeof RecommendationSchema>;
