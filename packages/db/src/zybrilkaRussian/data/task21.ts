import { type BankNumber, type BankTask, type Difficulty } from '../types.js';
import { TEXTS_21_A } from './task21texts/a.js';
import { TEXTS_21_B } from './task21texts/b.js';
import { TEXTS_21_C } from './task21texts/c.js';
import { TEXTS_21_D } from './task21texts/d.js';
import { TEXTS_21_E } from './task21texts/e.js';

/**
 * Task 21 (пунктуационный анализ), in the exam's form: every task is one
 * connected text of 7–9 numbered sentences written for the project
 * (docs/imports/zybrilka-russian-21-connected-text.md).
 *
 * A text is written as
 *
 *     # Заголовок | c | opr.prich
 *     opr.prich opr.prich odn|Sentence with three commas…
 *     -|Sentence without a comma.
 *
 * The header names the sign the task asks about (c — запятая, d — тире,
 * k — двоеточие) and the rule of the answer. Every line is one sentence;
 * before «|» stands one rule per mark of that sign, in the order of the
 * marks («-» — no such mark). Other signs are not tagged.
 *
 * A sentence answers when at least one of its marks follows the answer's
 * rule («запятая(-ые) ставится(-ятся)», as in the exam). The answer is
 * computed and must be the same under two readings of the rules: the
 * detailed one (a subordinate clause of time is not one of cause) and the
 * general one (all subordinate clauses, all обособленные определения, all
 * bessoyuznye sentences together). So: the answer's rule is shared by 2–4
 * sentences; every other rule, read generally, is in one sentence at most;
 * and no sentence outside the answer has the answer's rule read generally.
 */

type Sign = 'c' | 'd' | 'k';

interface Rule {
  /** The rule as the general reading names it. */
  readonly general: string;
  /** What the mark does, for the explanation. */
  readonly does: string;
  /** «Обрати внимание» when the rule is the answer. */
  readonly tip: string;
}

