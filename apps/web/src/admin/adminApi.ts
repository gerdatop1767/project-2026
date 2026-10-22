/**
 * The admin panel's own fetch helper. Every request is same-origin with
 * the httpOnly session cookie; the server alone decides access (401/403).
 * Writes carry `x-zybrilka-admin: 1` (see apps/api admin/access.ts).
 * Nothing here is cached — admin numbers are always fresh.
 */
export class AdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`admin api ${status} ${code}`);
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function toSearch(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request<T>(
  method: string,
  path: string,
  options: { query?: Query; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(`/api/v1/admin${path}${toSearch(options.query)}`, window.location.origin);
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-zybrilka-admin'] = '1';
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!response.ok) {
    let code = 'error';
    try {
      code = ((await response.json()) as { error?: string }).error ?? code;
    } catch {
      // a non-JSON error body
    }
    throw new AdminApiError(response.status, code);
  }
  return (await response.json()) as T;
}

export const adminApi = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  /** A same-origin link the browser downloads with the session cookie. */
  exportUrl: (kind: string, query?: Query) => `/api/v1/admin/export/${kind}${toSearch(query)}`,
};

/** Human text for an API error code — never the raw server message. */
export function errorText(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) return 'Сессия закончилась — войдите снова.';
    if (error.status === 403) return 'Нет доступа.';
    if (error.status === 404) return 'Не найдено.';
    if (error.status === 429) return 'Слишком много запросов — подождите минуту.';
    const known: Record<string, string> = {
      invalid_date: 'Неверная дата.',
      from_after_to: 'Начало периода позже конца.',
      period_too_long: 'Период слишком длинный (максимум 3 года).',
      period_in_future: 'Период в будущем.',
      custom_period_needs_from_and_to: 'Укажите обе даты.',
      target_not_allowed: 'Такую страницу нельзя указать целью ссылки.',
      invalid_body: 'Проверьте заполненные поля.',
      invalid_query: 'Неверные параметры фильтра.',
    };
    if (known[error.code]) return known[error.code]!;
    if (error.status >= 500) return 'Ошибка сервера. Попробуйте ещё раз.';
    return 'Запрос отклонён.';
  }
  return 'Нет связи с сервером.';
}
