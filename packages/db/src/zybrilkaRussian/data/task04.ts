import { isVowel, parseStressEntry, type ParsedStressEntry } from '@zybrilka/shared';
import { STRESS_ENTRIES } from '../../stressDictionary/data.js';
import {
  digitsOf,
  rng,
  shuffle,
  type BankNumber,
  type BankTask,
  type Difficulty,
} from '../types.js';

/**
 * Task 4 (ударение), generated from FIPI's «Орфоэпический список – 2026»
 * (stressDictionary/data.ts — the official list, one to one). A correct
 * option is the dictionary's own marking; a wrong one marks another vowel
 * of the same form, and only for words with a single accepted stress — a
 * word with a known variant pronunciation or a homograph (зАнятый/занятОй,
 * Отзыв/отзЫв) appears only correctly marked. Deterministic (fixed seed).
 */
export const TASK4_INSTRUCTION =
  'Укажите варианты ответов, в которых верно выделена буква, обозначающая ударный гласный звук. Запишите номера ответов.';

/** Never marked wrongly: a variant stress is also accepted somewhere, or a homograph. */
const ONLY_CORRECT = new Set([
  'ловка',
  'заперла',
  'проживший',
  'наживший',
  'наливший',
  'занятый',
  'занята',
  'нанявшийся',
  'прибыла',
]);
/** Left out completely: the same letters carry two stresses by meaning. */
const EXCLUDED = new Set(['отзыв']);

