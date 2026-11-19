import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  loadSeoSettings,
  moscowPeriodStarts,
  schema,
  seoSpendSince,
  type Database,
} from '@zybrilka/db';
import { usageCostUsd, worstCaseCostUsd, type SeoAgent } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';

/**
 * The only door from the SEO agent to an AI model (docs/SEO_CENTER.md §3).
 * Before every call: the emergency stop and both budgets are checked
 * against the WORST case of this call (all input uncached, full
 * max_tokens, every allowed web search). After every call — success or
 * not — the real usage is written to seo_ai_usage, which is what the
 * budget sums. A call that would not fit is never made.
 */

export class AiBlocked extends Error {
  constructor(
    public reason:
      'emergency_stop' | 'budget_daily' | 'budget_monthly' | 'not_configured' | 'refusal',
  ) {
    super(`ai blocked: ${reason}`);
  }
}

export class AiInvalidOutput extends Error {}

/** The subset of the SDK the gateway uses — a fake in tests. */
export interface AiClient {
  messages: {
    stream: (params: Anthropic.MessageStreamParams) => {
      finalMessage: () => Promise<Anthropic.Message>;
    };
  };
}

export interface AiCall {
  agent: SeoAgent;
  purpose: string;
  taskId?: string | null;
  /** 'strong' | 'cheap' → settings.strongModel / cheapModel. */
  tier: 'strong' | 'cheap';
  system: string;
  prompt: string;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Server-side web search (Anthropic runs it). */
  webSearch?: { maxUses: number; blockedDomains?: string[] };
}

export interface AiTextResult {
  text: string;
  sources: { url: string; title: string }[];
  costUsd: number;
  model: string;
}

