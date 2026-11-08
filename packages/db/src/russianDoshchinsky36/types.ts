/**
 * Data format for «ЕГЭ. Русский язык: типовые экзаменационные варианты:
 * 36 вариантов» (под ред. Р. А. Дощинского, «Национальное образование»,
 * 2027). One generated module per variant (`variantNN.ts`), read by
 * `importRussianDoshchinsky2027Book36.ts`. The format is shared with the
 * other printed Russian books (`../russianBook/types.ts`).
 */
export type {
  RussianBookPassage as R36Passage,
  RussianBookMultiPartCell as R36MultiPartCell,
  RussianBookTask as R36Task,
  RussianBookVariant as R36Variant,
} from '../russianBook/types.js';
