/**
 * The approved subject artwork. The FILE NAME is the source of truth for
 * which subject a picture belongs to (01_Mathematics.png → Математика, …);
 * this table is the only place that connects those names to the app's
 * subject ids. Files live in `public/branding/v2/subject-icons/` (512 px
 * copies of the approved 1254 px originals — see docs/SUBJECT_ICONS.md).
 */
export const SUBJECT_ICON_FILES = {
  math: '01_Mathematics.png',
  russian: '02_Russian_Language.png',
  english: '03_English_Language.png',
  social: '04_Social_Studies.png',
  informatics: '05_Informatics.png',
  physics: '06_Physics.png',
  chemistry: '07_Chemistry.png',
  biology: '08_Biology.png',
  history: '09_History.png',
} as const;

export type SubjectIconId = keyof typeof SUBJECT_ICON_FILES;

export function isSubjectIconId(id: string): id is SubjectIconId {
  return Object.hasOwn(SUBJECT_ICON_FILES, id);
}

export function subjectIconSrc(id: SubjectIconId): string {
  return `/branding/v2/subject-icons/${SUBJECT_ICON_FILES[id]}`;
}

/**
 * Responsive sources for the same artwork: 128/256 px WebP copies
 * (`sized/`, ~6–30 KB) next to the 512 px PNG (~270–450 KB). Most icons are
 * drawn at 40–56 px, so a phone downloads and decodes a 128/256 px copy
 * instead of a half-megabyte PNG — about 1/30 of the bytes and 1/16 of
 * the decoded bitmap memory per icon. The PNG stays the fallback.
 */
export function subjectIconSrcSet(id: SubjectIconId): string {
  const base = SUBJECT_ICON_FILES[id].replace(/\.png$/, '');
  return [
    `/branding/v2/subject-icons/sized/${base}-128.webp 128w`,
    `/branding/v2/subject-icons/sized/${base}-256.webp 256w`,
    `${subjectIconSrc(id)} 512w`,
  ].join(', ');
}

/** Each icon's own neon colour, used only for the glow / selected outline. */
export const SUBJECT_ICON_GLOW: Record<SubjectIconId, string> = {
  math: '#2ee6a6',
  russian: '#5b6bff',
  english: '#b45cff',
  social: '#ffa530',
  informatics: '#ff4560',
  physics: '#4aa0ff',
  chemistry: '#b052ff',
  biology: '#3ee060',
  history: '#ff4a3a',
};
