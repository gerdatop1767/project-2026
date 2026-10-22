/**
 * Per-subject topic lists and task-number counts for the Subject page
 * (approved references: 01_MATH…09_HISTORY_DESKTOP.png). Each subject
 * has its own real EGE topic breakdown — never a reused generic list
 * with the title swapped — while sharing one generic page component
 * (`SubjectDesktop`) and one generic drill-down mechanism
 * (`subject → taskNumber → tasks`, see `getTaskNumbers` below), so a
 * 10th subject only needs an entry here, not a new component.
 *
 * Solved/accuracy numbers are seeded deterministically per topic (see
 * `hashString`) — demo content, not real user progress.
 */

export type SubjectModeId = 'topics' | 'byNumber' | 'variants' | 'favorites';

export interface SubjectTopic {
  id: string;
  number: number;
  title: string;
  description: string;
}

export interface SubjectContent {
  subjectId: string;
  tagline: string;
  topics: readonly SubjectTopic[];
  /** How many numbered EGE tasks this subject has (roughly the real
   * spec's count) — drives the Variant builder's number grid and
   * Training's "По номерам" number picker. */
  taskNumberCount: number;
}

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const subjectContentList: readonly SubjectContent[] = [
  {
    subjectId: 'math',
    tagline: 'Тренируйся по темам, решай варианты и отслеживай свой прогресс',
    taskNumberCount: 19,
    topics: [
      {
        id: 'numbers',
        number: 1,
        title: 'Числа и вычисления',
        description: 'Действительные числа, проценты, степени',
      },
      {
        id: 'expressions',
        number: 2,
        title: 'Алгебраические выражения и уравнения',
        description: 'Преобразования, уравнения, неравенства',
      },
      {
        id: 'functions',
        number: 3,
        title: 'Функции и графики',
        description: 'Функции, их свойства, графики',
      },
      { id: 'geometry', number: 4, title: 'Геометрия', description: 'Планиметрия, стереометрия' },
      {
        id: 'planimetry',
        number: 5,
        title: 'Планиметрия',
        description: 'Треугольники, окружности, многоугольники',
      },
      {
        id: 'stereometry',
        number: 6,
        title: 'Стереометрия',
        description: 'Пространственные фигуры и их свойства',
      },
      {
        id: 'probability',
        number: 7,
        title: 'Комбинаторика, статистика и вероятность',
        description: 'Комбинаторика, вероятности, статистика',
      },
      {
        id: 'word-problems',
        number: 8,
        title: 'Текстовые задачи',
        description: 'Задачи на движение, работу, смеси и др.',
      },
      {
        id: 'practical',
        number: 9,
        title: 'Практические задачи',
        description: 'Экономические, прикладные, анализ данных',
      },
      {
        id: 'advanced',
        number: 10,
        title: 'Задания повышенной сложности',
        description: 'Задачи 15–19, нестандартные методы',
      },
    ],
  },
  {
    subjectId: 'russian',
    tagline: 'Тренируйся, разбирай правила, решай задания и повышай результаты на ЕГЭ',
    taskNumberCount: 27,
    topics: [
      {
        id: 'text',
        number: 1,
        title: 'Текст. Информационная обработка текста',
        description: 'Тема, основная мысль, стиль, тип речи, средства выразительности',
      },
      {
        id: 'expressive-means',
        number: 2,
        title: 'Выразительные средства языка',
        description: 'Лексические, грамматические, синтаксические средства',
      },
      {
        id: 'lexical-meaning',
        number: 3,
        title: 'Лексическое значение слова',
        description: 'Синонимы, антонимы, омонимы, фразеологизмы',
      },
      {
        id: 'spelling',
        number: 4,
        title: 'Орфография',
        description: 'Правописание корней, приставок, суффиксов, окончаний',
      },
      {
        id: 'punctuation',
        number: 5,
        title: 'Пунктуация',
        description: 'Знаки препинания в простом и сложном предложении',
      },
      {
        id: 'syntax',
        number: 6,
        title: 'Синтаксис',
        description: 'Словосочетание, предложение, виды предложений',
      },
      {
        id: 'speech-culture',
        number: 7,
        title: 'Культура речи',
        description: 'Нормы современного русского языка',
      },
      {
        id: 'language-norms',
        number: 8,
        title: 'Языковые нормы',
        description: 'Орфоэпические, лексические, грамматические, речевые нормы',
      },
      {
        id: 'essay',
        number: 9,
        title: 'Сочинение (задание 27)',
        description: 'Структура, аргументация, критерии, примеры',
      },
    ],
  },
  {
    subjectId: 'english',
    tagline: 'Практикуй все разделы, решай задания, развивай навыки и готовься к ЕГЭ',
    taskNumberCount: 38,
    topics: [
      { id: 'reading', number: 1, title: 'Reading', description: 'Чтение и понимание текста' },
      {
        id: 'use-of-english',
        number: 2,
        title: 'Use of English',
        description: 'Грамматика и лексика (задания 19–25)',
      },
      {
        id: 'listening',
        number: 3,
        title: 'Listening',
        description: 'Аудирование (задания 1–6)',
      },
      {
        id: 'writing',
        number: 4,
        title: 'Writing',
        description: 'Письменная часть (задания 37–38)',
      },
      { id: 'speaking', number: 5, title: 'Speaking', description: 'Устная часть (задания 3–4)' },
      {
        id: 'vocabulary',
        number: 6,
        title: 'Vocabulary',
        description: 'Лексика и фразовые глаголы',
      },
      {
        id: 'grammar',
        number: 7,
        title: 'Grammar',
        description: 'Времена, залоги, модальные глаголы и др.',
      },
      {
        id: 'communicative',
        number: 8,
        title: 'Communicative situations',
        description: 'Речевые ситуации, диалоги, ключевые выражения',
      },
      {
        id: 'text-analysis',
        number: 9,
        title: 'Text analysis',
        description: 'Анализ текста, основная мысль, структура',
      },
    ],
  },
  {
    subjectId: 'social',
    tagline: 'Понимай общество, учись анализировать и решать задания на ЕГЭ уверенно',
    taskNumberCount: 25,
    topics: [
      {
        id: 'person-society',
        number: 1,
        title: 'Человек и общество',
        description: 'Природа человека, деятельность, мышление',
      },
      {
        id: 'social-relations',
        number: 2,
        title: 'Социальные отношения',
        description: 'Социальные группы, институты, конфликты',
      },
      {
        id: 'economics',
        number: 3,
        title: 'Экономика',
        description: 'Рынок, фирмы, деньги, налоги, экономический рост',
      },
      {
        id: 'politics',
        number: 4,
        title: 'Политика',
        description: 'Государство, власть, политические режимы',
      },
      { id: 'law', number: 5, title: 'Право', description: 'Правовая система, отрасли права' },
      {
        id: 'civil-society',
        number: 6,
        title: 'Государство и гражданское общество',
        description: 'Функции государства, демократия, правовое государство',
      },
      {
        id: 'sociology',
        number: 7,
        title: 'Социология',
        description: 'Социальный контроль, отклоняющееся поведение',
      },
      {
        id: 'culture',
        number: 8,
        title: 'Культура и духовная сфера',
        description: 'Культура, наука, образование, религия',
      },
      {
        id: 'social-norms',
        number: 9,
        title: 'Человек в системе социальных норм',
        description: 'Мораль, право, традиции',
      },
    ],
  },
  {
    subjectId: 'informatics',
    tagline: 'Изучай теорию, решай задания, развивай логическое мышление и готовься к ЕГЭ',
    taskNumberCount: 27,
    topics: [
      {
        id: 'encoding',
        number: 1,
        title: 'Информация и её кодирование',
        description: 'Системы счисления, перевод, кодирование текстов, изображений',
      },
      {
        id: 'logic',
        number: 2,
        title: 'Логика и алгоритмы',
        description: 'Логические выражения, таблицы истинности, логические схемы',
      },
      {
        id: 'programming',
        number: 3,
        title: 'Алгоритмы и программирование',
        description: 'Алгоритмы, исполнители, циклы, ветвления',
      },
      {
        id: 'data-processing',
        number: 4,
        title: 'Списки, строки и работа с данными',
        description: 'Массивы, строки, обработка данных, анализ',
      },
      {
        id: 'file-system',
        number: 5,
        title: 'Файловая система',
        description: 'Файлы, папки, пути, объёмы информации',
      },
      {
        id: 'databases',
        number: 6,
        title: 'Базы данных',
        description: 'Таблицы, запросы, фильтрация, сортировка',
      },
      {
        id: 'networks',
        number: 7,
        title: 'Компьютерные сети',
        description: 'Интернет, IP-адреса, протоколы, поиск информации',
      },
      {
        id: 'modeling',
        number: 8,
        title: 'Моделирование и анализ',
        description: 'Таблицы, графы, деревья, модели, закономерности',
      },
      {
        id: 'security',
        number: 9,
        title: 'Информационная безопасность',
        description: 'Защита данных, вирусы, шифрование, безопасность в сети',
      },
    ],
  },
  {
    subjectId: 'physics',
    tagline: 'Разбирай теорию, решай задачи, развивай физическое мышление и готовься к ЕГЭ',
    taskNumberCount: 30,
    topics: [
      {
        id: 'kinematics',
        number: 1,
        title: 'Механика. Кинематика',
        description: 'Равномерное и равноускоренное движение, графики',
      },
      {
        id: 'dynamics',
        number: 2,
        title: 'Механика. Динамика',
        description: 'Законы Ньютона, силы, движение по окружности',
      },
      {
        id: 'statics',
        number: 3,
        title: 'Механика. Статика',
        description: 'Равновесие, моменты сил, условия равновесия',
      },
      {
        id: 'conservation-laws',
        number: 4,
        title: 'Механика. Законы сохранения',
        description: 'Импульс, энергия, работа, мощность',
      },
      {
        id: 'thermodynamics',
        number: 5,
        title: 'Молекулярная физика. Термодинамика',
        description: 'Идеальный газ, процессы, законы термодинамики',
      },
      {
        id: 'current',
        number: 6,
        title: 'Электродинамика. Постоянный ток',
        description: 'Электрическое поле, закон Ома, цепи, мощность',
      },
      {
        id: 'magnetism',
        number: 7,
        title: 'Электродинамика. Магнетизм',
        description: 'Магнитное поле, сила Ампера, индукция',
      },
      {
        id: 'induction',
        number: 8,
        title: 'Электродинамика. Электромагнитная индукция',
        description: 'Поток, ЭДС, закон Фарадея, правило Ленца',
      },
      {
        id: 'waves',
        number: 9,
        title: 'Колебания и волны',
        description: 'Механические колебания, волны, звук',
      },
      {
        id: 'optics',
        number: 10,
        title: 'Оптика и квантовая физика',
        description: 'Световые явления, фотоэффект, атомная физика',
      },
    ],
  },
  {
    subjectId: 'chemistry',
    tagline: 'Изучай теорию, решай задания, разбирай реакции и готовься к ЕГЭ',
    taskNumberCount: 34,
    topics: [
      {
        id: 'atomic-structure',
        number: 1,
        title: 'Общая химия. Строение вещества',
        description: 'Строение атома, ПСХЭ, химическая связь, степени окисления',
      },
      {
        id: 'reactions',
        number: 2,
        title: 'Химические реакции',
        description: 'Типы реакций, скорость, равновесие, ОВР',
      },
      {
        id: 'inorganic',
        number: 3,
        title: 'Неорганическая химия',
        description: 'Металлы, неметаллы, их соединения',
      },
      {
        id: 'elements',
        number: 4,
        title: 'Химия элементов',
        description: 'Свойства элементов и их соединений (1–20, 17 группа, 18 группа)',
      },
      {
        id: 'organic',
        number: 5,
        title: 'Органическая химия',
        description: 'Углеводороды, спирты, альдегиды, кислоты, сложные эфиры и др.',
      },
      {
        id: 'biochemistry',
        number: 6,
        title: 'Биохимия',
        description: 'Белки, жиры, углеводы, нуклеиновые кислоты, витамины',
      },
      {
        id: 'chemistry-and-life',
        number: 7,
        title: 'Химия и жизнь',
        description: 'Бытовая химия, лекарства, полимеры, экологические проблемы',
      },
      {
        id: 'calculations',
        number: 8,
        title: 'Расчётные задачи',
        description: 'Массовая доля, количество вещества, химические уравнения',
      },
      {
        id: 'experiments',
        number: 9,
        title: 'Экспериментальные задачи',
        description: 'Распознавание веществ, качественные реакции, лабораторные опыты',
      },
    ],
  },
  {
    subjectId: 'biology',
    tagline: 'Изучай теорию, решай задания, развивай понимание живой природы и готовься к ЕГЭ',
    taskNumberCount: 28,
    topics: [
      {
        id: 'cell',
        number: 1,
        title: 'Клетка как биологическая система',
        description: 'Строение клетки, органоиды, обмен веществ',
      },
      {
        id: 'human-organism',
        number: 2,
        title: 'Организм человека',
        description: 'Анатомия, физиология, гигиена, здоровье',
      },
      {
        id: 'ecosystems',
        number: 3,
        title: 'Виды, популяции, экосистемы',
        description: 'Вид, популяция, биоценоз, экосистема',
      },
      {
        id: 'evolution',
        number: 4,
        title: 'Эволюция органического мира',
        description: 'Доказательства эволюции, движущие силы',
      },
      {
        id: 'genetics',
        number: 5,
        title: 'Генетика и селекция',
        description: 'Законы Менделя, изменчивость, биотехнологии',
      },
      {
        id: 'health',
        number: 6,
        title: 'Человек и его здоровье',
        description: 'Наследственные заболевания, иммунитет, гигиена',
      },
      {
        id: 'botany',
        number: 7,
        title: 'Растения. Ботаника',
        description: 'Строение, жизненные процессы, систематика',
      },
      {
        id: 'zoology',
        number: 8,
        title: 'Животные. Зоология',
        description: 'Беспозвоночные и позвоночные животные',
      },
      {
        id: 'ecology',
        number: 9,
        title: 'Экология и охрана природы',
        description: 'Взаимодействие организмов, охрана экосистем',
      },
      {
        id: 'applied-biology',
        number: 10,
        title: 'Биология в практической деятельности человека',
        description: 'Биотехнологии, медицина, сельское хозяйство',
      },
    ],
  },
  {
    subjectId: 'history',
    tagline: 'Погружайся в историю, изучай события, анализируй источники и уверенно решай ЕГЭ',
    taskNumberCount: 25,
    topics: [
      {
        id: 'antiquity',
        number: 1,
        title: 'Древность и раннее Средневековье',
        description: 'Древние цивилизации, ранние государства',
      },
      {
        id: 'ancient-rus',
        number: 2,
        title: 'Древняя Русь (IX – начало XII в.)',
        description: 'Образование государства, князья, культура',
      },
      {
        id: 'russian-lands',
        number: 3,
        title: 'Русские земли в XII – середине XV в.',
        description: 'Феодальная раздробленность, борьба с Ордой',
      },
      {
        id: 'tsardom',
        number: 4,
        title: 'Российское государство в XV – XVII в.',
        description: 'Объединение земель, реформы, Смутное время',
      },
      {
        id: 'xviii-century',
        number: 5,
        title: 'Россия в XVIII в.',
        description: 'Эпоха Петра I, дворцовые перевороты, культура',
      },
      {
        id: 'xix-century',
        number: 6,
        title: 'Россия в XIX в.',
        description: 'Реформы, общественные движения, внешняя политика',
      },
      {
        id: 'early-xx-century',
        number: 7,
        title: 'Россия в начале XX в.',
        description: 'Революции 1905–1917 гг., Первая мировая война',
      },
      {
        id: 'ussr-1917-1945',
        number: 8,
        title: 'СССР в 1917 – 1945 гг.',
        description: 'Гражданская война, индустриализация, Великая Отечественная',
      },
      {
        id: 'ussr-1945-1991',
        number: 9,
        title: 'СССР в 1945 – 1991 гг.',
        description: 'Послевоенное развитие, «оттепель», застой, перестройка',
      },
      {
        id: 'modern-russia',
        number: 10,
        title: 'Россия в 1991–2022 гг.',
        description: 'Современная Россия, политика, экономика, культура',
      },
    ],
  },
];

const subjectContentById: ReadonlyMap<string, SubjectContent> = new Map(
  subjectContentList.map((content) => [content.subjectId, content]),
);

export function getSubjectContent(subjectId: string): SubjectContent {
  return subjectContentById.get(subjectId) ?? subjectContentList[0]!;
}

/** Deterministic per-topic progress — demo content, not real user data. */
export function getTopicProgress(
  subjectId: string,
  topic: SubjectTopic,
): { solved: number; total: number; accuracyPercent: number } {
  const seed = hashString(`${subjectId}:${topic.id}`);
  const total = 20 + (seed % 40);
  const solved = Math.round(total * (0.3 + ((seed >>> 3) % 60) / 100));
  const accuracyPercent = 50 + ((seed >>> 6) % 45);
  return { solved, total, accuracyPercent };
}
