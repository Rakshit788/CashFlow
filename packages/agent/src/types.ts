export type AgentAction =
  | 'hold'
  | 'release'
  | 'adjust'
  | 'approve_manual'
  | 'write_off';

export interface SuggestedAdjustment {
  type: 'apply_payment' | 'unapply_payment' | 'write_off' | 'credit' | 'noop';
  invoice_id?: number | null;
  payment_id?: number | null;
  amount?: number | null;
  note?: string;
}

export interface Recommendation {
  action: AgentAction;
  confidence: number;
  rationale: string;
  evidence_refs: string[];
  suggested_adjustments: SuggestedAdjustment[];
}

export interface AgentEvidence {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  at: string;
}

export interface AgentRunResult {
  recommendation: Recommendation;
  evidence: AgentEvidence[];
  provider: string;
  model: string;
  steps: number;
  metrics?: AgentRunMetrics;
}

export interface AgentRunMetrics {
  durationMs: number;
  toolCalls: number;
  cacheEnabled: boolean;
  cacheHits: number;
  cacheMisses: number;
}

/** Small cache interface keeps the agent independent from a specific cache client. */
export interface AgentCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<unknown>;
}