const C_SPP = 'граница главной и придаточной части';
const C: Record<string, Rule> = {
  odn: {
    general: 'odn',
    does: 'однородные члены предложения',
    tip: 'Запятая ставится между однородными членами без союзов и перед повторяющимися или противительными союзами (а, но, однако). Перед одиночным «и» запятой нет.',
  },
  ssp: {
    general: 'ssp',
    does: 'граница частей сложносочинённого предложения',
    tip: 'Проверь, есть ли по обе стороны от союза «и», «а», «но» своя грамматическая основа: тогда это части сложносочинённого предложения, а не однородные члены.',
  },
  'spp.opr': {
    general: 'spp',
    does: `${C_SPP}, придаточное определительное (который, где, чей)`,
    tip: 'Придаточное определительное отвечает на вопрос «какой?» и присоединяется словами «который», «чей», «где», «куда» к существительному главной части.',
  },
  'spp.izj': {
    general: 'spp',
    does: `${C_SPP}, придаточное изъяснительное (что, чтобы, как, ли)`,
    tip: 'Изъяснительное придаточное отвечает на падежный вопрос («о чём?», «что?») и зависит от глагола речи, мысли или чувства: «узнали, что…», «спорят, как…».',
  },
  'spp.vrem': {
    general: 'spp',
    does: `${C_SPP}, придаточное времени (когда, пока, как только)`,
    tip: 'Придаточное времени отвечает на вопрос «когда?». Запятая ставится и после него, если оно стоит в начале, и перед ним, если в конце.',
  },
  'spp.prich': {
    general: 'spp',
    does: `${C_SPP}, придаточное причины (потому что, так как, поскольку)`,
    tip: 'Придаточное причины отвечает на вопрос «почему?». Составной союз «потому что», «так как» обычно не разделяется запятой.',
  },
  'spp.usl': {
    general: 'spp',
    does: `${C_SPP}, придаточное условия (если, раз)`,
    tip: 'Придаточное условия отвечает на вопрос «при каком условии?» и чаще всего начинается союзом «если».',
  },
  'spp.ustup': {
    general: 'spp',
    does: `${C_SPP}, придаточное уступки (хотя, несмотря на то что)`,
    tip: 'Придаточное уступки сообщает о том, вопреки чему происходит действие главной части: «хотя…», «несмотря на то что…».',
  },
  'spp.cel': {
    general: 'spp',
    does: `${C_SPP}, придаточное цели (чтобы, для того чтобы)`,
    tip: 'Придаточное цели отвечает на вопрос «зачем?» и начинается союзом «чтобы» («для того чтобы»).',
  },
  'spp.sled': {
    general: 'spp',
    does: `${C_SPP}, придаточное следствия (так что)`,
    tip: 'Придаточное следствия начинается союзом «так что» и сообщает о результате того, о чём говорится в главной части.',
  },
  bsp: {
    general: 'bsp',
    does: 'граница частей бессоюзного сложного предложения',
    tip: 'В бессоюзном предложении запятая ставится между частями, которые перечисляют одновременные или последовательные события.',
  },
  'opr.prich': {
    general: 'opr',
    does: 'причастный оборот после определяемого слова',
    tip: 'Причастный оборот обособляется, когда стоит после определяемого слова; перед определяемым словом запятые не нужны: «покрытое льдом озеро».',
  },
  'opr.adj': {
    general: 'opr',
    does: 'обособленное определение, выраженное прилагательным с зависимыми словами',
    tip: 'Прилагательное с зависимыми словами после определяемого слова обособляется так же, как причастный оборот: «залив, богатый рыбой».',
  },
  'opr.pril': {
    general: 'opr',
    does: 'обособленное приложение',
    tip: 'Приложение — другое название того же предмета («Казань, столица Татарстана»). Распространённое приложение после определяемого слова обособляется.',
  },
  'obst.dee': {
    general: 'obst',
    does: 'деепричастный оборот',
    tip: 'Деепричастный оборот обозначает добавочное действие того же лица и выделяется запятыми с обеих сторон, где бы он ни стоял.',
  },
  'obst.pred': {
    general: 'obst',
    does: 'обособленное обстоятельство с предлогом «несмотря на»',
    tip: 'Обстоятельство с предлогом «несмотря на» обособляется всегда.',
  },
  utoch: {
    general: 'utoch',
    does: 'уточняющий член предложения',
    tip: 'Уточняющий член сужает смысл предыдущего слова («внизу, у самой воды»); между ними можно вставить «а именно».',
  },
  vv: {
    general: 'vv',
    does: 'вводное слово или сочетание',
    tip: 'Вводное слово выражает отношение говорящего или указывает на источник сообщения; его можно убрать без потери смысла предложения.',
  },
  sr: {
    general: 'sr',
    does: 'сравнительный оборот',
    tip: 'Сравнительный оборот с союзами «как», «словно», «будто», «точно» не содержит сказуемого и обычно выделяется запятыми.',
  },
  obr: {
    general: 'obr',
    does: 'обращение',
    tip: 'Обращение называет того, к кому обращена речь, и выделяется запятыми в любом месте предложения.',
  },
};

