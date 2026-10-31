/**
 * CSV for spreadsheet apps. A cell that a spreadsheet would read as a
 * formula (= + - @, tab, CR) is prefixed with an apostrophe (CSV/formula
 * injection), every cell is quoted, and the file starts with a BOM so
 * Excel reads UTF-8 Cyrillic correctly. `;` is the separator Russian-locale
 * Excel expects.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = Array.isArray(value) ? value.join(', ') : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(
  columns: { key: string; label: string }[],
  records: Record<string, unknown>[],
) {
  const lines = [columns.map((c) => csvCell(c.label)).join(';')];
  for (const record of records) lines.push(columns.map((c) => csvCell(record[c.key])).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
