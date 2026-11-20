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
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { currentTaskSignal, throwIfTaskAborted } from './taskScope.js';

/**
 * The only door from the SEO agent to an AI model (docs/SEO_CENTER.md §3).
 *
 * Budget: before EVERY request to the API (each `pause_turn` continuation
 * is a separate request) the gateway RESERVES the request's worst-case
 * cost: under a Postgres advisory lock it sums today's/this month's spend
 * (settled calls + open reservations of every worker and task) and inserts
 * a `seo_ai_usage` row with `error = 'pending'` and the worst-case cost.
 * Two concurrent calls are serialised by the lock, so together they can
 * never pass a limit only one of them fits. When the request ends the row
 * is settled to the real usage (unused reserve released); a failed request
 * with no usage settles to 0. A reservation left by a crashed worker keeps
 * its worst-case cost (unknown real spend — the safe side) and is marked
 * `abandoned` by the scheduler.
 *
 * Cancellation: the queue task's AbortSignal (taskScope.ts) is passed to
 * the SDK, so a timeout or an emergency stop aborts the HTTP request.
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
    stream: (
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ) => {
      finalMessage: () => Promise<Anthropic.Message>;
      /** The SDK's running snapshot (usage from message_start / message_delta so far). */
      readonly currentMessage?: Anthropic.Message | undefined;
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

/** Input tokens one web search may add (result pages fed back to the model). */
export const WEB_SEARCH_INPUT_TOKENS = 25_000;
/** `pg_advisory_xact_lock` key of the AI budget (any constant bigint). */
export const AI_BUDGET_LOCK = 7_340_211;
export const PENDING = 'pending';

/** Worst-case cost of ONE request: every input token uncached, full max_tokens, every search. */
export function requestWorstCaseUsd(
  model: string,
  promptText: string,
  maxTokens: number,
  maxSearches: number,
): number {
  return worstCaseCostUsd(
    model,
    estimateTokens(promptText) + maxSearches * WEB_SEARCH_INPUT_TOKENS,
    maxTokens,
    maxSearches,
  );
}

const MAX_CONTINUATIONS = 4;

