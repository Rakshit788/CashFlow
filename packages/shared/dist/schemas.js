"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApproveRejectSchema = exports.CreateApprovalSchema = exports.InvestigateExceptionSchema = void 0;
const zod_1 = require("zod");
exports.InvestigateExceptionSchema = zod_1.z.object({
    exceptionId: zod_1.z.number(),
});
exports.CreateApprovalSchema = zod_1.z.object({
    request_type: zod_1.z.string(),
    entity_id: zod_1.z.number(),
    requested_by: zod_1.z.string().optional(),
    metadata: zod_1.z.any().optional(),
});
exports.ApproveRejectSchema = zod_1.z.object({
    status: zod_1.z.enum(['approved', 'rejected']),
    rejected_reason: zod_1.z.string().optional(),
});
//# sourceMappingURL=schemas.js.map