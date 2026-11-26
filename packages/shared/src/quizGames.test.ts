import { describe, expect, it } from 'vitest';
import { MINI_GAMES } from './miniGames.js';
import {
  QUIZ_GAMES,
  QUIZ_TOPICS,
  checkQuizAnswer,
  commaItems,
  dedupeItems,
  expressiveItems,
  explanationPart,
  findInTextItems,
  formErrorItems,
  gapWordItems,
  grammarItems,
  hyphenItems,
  inputItems,
  keyTokens,
  neItems,
  nnItems,
  normalizeWord,
  oneCommaItems,
  paronymItems,
  quizRoundScore,
  rowItems,
  sentenceRange,
  wordMeaningItems,
  type QuizTaskRow,
} from './quizGames.js';

const row = (over: Partial<QuizTaskRow>): QuizTaskRow => ({
  id: 't1',
  taskNumber: 9,
  conditionMd: '',
  correctAnswer: '',
  acceptedAnswers: null,
  explanationMd: null,
  passageMd: null,
  imageUrl: null,
  ...over,
});

describe('the registry', () => {
  it('20 games: «Ударения», «Словарные слова» + 18 quizzes, each in a subject tab and a topic', () => {
    expect(MINI_GAMES).toHaveLength(20);
    expect(new Set(MINI_GAMES.map((g) => g.id)).size).toBe(20);
    expect(MINI_GAMES.filter((g) => g.subjectId === 'russian')).toHaveLength(17);
    expect(MINI_GAMES.filter((g) => g.subjectId === 'math').map((g) => g.title)).toEqual([
      'Теория вероятностей',
      'Вычисления',
      'Теория на практике',
    ]);
    const topics = new Set(QUIZ_TOPICS.map((t) => t.id));
    expect(MINI_GAMES.every((g) => topics.has(g.topic))).toBe(true);
    expect(QUIZ_GAMES.map((g) => g.title)).toEqual([
      'Гласные в корне',
      'Приставки',
      'Суффиксы и окончания',
      'НЕ и НИ',
      'Слитно, раздельно, через дефис',
      'Н и НН',
      'Одна запятая',
      'Расстановка знаков препинания',
      'Грамматические нормы',
      'Паронимы',
      'Ошибка в слове',
      'Пропущенное слово',
      'Значение слова в тексте',
      'Средства выразительности',
      'Фразеологизмы и антонимы',
      'Теория вероятностей',
      'Вычисления',
      'Теория на практике',
    ]);
  });

  it('points: 10 per right first answer, +20 for a perfect round', () => {
    expect(quizRoundScore(0, 10)).toBe(0);
    expect(quizRoundScore(7, 10)).toBe(70);
    expect(quizRoundScore(10, 10)).toBe(120);
    expect(quizRoundScore(12, 10)).toBe(120); // never more than the round
    expect(quizRoundScore(0, 0)).toBe(0);
  });
});

