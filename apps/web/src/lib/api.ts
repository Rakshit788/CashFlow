const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type Role = 'viewer' | 'analyst' | 'approver' | 'admin';

export function getRole(): Role {
  if (typeof window === 'undefined') return 'viewer';
  return (localStorage.getItem('cashflow_role') as Role) || 'viewer';
}

export function setRole(role: Role): void {
  localStorage.setItem('cashflow_role', role);
}

export function getUserId(): string {
  if (typeof window === 'undefined') return 'web-user';
  return localStorage.getItem('cashflow_user') || 'web-user';
}

export interface ApiError {
  error: string;
  details?: unknown;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-user-id': getUserId(),
      'x-user-role': getRole(),
      ...(options.headers || {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = (body as ApiError) || { error: `Request failed (${res.status})` };
    throw new Error(err.error + (err.details ? `: ${JSON.stringify(err.details)}` : ''));
  }
  return body as T;
}

export interface ExceptionRecord {
  id: number;
  type: string;
  status: string;
  severity: string;
  customer_id: number;
  customer_name?: string;
  invoice_id: number | null;
  payment_id: number | null;
  reason: string | null;
  detected_at: string;
  amount_delta: string | null;
  outstanding_balance_snapshot: string | null;
  resolution_notes: string | null;
}

export interface Investigation {
  id: number;
  exception_id: number;
  job_id: number | null;
  status: string;
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
  result: any;
  evidence: any[];
}

export interface Job {
  id: number;
  type: string;
  status: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Approval {
  id: number;
  request_type: string;
  entity_id: number;
  requested_by: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  metadata: any;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  changes: any;
  created_at: string;
}

export const api = {
  listExceptions: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])
    ).toString();
    return request<{ data: ExceptionRecord[]; page: number; limit: number; total: number }>(
      `/api/exceptions${qs ? `?${qs}` : ''}`
    );
  },
  getException: (id: number) =>
    request<{ data: ExceptionRecord & { invoices: any[]; payments: any[]; investigations: Investigation[]; approvals: Approval[] } }>(
      `/api/exceptions/${id}`
    ),
  investigate: (id: number) =>
    request<{ data: { job: Job; investigation: Investigation } }>(`/api/exceptions/${id}/investigate`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  resolveException: (id: number, notes: string) =>
    request<{ data: ExceptionRecord }>(`/api/exceptions/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution_notes: notes }),
    }),
  getJob: (id: number) => request<{ data: Job }>(`/api/jobs/${id}`),
  listJobs: () => request<{ data: Job[] }>(`/api/jobs`),
  getInvestigation: (id: number) => request<{ data: Investigation }>(`/api/investigations/${id}`),
  listApprovals: () => request<{ data: Approval[] }>(`/api/approvals`),
  decideApproval: (id: number, status: 'approved' | 'rejected', rejected_reason?: string) =>
    request<{ data: Approval; action: any }>(`/api/approvals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, rejected_reason }),
    }),
  listAuditLogs: () => request<{ data: AuditLog[] }>(`/api/audit-logs`),
};