const D: Record<string, Rule> = {
  pods: {
    general: 'pods',
    does: 'между подлежащим и сказуемым, выраженными существительными, числительными или неопределённой формой глагола (в том числе перед «это», «вот», «значит»)',
    tip: 'Тире между подлежащим и сказуемым ставится, если оба выражены существительными в именительном падеже, числительными или неопределённой формой глагола, а также перед словами «это», «вот», «значит».',
  },
  'bsp.usl': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение, первая часть которого называет условие или время',
    tip: 'В бессоюзном предложении тире ставится, если перед первой частью можно поставить «если» или «когда».',
  },
  'bsp.sled': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение, вторая часть которого называет следствие, результат',
    tip: 'В бессоюзном предложении тире ставится, если перед второй частью можно поставить «поэтому», «так что», «и вот».',
  },
  'bsp.protiv': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение с противопоставленными частями',
    tip: 'В бессоюзном предложении тире ставится, если между частями можно вставить «а» или «но».',
  },
  obob: {
    general: 'obob',
    does: 'обобщающее слово после однородных членов',
    tip: 'Если обобщающее слово стоит после однородных членов, перед ним ставится тире. Обобщающее слово — тот же член предложения в том же падеже, что и однородные: «Листья, кору, плоды — всё это…».',
  },
  pril: {
    general: 'poyasn',
    does: 'приложение в конце предложения, поясняющее предшествующее слово',
    tip: 'Тире ставится перед приложением в конце предложения, когда перед ним можно вставить «а именно».',
  },
  vstav: {
    general: 'poyasn',
    does: 'вставная конструкция или распространённое приложение внутри предложения',
    tip: 'Парные тире выделяют вставку или распространённое приложение, которое прерывает предложение.',
  },
  nepoln: {
    general: 'nepoln',
    does: 'пропуск члена предложения (неполное предложение)',
    tip: 'В неполном предложении тире ставится на месте пропуска, если пропущенное слово ясно из контекста и в речи на этом месте делается пауза.',
  },
  pryam: {
    general: 'pryam',
    does: 'прямая речь перед словами автора',
    tip: 'После прямой речи перед словами автора ставится тире.',
  },
};

const K: Record<string, Rule> = {
  obob: {
    general: 'obob',
    does: 'обобщающее слово перед однородными членами',
    tip: 'Двоеточие ставится, когда обобщающее слово стоит перед однородными членами.',
  },
  'bsp.prich': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение, вторая часть которого называет причину',
    tip: 'Двоеточие в бессоюзном предложении ставится, если между частями можно вставить «потому что».',
  },
  'bsp.poyasn': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение, вторая часть которого поясняет, раскрывает содержание первой',
    tip: 'Двоеточие в бессоюзном предложении ставится, если между частями можно вставить «а именно».',
  },
  'bsp.dop': {
    general: 'bsp',
    does: 'бессоюзное сложное предложение, вторая часть которого дополняет первую (узнали, увидели, поняли — что)',
    tip: 'Двоеточие в бессоюзном предложении ставится, если между частями можно вставить «что» и при этом слова «увидел», «понял», «узнал» не произносятся с предупреждением.',
  },
  pryam: {
    general: 'pryam',
    does: 'прямая речь или цитата после слов автора',
    tip: 'Перед прямой речью и цитатой, которой предшествуют слова автора, ставится двоеточие.',
  },
};

const SIGNS: Record<
  Sign,
  {
    rules: Record<string, Rule>;
    mark: string;
    name: string;
    ask: string;
    plural: string;
    none: string;
  }
> = {
  c: {
    rules: C,
    mark: ',',
    name: 'запятая',
    ask: '**запятая(-ые)** ставится(-ятся)',
    plural: 'запятые',
    none: 'запятых',
  },
  d: { rules: D, mark: '—', name: 'тире', ask: '**тире** ставится', plural: 'тире', none: 'тире' },
  k: {
    rules: K,
    mark: ':',
    name: 'двоеточие',
    ask: '**двоеточие** ставится',
    plural: 'двоеточия',
    none: 'двоеточий',
  },
};

/** The rule a tag belongs to under the general reading, or undefined for an unknown tag. */
export const generalRule21 = (sign: Sign, tag: string): string | undefined =>
  SIGNS[sign]?.rules[tag]?.general;

export interface Text21 {
  readonly title: string;
  readonly sign: Sign;
  readonly target: string;
  readonly sentences: readonly { readonly text: string; readonly tags: readonly string[] }[];
}

