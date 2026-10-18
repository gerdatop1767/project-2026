import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * jsdom has no layout, so these pin the CSS contract that stopped subject
 * names from breaking inside words ("Математ-ика") and was verified in a real
 * browser at 320/360/390/768 px: wide display font + too little room for the
 * longest word («Обществознание», ~11.4 em).
 */
const css = readFileSync(resolve(__dirname, 'HomeMobile.module.css'), 'utf-8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
};

describe('Home subject cards — names never split inside a word', () => {
  it('the name does not break inside words (overrides the global break-word)', () => {
    const name = rule('.subjectCardText .subjectName');
    expect(name).toContain('overflow-wrap: normal');
    expect(name).toContain('word-break: normal');
  });

  it('the name is sized from the card width so the longest word fits, never above 14px', () => {
    const name = rule('.subjectCardText .subjectName');
    expect(name).toMatch(/font-size:\s*min\(var\(--font-size-body-sm\),\s*calc\(\(100cqw/);
    expect(name).toMatch(/font-size:\s*0\.75rem/); // fallback where container units are unsupported
    expect(rule('.subjectCard')).toContain('container-type: inline-size');
  });

  it('keeps two columns while a card can be at least 9.75rem wide, else one column', () => {
    const grid = rule('.subjectGrid');
    expect(grid).toContain('auto-fit');
    expect(grid).toContain('9.75rem');
  });

  it('narrow cards stack icon/name; wide cards switch to the row layout', () => {
    expect(rule('.subjectCardInner')).toContain("'text text'");
    expect(css).toMatch(/@container \(min-width: 15rem\)[\s\S]*'thumb text chevron'/);
  });
});

describe('BottomNav on tablet widths', () => {
  it('has no left-rail variant (the mobile shell is a phone-width column up to 1023px)', () => {
    const nav = readFileSync(
      resolve(__dirname, '../../ui/BottomNav/BottomNav.module.css'),
      'utf-8',
    );
    expect(nav).not.toMatch(/@media\s*\(min-width:\s*768px\)/);
    expect(nav).not.toContain('100vh');
  });
});