const NOTES: Record<string, string> = {
  аэропорты: 'во множественном числе ударение остаётся на корне, как в «аэропОрт»',
  банты: 'во множественном числе ударение остаётся на корне: бАнт — бАнты',
  торты: 'во множественном числе ударение остаётся на корне: тОрт — тОрты',
  шарфы: 'во множественном числе ударение остаётся на корне: шАрф — шАрфы',
  краны: 'во множественном числе ударение остаётся на корне: крАн — крАны',
  иксы: 'во множественном числе ударение остаётся на корне: Икс — Иксы',
  бороду: 'в винительном падеже ударение уходит на первый слог: бОроду (но «бородА»)',
  бухгалтеров: 'во всех формах ударение на А: бухгАлтер, бухгАлтеры, бухгАлтеров',
  лекторов: 'во всех формах ударение на корне: лЕктор, лЕкторы, лЕкторов',
  конусов: 'во всех формах ударение на корне: кОнус, кОнусы, кОнусов',
  вероисповедание: 'ударение как в глаголе «исповЕдовать»',
  водопровод: 'вторая часть — «провОд», ударение на последний слог',
  газопровод: 'вторая часть — «провОд», ударение на последний слог',
  нефтепровод: 'вторая часть — «провОд», ударение на последний слог',
  гражданство: 'ударение как в слове «граждАнин»',
  дефис: 'ударение на последний слог',
  дешевизна: 'ударение на И, как в «белИзна», «новИзна»',
  диспансер: 'заимствованное слово с ударением на последний слог',
  договоренность: 'буква Ё всегда ударная: договорЁнность',
  документ: 'ударение на последний слог',
  досуг: 'ударение на последний слог',
  еретик: 'ударение на последний слог: еретИк, еретикА',
  жалюзи: 'французское слово, ударение на последний слог',
  значимость: 'ударение как в «знАчимый», «знАк»',
  каталог: 'на конце «-лОг», как в «диалОг», «монолОг»',
  некролог: 'на конце «-лОг», как в «диалОг», «каталОг»',
  квартал: 'ударение на последний слог',
  километр: 'на конце «-мЕтр», как в «сантимЕтр», «миллимЕтр»',
  корысть: 'ударение на Ы',
  кремень: 'ударение на последний слог: кремЕнь',
  кремня: 'в косвенных падежах ударение на окончании: кремнЯ, кремнЮ',
  локтя: 'в родительном падеже единственного числа ударение на корне: лОктя',
  локтей: 'в родительном падеже множественного числа ударение на окончании: локтЕй',
  ногтя: 'в родительном падеже единственного числа ударение на корне: нОгтя',
  ногтей: 'в родительном падеже множественного числа ударение на окончании: ногтЕй',
  лыжня: 'ударение на окончании',
  местностей: 'ударение на корне во всех формах, как в «мЕстность»',
  намерение: 'ударение как в «намЕреваться»',
  недруг: 'ударение на первый слог',
  недуг: 'ударение на последний слог',
  ненависть: 'ударение на первый слог',
  новостей: 'в родительном падеже множественного числа ударение на окончании: новостЕй',
  отрочество: 'ударение на первый слог',
  партер: 'заимствованное слово с ударением на последний слог',
  портфель: 'ударение на последний слог',
  приданое: 'ударение на А: придАное',
  призыв: 'ударение на корень «-зЫв-»: призЫв',
  созыв: 'ударение на корень «-зЫв-»: созЫв',
  свекла: 'буква Ё всегда ударная: свЁкла',
  сироты: 'во множественном числе ударение на О: сирОты',
  сосредоточение: 'ударение как в «сосредотОчиться»',
  средства: 'во множественном числе ударение на корне: срЕдства',
  статуя: 'ударение на первый слог',
  столяр: 'ударение на последний слог, как в «малЯр»',
  таможня: 'ударение на О',
  туфля: 'ударение на первый слог',
  цемент: 'ударение на последний слог',
  центнер: 'ударение на первый слог',
  цепочка: 'ударение на суффикс «-Очк-»',
  шофер: 'буква Ё всегда ударная: шофЁр',
  эксперт: 'ударение на последний слог',
  верна: 'в краткой форме женского рода ударение на окончании: вернА',
  ловка: 'в краткой форме женского рода ударение на окончании: ловкА',
  прозорлива: 'ударение как в полной форме «прозорлИвый»',
  красивее: 'ударение как в «красИвый»',
  красивейший: 'ударение как в «красИвый»',
  значимый: 'ударение как в «знАк», «знАчимость»',
  кухонный: 'ударение как в «кУхня»',
  мозаичный: 'ударение как в «мозаИка»',
  оптовый: 'ударение на О второго слога: оптОвый',
  прозорливый: 'ударение на И: прозорлИвый',
  сливовый: 'ударение как в «слИва»',
  клала: 'исключение: в прошедшем времени женского рода ударение остаётся на корне, как в «клАсть»',
  кралась:
    'исключение: в прошедшем времени женского рода ударение остаётся на корне, как в «крАсться»',
  послала:
    'исключение: в прошедшем времени женского рода ударение остаётся на корне, как в «послАть»',
  положил: 'ударение как в инфинитиве «положИть»',
  осведомится: 'ударение на корне, как в «освЕдомиться», «свЕдения»',
  дозировать: 'ударение на И: дозИровать — хотя в слове «дОза» ударный первый слог',
  пломбировать: 'исключение среди глаголов на «-ировать»: ударение на последний слог',
  запломбировать: 'исключение среди глаголов на «-ировать»: ударение на последний слог',
  закупорить: 'ударение на У: закУпорить, закУпорив',
  откупорить: 'ударение на У: откУпорить',
  закупорив: 'ударение как в инфинитиве «закУпорить»',
  клеить: 'ударение как в «клЕй»',
  оклеить: 'ударение как в «клЕй», «клЕить»',
  кашлянуть: 'ударение как в «кАшель»',
  черпать: 'ударение на первый слог',
  щелкать: 'буква Ё всегда ударная: щЁлкать',
  кровоточить: 'ударение на «-Ить»: кровоточИть',
  плодоносить: 'ударение на «-Ить»: плодоносИть',
  озлобить: 'ударение как в «злОба»',
  опошлить: 'ударение как в «пОшлый»',
  осведомиться: 'ударение как в «свЕдения»',
  кровоточащий: 'ударение как в «кровоточИть»: кровоточАщий',
  вовремя: 'ударение на первый слог',
  доверху: 'в наречиях с «до-» ударение на приставке: дОверху, дОнизу, дОсуха',
  донизу: 'в наречиях с «до-» ударение на приставке: дОнизу, дОверху, дОсуха',
  досуха: 'в наречиях с «до-» ударение на приставке: дОсуха, дОверху, дОнизу',
  засветло: 'ударение на приставке: зАсветло',
  надолго: 'ударение на О второго слога: надОлго',
  ненадолго: 'ударение на О третьего слога: ненадОлго',
};