export function parseTexts21(source: string): Text21[] {
  return source
    .trim()
    .split(/\n\s*\n/)
    .filter((block) => block.trim())
    .map((block) => {
      const [head = '', ...lines] = block.trim().split('\n');
      const [title = '', sign = '', target = ''] = head
        .replace(/^#\s*/, '')
        .split('|')
        .map((x) => x.trim());
      return {
        title,
        sign: sign as Sign,
        target,
        sentences: lines.map((line) => {
          const at = line.indexOf('|');
          const tags = line.slice(0, at).trim();
          return { text: line.slice(at + 1).trim(), tags: tags === '-' ? [] : tags.split(/\s+/) };
        }),
      };
    });
}

/** The answer of a text, or what is wrong with it. */
export function analyse21(t: Text21): { digits: string; problems: string[] } {
  const p: string[] = [];
  const where = `№21 «${t.title}»`;
  const sign = SIGNS[t.sign];
  if (!sign) return { digits: '', problems: [`${where}: unknown sign ${t.sign}`] };
  if (!sign.rules[t.target]) p.push(`${where}: unknown answer rule ${t.target}`);
  if (t.sentences.length < 7 || t.sentences.length > 9)
    p.push(`${where}: ${t.sentences.length} sentences`);
  const fine = new Map<string, number[]>();
  const general = new Map<string, number[]>();
  t.sentences.forEach((s, i) => {
    const marks = s.text.split(sign.mark).length - 1;
    if (marks !== s.tags.length)
      p.push(`${where} (${i + 1}): ${marks} × «${sign.mark}», ${s.tags.length} rules`);
    if (!/^[А-ЯЁ«(0-9]/.test(s.text) || !/[.!?…»)]$/.test(s.text))
      p.push(`${where} (${i + 1}): not a sentence «${s.text.slice(0, 30)}»`);
    for (const tag of new Set(s.tags)) {
      const r = sign.rules[tag];
      if (!r) {
        p.push(`${where} (${i + 1}): unknown rule ${tag}`);
        continue;
      }
      fine.set(tag, [...(fine.get(tag) ?? []), i + 1]);
      const g = new Set(general.get(r.general) ?? []);
      g.add(i + 1);
      general.set(r.general, [...g]);
    }
  });
  const answer = fine.get(t.target) ?? [];
  if (answer.length < 2 || answer.length > 4)
    p.push(`${where}: answer of ${answer.length} sentences`);
  for (const [tag, list] of fine)
    if (tag !== t.target && list.length > 1)
      p.push(`${where}: rule ${tag} repeats in ${list.join(', ')}`);
  const targetGeneral = sign.rules[t.target]?.general;
  for (const [g, list] of general) {
    if (g === targetGeneral) {
      if (list.join() !== answer.join())
        p.push(
          `${where}: read generally, «${g}» is in ${list.join(', ')}, the answer is ${answer.join(', ')}`,
        );
    } else if (list.length > 1)
      p.push(`${where}: read generally, «${g}» repeats in ${list.join(', ')}`);
  }
  const withSign = t.sentences.filter((s) => s.tags.length > 0).length;
  if (withSign - answer.length < 2) p.push(`${where}: fewer than two sentences with other rules`);
  return { digits: answer.join(''), problems: p };
}

const word = (s: string, from: number, back: boolean): string => {
  const part = back ? s.slice(0, from) : s.slice(from + 1);
  const words = part.match(/[А-Яа-яЁё0-9-]+/g) ?? [];
  return (back ? words[words.length - 1] : words[0]) ?? '';
};

/** «(3) запятые после слов «A» и «B» выделяют …» for every rule of a sentence. */
function describe(t: Text21, i: number): string[] {
  const sign = SIGNS[t.sign];
  const s = t.sentences[i]!;
  const at: number[] = [];
  for (let k = s.text.indexOf(sign.mark); k >= 0; k = s.text.indexOf(sign.mark, k + 1)) at.push(k);
  const byRule = new Map<string, string[]>();
  s.tags.forEach((tag, m) =>
    byRule.set(tag, [...(byRule.get(tag) ?? []), `«${word(s.text, at[m]!, true)}»`]),
  );
  return [...byRule].map(([tag, after]) => {
    const many = after.length > 1;
    const what = many ? sign.plural : sign.name;
    const does = sign.rules[tag]!.does;
    const words =
      after.length > 2 ? `${after.slice(0, -1).join(', ')} и ${after.at(-1)}` : after.join(' и ');
    return `${what} после ${after.length > 1 ? 'слов' : 'слова'} ${words}: ${does}${tag === t.target ? ' — **подходит**' : ''}`;
  });
}

function score(t: Text21, digits: string): number {
  const marks = t.sentences.reduce((n, s) => n + s.tags.length, 0);
  const rules = new Set(t.sentences.flatMap((s) => s.tags)).size;
  const mixed = t.sentences.filter(
    (s) => s.tags.includes(t.target) && new Set(s.tags).size > 1,
  ).length;
  return marks * 0.5 + rules + mixed * 1.5 + digits.length + (t.sign === 'c' ? 0 : 1);
}

export function buildTasks21(texts: readonly Text21[]): BankTask[] {
  const built = texts.map((t) => ({ t, ...analyse21(t) }));
  const order = built
    .map((b, i) => ({ i, s: score(b.t, b.digits) + i * 1e-6 }))
    .sort((a, b) => a.s - b.s);
  const diff = new Map<number, Difficulty>();
  const n = texts.length;
  order.forEach((o, rank) => diff.set(o.i, rank < n * 0.3 ? 1 : rank < n * 0.7 ? 2 : 3));
  return built.map(({ t, digits }, i): BankTask => {
    const sign = SIGNS[t.sign];
    const rule = sign.rules[t.target]!;
    const withSign = t.sentences.map((s, k) => ({ s, k })).filter((x) => x.s.tags.length > 0);
    const without = t.sentences.map((s, k) => (s.tags.length ? 0 : k + 1)).filter(Boolean);
    return {
      taskNumber: 21,
      n: i + 1,
      difficulty: diff.get(i)!,
      kind: `знак: ${sign.name}`,
      conditionMd: [
        `Найдите предложения, в которых ${sign.ask} в соответствии с одним и тем же правилом пунктуации. Запишите номера этих предложений.`,
        t.sentences.map((s, k) => `(${k + 1})${s.text}`).join(' '),
      ].join('\n\n'),
      answer: { type: 'digits', digits },
      explanationMd: [
        `Находим в тексте все ${sign.plural} и для каждого знака называем правило, по которому он поставлен.`,
        ...withSign.map(({ k }) => {
          const line = describe(t, k).join('; ');
          return `(${k + 1}) ${line[0]!.toUpperCase()}${line.slice(1)}.`;
        }),
        without.length
          ? `В ${without.length > 1 ? 'предложениях' : 'предложении'} ${without.join(', ')} ${sign.none} нет.`
          : `${sign.plural[0]!.toUpperCase()}${sign.plural.slice(1)} есть во всех предложениях.`,
        `Повторяется только одно правило: ${rule.does}. Оно действует в предложениях ${[...digits].join(', ')}, а каждое из остальных правил встречается в тексте один раз.`,
        `**Обрати внимание.** ${rule.tip}`,
        `Ответ: ${digits}.`,
      ].join('\n\n'),
      hintMd: `Выпиши номера предложений, где есть ${sign.name}, и для каждого знака назови правило. Ищи правило, которое повторяется в нескольких предложениях.`,
    };
  });
}

export const TEXTS_21: readonly Text21[] = [
  TEXTS_21_A,
  TEXTS_21_B,
  TEXTS_21_C,
  TEXTS_21_D,
  TEXTS_21_E,
].flatMap(parseTexts21);

function problems21(texts: readonly Text21[]): string[] {
  const p = texts.flatMap((t) => analyse21(t).problems);
  const seen = new Map<string, string>();
  for (const t of texts)
    for (const s of t.sentences) {
      const key = s.text.toLowerCase().replace(/[^а-яё]/g, '');
      if (seen.has(key))
        p.push(`№21: «${s.text.slice(0, 40)}…» in «${seen.get(key)}» and «${t.title}»`);
      seen.set(key, t.title);
    }
  const titles = new Set(texts.map((t) => t.title));
  if (titles.size !== texts.length) p.push('№21: two texts share a title');
  return p;
}

export const TASK21: BankNumber = {
  taskNumber: 21,
  topicSlug: 'russian-punctuation-rules',
  topicName: 'Пунктуационный анализ',
  problems: problems21(TEXTS_21),
  tasks: buildTasks21(TEXTS_21),
};
