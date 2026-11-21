import { rng, shuffle, type BankNumber, type BankTask, type Difficulty } from '../types.js';

/**
 * Task 21 (пунктуационный анализ). Five themes of sentences written for
 * the project; each line is `знак=правило … | sentence`, one rule per
 * sign in a sentence (c — запятая, d — тире, k — двоеточие). A rule may
 * carry a subtype after a dot (`c=spp.vrem` — придаточное времени): some
 * keys, like the Дощинский 2027 books, count придаточные of different kinds
 * as different rules, FIPI's general wording counts them as one. A task
 * takes eight sentences of one theme and asks about one sign: two or three
 * sentences share one rule down to its subtype (the answer); every other
 * rule appears at most once, and no other sentence has the answer's rule
 * with another subtype — so the answer is the same under either reading.
 * Known limit: the eight sentences share a theme but are not one connected
 * text, as in the exam.
 */
const RULES: Record<string, string> = {
  'c:prich': 'запятые выделяют причастный оборот после определяемого слова',
  'c:dee': 'запятые выделяют деепричастный оборот',
  'c:odn': 'запятые разделяют однородные члены предложения',
  'c:ssp': 'запятая разделяет части сложносочинённого предложения',
  'c:spp.vrem': 'запятая отделяет придаточную часть времени от главной',
  'c:spp.opr': 'запятая отделяет придаточную определительную часть от главной',
  'c:spp.usl': 'запятая отделяет придаточную часть условия от главной',
  'c:spp.izj': 'запятая отделяет придаточную изъяснительную часть от главной',
  'c:spp.mest': 'запятая отделяет придаточную часть места от главной',
  'c:spp.cel': 'запятая отделяет придаточную часть цели от главной',
  'c:bsp': 'запятые разделяют части бессоюзного сложного предложения',
  'c:vv': 'запятые выделяют вводное слово (сочетание)',
  'c:sr': 'запятые выделяют сравнительный оборот',
  'c:pril': 'запятые выделяют обособленное приложение',
  'c:obr': 'запятые выделяют обращение',
  'd:pods': 'тире между подлежащим и сказуемым, выраженными существительными',
  'd:bsp.sled':
    'тире в бессоюзном сложном предложении: во второй части — следствие, результат того, о чём говорится в первой',
  'd:bsp.usl': 'тире в бессоюзном сложном предложении: первая часть указывает на условие',
  'd:obob': 'тире после однородных членов перед обобщающим словом',
  'k:obob': 'двоеточие после обобщающего слова перед однородными членами',
  'k:bsp.prich': 'двоеточие в бессоюзном сложном предложении: вторая часть указывает на причину',
  'k:bsp.dop':
    'двоеточие в бессоюзном сложном предложении: вторая часть дополняет первую (что понял, сказал, знаю)',
};

