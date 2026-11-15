import { loadTheoryMaterial } from '../theory/russianTheory.js';
import type { LibraryItem } from './libraryData.js';

export * from './libraryData.js';

const loaders = import.meta.glob<string>('../../content/library/*.md', {
  query: '?raw',
  import: 'default',
});

/** Loads an item's Markdown — its own file, or the theory file it reuses. */
export async function loadLibraryText(item: LibraryItem): Promise<string> {
  if (item.theoryFile) return loadTheoryMaterial(item.theoryFile);
  const load = loaders[`../../content/library/${item.id}.md`];
  if (!load) throw new Error(`library text not found: ${item.id}`);
  return load();
}

/** Every library file on disk — for the integrity test. */
export function libraryFiles(): string[] {
  return Object.keys(loaders).map((path) => path.replace(/^.*\/(.+)\.md$/, '$1'));
}
