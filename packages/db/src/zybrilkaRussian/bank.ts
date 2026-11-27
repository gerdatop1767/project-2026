import { ZR_COLLECTION_SLUG } from './collection.js';
import { TASK4 } from './data/task04.js';
import { TASK5 } from './data/task05.js';
import { TASK6 } from './data/task06.js';
import { TASK7 } from './data/task07.js';
import { TASK8 } from './data/task08.js';
import { TASK9 } from './data/task09.js';
import { TASK11 } from './data/task11.js';
import { TASK12 } from './data/task12.js';
import { TASK13 } from './data/task13.js';
import { TASK14 } from './data/task14.js';
import { TASK15 } from './data/task15.js';
import { TASK16 } from './data/task16.js';
import { TASK17 } from './data/task17.js';
import { TASK18 } from './data/task18.js';
import { TASK19 } from './data/task19.js';
import { TASK20 } from './data/task20.js';
import { TASK21 } from './data/task21.js';
import { TASK22 } from './data/task22.js';
import type { BankNumber } from './types.js';

/**
 * Every number of Зубрилка's Russian bank 4–22 (№10 lives separately in
 * importZybrilkaRussian10.ts and is never touched here). A number is
 * added as its data module grows batch by batch; the importer publishes
 * only complete (100-task) numbers unless asked otherwise.
 */
export const BANK_NUMBERS: readonly BankNumber[] = [
  TASK4,
  TASK5,
  TASK6,
  TASK7,
  TASK8,
  TASK9,
  TASK11,
  TASK12,
  TASK13,
  TASK14,
  TASK15,
  TASK16,
  TASK17,
  TASK18,
  TASK19,
  TASK20,
  TASK21,
  TASK22,
];

export const bankSource = (taskNumber: number) =>
  `Зубрилка. Авторские задания ЕГЭ по русскому языку, №${taskNumber}`;
/** All numbers share one collection (zybrilkaRussian/collection.ts); kept for callers. */
export const bankCollectionSlug = (_taskNumber: number) => ZR_COLLECTION_SLUG;
export const BANK_TAG = 'zybrilka-russian-bank';
export const BANK_YEAR = 2027;
export const BANK_SET_SIZE = 10;