const THEMES: Record<string, string> = {
  природа: `
c=prich|Река, вышедшая из берегов, затопила луга.
c=prich|Над озером кружили чайки, высматривавшие рыбу.
c=dee|Пробираясь сквозь заросли, мы вышли к ручью.
c=dee|Ветер гнал облака, не давая солнцу выглянуть.
c=odn|В лесу росли сосны, ели, берёзы.
c=odn|Тропинка петляла, поднималась на холмы, спускалась в овраги.
c=ssp|Солнце село, и над рекой поднялся туман.
c=ssp|Дождь кончился, но небо оставалось хмурым.
c=spp.vrem|Когда наступила осень, листья пожелтели.
c=spp.opr|Мы вышли на поляну, которую окружали старые дубы.
c=vv|К счастью, дождь скоро прекратился.
c=vv|Зима в этом году, по-видимому, будет снежной.
c=sr|Озеро блестело, как огромное зеркало.
c=sr|Над полем, словно белое покрывало, лежал туман.
d=pods|Лес — лёгкие планеты.
d=pods|Берёза — символ русской природы.
d=bsp.sled|Подул ветер — зашумели деревья.
d=bsp.sled|Пришла весна — растаял снег.
d=obob c=odn|Сосны, ели, пихты — все деревья здесь хвойные.
k=obob c=odn|В лесу водятся разные птицы: дятлы, синицы, клесты.
k=obob c=odn|Осень дарит нам многое: грибы, ягоды, орехи.
k=bsp.prich|Мы поспешили домой: надвигалась гроза.
k=bsp.dop|Я понял: зима близко.
c=pril|Байкал, самое глубокое озеро планеты, хранит огромные запасы пресной воды.
c=pril|Наш проводник, опытный охотник, знал каждую тропу.
c=obr|Береги, человек, родную природу!
c=obr|Друзья, давайте сохраним этот лес!
c=bsp|Светило солнце, пели птицы, журчал ручей.
c=bsp|Ветер стих, лес замер.
d=bsp.usl|Посадишь лес — сохранишь чистый воздух.
`,
  город: `
c=prich|Улицы, освещённые фонарями, казались праздничными.
c=prich|Мы зашли в кафе, расположенное на углу.
c=dee|Перейдя площадь, мы оказались у театра.
c=dee|Машины медленно ползли, сигналя друг другу.
c=odn|В витринах были книги, игрушки, сувениры.
c=odn|Город шумел, спешил, жил своей жизнью.
c=ssp|Наступил вечер, и в окнах зажглись огни.
c=ssp|Трамвай опоздал, а автобус ушёл без нас.
c=spp.opr|Мы поднялись на башню, откуда был виден весь город.
c=spp.usl|Если пойдёт дождь, экскурсию перенесут.
c=vv|Этот мост, говорят, построили двести лет назад.
c=vv|Конечно, в столице много интересных музеев.
c=sr|Небоскрёбы, как великаны, возвышались над рекой.
c=sr|Огни мелькали, будто светлячки.
d=pods|Москва — столица России.
d=pods|Метро — самый быстрый вид городского транспорта.
d=bsp.sled|Включили фонари — улица преобразилась.
d=bsp.usl|Опоздаешь на поезд — придётся ждать до утра.
d=obob c=odn|Театры, музеи, парки — всё было открыто для гостей.
k=obob c=odn|На площади стояли киоски: газетные, цветочные, сувенирные.
k=obob c=odn|В городе три главные улицы: Садовая, Морская и Центральная.
k=bsp.prich|Мы не смогли войти в музей: он был закрыт на ремонт.
k=bsp.dop|Экскурсовод предупредил: фотографировать нельзя.
c=pril|Наш гид, студентка исторического факультета, рассказывала увлечённо.
c=pril|Старый вокзал, памятник архитектуры, недавно отреставрировали.
c=obr|Уважаемые пассажиры, будьте внимательны!
c=obr|Город мой, ты прекрасен в любое время года!
c=bsp|Гудели машины, спешили прохожие, звенели трамваи.
c=bsp|Начался дождь, площадь опустела.
d=pods|Наш город — крупный промышленный центр.
`,
  школа: `
c=prich|Ученики, получившие пятёрки, радовались.
c=prich|Учитель проверил тетради, сданные утром.
c=dee|Закончив урок, учитель раздал задания.
c=dee|Ребята сидели тихо, внимательно слушая объяснение.
c=odn|На уроке мы читали, писали, отвечали на вопросы.
c=odn|В портфеле лежали учебники, тетради, пенал.
c=ssp|Прозвенел звонок, и ученики вышли в коридор.
c=ssp|Задача была трудной, но мы её решили.
c=spp.izj|Учитель объяснил, почему это правило важно.
c=spp.vrem|Когда начались каникулы, все разъехались.
c=vv|Экзамен, к сожалению, перенесли на неделю.
c=vv|Во-первых, нужно повторить теорию.
c=sr|Время на экзамене летело, как стрела.
c=sr|Его голос звучал звонко, как колокольчик.
d=pods|Учение — путь к знаниям.
d=pods|Наша школа — старейшее здание района.
d=bsp.usl|Выучишь правило — решишь задачу.
d=bsp.sled|Прозвенел звонок — урок окончен.
d=obob c=odn|Алгебра, геометрия, физика — эти предметы ему нравились больше всего.
k=obob c=odn|На олимпиаде были задания трёх видов: тесты, задачи и сочинение.
k=obob c=odn|Мы изучаем разные науки: историю, химию, биологию.
k=bsp.prich|Учитель был доволен: класс написал контрольную без двоек.
k=bsp.dop|Я знаю точно: завтра будет экзамен.
c=pril|Наш директор, бывший учитель физики, любил опыты.
c=pril|Анна Петровна, классный руководитель, собрала родителей.
c=obr|Ребята, откройте учебники.
c=obr|Повтори, Саша, последнее правило.
c=bsp|Звенели звонки, хлопали двери, шумели ученики.
c=bsp|Урок закончился, все разошлись.
d=pods|Книга — лучший друг ученика.
`,
  путешествие: `
c=prich|Поезд, следовавший на юг, остановился у моста.
c=prich|Мы поселились в доме, стоявшем у моря.
c=dee|Сойдя на берег, путешественники разбили лагерь.
c=dee|Мы шли по горной тропе, держась за верёвку.
c=odn|В рюкзаке были палатка, котелок, спальник.
c=odn|Мы купались, загорали, ловили рыбу.
c=ssp|Корабль отчалил, и берег начал удаляться.
c=ssp|Погода испортилась, но мы продолжили путь.
c=spp.mest|Мы остановились там, где начиналась тропа.
c=spp.cel|Чтобы успеть на паром, пришлось встать до рассвета.
c=vv|Дорога, по словам местных жителей, займёт два часа.
c=vv|Кажется, мы заблудились.
c=sr|Горы стояли, как стражи.
c=sr|Волны били о берег, точно молоты.
d=pods|Путешествие — лучший учитель.
d=pods|Эльбрус — высочайшая вершина Европы.
d=bsp.sled|Взошло солнце — туман рассеялся.
d=bsp.usl|Не взял компас — не жалуйся.
d=obob c=odn|Горы, море, леса — всё восхищало туристов.
k=obob c=odn|Мы посетили три страны: Грузию, Армению, Азербайджан.
k=obob c=odn|В поход мы взяли самое нужное: аптечку, фонари и карту.
k=bsp.prich|Пришлось вернуться: дорогу размыло.
k=bsp.dop|Проводник сказал коротко: дальше пойдём пешком.
c=pril|Наш капитан, человек опытный, не боялся шторма.
c=pril|Казань, столица Татарстана, встретила нас солнцем.
c=obr|Пассажиры, займите свои места.
c=obr|Счастливого пути, дорогие туристы!
c=bsp|Шумело море, кричали чайки, качались лодки.
c=bsp|Начался шторм, порт закрыли.
d=pods|Байкал — жемчужина Сибири.
`,
  семья: `
c=prich|Бабушка достала альбом, хранивший семейные фотографии.
c=prich|Дом, построенный дедом, стоял на краю села.
c=dee|Вернувшись с работы, отец сел ужинать.
c=dee|Мама пела, расчёсывая дочке волосы.
c=odn|На столе стояли пироги, варенье, мёд.
c=odn|Сестра шила, вязала, вышивала.
c=ssp|Наступил праздник, и вся семья собралась вместе.
c=ssp|Брат уехал учиться, а сестра осталась дома.
c=spp.opr|Я помню дом, где прошло моё детство.
c=spp.vrem|Мама позвонила, когда мы уже спали.
c=vv|Дед, наверное, уже вернулся с рыбалки.
c=vv d=pods|Безусловно, семья — главное в жизни.
c=sr|Сестра пела, как соловей.
c=sr|Бабушка встретила нас, будто родных детей.
d=pods|Семья — опора человека.
c=spp.opr d=pods|Дом — это место, где тебя ждут.
d=bsp.sled|Мама позвала — дети прибежали.
d=bsp.usl|Будешь помогать — получишь награду.
d=obob c=odn|Отец, мать, бабушка — все ждали меня на перроне.
k=obob c=odn|В саду росли фруктовые деревья: яблони, груши, вишни.
k=obob|В семье было трое детей: два сына и дочь.
k=bsp.prich|Мы не скучали: дома всегда было много дел.
k=bsp.dop|Бабушка объявила: обед готов.
c=pril|Мой дед, ветеран войны, любил рассказывать о прошлом.
c=pril|Сестра, студентка консерватории, играла на рояле.
c=obr|Мама, мы вернулись!
c=obr|Спасибо тебе, бабушка, за пироги.
c=bsp|Трещали дрова, пахло хлебом, тикали часы.
c=bsp|Пришли гости, начался праздник.
d=pods|Дети — наше будущее.
`,
};

