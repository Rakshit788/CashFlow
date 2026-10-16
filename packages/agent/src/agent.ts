import { executeTool, toolDefinitions, ToolDefinition } from './tools';
import {
  ChatMessage,
  LLMProvider,
  createProvider,
  loadProviderConfig,
} from './llm';
import { RecommendationSchema } from './schema';
import { AgentCache, AgentEvidence, AgentRunMetrics, AgentRunResult, Recommendation } from './types';

const SYSTEM_PROMPT = `You are a senior cash application analyst and reconciliation expert.
Your job is to investigate a cash application exception and recommend the safest corrective action.

Use the provided tools to gather evidence. Start with getInvestigationContext, which returns:
1. The exception details.
2. The customer's invoices and outstanding balances.
3. The customer's payments and how much of each has been applied.
4. Similar exceptions for the same customer (patterns).
Use other tools only when you need to inspect or verify a specific record.
When a remittance reference or payment memo is ambiguous, use searchRemittanceAdvice to find
candidate notes for this customer. Treat semantic matches as leads only; verify invoice IDs,
payment IDs, and amounts against the exact financial tools before recommending an action.

Then produce a final answer as STRICT JSON only (no markdown fences) matching:
{
  "action": "hold" | "release" | "adjust" | "approve_manual" | "write_off",
  "confidence": <number between 0 and 1>,
  "rationale": "<concise explanation grounded in the evidence>",
  "evidence_refs": ["<tool name or invoice/payment id that supports the claim>"],
  "suggested_adjustments": [
    {"type": "apply_payment"|"unapply_payment"|"write_off"|"credit"|"noop",
     "invoice_id": <number|null>, "payment_id": <number|null>, "amount": <number|null>, "note": "<text>"}
  ]
}

Guidelines:
- Never recommend writing off or adjusting amounts above the approval threshold without flagging it.
- Prefer "hold" or "approve_manual" when evidence is ambiguous.
- Every claim in the rationale must be supported by a tool result.`;

function summarizeException(ex: any): string {
  return JSON.stringify(
    {
      id: ex.id,
      type: ex.type,
      status: ex.status,
      severity: ex.severity,
      customer_id: ex.customer_id,
      invoice_id: ex.invoice_id,
      payment_id: ex.payment_id,
      reason: ex.reason,
      amount_delta: ex.amount_delta,
      outstanding_balance_snapshot: ex.outstanding_balance_snapshot,
    },
    null,
    2
  );
}

function parseRecommendation(content: string | null): Recommendation | null {
  if (!content) return null;
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const result = RecommendationSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  evidence: AgentEvidence[],
  step: number,
  cache?: AgentCache,
  cacheStats?: { hits: number; misses: number }
): Promise<unknown> {
  const result = await executeTool(name, args, cache, cacheStats);
  evidence.push({ step, tool: name, args, result, at: new Date().toISOString() });
  return result;
}

async function runLlmAgent(
  exceptionId: number,
  provider: LLMProvider,
  maxSteps = 8,
  cache?: AgentCache,
  cacheStats?: { hits: number; misses: number }
): Promise<{ recommendation: Recommendation; evidence: AgentEvidence[]; steps: number }> {
  const evidence: AgentEvidence[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Investigate exception #${exceptionId}. Start by calling getInvestigationContext.`,
    },
  ];

  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const response = await provider.complete(messages, toolDefinitions);

    if (response.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      });
      for (const call of response.toolCalls) {
        const result = await callTool(call.name, call.arguments, evidence, steps, cache, cacheStats);
        messages.push({
          role: 'tool',
          content: JSON.stringify(result).slice(0, 8000),
          tool_call_id: call.id,
          name: call.name,
        });
      }
      continue;
    }

    const recommendation = parseRecommendation(response.content);
    if (recommendation) {
      return { recommendation, evidence, steps: steps + 1 };
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: 'Please respond with the required STRICT JSON object only.',
    });
  }

  throw new Error('Agent exceeded maximum steps without producing a valid recommendation');
}