function usageOf(u: Anthropic.Usage | null | undefined) {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    webSearches: u?.server_tool_use?.web_search_requests ?? 0,
  };
}

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

  /**
   * Atomically checks the stop switch and both budgets and reserves the
   * request's worst case. Returns the reservation row id.
   */
  async reserve(call: AiCall, model: string, worstUsd: number): Promise<string> {
    if (!this.opts.client) throw new AiBlocked('not_configured');
    throwIfTaskAborted();
    const { day, month } = moscowPeriodStarts(this.opts.now?.() ?? new Date());
    return this.opts.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${AI_BUDGET_LOCK})`);
      const settings = await loadSeoSettings(tx);
      if (settings.emergencyStop) throw new AiBlocked('emergency_stop');
      const [daySpent, monthSpent] = [await seoSpendSince(tx, day), await seoSpendSince(tx, month)];
      if (daySpent + worstUsd > settings.dailyBudgetUsd) throw new AiBlocked('budget_daily');
      if (monthSpent + worstUsd > settings.monthlyBudgetUsd) throw new AiBlocked('budget_monthly');
      const [row] = await tx
        .insert(schema.seoAiUsage)
        .values({
          agent: call.agent,
          purpose: call.purpose,
          model,
          taskId: call.taskId ?? null,
          costUsd: worstUsd,
          ok: false,
          error: PENDING,
        })
        .returning({ id: schema.seoAiUsage.id });
      return row!.id;
    });
  }

  /**
   * What a request that did not complete cost. Anthropic bills a request
   * that reached the model even if the stream was cut (timeout, stop,
   * network): with a `message_start` the input tokens are known and the
   * output so far is estimated from the text received. An HTTP error answer
   * (4xx/5xx status) means the request was refused — not billed. A failure
   * before any byte arrived is unknown: the input estimate is kept (safe side).
   */
  private failedUsage(
    err: unknown,
    snapshot: Anthropic.Message | undefined,
    promptText: string,
  ): { usage: Anthropic.Usage | null; note: string } {
    if (snapshot?.usage) {
      const received = snapshot.content
        .map((b) => (b.type === 'text' ? b.text : b.type === 'thinking' ? b.thinking : ''))
        .join('');
      const usage = {
        ...snapshot.usage,
        output_tokens: Math.max(
          snapshot.usage.output_tokens ?? 0,
          received ? estimateTokens(received) : 0,
        ),
      } as Anthropic.Usage;
      return { usage, note: 'partial' };
    }
    if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
      return { usage: null, note: 'refused' };
    }
    return {
      usage: { input_tokens: estimateTokens(promptText), output_tokens: 0 } as Anthropic.Usage,
      note: 'unknown_estimated',
    };
  }

  /** Replaces a reservation with the real usage of the request (0 if it produced none). */
  private async settle(
    id: string,
    model: string,
    usage: Anthropic.Usage | null,
    error: string | null,
  ) {
    const u = usageOf(usage);
    const costUsd = usageCostUsd(model, u);
    await this.opts.db
      .update(schema.seoAiUsage)
      .set({ ...u, costUsd, ok: error === null, error })
      .where(eq(schema.seoAiUsage.id, id));
    return costUsd;
  }

  /** Runs a call to completion (resuming `pause_turn`); every request is reserved and settled. */
  private async run(call: AiCall, extra: Partial<Anthropic.MessageStreamParams> = {}) {
    const settings = await loadSeoSettings(this.opts.db);
    const model = call.tier === 'strong' ? settings.strongModel : settings.cheapModel;
    if (!this.opts.client) throw new AiBlocked('not_configured');
    const client = this.opts.client;
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
    const content: Anthropic.ContentBlock[] = [];
    let costUsd = 0;
    let message: Anthropic.Message | null = null;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const worst = requestWorstCaseUsd(
        model,
        call.system + JSON.stringify(messages),
        call.maxTokens,
        call.webSearch?.maxUses ?? 0,
      );
      const reservation = await this.reserve(call, model, worst);
      let stream: ReturnType<AiClient['messages']['stream']> | undefined;
      try {
        const signal = currentTaskSignal();
        stream = client.messages.stream(
          {
            model,
            max_tokens: call.maxTokens,
            // Stable system prompt first → cacheable prefix across calls of one agent.
            system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
            messages,
            ...(tools ? { tools } : {}),
            output_config: { effort: call.effort ?? 'medium', ...(extra.output_config ?? {}) },
          },
          signal ? { signal } : undefined,
        );
        message = await stream.finalMessage();
      } catch (err) {
        // Settle to what the request really cost (partial / refused / estimated) — never a silent $0.
        const failed = this.failedUsage(
          err,
          stream?.currentMessage,
          call.system + JSON.stringify(messages),
        );
        await this.settle(
          reservation,
          model,
          failed.usage,
          `${failed.note}: ${err instanceof Error ? err.message : 'error'}`.slice(0, 500),
        ).catch((e: unknown) => this.opts.logger.error({ err: e }, 'seo ai usage not settled'));
        throw err;
      }
      const failure =
        message.stop_reason === 'refusal'
          ? 'refusal'
          : message.stop_reason === 'max_tokens'
            ? `output cut at max_tokens (${call.maxTokens})`
            : null;
      costUsd += await this.settle(reservation, model, message.usage, failure);
      content.push(...message.content);
      if (message.stop_reason !== 'pause_turn') break;
      // Resume: resend the conversation with the paused assistant turn.
      messages.push({ role: 'assistant', content: message.content });
    }
    if (message?.stop_reason === 'refusal') throw new AiBlocked('refusal');
    if (message?.stop_reason === 'max_tokens') {
      throw new AiInvalidOutput(`output cut at max_tokens (${call.maxTokens})`);
    }
    return { content, costUsd, model };
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

  /**
   * Research cache: the same question is answered once per TTL. A result
   * `isValid` rejects (e.g. an empty research answer) is NOT cached — the
   * call throws AiInvalidOutput, so the task retries instead of reusing
   * nothing for a whole day.
   */
  async cached<T>(
    kind: string,
    keyParts: unknown,
    ttlHours: number,
    produce: () => Promise<T>,
    isValid: (value: T) => boolean = () => true,
  ): Promise<T> {
    const key = `${kind}:${createHash('sha256').update(JSON.stringify(keyParts)).digest('hex').slice(0, 40)}`;
    const now = this.opts.now?.() ?? new Date();
    const [hit] = await this.opts.db
      .select()
      .from(schema.seoResearchCache)
      .where(eq(schema.seoResearchCache.key, key));
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await produce();
    if (!isValid(value))
      throw new AiInvalidOutput(`${kind}: empty or too short result, not cached`);
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
  // One request may take at most 6 min (× 2 SDK attempts); the queue's task
  // timeout (15 min) aborts anything longer through the task signal.
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 6 * 60_000 }) as unknown as AiClient;
}
