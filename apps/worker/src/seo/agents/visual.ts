import { randomBytes } from 'node:crypto';
import { loadSeoSettings, schema } from '@zybrilka/db';
import { escapeHtml, renderMarkdown } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { SeoDeps } from '../deps.js';
import { PermanentError, type TaskHandler } from '../queue.js';

/**
 * Visual Agent (docs/SEO_CENTER.md §10): only ORIGINAL images — SVG cover,
 * infographic built from the article's own content, and an optional meme
 * card (our own caption on a brand template). Nothing is downloaded from
 * other sites, so there is no copyright question. SVG keeps files tiny
 * (a few KB), scales to any screen, and the text is real text.
 */

const PALETTES = [
  {
    bg1: '#05070f',
    bg2: '#161b3f',
    accent: '#2b8ff0',
    accent2: '#5ab8fd',
    text: '#f5f7fa',
    muted: '#9aa6bf',
  },
  {
    bg1: '#0d1226',
    bg2: '#1f2a5c',
    accent: '#22c55e',
    accent2: '#8fd3ff',
    text: '#f5f7fa',
    muted: '#9aa6bf',
  },
  {
    bg1: '#140b2e',
    bg2: '#2a1650',
    accent: '#f5a623',
    accent2: '#ef5a9a',
    text: '#f5f7fa',
    muted: '#c9c3e0',
  },
];

/** Greedy word wrap by an average glyph width (good enough for Inter/system sans). */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1]!.replace(/[.,:;!?]?$/, '')}…`;
    return cut;
  }
  return lines;
}

const FONT = `font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif"`;

function tspans(lines: string[], x: number, y: number, size: number, lh = 1.2) {
  return lines
    .map((l, i) => `<tspan x="${x}" y="${y + i * size * lh}">${escapeHtml(l)}</tspan>`)
    .join('');
}

export function coverSvg(o: { title: string; kicker: string; palette: number }): string {
  const p = PALETTES[o.palette % PALETTES.length]!;
  const lines = wrap(o.title, 26, 4);
  const size = lines.length > 3 ? 58 : 66;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeHtml(o.title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg1}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>
<linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent2}"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/>
<circle cx="1080" cy="110" r="220" fill="${p.accent}" opacity=".12"/><circle cx="1140" cy="560" r="160" fill="${p.accent2}" opacity=".10"/>
<rect x="72" y="72" width="${Math.min(560, 24 + o.kicker.length * 15)}" height="48" rx="24" fill="url(#a)"/>
<text x="96" y="104" ${FONT} font-size="24" font-weight="700" fill="#04162c">${escapeHtml(o.kicker)}</text>
<text ${FONT} font-size="${size}" font-weight="800" fill="${p.text}">${tspans(lines, 72, 210, size, 1.15)}</text>
<text x="72" y="566" ${FONT} font-size="30" font-weight="800" fill="${p.text}">Зубрилка</text>
<text x="232" y="566" ${FONT} font-size="24" fill="${p.muted}">бесплатный тренажёр ЕГЭ · zybrilka.ru</text>
</svg>`;
}

export function infographicSvg(o: {
  title: string;
  items: { label: string; text: string }[];
  palette: number;
}): string {
  const p = PALETTES[o.palette % PALETTES.length]!;
  const items = o.items.slice(0, 6);
  const rowH = 168;
  const height = 170 + items.length * rowH + 40;
  const titleLines = wrap(o.title, 34, 2);
  const rows = items
    .map((it, i) => {
      const y = 170 + i * rowH;
      const textLines = wrap(it.text, 44, 2);
      return `<g><rect x="48" y="${y}" width="1104" height="${rowH - 20}" rx="22" fill="${p.text}" opacity=".06"/>