async function runRuleBasedAgent(
  exceptionId: number,
  cache?: AgentCache,
  cacheStats?: { hits: number; misses: number }
): Promise<{
  recommendation: Recommendation;
  evidence: AgentEvidence[];
  steps: number;
}> {
  const evidence: AgentEvidence[] = [];
  let step = 0;

  const context = (await callTool(
    'getInvestigationContext',
    { exceptionId },
    evidence,
    step++,
    cache,
    cacheStats
  )) as any;
  const exception = context?.exception;
  if (!exception || exception.error) throw new Error('Exception not found');
  const customerId = exception.customer_id;
  const invoices = context.invoices as any[];
  const payments = context.payments as any[];

  const threshold = parseFloat(process.env.APPROVAL_THRESHOLD || '1000');
  const delta = Math.abs(parseFloat(exception.amount_delta || '0'));
  const needsApproval = delta > threshold;

  const oldestOutstanding = invoices.find((i) => parseFloat(i.outstanding) > 0.01);
  const unapplied = payments.find((p) => parseFloat(p.unapplied) > 0.01);

  const refs = [`exception:${exceptionId}`, `customer:${customerId}`];
  let recommendation: Recommendation;

  switch (exception.type) {
    case 'unapplied_payment': {
      if (oldestOutstanding && unapplied) {
        const amount = Math.min(
          parseFloat(unapplied.unapplied),
          parseFloat(oldestOutstanding.outstanding)
        );
        refs.push(`payment:${unapplied.id}`, `invoice:${oldestOutstanding.id}`);
        recommendation = {
          action: needsApproval ? 'approve_manual' : 'adjust',
          confidence: 0.82,
          rationale: `Payment #${unapplied.id} has ${unapplied.unapplied} unapplied. Invoice #${oldestOutstanding.id} has an outstanding balance of ${oldestOutstanding.outstanding}. Recommend applying ${amount.toFixed(2)} of the unapplied payment to the oldest open invoice.`,
          evidence_refs: refs,
          suggested_adjustments: [
            {
              type: 'apply_payment',
              invoice_id: oldestOutstanding.id,
              payment_id: unapplied.id,
              amount: parseFloat(amount.toFixed(2)),
              note: 'Apply unapplied cash to oldest outstanding invoice (FIFO)',
            },
          ],
        };
      } else {
        recommendation = {
          action: 'hold',
          confidence: 0.5,
          rationale: 'Payment appears unapplied but no open invoice was found to apply it to. Manual review required.',
          evidence_refs: refs,
          suggested_adjustments: [],
        };
      }
      break;
    }
    case 'amount_mismatch': {
      recommendation = {
        action: needsApproval ? 'approve_manual' : 'adjust',
        confidence: 0.65,
        rationale: `A difference of ${delta.toFixed(2)} exists between the payment and the amount applied. Recommend reconciling the allocation to the invoice(s) by the delta.`,
        evidence_refs: refs,
        suggested_adjustments: [
          {
            type: 'apply_payment',
            invoice_id: exception.invoice_id ?? oldestOutstanding?.id ?? null,
            payment_id: exception.payment_id ?? null,
            amount: parseFloat(delta.toFixed(2)),
            note: 'Allocate remaining amount to match payment',
          },
        ],
      };
      break;
    }
    case 'overpayment': {
      recommendation = {
        action: 'hold',
        confidence: 0.7,
        rationale: `Customer has paid ${delta.toFixed(2)} more than their total open invoices. Recommend holding the credit balance and confirming with the customer before issuing a refund or credit note.`,
        evidence_refs: refs,
        suggested_adjustments: [
          {
            type: 'credit',
            invoice_id: null,
            payment_id: null,
            amount: parseFloat(delta.toFixed(2)),
            note: 'Record customer credit balance pending confirmation',
          },
        ],
      };
      break;
    }
    case 'duplicate_payment': {
      recommendation = {
        action: 'hold',
        confidence: 0.75,
        rationale: `Possible duplicate payment detected. Hold the duplicate and request confirmation before reversing.`,
        evidence_refs: refs,
        suggested_adjustments: [],
      };
      break;
    }
    case 'timing_issue': {
      recommendation = {
        action: 'approve_manual',
        confidence: 0.6,
        rationale: `Invoice is past due with an outstanding balance. This is a timing/collection issue rather than a cash application error. Recommend routing to collections.`,
        evidence_refs: refs,
        suggested_adjustments: [],
      };
      break;
    }
    default: {
      recommendation = {
        action: 'approve_manual',
        confidence: 0.4,
        rationale: `Exception type "${exception.type}" is not automatically classifiable. Escalate for manual review.`,
        evidence_refs: refs,
        suggested_adjustments: [],
      };
    }
  }

  return { recommendation, evidence, steps: step };
}

export interface RunAgentOptions {
  provider?: LLMProvider | null;
  maxSteps?: number;
  cache?: AgentCache;
}

export async function runAgent(
  exceptionId: number,
  options: RunAgentOptions = {}
): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const cacheStats = { hits: 0, misses: 0 };
  const metrics = (toolCalls: number): AgentRunMetrics => ({
    durationMs: Date.now() - startedAt,
    toolCalls,
    cacheEnabled: options.cache !== undefined,
    cacheHits: cacheStats.hits,
    cacheMisses: cacheStats.misses,
  });
  const provider =
    options.provider !== undefined ? options.provider : createProvider(loadProviderConfig());

  if (provider) {
    try {
      const { recommendation, evidence, steps } = await runLlmAgent(
        exceptionId,
        provider,
        options.maxSteps,
        options.cache,
        cacheStats
      );
      return {
        recommendation,
        evidence,
        provider: provider.name,
        model: provider.model,
        steps,
        metrics: metrics(evidence.length),
      };
    } catch (err) {
      console.error('LLM agent failed, falling back to rule-based agent:', (err as Error).message);
    }
  }

  const { recommendation, evidence, steps } = await runRuleBasedAgent(
    exceptionId,
    options.cache,
    cacheStats
  );
  return {
    recommendation,
    evidence,
    provider: 'rule-based',
    model: 'deterministic',
    steps,
    metrics: metrics(evidence.length),
  };
}