describe('parsers — questions only from the task’s own text, key and explanation', () => {
  it('№9–12 rows: Да for the rows in the key, the row’s own explanation', () => {
    const items = rowItems(
      row({
        conditionMd:
          'Укажите варианты ответов, в которых во всех словах одного ряда пропущена одна и та же буква. Запишите номера ответов.\n\n1) зам..рать, пол..ровать\n\n2) возн..кновение, ут..шительный\n\n3) предп..лагать, предст..витель\n\n4) л..биринт, укр..щение\n\n5) ув..дать, осв..щение',
        correctAnswer: '13',
        explanationMd:
          '1) замИрать, полИровать — И. Подходит.\n\n2) И, Е — нет.\n\n3) А, А — подходит.\n\n4) А, О.\n\n5) Я, Е.\n\nОтвет: 13.',
      }),
    );
    expect(items.map((i) => i.correct)).toEqual(['Да', 'Нет', 'Да', 'Нет', 'Нет']);
    expect(items[0]!.explanation).toBe('1) замИрать, полИровать — И. Подходит.');
    expect(items[4]!.explanation).toBe('5) Я, Е.');
  });

  it('explanations out of order are cut at ANY other place, never mixed', () => {
    const md = '(1) раненого — НН.\n\n(3) отчаянно — НН.\n\n(2) расположено — Н.';
    expect(explanationPart(md, 1)).toBe('(1) раненого — НН.');
    expect(explanationPart(md, 2)).toBe('(2) расположено — Н.');
    expect(explanationPart(md, 3)).toBe('(3) отчаянно — НН.');
    expect(explanationPart(md, 4)).toBeNull();
  });

  it('№15: one question per place; «пишется НН» and «одна буква Н» keys both work', () => {
    const base = {
      conditionMd:
        'Укажите цифру(-ы), на месте которой(-ых) пишется НН.\n\nУтре(1)ие улицы прониза(2)ы запахом.',
      correctAnswer: '1',
    };
    const nn = nnItems(row(base));
    expect(nn.map((i) => [i.text, i.correct])).toEqual([
      ['Утре▢ие улицы прониза..ы запахом.', 'НН'],
      ['Утре..ие улицы прониза▢ы запахом.', 'Н'],
    ]);
    const n = nnItems(
      row({
        ...base,
        conditionMd: base.conditionMd.replace('пишется НН', 'пишется одна буква Н'),
        correctAnswer: '2',
      }),
    );
    expect(n.map((i) => i.correct)).toEqual(['НН', 'Н']);
  });

  it('№13: НЕ слитно/раздельно by the key and the asked spelling', () => {
    const items = neItems(
      row({
        conditionMd:
          'Укажите варианты ответов, в которых НЕ с выделенным словом пишется РАЗДЕЛЬНО. Запишите номера ответов.\n\n1) (НЕ)УДИВИТЬ!\n\n2) (НЕ)КУДА было идти.\n\n3) (НЕ)СПЕША шёл.\n\n4) (НЕ)ДОСТУПНЫМИ были.\n\n5) (НЕ)ЛЕПЫЙ вид.',
        correctAnswer: '13',
      }),
    );
    expect(items.map((i) => i.correct)).toEqual([
      'раздельно',
      'слитно',
      'раздельно',
      'слитно',
      'слитно',
    ]);
  });

  it('№14 and №16: Да / Нет per sentence', () => {
    const lines = '\n\n1) а\n\n2) б\n\n3) в\n\n4) г\n\n5) д';
    expect(
      hyphenItems(
        row({
          conditionMd: `Укажите варианты ответов, в которых все выделенные слова пишутся ЧЕРЕЗ ДЕФИС.${lines}`,
          correctAnswer: '25',
        }),
      ).map((i) => [i.prompt, i.correct]),
    ).toEqual([
      ['Оба выделенных слова пишутся через дефис?', 'Нет'],
      ['Оба выделенных слова пишутся через дефис?', 'Да'],
      ['Оба выделенных слова пишутся через дефис?', 'Нет'],
      ['Оба выделенных слова пишутся через дефис?', 'Нет'],
      ['Оба выделенных слова пишутся через дефис?', 'Да'],
    ]);
    expect(
      oneCommaItems(
        row({
          conditionMd: `Укажите предложения, в которых нужно поставить ОДНУ запятую.${lines}`,
          correctAnswer: '34',
        }),
      ).map((i) => i.correct),
    ).toEqual(['Нет', 'Нет', 'Да', 'Да', 'Нет']);
  });

  it('№17–20: places as slots, any order of the tapped places', () => {
    const [item] = commaItems(
      row({
        conditionMd:
          'Укажите цифру(-ы), на месте которой(-ых) должна(-ы) стоять запятая(-ые).\n\nВысокий (1) стройный (2) он шёл (3) не глядя (4) вперёд.',
        correctAnswer: '312',
      }),
    );
    expect(item).toMatchObject({
      kind: 'slots',
      slots: [1, 2, 3, 4],
      correct: '123',
      display: '1, 2, 3',
    });
    expect(checkQuizAnswer(item!, '321')).toBe(true);
    expect(checkQuizAnswer(item!, '12')).toBe(false);
    expect(checkQuizAnswer(item!, '1234')).toBe(false);
  });

  it('№5 and №7: the highlighted word the key corrects; ambiguous tasks give nothing', () => {
    const [par] = paronymItems(
      row({
        conditionMd:
          'В одном из приведённых ниже предложений НЕВЕРНО употреблено выделенное слово.\n\nБыл СКРЫТНЫМ человеком.\n\nВспышки РАЗДРАЖИТЕЛЬНОСТИ.\n\nЗВУЧНЫЙ барьер преодолел.\n\nЯБЛОНЕВОЕ дерево.',
        correctAnswer: 'звуковой',
      }),
    );
    expect(par).toMatchObject({ correct: 'ЗВУЧНЫЙ', display: 'ЗВУЧНЫЙ → ЗВУКОВОЙ' });
    const [form] = formErrorItems(
      row({
        conditionMd:
          'В одном из выделенных ниже слов допущена грамматическая ошибка.\n\nмама ПЕЧЁТ блины\n\nне ЕЗДИ туда\n\nпуть ДЛИНЬШЕ\n\nсвыше ПЯТИСОТ учреждений\n\nнесбывшихся МЕЧТАНИЙ',
        correctAnswer: 'длиннее',
      }),
    );
    expect(form).toMatchObject({ correct: 'ДЛИНЬШЕ', display: 'ДЛИНЬШЕ → длиннее' });
    expect(form!.options).toEqual(['ПЕЧЁТ', 'ЕЗДИ', 'ДЛИНЬШЕ', 'ПЯТИСОТ', 'МЕЧТАНИЙ']);
  });

  it('№8: the error of each sentence by the key, «Ошибки нет» for the others', () => {
    const condition =
      'Установите соответствие.\n\nА) ошибка с числительным\n\nБ) ошибка с причастным оборотом\n\nВ) ошибка с деепричастием\n\nГ) падеж\n\nД) однородные\n\n1) Двое подруг.\n\n2) Всё верно.\n\n3) Поля, посеревшие от дождя туристов.\n\n4) Благодаря за приём, были слова.\n\n5) Согласно приказа.\n\n6) Знал и любил музыку.\n\n7) Тоже верно.';
    const answer = JSON.stringify({
      parts: ['1', '3', '4', '5', '6'].map((n, i) => ({ label: 'АБВГД'[i], correctAnswer: n })),
    });
    const items = grammarItems(row({ conditionMd: condition, correctAnswer: answer }));
    expect(items).toHaveLength(7);
    expect(items[0]!.correct).toBe('Ошибка с числительным');
    // The key says only that none of the five errors is there.
    expect(items[1]!.correct).toBe('Ни одной из этих ошибок');
    expect(items[1]!.explanation).toMatch(/По ключу задания[\s\S]*Других ошибок ключ не проверяет/);
    expect(items[1]!.explanationSource).toBe('auto');
    expect(items[0]!.options).toContain('Ни одной из этих ошибок');
  });

  it('№22: the means of each fragment by the key', () => {
    const condition =
      'Установите соответствие.\n\nА) Разве это не молодость? Разве это не молодость?\n\nБ) И вода, и луч, и ветер.\n\nВ) Как женщину, ты Родину любил.\n\nГ) Мужичок с перст.\n\nД) Богатый пирует, бедный горюет.\n\n1) риторическое обращение\n\n2) эпифора\n\n3) сравнение\n\n4) парцелляция\n\n5) антитеза\n\n6) аллитерация\n\n7) многосоюзие\n\n8) анафора\n\n9) литота';
    const answer = JSON.stringify({
      parts: ['8', '7', '3', '9', '5'].map((n, i) => ({ label: 'АБВГД'[i], correctAnswer: n })),
    });
    const items = expressiveItems(
      row({
        conditionMd: condition,
        correctAnswer: answer,
        explanationMd:
          'А — 8, анафора. Б — 7, многосоюзие. В — 3, сравнение. Г — 9, литота. Д — 5, антитеза.',
      }),
    );
    expect(items.map((i) => i.correct)).toEqual([
      'анафора',
      'многосоюзие',
      'сравнение',
      'литота',
      'антитеза',
    ]);
    expect(items[2]!.explanation).toBe('В — 3, сравнение.');
  });

  it('№1: the gap of the text, typed; №2: the meaning per entry with its sentence', () => {
    const [gap] = gapWordItems(
      row({
        conditionMd:
          'Самостоятельно подберите относительное местоимение, которое должно стоять на месте пропуска в тексте. Запишите это местоимение.',
        correctAnswer: 'что',
        passageMd: 'Первое предложение. Это близко к тому, <…> видно в памятниках. Конец.',
      }),
    );
    expect(gap).toMatchObject({
      kind: 'input',
      text: 'Это близко к тому, ▢ видно в памятниках.',
      correct: 'что',
    });
    expect(checkQuizAnswer(gap!, ' Что ')).toBe(true);
    const meaning = wordMeaningItems(
      row({
        conditionMd:
          'В тексте выделено пять слов. Укажите варианты ответов, в которых лексическое значение выделенного слова соответствует его значению в данном тексте.\n\n1) ПЕРЕДАЧА. Механизм.\n\n2) ЗАБРОСИТЬ. Перестать заниматься.\n\n3) ВРЕМЯ. Промежуток.\n\n4) СУДИТЬ. Следить за игрой.\n\n5) ПОЛЕ. Ровное место.',
        correctAnswer: '34',
        passageMd:
          'Начинается **передачу** сегодня. Не будет **заброшенных** шайб. Было **время** до гола. Встречу **судит** Хеллемонд. Игра на **поле** идёт.',
      }),
    );
    expect(meaning.map((i) => i.correct)).toEqual(['Нет', 'Нет', 'Да', 'Да', 'Нет']);
    expect(meaning[3]!.text).toMatch(/^Встречу судит Хеллемонд\./);
  });

  it('№25: tap the words; any order; shown as the text’s words', () => {
    expect(sentenceRange('Из предложений 14–16 выпишите один фразеологизм.')).toEqual([14, 15, 16]);
    expect(sentenceRange('Из предложений 8, 9 выпишите антонимы.')).toEqual([8, 9]);
    expect(keyTokens('своичужие', ['и', 'свои', 'и', 'чужие'])).toEqual([1, 3]);
    const [item] = findInTextItems(
      row({
        conditionMd: 'Из предложений 12–13 выпишите один фразеологизм.',
        correctAnswer: 'таксказать',
        passageMd:
          '(11)Начало. (12)Если идти, так сказать, без работы. (13)Тогда скучно. (14)Конец.',
      }),
    );
    expect(item).toMatchObject({ kind: 'words', display: 'так сказать' });
    expect(checkQuizAnswer(item!, 'так сказать')).toBe(true);
    expect(checkQuizAnswer(item!, 'сказать так')).toBe(true);
    expect(checkQuizAnswer(item!, 'так')).toBe(false);
  });

  it('math: a numeric answer typed as 0,5 or 0.5; tasks with a figure are left out', () => {
    const [item] = inputItems(row({ conditionMd: 'Найдите вероятность.', correctAnswer: '0,25' }));
    expect(checkQuizAnswer(item!, '0.25')).toBe(true);
    expect(checkQuizAnswer(item!, '0,25')).toBe(true);
    expect(checkQuizAnswer(item!, '.25')).toBe(true);
    expect(checkQuizAnswer(item!, '0,3')).toBe(false);
    expect(
      inputItems(row({ conditionMd: 'По рисунку…', correctAnswer: '3', imageUrl: '/a.png' })),
    ).toEqual([]);
    expect(inputItems(row({ conditionMd: 'Найдите x.', correctAnswer: '-2; 3' }))).toEqual([]);
  });

  it('a task that does not parse gives no question; repeats are dropped', () => {
    expect(rowItems(row({ conditionMd: 'Что-то другое.\n\n1) а', correctAnswer: '1' }))).toEqual(
      [],
    );
    expect(
      nnItems(
        row({
          conditionMd: 'Укажите цифру(-ы), на месте которой(-ых) пишется НН.\n\nбез мест',
          correctAnswer: '1',
        }),
      ),
    ).toEqual([]);
    const a = inputItems(row({ id: 'a', conditionMd: 'Найдите  2+2.', correctAnswer: '4' }));
    const b = inputItems(row({ id: 'b', conditionMd: 'Найдите 2+2.', correctAnswer: '4' }));
    expect(dedupeItems([...a, ...b])).toHaveLength(1);
    expect(normalizeWord('Ёлка-палка!')).toBe('елкапалка');
  });

  describe('audit fixes', () => {
    it('a question whose own explanation calls its key doubtful is not asked', () => {
      const items = rowItems(
        row({
          conditionMd:
            'Укажите варианты ответов, в которых во всех словах одного ряда пропущена одна и та же буква.\n\n1) а..б\n\n2) об..ход, беспр..зорник\n\n3) в..г\n\n4) д..е\n\n5) ж..з',
          correctAnswer: '13',
          explanationMd:
            '1) Везде И. Подходит.\n\n2) первое слово («об..ход») не поддаётся надёжной проверке по скану — ряд исключён.\n\n3) Везде А. Подходит.\n\n4) Разные.\n\n5) Разные.',
        }),
      );
      expect(items.map((i) => i.key)).toEqual(['t1:1', 't1:2', 't1:3', 't1:4', 't1:5']);
      expect(dedupeItems(items).map((i) => i.key)).toEqual(['t1:1', 't1:3', 't1:4', 't1:5']);
    });

    it('the same fragment with another key in another task: one question, both keys if both are options', () => {
      const base = {
        key: 'a:А',
        taskId: 'a',
        kind: 'choice' as const,
        text: 'Прощай, свободная стихия!',
        prompt: 'Какое средство выразительности здесь?',
        options: ['эпитет', 'риторическое обращение', 'литота'],
        correct: 'риторическое обращение',
        display: 'риторическое обращение',
      };
      const other = { ...base, key: 'b:Б', taskId: 'b', correct: 'эпитет', display: 'эпитет' };
      const [merged, ...rest] = dedupeItems([base, other]);
      expect(rest).toEqual([]);
      expect(merged!.accepted).toEqual(['эпитет']);
      expect(checkQuizAnswer(merged!, 'эпитет')).toBe(true);
      expect(checkQuizAnswer(merged!, 'литота')).toBe(false);
      // Not among this question's options: dropped as a repeat, never accepted.
      const [only] = dedupeItems([
        { ...base, options: ['риторическое обращение', 'литота'] },
        other,
      ]);
      expect(only!.accepted ?? []).toEqual([]);
    });

    it('task explanations are marked as the task’s; keys are shown as written in the explanation', () => {
      const [gap] = gapWordItems(
        row({
          conditionMd:
            'Самостоятельно подберите неопределённое местоимение, которое должно стоять на месте пропуска.',
          correctAnswer: 'чтото',
          explanationMd: 'Нужно «что-то». Ответ: чтото.',
          passageMd: 'Начало. Он <…> сказал. Конец.',
        }),
      );
      expect(gap).toMatchObject({ display: 'что-то', explanationSource: 'task' });
      const [par] = paronymItems(
        row({
          conditionMd:
            'В одном из приведённых ниже предложений НЕВЕРНО употреблено выделенное слово.\n\nПроизвёл ДВОЙНОЕ впечатление.\n\nБыл СКРЫТНЫМ.\n\nВспышки РАЗДРАЖИТЕЛЬНОСТИ.\n\nЯБЛОНЕВОЕ дерево.',
          correctAnswer: 'двойственное',
          acceptedAnswers: ['двоякое'],
        }),
      );
      expect(par!.display).toBe('ДВОЙНОЕ → ДВОЙСТВЕННОЕ или ДВОЯКОЕ');
    });
  });
});