/** `c:spp.vrem` → `c:spp`: the rule as FIPI's general wording names it. */
const general = (rule: string) => rule.split('.')[0]!;

interface S {
  readonly theme: string;
  readonly text: string;
  /** sign → rule key, e.g. { c: 'c:prich' } */
  readonly rules: Readonly<Record<string, string>>;
}

export const TASK21_SENTENCES: readonly S[] = Object.entries(THEMES).flatMap(([theme, block]) =>
  block
    .trim()
    .split('\n')
    .map((line) => {
      const [tags = '', text = ''] = line.split('|');
      const rules: Record<string, string> = {};
      for (const t of tags.split(' ')) {
        const [sign, rule] = t.split('=') as [string, string];
        rules[sign] = `${sign}:${rule}`;
      }
      return { theme, text, rules };
    }),
);

const SIGN_OF: Record<string, { ask: string; mark: string; name: string }> = {
  c: { ask: '**запятая(-ые)** ставится(-ятся)', mark: ',', name: 'запятая' },
  d: { ask: '**тире** ставится', mark: '—', name: 'тире' },
  k: { ask: '**двоеточие** ставится', mark: ':', name: 'двоеточие' },
};

const TIPS: Record<string, string> = {
  c: 'Для каждой запятой назови правило: однородные члены, части сложного предложения (сочинение, подчинение, бессоюзие), обособленные обороты, вводные слова, обращения, сравнительные обороты. Совпасть должно именно правило, а не просто наличие запятой.',
  d: 'Тире ставится между подлежащим и сказуемым, выраженными существительными; в бессоюзном предложении при быстрой смене событий, условии или следствии; после однородных членов перед обобщающим словом.',
  k: 'Двоеточие ставится после обобщающего слова перед однородными членами и в бессоюзном предложении, если вторая часть поясняет, дополняет первую или указывает причину.',
};