<circle cx="112" cy="${y + 70}" r="40" fill="url(#a)"/><text x="112" y="${y + 82}" text-anchor="middle" ${FONT} font-size="34" font-weight="800" fill="#04162c">${i + 1}</text>
<text x="180" y="${y + 54}" ${FONT} font-size="38" font-weight="700" fill="${p.text}">${escapeHtml(wrap(it.label, 40, 1)[0] ?? '')}</text>
<text ${FONT} font-size="32" fill="${p.muted}">${tspans(textLines, 180, y + 98, 32, 1.2)}</text></g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-label="${escapeHtml(o.title)}">
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent2}"/></linearGradient></defs>
<rect width="1200" height="${height}" rx="32" fill="${p.bg1}"/>
<text ${FONT} font-size="52" font-weight="800" fill="${p.text}">${tspans(titleLines, 48, 90, 52, 1.15)}</text>
${rows}
<text x="1152" y="${height - 18}" text-anchor="end" ${FONT} font-size="20" fill="${p.muted}">zybrilka.ru</text>
</svg>`;
}

export function memeSvg(o: { top: string; bottom: string; palette: number }): string {
  const p = PALETTES[o.palette % PALETTES.length]!;
  const top = wrap(o.top.toUpperCase(), 28, 3);
  const bottom = wrap(o.bottom.toUpperCase(), 28, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="${escapeHtml(`${o.top} — ${o.bottom}`)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg2}"/><stop offset="1" stop-color="${p.bg1}"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/>
<rect x="60" y="300" width="960" height="480" rx="40" fill="${p.text}" opacity=".05"/>
<text x="540" y="580" text-anchor="middle" ${FONT} font-size="200">🦬</text>
<text text-anchor="middle" ${FONT} font-size="62" font-weight="900" fill="${p.text}" stroke="#000" stroke-width="2" paint-order="stroke">${tspans(top, 540, 130, 62, 1.15)}</text>
<text text-anchor="middle" ${FONT} font-size="62" font-weight="900" fill="${p.accent2}" stroke="#000" stroke-width="2" paint-order="stroke">${tspans(bottom, 540, 880, 62, 1.15)}</text>
<text x="1040" y="1050" text-anchor="end" ${FONT} font-size="24" fill="${p.muted}">zybrilka.ru</text>
</svg>`;
}

const visualPlanSchema = z.object({
  coverKicker: z.string().min(3).max(32),
  coverAlt: z.string().min(10).max(200),
  infographic: z
    .object({
      title: z.string().min(5).max(90),
      alt: z.string().min(10).max(250),
      afterHeading: z.string().max(200),
      items: z
        .array(z.object({ label: z.string().min(2).max(50), text: z.string().min(5).max(120) }))
        .min(3)
        .max(6),
    })
    .nullable(),
  meme: z
    .object({
      top: z.string().min(3).max(80),
      bottom: z.string().min(3).max(80),
      alt: z.string().min(10).max(200),
      afterHeading: z.string().max(200),
    })
    .nullable(),
});

