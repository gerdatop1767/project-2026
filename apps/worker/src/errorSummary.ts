/**
 * What may go into a log about an unexpected error: its class and code.
 * Never the message or the error object itself — a failed query's message
 * carries its parameters (a support message's text, a name, a link token).
 */
export function errorSummary(error: unknown): { errorName: string; errorCode?: string } {
  const errorName = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' || typeof code === 'number'
    ? { errorName, errorCode: String(code) }
    : { errorName };
}
