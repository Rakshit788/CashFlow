import { z } from 'zod';
export declare const InvestigateExceptionSchema: z.ZodObject<{
    exceptionId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    exceptionId: number;
}, {
    exceptionId: number;
}>;
export declare const CreateApprovalSchema: z.ZodObject<{
    request_type: z.ZodString;
    entity_id: z.ZodNumber;
    requested_by: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    request_type: string;
    entity_id: number;
    requested_by?: string | undefined;
    metadata?: any;
}, {
    request_type: string;
    entity_id: number;
    requested_by?: string | undefined;
    metadata?: any;
}>;
export declare const ApproveRejectSchema: z.ZodObject<{
    status: z.ZodEnum<["approved", "rejected"]>;
    rejected_reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "rejected" | "approved";
    rejected_reason?: string | undefined;
}, {
    status: "rejected" | "approved";
    rejected_reason?: string | undefined;
}>;
//# sourceMappingURL=schemas.d.ts.map