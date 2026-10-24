import { describe, expect, it } from 'vitest';
import { parseTelegramHtml, planBroadcast } from './telegramHtml.js';

describe('parseTelegramHtml', () => {
  it('keeps supported formatting and line breaks, counting only visible characters', () => {
    const r = parseTelegramHtml(
      '<b>Привет</b>\n<i>мир</i> &amp; <a href="https://zybrilka.ru">сайт</a>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toBe('<b>Привет</b>\n<i>мир</i> &amp; <a href="https://zybrilka.ru">сайт</a>');
    expect(r.visibleLength).toBe('Привет\nмир & сайт'.length);
    expect(r.nodes[0]).toEqual({
      type: 'tag',
      tag: 'b',
      children: [{ type: 'text', text: 'Привет' }],
    });
    expect(r.nodes.at(-1)).toEqual({
      type: 'tag',
      tag: 'a',
      href: 'https://zybrilka.ru',
      children: [{ type: 'text', text: 'сайт' }],
    });
  });

  it('escapes a lone & and > for the author', () => {
    const r = parseTelegramHtml('5 > 3 & 2 < 4?');
    expect(r.ok).toBe(false); // a bare < is ambiguous: must be &lt;
    const ok = parseTelegramHtml('5 > 3 & 2 &lt; 4');
    expect(ok.ok && ok.html).toBe('5 &gt; 3 &amp; 2 &lt; 4');
  });

  it.each([
    ['<script>alert(1)</script>', 'не поддерживает'],
    ['<b>жирный', 'не закрыт'],
    ['<b><i>x</b></i>', 'вложенный'],
    ['<a href="javascript:alert(1)">x</a>', 'адрес'],
    ['<b onclick="x">x</b>', 'не поддерживает'],
    ['<img src=x onerror=alert(1)>', 'не поддерживает'],
  ])('rejects %s', (input, message) => {
    const r = parseTelegramHtml(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('accepts the spoiler span form', () => {
    const r = parseTelegramHtml('<span class="tg-spoiler">тайна</span>');
    expect(r.ok && r.html).toBe('<tg-spoiler>тайна</tg-spoiler>');
  });
});

describe('planBroadcast', () => {
  it('text only, one photo with caption, an album with caption, or images then text', () => {
    expect(planBroadcast(10, 0, 'caption')).toEqual({ ok: true, parts: [{ kind: 'text' }] });
    expect(planBroadcast(10, 1, 'caption')).toEqual({
      ok: true,
      parts: [{ kind: 'photo', withCaption: true }],
    });
    expect(planBroadcast(10, 3, 'caption')).toEqual({
      ok: true,
      parts: [{ kind: 'album', withCaption: true }],
    });
    expect(planBroadcast(10, 1, 'separate')).toEqual({
      ok: true,
      parts: [{ kind: 'photo', withCaption: false }, { kind: 'text' }],
    });
    expect(planBroadcast(0, 2, 'caption')).toEqual({
      ok: true,
      parts: [{ kind: 'album', withCaption: false }],
    });
  });

  it('refuses what Telegram would refuse', () => {
    expect(planBroadcast(0, 0, 'caption').ok).toBe(false);
    expect(planBroadcast(1025, 1, 'caption').ok).toBe(false);
    expect(planBroadcast(1025, 1, 'separate').ok).toBe(true);
    expect(planBroadcast(4097, 0, 'caption').ok).toBe(false);
    expect(planBroadcast(5, 11, 'caption').ok).toBe(false);
  });
});
