/**
 * A small, safe Markdown → HTML renderer for SEO articles (server-side
 * rendered by the API, previewed in the admin). Everything is escaped;
 * only a fixed subset becomes markup:
 *   ## / ### headings (with ids for the table of contents), paragraphs,
 *   **bold**, *italic*, `code`, [text](https://… or /path), ![alt](media:<id>),
 *   - / 1. lists, | tables |, > quotes, > [!tip|warning|example] callouts, ---.
 * Raw HTML in the source is shown as text, never executed. Images may only
 * reference the article's own media (`media:<id>`): no hotlinking of other
 * sites' pictures (copyright), no javascript:/data: URLs.
 */

export interface MdImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface MdOptions {
  /** Resolves `media:<id>`; null → the image is dropped. */
  resolveImage?: (id: string) => MdImage | null;
  /** Rewrites internal links (e.g. app pages → tracked campaign link). */
  rewriteLink?: (href: string) => string;
  /** Host treated as internal (no rel=noopener/nofollow), e.g. zybrilka.ru. */
  siteHost?: string;
}

export interface MdHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

export interface MdResult {
  html: string;
  headings: MdHeading[];
  text: string;
  wordCount: number;
  imageIds: string[];
  links: string[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RU_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
function anchorId(text: string): string {
  const id = [...text.toLowerCase()]
    .map((c) => RU_LAT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return id || 'section';
}

/** Only http(s) absolute URLs and site-relative paths survive. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(h)) return h;
  if (/^#[\w-]+$/.test(h)) return h;
  try {
    const u = new URL(h);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
  } catch {
    // not a URL
  }
  return null;
}

interface Ctx {
  opts: MdOptions;
  imageIds: string[];
  links: string[];
}

function inline(src: string, ctx: Ctx): string {
  // Tokenise code spans first so their content is never formatted.
  const out: string[] = [];
  const re = /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(emphasis(escapeHtml(src.slice(last, m.index))));
    if (m[1] !== undefined) {
      out.push(`<code>${escapeHtml(m[1])}</code>`);
    } else if (m[3] !== undefined) {
      out.push(image(m[2] ?? '', m[3], ctx));
    } else {
      out.push(link(m[4]!, m[5]!, ctx));
    }
    last = re.lastIndex;
  }
  out.push(emphasis(escapeHtml(src.slice(last))));
  return out.join('');
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
}

function image(alt: string, ref: string, ctx: Ctx): string {
  const id = ref.startsWith('media:') ? ref.slice(6) : null;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return '';
  const img = ctx.opts.resolveImage?.(id);
  if (!img) return '';
  ctx.imageIds.push(id);
  const size = img.width && img.height ? ` width="${img.width}" height="${img.height}"` : '';
  const caption = img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : '';
  return `<figure><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || alt)}"${size} loading="lazy" decoding="async">${caption}</figure>`;
}

function link(text: string, href: string, ctx: Ctx): string {
  let target = safeHref(href);
  if (!target) return emphasis(escapeHtml(text));
  if (ctx.opts.rewriteLink) target = ctx.opts.rewriteLink(target);
  ctx.links.push(target);
  let external = false;
  try {
    const u = new URL(target);
    external = !ctx.opts.siteHost || u.host !== ctx.opts.siteHost;
  } catch {
    external = false;
  }
  const rel = external ? ' rel="noopener" target="_blank"' : '';
  return `<a href="${escapeHtml(target)}"${rel}>${emphasis(escapeHtml(text))}</a>`;
}

const CALLOUTS: Record<string, string> = {
  tip: 'Совет',
  warning: 'Внимание',
  example: 'Пример',
  remember: 'Запомни',
  mistake: 'Частая ошибка',
};

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function renderMarkdown(source: string, opts: MdOptions = {}): MdResult {
  const ctx: Ctx = { opts, imageIds: [], links: [] };
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  const headings: MdHeading[] = [];
  const usedIds = new Set<string>();
  const textParts: string[] = [];
  let i = 0;

  const para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const t = para.join(' ');
      textParts.push(t);
      html.push(`<p>${inline(t, ctx)}</p>`);
      para.length = 0;
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      flushPara();
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.+?)\s*#*$/.exec(trimmed);
    if (h) {
      flushPara();
      const level: 2 | 3 = h[1]!.length <= 2 ? 2 : 3;
      const text = h[2]!;
      let id = anchorId(text);
      for (let n = 2; usedIds.has(id); n++) id = `${anchorId(text)}-${n}`;
      usedIds.add(id);
      headings.push({ level, text, id });
      textParts.push(text);
      html.push(`<h${level} id="${id}">${inline(text, ctx)}</h${level}>`);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      html.push('<hr>');
      i++;
      continue;
    }
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|?\s*:?-{2,}/.test(lines[i + 1]!.trim())
    ) {
      flushPara();
      const head = splitRow(trimmed);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        body.push(splitRow(lines[i]!));
        i++;
      }
      textParts.push(head.join(' '), ...body.map((r) => r.join(' ')));
      html.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>${body
          .map(
            (r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? '', ctx)}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      const callout = /^\[!(\w+)\]\s*(.*)$/.exec(quote[0] ?? '');
      if (callout && CALLOUTS[callout[1]!.toLowerCase()]) {
        const kind = callout[1]!.toLowerCase();
        const rest = [callout[2] ?? '', ...quote.slice(1)].join(' ').trim();
        textParts.push(rest);
        html.push(
          `<aside class="callout callout-${kind}"><strong>${CALLOUTS[kind]}</strong><p>${inline(rest, ctx)}</p></aside>`,
        );
      } else {
        const t = quote.join(' ');
        textParts.push(t);
        html.push(`<blockquote><p>${inline(t, ctx)}</p></blockquote>`);
      }
      continue;
    }
    const ul = /^[-*+]\s+(.+)$/;
    const ol = /^\d+[.)]\s+(.+)$/;
    if (ul.test(trimmed) || ol.test(trimmed)) {
      flushPara();
      const ordered = ol.test(trimmed);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!.trim())) {
        items.push(re.exec(lines[i]!.trim())![1]!);
        i++;
      }
      textParts.push(...items);
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((it) => `<li>${inline(it, ctx)}</li>`).join('')}</${tag}>`);
      continue;
    }
    para.push(trimmed);
    i++;
  }
  flushPara();

  const text = textParts
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '');
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    html: html.join('\n'),
    headings,
    text,
    wordCount,
    imageIds: ctx.imageIds,
    links: ctx.links,
  };
}
