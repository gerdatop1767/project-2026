import { describe, expect, it } from 'vitest';
import { parseEmphasis, parseHeading } from './emphasis.js';

describe('parseEmphasis', () => {
  it('splits **bold** into a bold token', () => {
    expect(parseEmphasis('в тексте выделено **СТАРЫЙ**')).toEqual([
      { type: 'text', value: 'в тексте выделено ' },
      { type: 'bold', value: 'СТАРЫЙ' },
    ]);
  });

  it('splits *italic* into an italic token, never confused with **bold**', () => {
    expect(parseEmphasis('*Старый пропуск.*')).toEqual([
      { type: 'italic', value: 'Старый пропуск.' },
    ]);
  });

  it('handles multiple bold spans in one line', () => {
    const tokens = parseEmphasis('А) **живые** и **занимательные**');
    expect(tokens).toEqual([
      { type: 'text', value: 'А) ' },
      { type: 'bold', value: 'живые' },
      { type: 'text', value: ' и ' },
      { type: 'bold', value: 'занимательные' },
    ]);
  });

  it('returns a single text token when there is no emphasis markup', () => {
    expect(parseEmphasis('Обычный текст без выделений.')).toEqual([
      { type: 'text', value: 'Обычный текст без выделений.' },
    ]);
  });

  it('returns an empty array for an empty line', () => {
    expect(parseEmphasis('')).toEqual([]);
  });

  it('a single stray asterisk (odd count, no closing partner) is left as plain text, never dropped or misread', () => {
    expect(parseEmphasis('Смотри сноску * внизу страницы.')).toEqual([
      { type: 'text', value: 'Смотри сноску * внизу страницы.' },
    ]);
  });

  it('KNOWN LIMITATION: two non-markdown asterisks in one line (e.g. "*" used as a multiplication sign in plain prose, outside $...$) are misread as an *italic* span — verified not to occur in any current imported task content (no Russian or math conditionMd/explanationMd uses a literal "*" outside $...$ for anything), but documented here so a future import introducing this pattern fails this test instead of silently mis-rendering', () => {
    expect(parseEmphasis('2 * 3 * 4 = 24')).toEqual([
      { type: 'text', value: '2 ' },
      { type: 'italic', value: ' 3 ' },
      { type: 'text', value: ' 4 = 24' },
    ]);
  });

  // ЕГЭ-2027 content marks notes with underscores; they rendered as raw «_…_».
  it('splits _italic_ (underscores at word boundaries) into an italic token', () => {
    expect(parseEmphasis('_Разбор подготовлен редакцией Зубрилки._')).toEqual([
      { type: 'italic', value: 'Разбор подготовлен редакцией Зубрилки.' },
    ]);
    expect(parseEmphasis('Ответ: 3. _В ответ запишите б)._')).toEqual([
      { type: 'text', value: 'Ответ: 3. ' },
      { type: 'italic', value: 'В ответ запишите б).' },
    ]);
  });

  it('leaves underscores inside words and lone underscores as plain text', () => {
    expect(parseEmphasis('точка A_1 и B_1')).toEqual([{ type: 'text', value: 'точка A_1 и B_1' }]);
    expect(parseEmphasis('snake_case_name')).toEqual([{ type: 'text', value: 'snake_case_name' }]);
    expect(parseEmphasis('пропуск _ внизу')).toEqual([{ type: 'text', value: 'пропуск _ внизу' }]);
    expect(parseEmphasis('_ не курсив _')).toEqual([{ type: 'text', value: '_ не курсив _' }]);
  });
});

describe('parseHeading', () => {
  it('reads a markdown heading line', () => {
    expect(parseHeading('### а)')).toBe('а)');
    expect(parseHeading('## Шаг 1')).toBe('Шаг 1');
    expect(parseHeading('# А')).toBe('А');
  });

  it('is not fooled by a # that is not a heading', () => {
    expect(parseHeading('#5 в рейтинге')).toBeNull();
    expect(parseHeading('Ответ: 3')).toBeNull();
    expect(parseHeading('###')).toBeNull();
    expect(parseHeading(' ### а)')).toBeNull();
  });
});
