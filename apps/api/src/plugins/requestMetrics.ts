import type { FastifyInstance } from 'fastify';

/**
 * In-process request metrics for the admin «Техническое состояние» page:
 * method, route PATTERN (e.g. /api/v1/tasks/:id/attempt — never the real
 * URL, query or body), status code and duration of recent requests, plus
 * counters since this process started. Nothing is persisted: a restart
 * resets it, and the page says "с момента запуска процесса". One API
 * process = one view; several replicas would each have their own.
 */
export interface RequestSample {
  at: number;
  method: string;
  route: string;
  status: number;
  ms: number;
}

const CAPACITY = 20_000;

export class RequestMetrics {
  readonly startedAt = Date.now();
  total = 0;
  serverErrors = 0;
  private samples: RequestSample[] = [];
  private next = 0;

  record(sample: RequestSample) {
    this.total++;
    if (sample.status >= 500) this.serverErrors++;
    if (this.samples.length < CAPACITY) this.samples.push(sample);
    else this.samples[this.next] = sample;
    this.next = (this.next + 1) % CAPACITY;
  }

  /** Samples newer than `sinceMs` (bounded by the buffer). */
  recent(sinceMs: number): RequestSample[] {
    return this.samples.filter((s) => s.at >= sinceMs);
  }
}

export function registerRequestMetrics(app: FastifyInstance, metrics: RequestMetrics) {
  app.addHook('onResponse', async (request, reply) => {
    metrics.record({
      at: Date.now(),
      method: request.method,
      route: request.routeOptions.url ?? '(unmatched)',
      status: reply.statusCode,
      ms: reply.elapsedTime,
    });
  });
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}