function groupNote(e: ParsedStressEntry): string {
  const note = e.formNote ?? '';
  const w = e.word;
  if (e.partOfSpeech === 'гл.') {
    if (note.includes('ж. р.'))
      return 'в прошедшем времени женского рода ударение переходит на окончание «-А»: бралА, взялА, понялА';
    if (note.includes('м. р.') || note.includes('мн. ч.'))
      return 'в мужском роде и во множественном числе прошедшего времени ударение на приставке или корне: зАнял, нАчал, прИнял — но в женском роде занялА, началА, принялА';
    if (note.includes('3 л.'))
      return 'в формах на «-ит» ударение на окончании: звонИт, позвонИт, вручИт';
    if (/ить(ся)?$/.test(w) && w[e.stressIndex] === 'и')
      return 'ударение на «-Ить», и в личных формах оно остаётся на окончании';
    return 'в инфинитиве ударение на последний слог: начАть, понЯть, принЯть (но в прошедшем времени мужского рода — нАчал, прИнял)';
  }
  if (e.partOfSpeech === 'прич.') {
    if (note.includes('кр. ф.'))
      return 'в краткой форме женского рода ударение на окончании «-А»: занятА, принятА, снятА';
    if (w.includes('ённ')) return 'в причастиях на «-ённый» ударение падает на Ё суффикса';
    if (/вш/.test(w)) return 'ударение как в инфинитиве, от которого образовано причастие';
    return 'ударение на приставке: зАнятый, нАчатый, прИнятый, зАпертый, сОгнутый';
  }
  if (e.partOfSpeech === 'деепр.')
    return 'ударение в деепричастии как в инфинитиве: начАть — начАв';
  return 'запомни ударение по орфоэпическому словарю';
}

/** Lowercase form with the vowel at `index` written as a capital; ё shown as е. */
function marked(word: string, index: number): string {
  const plain = word.replace(/ё/g, 'е');
  return plain.slice(0, index) + plain[index]!.toUpperCase() + plain.slice(index + 1);
}

interface Usable {
  readonly e: ParsedStressEntry;
  readonly plain: string;
  readonly note: string;
  readonly canBeWrong: boolean;
  readonly tricky: boolean;
}

export function task4Pool(): Usable[] {
  const parsed = STRESS_ENTRIES.map(parseStressEntry).filter(
    (p): p is ParsedStressEntry => typeof p !== 'string',
  );
  const byPlain = new Map<string, ParsedStressEntry[]>();
  for (const e of parsed) {
    const plain = e.word.replace(/ё/g, 'е');
    byPlain.set(plain, [...(byPlain.get(plain) ?? []), e]);
  }
  const out: Usable[] = [];
  for (const [plain, entries] of byPlain) {
    if (EXCLUDED.has(plain)) continue;
    const stresses = new Set(entries.map((e) => e.stressIndex));
    if (stresses.size > 1) continue; // a homograph the list itself marks two ways
    const e = entries[0]!;
    const vowels = [...plain].filter(isVowel).length;
    out.push({
      e,
      plain,
      note: NOTES[plain] ?? groupNote(e),
      canBeWrong: vowels > 1 && !ONLY_CORRECT.has(plain),
      tricky: e.partOfSpeech !== 'сущ.' || (e.formNote ?? '') !== '',
    });
  }
  return out.sort((a, b) => a.plain.localeCompare(b.plain, 'ru'));
}

/** A wrong marking: the nearest other vowel (the typical mistake). */
function wrongIndex(u: Usable, rand: () => number): number {
  const vowels = [...u.plain].flatMap((ch, i) => (isVowel(ch) ? [i] : []));
  const at = u.e.stressIndex;
  const others = vowels.filter((i) => i !== at);
  const nearest = Math.min(...others.map((i) => Math.abs(i - at)));
  const near = others.filter((i) => Math.abs(i - at) === nearest);
  return near[Math.floor(rand() * near.length)]!;
}

/** Same lemma in one task makes it a comparison, not a recall: keep them apart. */
const stem = (s: string) => s.slice(0, 5);

