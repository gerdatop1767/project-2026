import { TASK4 } from './data/task04.js';
import { TASK5 } from './data/task05.js';
import { TASK6 } from './data/task06.js';
import { TASK7 } from './data/task07.js';
import { TASK9 } from './data/task09.js';
import { TASK11 } from './data/task11.js';
import { TASK12 } from './data/task12.js';
import { TASK13 } from './data/task13.js';
import { TASK14 } from './data/task14.js';
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
  TASK9,
  TASK11,
  TASK12,
  TASK13,
  TASK14,
];

export const bankSource = (taskNumber: number) =>
  `Зубрилка. Авторские задания ЕГЭ по русскому языку, №${taskNumber}`;
export const bankCollectionSlug = (taskNumber: number) => `zybrilka-russian-${taskNumber}`;
export const bankCollectionTitle = (taskNumber: number) =>
  `Зубрилка — авторские задания по русскому языку, №${taskNumber}`;
export const BANK_TAG = 'zybrilka-russian-bank';
export const BANK_YEAR = 2027;
export const BANK_SET_SIZE = 10;
