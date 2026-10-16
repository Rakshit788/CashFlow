export type ExceptionStatus = 'open' | 'investigating' | 'pending_approval' | 'resolved' | 'rejected';
export type ExceptionType = 'amount_mismatch' | 'unapplied_payment' | 'duplicate_payment' | 'overpayment' | 'timing_issue' | 'other';
export type Severity = 'low' | 'medium' | 'high';
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
export type InvestigationStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Exception {
  id: number;
  type: ExceptionType;
  status: ExceptionStatus;
  severity: Severity;
  customer_id: number;
  invoice_id?: number | null;
  payment_id?: number | null;
  reason: string | null;
  detected_at: Date | string;
  amount_delta: number | null;
  outstanding_balance_snapshot: number | null;
  metadata: any;
  assigned_to: string | null;
  resolved_at: Date | string | null;
  resolution_notes: string | null;
}

export interface Investigation {
  id: number;
  exception_id: number;
  job_id: number | null;
  status: InvestigationStatus;
  requested_by: string | null;
  requested_at: Date | string;
  completed_at: Date | string | null;
  result: any;
  evidence: any;
}

export interface Job {
  id: number;
  type: string;
  status: JobStatus;
  payload: any;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}