export function buildTask4Bank(count = 50, seed = 4042027): BankTask[] {
  const rand = rng(seed);
  const pool = task4Pool();
  let queue: Usable[] = [];
  const nextWord = (taken: Usable[], wantWrong: boolean): Usable => {
    for (let attempt = 0; attempt < 500; attempt++) {
      if (queue.length === 0) queue = shuffle(pool, rand);
      const i = queue.findIndex(
        (u) =>
          (!wantWrong || u.canBeWrong) &&
          !taken.some((t) => t.plain === u.plain || stem(t.plain) === stem(u.plain)),
      );
      if (i >= 0) return queue.splice(i, 1)[0]!;
      queue = [...queue, ...shuffle(pool, rand)];
    }
    throw new Error('task 4: no word fits');
  };

  const drafts: { words: { u: Usable; shown: string; right: boolean }[]; score: number }[] = [];
  const seen = new Set<string>();
  while (drafts.length < count) {
    const rightCount = [2, 3, 3, 3, 4][Math.floor(rand() * 5)]!;
    const flags = shuffle(
      [...Array(5)].map((_, i) => i < rightCount),
      rand,
    );
    const taken: Usable[] = [];
    const words = flags.map((right) => {
      const u = nextWord(taken, !right);
      taken.push(u);
      return { u, right, shown: marked(u.e.word, right ? u.e.stressIndex : wrongIndex(u, rand)) };
    });
    const key = words
      .map((w) => w.shown)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const score = words.filter((w) => w.u.tricky).length + (rightCount === 3 ? 0 : 0.5);
    drafts.push({ words, score });
  }

  // Difficulty by real hardness: verb / participle / short and case forms
  // are the traps of task 4; the 15 easiest are «лёгкие», the 13 hardest «сложные».
  const order = drafts
    .map((d, i) => ({ i, score: d.score }))
    .sort((a, b) => a.score - b.score || a.i - b.i);
  const difficultyOf = new Map<number, Difficulty>();
  order.forEach((o, rank) =>
    difficultyOf.set(o.i, rank < count * 0.3 ? 1 : rank < count * 0.74 ? 2 : 3),
  );

  return drafts.map((d, i) => {
    const flags = d.words.map((w) => w.right);
    const digits = digitsOf(flags);
    const lines = d.words.map((w, k) => `${k + 1}) ${w.shown}`);
    const verdicts = d.words.map((w, k) => {
      const right = marked(w.u.e.word, w.u.e.stressIndex);
      const note = w.u.note.charAt(0).toUpperCase() + w.u.note.slice(1);
      return w.right
        ? `${k + 1}) ${w.shown} — выделено верно. ${note}.`
        : `${k + 1}) ${w.shown} — неверно, правильно: **${right}**. ${note}.`;
    });
    const verbs = d.words.filter((w) => w.u.e.partOfSpeech === 'гл.').length;
    const nouns = d.words.filter((w) => w.u.e.partOfSpeech === 'сущ.').length;
    const kind =
      verbs >= 3 ? 'глагольные формы' : nouns >= 3 ? 'существительные' : 'разные части речи';
    const pastForms = d.words.some((w) => (w.u.e.formNote ?? '').includes('прош. вр.'));
    return {
      taskNumber: 4,
      n: i + 1,
      difficulty: difficultyOf.get(i)!,
      kind,
      conditionMd: [TASK4_INSTRUCTION, ...lines].join('\n\n'),
      answer: { type: 'digits', digits },
      explanationMd: [
        'Все слова задания — из орфоэпического списка ФИПИ. Проверяем каждое слово: совпадает ли выделенная буква с ударной гласной.',
        ...verdicts,
        `**Обрати внимание.** ${
          pastForms
            ? 'У глаголов прошедшего времени ударение зависит от формы: зАнял, но занялА; нАчал, но началА. Проверяй именно ту форму, что дана в задании.'
            : 'Не ставь ударение «по аналогии» с похожим словом — у слов из списка ФИПИ ударение нужно помнить. Сверяйся с родственными словами, где ударение очевидно: кУхня — кУхонный, слИва — слИвовый.'
        }`,
        `Ответ: ${digits}.`,
      ].join('\n\n'),
      hintMd:
        'Произнеси каждое слово в той форме, в какой оно дано, и вспомни родственное слово или форму, где ударение слышно отчётливо.',
    } satisfies BankTask;
  });
}

export const TASK4: BankNumber = {
  taskNumber: 4,
  topicSlug: 'russian-orthoepy',
  topicName: 'Орфоэпические нормы (ударение)',
  tasks: buildTask4Bank(),
};