/** Conservative token estimate: Russian text is ~2.5–3 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.2) + 50;
}

const MAX_CONTINUATIONS = 4;

export class SeoAi {
  constructor(
    private readonly opts: {
      db: Database;
      client: AiClient | null;
      logger: Logger;
      now?: () => Date;
    },
  ) {}

  get configured() {
    return this.opts.client !== null;
  }

  private async guard(model: string, call: AiCall) {
    if (!this.opts.client) throw new AiBlocked('not_configured');
    const settings = await loadSeoSettings(this.opts.db);
    if (settings.emergencyStop) throw new AiBlocked('emergency_stop');
    const worst = worstCaseCostUsd(
      model,
      estimateTokens(call.system + call.prompt) * (call.webSearch ? 4 : 1),
      call.maxTokens * (call.webSearch ? 2 : 1),
      call.webSearch?.maxUses ?? 0,
    );
    const { day, month } = moscowPeriodStarts(this.opts.now?.() ?? new Date());
    const [daySpent, monthSpent] = await Promise.all([
      seoSpendSince(this.opts.db, day),
      seoSpendSince(this.opts.db, month),
    ]);
    if (daySpent + worst > settings.dailyBudgetUsd) throw new AiBlocked('budget_daily');
    if (monthSpent + worst > settings.monthlyBudgetUsd) throw new AiBlocked('budget_monthly');
    return settings;
  }

  private async record(
    call: AiCall,
    model: string,
    usage: Anthropic.Usage | null,
    error: string | null,
  ) {
    const u = {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      webSearches: usage?.server_tool_use?.web_search_requests ?? 0,
    };
    const costUsd = usageCostUsd(model, u);
    await this.opts.db.insert(schema.seoAiUsage).values({
      agent: call.agent,
      purpose: call.purpose,
      model,
      taskId: call.taskId ?? null,
      ...u,
      costUsd,
      ok: error === null,
      error,
    });
    return costUsd;
  }

  /** Runs a call to completion (resuming `pause_turn`), summing usage across continuations. */
  private async run(call: AiCall, extra: Partial<Anthropic.MessageStreamParams> = {}) {
    const settings = await loadSeoSettings(this.opts.db);
    const model = call.tier === 'strong' ? settings.strongModel : settings.cheapModel;
    await this.guard(model, call);
    const client = this.opts.client!;
    const tools: Anthropic.MessageStreamParams['tools'] = call.webSearch
      ? [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: call.webSearch.maxUses,
            ...(call.webSearch.blockedDomains?.length
              ? { blocked_domains: call.webSearch.blockedDomains }
              : {}),
          },
        ]
      : undefined;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: call.prompt }];
    const total: Anthropic.Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    } as unknown as Anthropic.Usage;
    const add = (u: Anthropic.Usage) => {
      total.input_tokens += u.input_tokens;
      total.output_tokens += u.output_tokens;
      total.cache_creation_input_tokens =
        (total.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      total.cache_read_input_tokens =
        (total.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      if (total.server_tool_use && u.server_tool_use) {
        total.server_tool_use.web_search_requests += u.server_tool_use.web_search_requests ?? 0;
      }
    };
    const content: Anthropic.ContentBlock[] = [];
    try {
      let message: Anthropic.Message | null = null;
      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        message = await client.messages
          .stream({
            model,
            max_tokens: call.maxTokens,
            // Stable system prompt first → cacheable prefix across calls of one agent.
            system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
            messages,
            ...(tools ? { tools } : {}),
            output_config: { effort: call.effort ?? 'medium', ...(extra.output_config ?? {}) },
          })
          .finalMessage();
        add(message.usage);
        content.push(...message.content);
        if (message.stop_reason !== 'pause_turn') break;
        // Resume: resend the conversation with the paused assistant turn.
        messages.push({ role: 'assistant', content: message.content });
      }
      if (message?.stop_reason === 'refusal') throw new AiBlocked('refusal');
      if (message?.stop_reason === 'max_tokens') {
        throw new AiInvalidOutput(`output cut at max_tokens (${call.maxTokens})`);
      }
      const costUsd = await this.record(call, model, total, null);
      return { content, costUsd, model };
    } catch (err) {
      await this.record(
        call,
        model,
        total,
        err instanceof Error ? err.message.slice(0, 500) : 'error',
      ).catch((e: unknown) => this.opts.logger.error({ err: e }, 'seo ai usage not recorded'));
      throw err;
    }
  }

  async text(call: AiCall): Promise<AiTextResult> {
    const { content, costUsd, model } = await this.run(call);
    const text = content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const sources = new Map<string, string>();
    for (const b of content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) if (r.type === 'web_search_result') sources.set(r.url, r.title);
      }
      if (b.type === 'text' && b.citations) {
        for (const c of b.citations) {
          if (c.type === 'web_search_result_location') sources.set(c.url, c.title ?? c.url);
        }
      }
    }
    return { text, sources: [...sources].map(([url, title]) => ({ url, title })), costUsd, model };
  }

  /** Structured output, validated again by Zod (the API guarantees shape, Zod checks lengths/limits). */
  async json<S extends z.ZodType>(
    call: AiCall,
    outputSchema: S,
  ): Promise<{ data: z.infer<S>; costUsd: number }> {
    const format = zodOutputFormat(outputSchema);
    const { content, costUsd } = await this.run(call, {
      output_config: { format: { type: 'json_schema', schema: format.schema } },
    });
    const raw = content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AiInvalidOutput('model returned invalid JSON');
    }
    const result = outputSchema.safeParse(parsed);
    if (!result.success) {
      throw new AiInvalidOutput(
        `schema: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    return { data: result.data, costUsd };
  }

  /** Research cache: the same question is answered once per TTL. */
  async cached<T>(
    kind: string,
    keyParts: unknown,
    ttlHours: number,
    produce: () => Promise<T>,
  ): Promise<T> {
    const key = `${kind}:${createHash('sha256').update(JSON.stringify(keyParts)).digest('hex').slice(0, 40)}`;
    const now = this.opts.now?.() ?? new Date();
    const [hit] = await this.opts.db
      .select()
      .from(schema.seoResearchCache)
      .where(eq(schema.seoResearchCache.key, key));
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await produce();
    const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
    await this.opts.db
      .insert(schema.seoResearchCache)
      .values({ key, kind, value: value as object, expiresAt })
      .onConflictDoUpdate({
        target: schema.seoResearchCache.key,
        set: { value: value as object, expiresAt, createdAt: now },
      });
    return value;
  }
}

export function createAnthropicClient(apiKey: string | undefined): AiClient | null {
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 }) as unknown as AiClient;
}
