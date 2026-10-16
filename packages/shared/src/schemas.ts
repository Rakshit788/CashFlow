import { z } from 'zod';

export const InvestigateExceptionSchema = z.object({
  exceptionId: z.number(),
});

export const CreateApprovalSchema = z.object({
  request_type: z.string(),
  entity_id: z.number(),
  requested_by: z.string().optional(),
  metadata: z.any().optional(),
});

export const ApproveRejectSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejected_reason: z.string().optional(),
});