/** Inserts `![alt](media:id)` right after the given H2 section's first paragraph (or at the end). */
export function insertImage(bodyMd: string, heading: string, alt: string, id: string): string {
  const tag = `![${alt.replace(/[[\]]/g, '')}](media:${id})`;
  if (bodyMd.includes(`media:${id}`)) return bodyMd;
  const lines = bodyMd.split('\n');
  const h = lines.findIndex(
    (l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim() === heading.trim(),
  );
  if (h === -1) return `${bodyMd.trimEnd()}\n\n${tag}\n`;
  let i = h + 1;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  while (i < lines.length && lines[i]!.trim() !== '' && !/^#/.test(lines[i]!)) i++;
  lines.splice(i, 0, '', tag);
  return lines.join('\n');
}

export function visualsHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const articleId = (ctx.task.payload as { articleId: string }).articleId;
    const [a] = await db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, articleId));
    if (!a) throw new PermanentError('article not found');
    if (settings.maxImagesPerArticle === 0) return { skipped: 'images disabled' };
    const headings = renderMarkdown(a.bodyMd)
      .headings.filter((h) => h.level === 2)
      .map((h) => h.text);

    const { data } = await ai.json(
      {
        agent: 'visual',
        purpose: 'visuals.plan',
        taskId: ctx.task.id,
        tier: 'cheap',
        effort: 'low',
        maxTokens: 2500,
        system: `Ты — визуальный редактор блога о ЕГЭ. Предлагаешь инфографику ТОЛЬКО из содержания статьи (не придумывай факты и цифры) и, если уместно, мем-подпись для школьников: добрую, без оскорблений учителей и учеников, без чужих мемных персонажей и брендов. Если мем неуместен (серьёзная тема, правила, даты) — meme: null.`,
        prompt: `Статья «${a.title}». Разделы: ${headings.join(' | ')}

${a.bodyMd.slice(0, 14_000)}

Верни: короткую плашку для обложки (2–3 слова, например «Разбор задания»), alt обложки, инфографику (3–6 пунктов: шаги, правила или сравнение из статьи; afterHeading — точный заголовок раздела, после которого её поставить) и мем или null.`,
      },
      visualPlanSchema,
    );

    const palette = Number.parseInt(a.id.slice(0, 2), 16) % PALETTES.length;
    const save = async (
      kind: string,
      svg: string,
      alt: string,
      description: string,
      width: number,
      height: number,
    ) => {
      const fileName = `${a.slug.slice(0, 60)}-${kind}-${randomBytes(3).toString('hex')}.svg`;
      const bytes = Buffer.from(svg.replace(/\n/g, ''), 'utf8');
      const [m] = await db
        .insert(schema.seoMedia)
        .values({
          articleId: a.id,
          kind,
          fileName,
          mimeType: 'image/svg+xml',
          bytes,
          sizeBytes: bytes.length,
          width,
          height,
          alt,
          description,
          origin: 'generated',
          license: 'Оригинальное изображение Зубрилки',
        })
        .returning({ id: schema.seoMedia.id });
      return m!.id;
    };

    // A live article's body is not rewritten silently: only its cover is refreshed.
    const live = a.status === 'published' || a.status === 'needs_update';
    if (!live) {
      // Replace earlier generated images (a re-run must not pile them up).
      await db
        .delete(schema.seoMedia)
        .where(and(eq(schema.seoMedia.articleId, a.id), eq(schema.seoMedia.origin, 'generated')));
    }
    let body = a.bodyMd;
    let made = 0;
    const coverId = await save(
      'cover',
      coverSvg({ title: a.h1 ?? a.title, kicker: data.coverKicker, palette }),
      data.coverAlt,
      `Обложка статьи «${a.title}»`,
      1200,
      630,
    );
    made++;
    if (!live && data.infographic && made < settings.maxImagesPerArticle) {
      const svg = infographicSvg({
        title: data.infographic.title,
        items: data.infographic.items,
        palette,
      });
      const h = Number(/height="(\d+)"/.exec(svg)![1]);
      const id = await save(
        'infographic',
        svg,
        data.infographic.alt,
        data.infographic.title,
        1200,
        h,
      );
      body = insertImage(body, data.infographic.afterHeading, data.infographic.alt, id);
      made++;
    }
    if (!live && data.meme && made < settings.maxImagesPerArticle) {
      const id = await save(
        'meme',
        memeSvg({ top: data.meme.top, bottom: data.meme.bottom, palette }),
        data.meme.alt,
        'Мем Зубрилки',
        1080,
        1080,
      );
      body = insertImage(body, data.meme.afterHeading, data.meme.alt, id);
      made++;
    }
    // Drop references to media that no longer exist (previous generated set).
    const existing = new Set(
      (
        await db
          .select({ id: schema.seoMedia.id })
          .from(schema.seoMedia)
          .where(eq(schema.seoMedia.articleId, a.id))
      ).map((m) => m.id),
    );
    body = body.replace(/\n?!\[[^\]]*\]\(media:([0-9a-f-]{36})\)/g, (m, id: string) =>
      existing.has(id) ? m : '',
    );

    await db
      .update(schema.seoArticles)
      .set({ coverMediaId: coverId, ...(live ? {} : { bodyMd: body }), updatedAt: deps.now() })
      .where(eq(schema.seoArticles.id, a.id));
    await ctx.log(
      'visuals.done',
      `Изображений: ${made} (обложка${data.infographic ? ', инфографика' : ''}${data.meme ? ', мем' : ''})`,
      { articleId: a.id },
    );
    return { images: made };
  };
}