/** Sentences two tasks may have in common (of seven or eight). */
export const MAX_SHARED = 4;

export function generatePunctuationTasks(count = 100, seed = 21212027, maxUses = 8): BankTask[] {
  const rand = rng(seed);
  const uses = new Map<string, number>();
  const seen = new Set<string>();
  const earlier: Set<string>[] = [];
  const themes = Object.keys(THEMES);
  const plan: string[] = [];
  for (let i = 0; i < count; i++) plan.push(i % 20 < 12 ? 'c' : i % 20 < 17 ? 'd' : 'k');
  const drafts: { sign: string; target: string; picked: S[]; score: number }[] = [];
  let guard = 0;
  while (drafts.length < count) {
    if (++guard > count * 400) throw new Error('task 21: cannot build enough tasks');
    const sign = plan[drafts.length]!;
    const theme = themes[Math.floor(rand() * themes.length)]!;
    const pool = shuffle(
      TASK21_SENTENCES.filter((s) => s.theme === theme && (uses.get(s.text) ?? 0) < maxUses),
      rand,
    );
    // Grouped by the full rule, subtype included.
    const byRule = new Map<string, S[]>();
    for (const s of pool) {
      const r = s.rules[sign];
      if (r) byRule.set(r, [...(byRule.get(r) ?? []), s]);
    }
    const rules = [...byRule.keys()].filter((r) => byRule.get(r)!.length >= 2);
    if (rules.length === 0) continue;
    const target = rules[Math.floor(rand() * rules.length)]!;
    const k = Math.min(byRule.get(target)!.length, rand() < 0.6 ? 2 : 3);
    const picked: S[] = byRule.get(target)!.slice(0, k);
    // Other rules of this sign: at most one sentence per rule without its
    // subtype, and none sharing the answer's rule with another subtype.
    const taken = new Set([general(target)]);
    for (const [r, list] of byRule) {
      if (taken.has(general(r)) || picked.length >= 6) continue;
      picked.push(list[0]!);
      taken.add(general(r));
    }
    // Fill to eight with sentences without this sign.
    for (const s of pool) {
      if (picked.length >= 8) break;
      if (!s.rules[sign] && !picked.includes(s)) picked.push(s);
    }
    if (picked.length < 7) continue;
    const ordered = shuffle(picked, rand);
    const key = `${sign}|${ordered
      .map((s) => s.text)
      .sort()
      .join('|')}`;
    if (seen.has(key)) continue;
    // Two tasks share at most half of their sentences.
    if (earlier.some((set) => ordered.filter((s) => set.has(s.text)).length > MAX_SHARED)) continue;
    seen.add(key);
    earlier.push(new Set(ordered.map((s) => s.text)));
    for (const s of ordered) uses.set(s.text, (uses.get(s.text) ?? 0) + 1);
    const withSign = ordered.filter((s) => s.rules[sign]).length;
    drafts.push({
      sign,
      target,
      picked: ordered,
      score: withSign + (sign === 'c' ? 0 : 1.5) + rand() * 0.01,
    });
  }
  const order = drafts.map((d, i) => ({ i, s: d.score })).sort((a, b) => a.s - b.s);
  const diff = new Map<number, Difficulty>();
  order.forEach((o, rank) => diff.set(o.i, rank < count * 0.3 ? 1 : rank < count * 0.7 ? 2 : 3));
  return drafts.map((d, i): BankTask => {
    const digits = d.picked
      .map((s, k) => (s.rules[d.sign] === d.target ? String(k + 1) : ''))
      .join('');
    const sg = SIGN_OF[d.sign]!;
    return {
      taskNumber: 21,
      n: i + 1,
      difficulty: diff.get(i)!,
      kind: `знак: ${sg.name}`,
      conditionMd: [
        `Найдите предложения, в которых ${sg.ask} в соответствии с одним и тем же правилом пунктуации. Запишите номера этих предложений.`,
        d.picked.map((s, k) => `(${k + 1})${s.text}`).join(' '),
      ].join('\n\n'),
      answer: { type: 'digits', digits },
      explanationMd: [
        `Рассматриваем только предложения, где есть ${sg.name}, и называем правило для каждого случая.`,
        ...d.picked.flatMap((s, k) => {
          const r = s.rules[d.sign];
          if (!r) return [];
          return [`(${k + 1}) ${RULES[r]}.${r === d.target ? ' Подходит.' : ''}`];
        }),
        `В остальных предложениях знака «${sg.mark}» нет. По одному правилу знак поставлен в предложениях ${[...digits].join(', ')}.`,
        `**Обрати внимание.** ${TIPS[d.sign]}`,
        `Ответ: ${digits}.`,
      ].join('\n\n'),
      hintMd: `Выпиши все предложения, где есть ${sg.name}, и для каждого назови правило. Ищи правило, которое повторяется.`,
    };
  });
}

export const TASK21: BankNumber = {
  taskNumber: 21,
  topicSlug: 'russian-punctuation-rules',
  topicName: 'Пунктуационный анализ',
  problems: TASK21_SENTENCES.flatMap((s) =>
    Object.entries(s.rules)
      .flatMap(([sign, r]) => [
        ...(RULES[r] ? [] : [`№21: unknown rule ${r}`]),
        ...(s.text.includes(SIGN_OF[sign]!.mark)
          ? []
          : [`№21: «${s.text}» has no ${SIGN_OF[sign]!.name}`]),
      ])
      .concat(
        Object.entries(SIGN_OF)
          .filter(([sign, v]) => s.text.includes(v.mark) && !s.rules[sign])
          .map(([, v]) => `№21: «${s.text}» has a ${v.name} without a rule`),
      ),
  ),
  tasks: generatePunctuationTasks(),
};
