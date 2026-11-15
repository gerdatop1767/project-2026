/**
 * Russian-language theory: the manifest (russianTheoryData.ts) plus the
 * lazy loaders of the Markdown texts (src/content/theory/russian).
 */
export * from './russianTheoryData.js';

const loaders = import.meta.glob<string>('../../content/theory/russian/*.md', {
  query: '?raw',
  import: 'default',
});

/** Loads one material's Markdown (its own chunk — never in the main bundle). */
export async function loadTheoryMaterial(id: string): Promise<string> {
  const load = loaders[`../../content/theory/russian/${id}.md`];
  if (!load) throw new Error(`theory material not found: ${id}`);
  return load();
}

/** All material ids that have a file — for the integrity test. */
export function theoryMaterialFiles(): string[] {
  return Object.keys(loaders).map((path) => path.replace(/^.*\/(.+)\.md$/, '$1'));
}
