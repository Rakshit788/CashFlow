import { ToolDefinition } from './tools';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = (env.LLM_PROVIDER || 'openai').toLowerCase();
  return {
    provider,
    model: env.LLM_MODEL || (provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
    apiKey:
      provider === 'gemini'
        ? env.GEMINI_API_KEY || env.LLM_API_KEY
        : env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL || (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai' : undefined),
    maxTokens: parseInt(env.LLM_MAX_TOKENS || '2000', 10),
    temperature: parseFloat(env.LLM_TEMPERATURE || '0.1'),
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return res.json() as Promise<any>;
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string = 'openai';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private temperature: number;

  constructor(cfg: ProviderConfig) {
    if (!cfg.apiKey) throw new Error('OPENAI_API_KEY is required for the openai provider');
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.baseUrl = cfg.baseUrl || 'https://api.openai.com/v1';
    this.maxTokens = cfg.maxTokens;
    this.temperature = cfg.temperature;
  }

  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const payload = {
      model: this.model,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool', content: m.content ?? '', tool_call_id: m.tool_call_id };
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return {
            role: 'assistant',
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: 'auto',
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      payload
    );

    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: parseArgs(tc.function?.arguments),
    }));

    return { content: msg.content ?? null, toolCalls };
  }
}

export class GeminiProvider extends OpenAIProvider {
  override readonly name = 'gemini';
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private apiKey: string;
  private maxTokens: number;
  private temperature: number;

  constructor(cfg: ProviderConfig) {
    if (!cfg.apiKey) throw new Error('ANTHROPIC_API_KEY is required for the anthropic provider');
    this.apiKey = cfg.apiKey;
    this.model = cfg.model || 'claude-3-5-sonnet-latest';
    this.maxTokens = cfg.maxTokens;
    this.temperature = cfg.temperature;
  }

  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const system = messages.find((m) => m.role === 'system')?.content ?? undefined;
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }],
          };
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return {
            role: 'assistant',
            content: m.tool_calls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
          };
        }
        return { role: m.role, content: m.content ?? '' };
      });

    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        system,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        messages: anthropicMessages,
      }
    );

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') content = (content ?? '') + block.text;
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
      }
    }
    return { content, toolCalls };
  }
}

export function createProvider(cfg: ProviderConfig = loadProviderConfig()): LLMProvider | null {
  if (!cfg.apiKey) return null;
  if (cfg.provider === 'anthropic') return new AnthropicProvider(cfg);
  if (cfg.provider === 'gemini') return new GeminiProvider(cfg);
  return new OpenAIProvider(cfg);
}
