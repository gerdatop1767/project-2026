/**
 * Telegram's HTML formatting (https://core.telegram.org/bots/api#html-style)
 * for broadcasts: validated on the server, previewed in the admin panel and
 * sent by the worker from the same parse — so the preview shows what
 * Telegram will show, and Telegram never rejects a confirmed broadcast for
 * bad markup.
 */

export const TELEGRAM_TEXT_MAX = 4096;
export const TELEGRAM_CAPTION_MAX = 1024;
export const BROADCAST_MAX_IMAGES = 10;
export const BROADCAST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BROADCAST_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

const SIMPLE_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'blockquote',
  'tg-spoiler',
]);

export type TelegramHtmlNode =
  | { type: 'text'; text: string }
  | { type: 'tag'; tag: string; href?: string; children: TelegramHtmlNode[] };

export type TelegramHtmlResult =
  | { ok: true; html: string; nodes: TelegramHtmlNode[]; visibleLength: number }
  | { ok: false; error: string };

const ENTITY = /^&(?:lt|gt|amp|quot|#\d{1,7}|#x[0-9a-f]{1,6});/i;
const decode: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };

function decodeEntity(entity: string): string {
  const name = entity.slice(1, -1).toLowerCase();
  if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
  if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
  return decode[name] ?? entity;
}

function safeHref(raw: string): string | null {
  const href = raw.replace(/&amp;/g, '&').trim();
  return /^(https?:\/\/|tg:\/\/)[^\s"<>]+$/i.test(href) ? href : null;
}

/**
 * Parses (and lightly normalises) a broadcast text. A lone `&` or `>` is
 * escaped for the author; a `<` must open or close a supported tag. Tags
 * must be properly nested. Returns the HTML to send, a tree to preview and
 * the visible length Telegram counts against its limits.
 */
export function parseTelegramHtml(input: string): TelegramHtmlResult {
  const root: TelegramHtmlNode[] = [];
  const stack: { tag: string; node: Extract<TelegramHtmlNode, { type: 'tag' }> }[] = [];
  let out = '';
  let text = '';
  let visible = 0;
  const children = () => (stack.length ? stack[stack.length - 1]!.node.children : root);
  const flush = () => {
    if (text) {
      children().push({ type: 'text', text });
      text = '';
    }
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '&') {
      const entity = ENTITY.exec(input.slice(i));
      if (entity) {
        out += entity[0];
        text += decodeEntity(entity[0]);
        visible++;
        i += entity[0].length;
      } else {
        out += '&amp;';
        text += '&';
        visible++;
        i++;
      }
      continue;
    }
    if (ch === '>') {
      out += '&gt;';
      text += '>';
      visible++;
      i++;
      continue;
    }
    if (ch === '<') {
      const end = input.indexOf('>', i);
      if (end === -1)
        return {
          ok: false,
          error: 'Незакрытый тег «<». Чтобы написать сам знак, используйте &lt;',
        };
      const raw = input.slice(i + 1, end).trim();
      const closing = /^\/\s*([a-z-]+)$/i.exec(raw);
      if (closing) {
        const name = closing[1]!.toLowerCase();
        const top = stack[stack.length - 1];
        if (!top || top.tag !== name) {
          return {
            ok: false,
            error: `Лишний или неправильно вложенный закрывающий тег </${name}>`,
          };
        }
        flush();
        stack.pop();
        out += `</${name}>`;
        i = end + 1;
        continue;
      }
      const opening = /^([a-z-]+)(?:\s+(.*))?$/is.exec(raw);
      if (!opening) return { ok: false, error: `Непонятный тег <${raw}>` };
      const name = opening[1]!.toLowerCase();
      const attrs = (opening[2] ?? '').trim();
      let node: Extract<TelegramHtmlNode, { type: 'tag' }>;
      if (name === 'a') {
        const hrefMatch =
          /^href\s*=\s*"([^"]*)"$/i.exec(attrs) ?? /^href\s*=\s*'([^']*)'$/i.exec(attrs);
        const href = hrefMatch ? safeHref(hrefMatch[1]!) : null;
        if (!href) {
          return { ok: false, error: 'У ссылки нужен адрес вида <a href="https://…">' };
        }
        node = { type: 'tag', tag: 'a', href, children: [] };
        out += `<a href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
      } else if (SIMPLE_TAGS.has(name) && attrs === '') {
        node = { type: 'tag', tag: name, children: [] };
        out += `<${name}>`;
      } else if (name === 'span' && /^class\s*=\s*["']tg-spoiler["']$/i.test(attrs)) {
        node = { type: 'tag', tag: 'tg-spoiler', children: [] };
        out += '<tg-spoiler>';
        flush();
        children().push(node);
        stack.push({ tag: 'span', node });
        i = end + 1;
        continue;
      } else {
        return {
          ok: false,
          error: `Тег <${name}> Telegram не поддерживает. Можно: <b>, <i>, <u>, <s>, <a href>, <code>, <pre>, <blockquote>, <tg-spoiler>`,
        };
      }
      flush();
      children().push(node);
      stack.push({ tag: name, node });
      i = end + 1;
      continue;
    }
    out += ch;
    text += ch;
    visible++;
    i++;
  }
  if (stack.length) {
    return { ok: false, error: `Тег <${stack[stack.length - 1]!.tag}> не закрыт` };
  }
  flush();
  // Telegram closes a `<span class="tg-spoiler">` as </span>; normalised above to tg-spoiler.
  out = out.replace(/<\/span>/g, '</tg-spoiler>');
  return { ok: true, html: out, nodes: root, visibleLength: visible };
}

export type BroadcastMediaMode = 'caption' | 'separate';

/** What one recipient gets, in order. */
export type BroadcastPart =
  | { kind: 'text' }
  | { kind: 'photo'; withCaption: boolean }
  | { kind: 'album'; withCaption: boolean };

export type BroadcastPlan = { ok: true; parts: BroadcastPart[] } | { ok: false; error: string };

/**
 * Decides the messages for a broadcast: text only; one image (+ caption);
 * an album (+ caption on the first image); or images, then the text as its
 * own message (`separate`, or a text too long for a caption).
 */
export function planBroadcast(
  visibleLength: number,
  images: number,
  mode: BroadcastMediaMode,
): BroadcastPlan {
  if (images > BROADCAST_MAX_IMAGES) {
    return { ok: false, error: `Не больше ${BROADCAST_MAX_IMAGES} изображений` };
  }
  if (visibleLength === 0 && images === 0) return { ok: false, error: 'Сообщение пустое' };
  if (visibleLength > TELEGRAM_TEXT_MAX) {
    return { ok: false, error: `Текст длиннее ${TELEGRAM_TEXT_MAX} символов` };
  }
  const media: BroadcastPart['kind'] | null =
    images === 0 ? null : images === 1 ? 'photo' : 'album';
  if (!media) return { ok: true, parts: [{ kind: 'text' }] };
  if (visibleLength === 0) return { ok: true, parts: [{ kind: media, withCaption: false }] };
  if (mode === 'caption') {
    if (visibleLength > TELEGRAM_CAPTION_MAX) {
      return {
        ok: false,
        error: `Подпись к изображению — до ${TELEGRAM_CAPTION_MAX} символов. Сократите текст или выберите «Текст отдельным сообщением».`,
      };
    }
    return { ok: true, parts: [{ kind: media, withCaption: true }] };
  }
  return { ok: true, parts: [{ kind: media, withCaption: false }, { kind: 'text' }] };
}
