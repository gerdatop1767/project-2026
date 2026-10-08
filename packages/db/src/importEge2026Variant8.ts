import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import * as schema from './schema.js';

/**
 * Import EGE-2026 Вариант 8 — third variant of the new batch (6-10),
 * sourced from the same variant6_10.pdf (pages 9-12, stored as relative
 * pages 1-4, same convention as Вариант 6-7), cross-read against the
 * TXT+image ZIP extracts. Task 11's graph (line + parabola sharing a
 * root) was verified via pixel-grid crosshair alignment, same rigor as
 * V6/V7 — see docs/imports/ege-2026-variant-6-10-report.md.
 */
const SOURCE = 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты';
const SOURCE_DOCUMENT = 'ЕГЭ 2026 Ященко варианты 6-10';
const SOURCE_YEAR = 2026;
const VARIANT = 8;
const IMPORT_TAG = 'ege-2026-variant-8';

const COLLECTION_SLUG = 'ege-2026-yashchenko';
const COLLECTION_TITLE = 'ЕГЭ 2026 Ященко';
const COLLECTION_PUBLISHER = 'Ященко';
const VARIANT_TITLE = 'ЕГЭ 2026 — Ященко — Вариант 8';
const SOURCE_FILE = 'variant6_10.pdf';
const SOURCE_PAGE_START = 1;
const SOURCE_PAGE_END = 4;

type ImportStatus = 'published' | 'needs_review';
type ImportAnswerType = 'short_answer' | 'interval' | 'multi_part';

interface ImportSolutionStep {
  title: string;
  explanation: string;
}

interface ImportTask {
  taskNumber: number;
  topicSlug: string;
  topicName: string;
  sourcePage: number;
  rawStatement: string;
  conditionMd: string;
  imageUrl: string | null;
  answerType?: ImportAnswerType;
  correctAnswer: string;
  correctAnswerDisplay?: string;
  explanationMd: string;
  hintMd: string;
  solutionSteps: readonly ImportSolutionStep[];
  status: ImportStatus;
  reviewNote?: string;
}

const importTasks: readonly ImportTask[] = [
  {
    taskNumber: 1,
    topicSlug: 'planimetry-circles',
    topicName: 'Планиметрия: окружности',
    sourcePage: 1,
    rawStatement:
      'Два угла вписанного в окружность четырёхугольника равны 54° и 78°. Найдите больший из оставшихся углов. Ответ дайте в градусах.',
    conditionMd:
      'Два угла вписанного в окружность четырёхугольника равны $54°$ и $78°$. Найдите больший из оставшихся углов. Ответ дайте в градусах.',
    imageUrl: null,
    correctAnswer: '126',
    explanationMd:
      'Что дано: четырёхугольник ABCD вписан в окружность, два его угла равны 54° и 78° (соседние, так как 54°+78°=132°≠180°).\n\nШаг 1. Сумма противоположных углов вписанного четырёхугольника равна 180°. Пусть ∠A=54°, тогда противоположный ∠C=180°−54°=126°.\n\nШаг 2. Пусть ∠B=78°, тогда противоположный ∠D=180°−78°=102°.\n\nШаг 3. Больший из оставшихся углов — 126°.\n\nОтвет: 126.',
    hintMd: 'Сумма противоположных углов вписанного в окружность четырёхугольника равна 180°.',
    solutionSteps: [
      { title: 'Находим угол, противоположный 54°', explanation: '$180°-54°=126°$.' },
      { title: 'Находим угол, противоположный 78°', explanation: '$180°-78°=102°$.' },
      { title: 'Выбираем больший', explanation: '$\\max(126°,102°)=126°$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 2,
    topicSlug: 'vectors',
    topicName: 'Векторы',
    sourcePage: 1,
    rawStatement: 'Даны векторы a(9;-8) и b(3;8). Найдите скалярное произведение векторов a и b.',
    conditionMd:
      'Даны векторы $\\vec a(9;-8)$ и $\\vec b(3;8)$. Найдите скалярное произведение векторов $\\vec a$ и $\\vec b$.',
    imageUrl: null,
    correctAnswer: '-37',
    explanationMd:
      'Что дано: a⃗=(9;−8), b⃗=(3;8).\n\nШаг 1. a⃗·b⃗=9·3+(−8)·8=27−64=−37.\n\nОтвет: −37.',
    hintMd:
      'Скалярное произведение векторов в координатах: $\\vec a\\cdot\\vec b=a_x b_x+a_y b_y$.',
    solutionSteps: [
      {
        title: 'Вычисляем скалярное произведение',
        explanation: '$9\\cdot3+(-8)\\cdot8=27-64=-37$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 3,
    topicSlug: 'stereometry-solids',
    topicName: 'Стереометрия: тела вращения',
    sourcePage: 1,
    rawStatement:
      'Найдите объём многогранника, вершинами которого являются точки A, B, C, B1 прямоугольного параллелепипеда ABCDA1B1C1D1, у которого AB=9, AD=8, AA1=10.',
    conditionMd:
      'Найдите объём многогранника, вершинами которого являются точки $A$, $B$, $C$, $B_1$ прямоугольного параллелепипеда $ABCDA_1B_1C_1D_1$, у которого $AB=9$, $AD=8$, $AA_1=10$.',
    imageUrl: null,
    correctAnswer: '120',
    explanationMd:
      'Что дано: A=(0,0,0), B=(9,0,0), C=(9,8,0), B1=(9,0,10) — тетраэдр с этими четырьмя вершинами.\n\nШаг 1. V=(1/6)|det[B−A; C−A; B1−A]|=(1/6)|det[(9,0,0);(9,8,0);(9,0,10)]|.\n\nШаг 2. det=9·(8·10−0·0)−0·(9·10−0·9)+0·(9·0−8·9)=9·80=720.\n\nШаг 3. V=720/6=120.\n\nОтвет: 120.',
    hintMd:
      'Это тетраэдр с вершинами A, B, C, B1 — вычисли объём через смешанное произведение векторов из вершины A.',
    solutionSteps: [
      {
        title: 'Вводим координаты',
        explanation: '$A=(0,0,0)$, $B=(9,0,0)$, $C=(9,8,0)$, $B_1=(9,0,10)$.',
      },
      {
        title: 'Вычисляем объём тетраэдра',
        explanation: '$V=\\dfrac16|\\det[\\ldots]|=\\dfrac{720}6=120$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 4,
    topicSlug: 'probability-basic',
    topicName: 'Теория вероятностей',
    sourcePage: 1,
    rawStatement:
      'В фирме такси в наличии 20 легковых автомобилей: 7 чёрного цвета с жёлтыми надписями на бортах, остальные — жёлтого цвета с чёрными надписями. Найдите вероятность того, что на случайный вызов приедет машина жёлтого цвета с чёрными надписями.',
    conditionMd:
      'В фирме такси в наличии $20$ легковых автомобилей: $7$ чёрного цвета с жёлтыми надписями на бортах, остальные — жёлтого цвета с чёрными надписями. Найдите вероятность того, что на случайный вызов приедет машина жёлтого цвета с чёрными надписями.',
    imageUrl: null,
    correctAnswer: '0.65',
    explanationMd:
      'Что дано: всего 20 машин, 7 чёрных, остальные 20−7=13 жёлтых.\n\nШаг 1. P(жёлтая)=13/20=0.65.\n\nОтвет: 0.65.',
    hintMd: 'Найди число жёлтых машин как остаток от общего числа.',
    solutionSteps: [
      {
        title: 'Вычисляем вероятность',
        explanation: '$P=\\dfrac{20-7}{20}=\\dfrac{13}{20}=0.65$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 5,
    topicSlug: 'probability-basic',
    topicName: 'Теория вероятностей',
    sourcePage: 1,
    rawStatement:
      'Биатлонист по одному разу стреляет по пяти мишеням. Вероятность попадания в мишень при одном выстреле равна 0,8. Найдите вероятность того, что биатлонист 4 раза попадёт в мишени и один раз промахнётся. Результат округлите до сотых.',
    conditionMd:
      'Биатлонист по одному разу стреляет по пяти мишеням. Вероятность попадания в мишень при одном выстреле равна $0.8$. Найдите вероятность того, что биатлонист $4$ раза попадёт в мишени и один раз промахнётся. Результат округлите до сотых.',
    imageUrl: null,
    correctAnswer: '0.41',
    explanationMd:
      'Что дано: 5 независимых выстрелов, p=0.8, нужно ровно 4 попадания из 5.\n\nШаг 1. P=C(5,4)·0.8⁴·0.2¹=5·0.4096·0.2=0.4096.\n\nШаг 2. Округляем: 0.41.\n\nОтвет: 0.41.',
    hintMd: 'Используй формулу Бернулли: $P=C_5^4 p^4(1-p)^1$.',
    solutionSteps: [
      {
        title: 'Применяем формулу Бернулли',
        explanation: '$P=C_5^4\\cdot0.8^4\\cdot0.2=5\\cdot0.4096\\cdot0.2=0.4096$.',
      },
      { title: 'Округляем', explanation: '$0.4096\\approx0.41$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 6,
    topicSlug: 'logarithmic-equations',
    topicName: 'Логарифмические уравнения',
    sourcePage: 1,
    rawStatement:
      'Найдите корень уравнения 2log₃(x+2)=1+log₃(4x+8). Если уравнение имеет больше одного корня, в ответе запишите меньший из корней.',
    conditionMd:
      'Найдите корень уравнения $2\\log_3(x+2)=1+\\log_3(4x+8)$. Если уравнение имеет больше одного корня, в ответе запишите меньший из корней.',
    imageUrl: null,
    correctAnswer: '10',
    explanationMd:
      'Что дано: 2log₃(x+2)=1+log₃(4x+8). ОДЗ: x+2>0 и 4x+8>0, оба дают x>−2.\n\nШаг 1. 2log₃(x+2)=log₃((x+2)²). 1+log₃(4x+8)=log₃(3(4x+8))=log₃(12x+24).\n\nШаг 2. (x+2)²=12x+24 → x²+4x+4=12x+24 → x²−8x−20=0.\n\nШаг 3. x=(8±√(64+80))/2=(8±12)/2 → x=10 или x=−2.\n\nШаг 4. Проверка ОДЗ (x>−2): x=10 подходит; x=−2 не подходит (граница, не строго больше).\n\nОтвет: 10 (единственный корень).',
    hintMd:
      'Приведи обе части к одному логарифму: $2\\log_3(x+2)=\\log_3((x+2)^2)$ и $1+\\log_3(4x+8)=\\log_3(12x+24)$.',
    solutionSteps: [
      { title: 'Приводим к одному логарифму', explanation: '$(x+2)^2=12x+24$.' },
      {
        title: 'Решаем квадратное уравнение',
        explanation: '$x^2-8x-20=0 \\;\\Rightarrow\\; x=10$ или $x=-2$.',
      },
      { title: 'Проверяем ОДЗ', explanation: 'Только $x=10$ удовлетворяет $x>-2$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 7,
    topicSlug: 'trigonometry-identities',
    topicName: 'Тригонометрия: основные тождества',
    sourcePage: 2,
    rawStatement: 'Найдите tgα, если sinα=2√5/5 и α∈(π/2;π).',
    conditionMd:
      'Найдите $\\mathrm{tg}\\,\\alpha$, если $\\sin\\alpha=\\dfrac{2\\sqrt5}5$ и $\\alpha\\in\\left(\\dfrac\\pi2;\\pi\\right)$.',
    imageUrl: null,
    correctAnswer: '-2',
    explanationMd:
      'Что дано: sinα=2√5/5=2/√5, α во II четверти (cosα<0).\n\nШаг 1. cos²α=1−4/5=1/5, cosα=−1/√5 (отрицательный во II четверти).\n\nШаг 2. tgα=sinα/cosα=(2/√5)/(−1/√5)=−2.\n\nОтвет: −2.',
    hintMd:
      'Во II четверти косинус отрицателен — найди его из основного тригонометрического тождества.',
    solutionSteps: [
      {
        title: 'Находим cosα',
        explanation: '$\\cos\\alpha=-\\sqrt{1-\\sin^2\\alpha}=-\\dfrac1{\\sqrt5}$.',
      },
      {
        title: 'Вычисляем тангенс',
        explanation: '$\\mathrm{tg}\\,\\alpha=\\dfrac{2/\\sqrt5}{-1/\\sqrt5}=-2$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 8,
    topicSlug: 'derivative-graph-analysis',
    topicName: 'Производная по графику функции',
    sourcePage: 2,
    rawStatement:
      'На рисунке изображён график функции y=f(x). На оси абсцисс отмечены точки -1, 1, 2, 3. В какой из этих точек значение производной наибольшее? В ответе укажите эту точку. [график: точка -1 чуть правее (после) локального максимума — малая отрицательная производная; точка 1 точно в вершине локального максимума — производная 0; точка 2 точно на дне впадины — производная 0; точка 3 чуть левее (до) следующего локального максимума — малая положительная производная]',
    conditionMd:
      'На рисунке изображён график функции $y=f(x)$. На оси абсцисс отмечены точки $-1$, $1$, $2$, $3$. В какой из этих точек значение производной наибольшее? В ответе укажите эту точку.',
    imageUrl: null,
    correctAnswer: '3',
    explanationMd:
      'Что дано: график функции с отмеченными точками −1,1,2,3. В точках 1 (вершина локального максимума) и 2 (дно локальной впадины) производная равна 0 (касательная горизонтальна). В точке −1 график уже прошёл локальный максимум и идёт на небольшой спад — производная чуть отрицательна. В точке 3 график ещё не достиг следующего локального максимума и продолжает слегка возрастать — производная чуть положительна.\n\nШаг 1. В точках 1 и 2 производная равна 0 (экстремумы).\n\nШаг 2. В точке −1 функция убывает (производная <0), в точке 3 функция возрастает (производная >0).\n\nШаг 3. Наибольшее значение среди {отрицательное, 0, 0, положительное} — положительное, то есть в точке 3.\n\nОтвет: 3.',
    hintMd:
      'Наибольшая производная — там, где касательная идёт вверх (функция возрастает), а не там, где она горизонтальна или идёт вниз.',
    solutionSteps: [
      {
        title: 'Исключаем точки экстремума',
        explanation: 'В $x=1$ и $x=2$ производная равна $0$.',
      },
      {
        title: 'Сравниваем оставшиеся точки',
        explanation:
          'В $x=-1$ функция убывает (производная $<0$), в $x=3$ функция возрастает (производная $>0$).',
      },
      {
        title: 'Выбираем наибольшее',
        explanation: 'Положительное значение в $x=3$ больше нуля и больше отрицательного в $x=-1$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 9,
    topicSlug: 'physics-formulas',
    topicName: 'Текстовые задачи (физические формулы)',
    sourcePage: 2,
    rawStatement:
      'Коэффициент полезного действия (КПД) некоторого двигателя определяется формулой η=((T1-T2)/T1)·100%, где T1 — температура нагревателя (в кельвинах), T2 — температура холодильника (в кельвинах). При какой температуре T1 нагревателя КПД этого двигателя будет 25%, если температура холодильника T2=336 К? Ответ дайте в кельвинах.',
    conditionMd:
      'Коэффициент полезного действия (КПД) некоторого двигателя определяется формулой $\\eta=\\dfrac{T_1-T_2}{T_1}\\cdot100\\%$, где $T_1$ — температура нагревателя (в кельвинах), $T_2$ — температура холодильника (в кельвинах). При какой температуре $T_1$ нагревателя КПД этого двигателя будет $25\\%$, если температура холодильника $T_2=336$ К? Ответ дайте в кельвинах.',
    imageUrl: null,
    correctAnswer: '448',
    explanationMd:
      'Что дано: η=0.25, T2=336.\n\nШаг 1. 0.25=(T1−336)/T1 → 0.25T1=T1−336 → 336=0.75T1.\n\nШаг 2. T1=336/0.75=448.\n\nОтвет: 448.',
    hintMd: 'Вырази T1 из уравнения $\\eta T_1=T_1-T_2$.',
    solutionSteps: [
      { title: 'Решаем уравнение', explanation: '$0.75T_1=336 \\;\\Rightarrow\\; T_1=448$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 10,
    topicSlug: 'motion-word-problems',
    topicName: 'Текстовые задачи на движение',
    sourcePage: 2,
    rawStatement:
      'Из города A в город Б выехал автобус, а через 2 часа со скоростью 65 км/ч следом за ним выехал автомобиль, догнал автобус в городе К и повернул обратно. Когда автомобиль вернулся в A, автобус прибыл в Б. Найдите расстояние от A до К, если расстояние между городами A и Б равно 336 км. Ответ дайте в километрах.',
    conditionMd:
      'Из города $A$ в город $Б$ выехал автобус, а через $2$ часа со скоростью $65$ км/ч следом за ним выехал автомобиль, догнал автобус в городе $К$ и повернул обратно. Когда автомобиль вернулся в $A$, автобус прибыл в $Б$. Найдите расстояние от $A$ до $К$, если расстояние между городами $A$ и $Б$ равно $336$ км. Ответ дайте в километрах.',
    imageUrl: null,
    correctAnswer: '208',
    explanationMd:
      'Что дано: автобус выезжает первым (скорость v неизвестна), автомобиль — через 2ч со скоростью 65 км/ч, догоняет в K, разворачивается, возвращается в A точно к моменту прибытия автобуса в Б (336 км).\n\nШаг 1. Пусть t₁ — время движения автомобиля до K. AK=65t₁=v(2+t₁).\n\nШаг 2. 2+2t₁=336/v.\n\nШаг 3. Решая систему: t₁=2v/(65−v); подставляя — v²+233v−10920=0 → v=40.\n\nШаг 4. t₁=2·40/(65−40)=3.2ч. AK=65·3.2=208.\n\nОтвет: 208.',
    hintMd:
      'Составь уравнение на момент встречи в K и на равенство времени прибытия — получится система на скорость автобуса и время встречи.',
    solutionSteps: [
      { title: 'Составляем уравнение встречи', explanation: '$65t_1=v(2+t_1)$.' },
      { title: 'Составляем уравнение на равенство времени', explanation: '$2+2t_1=336/v$.' },
      { title: 'Решаем систему', explanation: '$v=40$ км/ч, $t_1=3.2$ ч.' },
      { title: 'Находим AK', explanation: '$AK=65\\cdot3.2=208$ км.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 11,
    topicSlug: 'functions-graphs',
    topicName: 'Функции и графики',
    sourcePage: 2,
    rawStatement:
      'На рисунке изображены графики функций f(x)=kx+b и g(x)=ax²+bx+c, которые пересекаются в начале координат и в точке A. Найдите абсциссу точки A. [график: парабола с вершиной (1;-1), корнями 0 и 2; прямая через начало координат и точку (2;4)]',
    conditionMd:
      'На рисунке изображены графики функций $f(x)=kx+b$ и $g(x)=ax^2+bx+c$, которые пересекаются в начале координат и в точке $A$. Найдите абсциссу точки $A$.',
    imageUrl: null,
    correctAnswer: '4',
    explanationMd:
      'Что дано: по рисунку парабола проходит через точки (0;0) и (2;0) (корни), вершина в точке (1;−1); прямая проходит через (0;0) и отмеченную точку (2;4) (координаты считаны по клеткам и подтверждены попиксельно по сетке рисунка).\n\nШаг 1. Парабола: g(x)=a·x·(x−2) (корни 0 и 2). Вершина при x=1: g(1)=a·1·(−1)=−a. Из вершины g(1)=−1: −a=−1 → a=1. Значит g(x)=x²−2x.\n\nШаг 2. Прямая: f(x)=kx (b=0, через начало координат). Из точки (2;4): 2k=4 → k=2.\n\nШаг 3. В точке A: kx=g(x) → 2x=x²−2x → x²−4x=0 → x(x−4)=0. При x≠0: x=4.\n\nОтвет: 4.',
    hintMd:
      'Коэффициенты a и k находятся напрямую по отмеченным на графике точкам (корни параболы и вершина, точка на прямой); затем приравняй $kx=g(x)$ и реши относительно $x\\neq0$.',
    solutionSteps: [
      {
        title: 'Находим уравнение параболы',
        explanation: 'Корни $0$ и $2$, вершина $(1;-1)$ дают $g(x)=x^2-2x$.',
      },
      { title: 'Находим уравнение прямой', explanation: 'Через $(0;0)$ и $(2;4)$: $k=2$.' },
      {
        title: 'Находим точку A',
        explanation: '$2x=x^2-2x \\;\\Rightarrow\\; x(x-4)=0 \\;\\Rightarrow\\; x=4$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 12,
    topicSlug: 'function-extrema-point',
    topicName: 'Точки экстремума функции',
    sourcePage: 2,
    rawStatement: 'Найдите точку максимума функции y=(x+81)e^(81-x).',
    conditionMd: 'Найдите точку максимума функции $y=(x+81)e^{81-x}$.',
    imageUrl: null,
    correctAnswer: '-80',
    explanationMd:
      "Что дано: y=(x+81)e^(81−x).\n\nШаг 1. y'=e^(81−x)+(x+81)·e^(81−x)·(−1)=e^(81−x)·[1−(x+81)]=−e^(81−x)·(x+80).\n\nШаг 2. y'=0 при x=−80.\n\nШаг 3. При x<−80: (x+80)<0, y'>0 (возрастает). При x>−80: (x+80)>0, y'<0 (убывает). Значит x=−80 — точка максимума.\n\nОтвет: −80.",
    hintMd: 'Найди производную произведения, учитывая, что $e^{81-x}$ никогда не равен нулю.',
    solutionSteps: [
      { title: 'Находим производную', explanation: "$y'=-e^{81-x}(x+80)$." },
      { title: 'Находим критическую точку', explanation: "$y'=0 \\;\\Rightarrow\\; x=-80$." },
      {
        title: 'Определяем тип экстремума',
        explanation: 'Производная меняет знак с $+$ на $-$ — точка максимума.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 13,
    topicSlug: 'trigonometric-equations',
    topicName: 'Тригонометрические уравнения',
    sourcePage: 3,
    rawStatement:
      'а) Решите уравнение [cos⁴x+sin(3π/2+2x)-sin²x] / [2cos²(-π/8-x/4)-5sin(x/4+π/8)-2] = 0. б) Найдите все корни этого уравнения, принадлежащие отрезку [π; 4π].',
    conditionMd:
      'а) Решите уравнение $\\dfrac{\\cos^4x+\\sin\\left(\\dfrac{3\\pi}2+2x\\right)-\\sin^2x}{2\\cos^2\\left(-\\dfrac\\pi8-\\dfrac x4\\right)-5\\sin\\left(\\dfrac x4+\\dfrac\\pi8\\right)-2}=0$.\n\nб) Найдите все корни этого уравнения, принадлежащие отрезку $[\\pi;4\\pi]$.',
    imageUrl: null,
    correctAnswer: 'π, 3π/2, 2π, 5π/2, 3π, 4π',
    correctAnswerDisplay: '$\\pi;\\ \\dfrac{3\\pi}2;\\ 2\\pi;\\ \\dfrac{5\\pi}2;\\ 3\\pi;\\ 4\\pi$',
    explanationMd:
      'Что дано: дробь с числителем cos⁴x+sin(3π/2+2x)−sin²x и знаменателем 2cos²(−π/8−x/4)−5sin(x/4+π/8)−2, равная 0.\n\nШаг 1. sin(3π/2+2x)=−cos2x. Числитель=cos⁴x−cos2x−sin²x. Подставляя cos2x=2cos²x−1, sin²x=1−cos²x: числитель=cos⁴x−2cos²x+1−1+cos²x=cos⁴x−cos²x=cos²x(cos²x−1)=−cos²x·sin²x=−(1/4)sin²2x.\n\nШаг 2. Числитель=0 ⟺ sin2x=0 ⟺ x=πn/2, n∈ℤ.\n\nШаг 3. Знаменатель: пусть θ=x/4+π/8 (cos(−π/8−x/4)=cosθ). Знаменатель=2cos²θ−5sinθ−2=−2sin²θ−5sinθ=−sinθ(2sinθ+5). Так как 2sinθ+5 никогда не равно 0, знаменатель=0 ⟺ sinθ=0 ⟺ x/4+π/8=πk ⟺ x=4πk−π/2.\n\nШаг 4. Исключаем x=4πk−π/2 из общего решения: 4πk−π/2=πn/2 ⟺ n=8k−1, то есть исключаем n≡7(mod 8).\n\nШаг 5 (б). На отрезке [π;4π]: x=πn/2 для n=2,...,8. Исключаем n=7 (x=7π/2). Остаются: n=2,3,4,5,6,8 → x=π, 3π/2, 2π, 5π/2, 3π, 4π.\n\nОтвет: а) x=πn/2, n∈ℤ, n≢7(mod 8); б) π, 3π/2, 2π, 5π/2, 3π, 4π.',
    hintMd:
      'Упрости числитель через формулы приведения и двойного угла до $-\\tfrac14\\sin^22x$; знаменатель — заменой $\\theta=x/4+\\pi/8$ до $-\\sin\\theta(2\\sin\\theta+5)$.',
    solutionSteps: [
      {
        title: 'Упрощаем числитель',
        explanation: 'Числитель $=-\\dfrac14\\sin^22x$, равен нулю при $x=\\dfrac{\\pi n}2$.',
      },
      {
        title: 'Упрощаем знаменатель',
        explanation:
          'При $\\theta=\\dfrac x4+\\dfrac\\pi8$: знаменатель $=-\\sin\\theta(2\\sin\\theta+5)$, равен нулю при $x=4\\pi k-\\pi/2$.',
      },
      {
        title: 'Исключаем точки разрыва',
        explanation: 'Из $x=\\dfrac{\\pi n}2$ исключаем $n\\equiv7\\pmod8$.',
      },
      {
        title: 'Отбираем корни на отрезке',
        explanation: 'На $[\\pi;4\\pi]$: $n=2,\\ldots,8$ кроме $n=7$ — шесть корней.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 14,
    topicSlug: 'stereometry-prism',
    topicName: 'Стереометрия: призма',
    sourcePage: 3,
    rawStatement:
      'В правильной треугольной призме ABCA1B1C1 высота AA1 в 1,5 раза больше стороны AB основания ABC. Через прямую A1C1 перпендикулярно плоскости ACB1 провели плоскость α. а) Докажите, что плоскость α делит ребро BB1 в отношении 1:2. б) Найдите угол между плоскостями BCC1 и α.',
    conditionMd:
      'В правильной треугольной призме $ABCA_1B_1C_1$ высота $AA_1$ в $1.5$ раза больше стороны $AB$ основания $ABC$. Через прямую $A_1C_1$ перпендикулярно плоскости $ACB_1$ провели плоскость $\\alpha$.\n\nа) Докажите, что плоскость $\\alpha$ делит ребро $BB_1$ в отношении $1:2$.\n\nб) Найдите угол между плоскостями $BCC_1$ и $\\alpha$.',
    imageUrl: null,
    correctAnswer: 'arccos(0.25)',
    correctAnswerDisplay: '$\\arccos0.25$',
    explanationMd:
      'Что дано: правильная призма, сторона основания s, высота h=1.5s.\n\nИдея: как и в общем случае (координаты A=(0,0,0), B=(s,0,0), C=(s/2,s√3/2,0), ..., h — высота), точка пересечения плоскости α с BB1 имеет параметр t=h−3s²/(4h) от точки B.\n\nШаг 1. При h=1.5s: t=1.5s−3s²/(4·1.5s)=1.5s−0.5s=s.\n\nШаг 2. От B до точки пересечения: t=s. От точки пересечения до B1: h−t=1.5s−s=0.5s. Отношение s:0.5s=2:1 от B, то есть 1:2 от B1 — что и требовалось доказать.\n\nШаг 3 (б). Нормаль плоскости BCC1: m=(√3,1,0). Нормаль плоскости α: N=(−3s,s√3,−4h)=s·(−3,√3,−6) при h=1.5s.\n\nШаг 4. cosθ=|m·N|/(|m||N|). m·N=s(−3√3+√3)=−2√3s. |m|=2. |N|=s√(9+3+36)=4√3s.\n\nШаг 5. cosθ=2√3s/(2·4√3s)=2√3/(8√3)=1/4=0.25.\n\nОтвет: arccos(0.25).',
    hintMd:
      'Используй общую формулу точки пересечения плоскости α (проходящей через A1C1 перпендикулярно ACB1) с ребром BB1 и общую формулу угла между плоскостями BCC1 и α через их нормали.',
    solutionSteps: [
      {
        title: 'Вводим координаты',
        explanation: '$A=(0,0,0)$, $B=(s,0,0)$, $C=(s/2,s\\sqrt3/2,0)$, высота $h=1.5s$.',
      },
      {
        title: 'Находим точку пересечения с BB1',
        explanation: '$t=h-3s^2/(4h)=s$, что даёт отношение $1:2$ от $B_1$.',
      },
      {
        title: 'Находим угол между плоскостями',
        explanation: 'С нормалями $m=(\\sqrt3,1,0)$ и $N=s(-3,\\sqrt3,-6)$: $\\cos\\theta=0.25$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 15,
    topicSlug: 'inequalities-substitution',
    topicName: 'Неравенства методом замены',
    sourcePage: 3,
    rawStatement: 'Решите неравенство √(x²-5) > 3 + 1/(1-√(x²-5)).',
    conditionMd: 'Решите неравенство $\\sqrt{x^2-5}>3+\\dfrac1{1-\\sqrt{x^2-5}}$.',
    imageUrl: null,
    correctAnswer: 'x∈(-∞;-3)∪(-3;-√6)∪(√6;3)∪(3;+∞)',
    correctAnswerDisplay: '$x\\in(-\\infty;-3)\\cup(-3;-\\sqrt6)\\cup(\\sqrt6;3)\\cup(3;+\\infty)$',
    explanationMd:
      'Что дано: ОДЗ x²≥5. Пусть t=√(x²−5)≥0, t≠1.\n\nШаг 1 (t<1). Умножаем на (1−t)>0: t(1−t)>3(1−t)+1 → t−t²>4−3t → −t²+4t−4>0 → (t−2)²<0 — решений нет.\n\nШаг 2 (t>1). Умножаем на (1−t)<0 (меняем знак): t(1−t)<3(1−t)+1 → −t²+4t−4<0 → (t−2)²>0 — верно при всех t≠2.\n\nШаг 3. Итого: t>1, t≠2.\n\nШаг 4. Возвращаемся к x: x²−5>1 и x²−5≠4 → x²>6 и x²≠9.\n\nШаг 5. |x|>√6, x≠±3.\n\nОтвет: x∈(−∞;−3)∪(−3;−√6)∪(√6;3)∪(3;+∞).',
    hintMd:
      'Сделай замену $t=\\sqrt{x^2-5}\\geqslant0$ и реши неравенство относительно $t$, рассматривая знак $(1-t)$.',
    solutionSteps: [
      { title: 'Вводим замену', explanation: '$t=\\sqrt{x^2-5}\\geqslant0$, $t\\neq1$.' },
      {
        title: 'Решаем неравенство относительно t',
        explanation: 'При $t<1$ решений нет; при $t>1$ верно для всех $t\\neq2$.',
      },
      { title: 'Возвращаемся к x', explanation: '$x^2>6$, $x^2\\neq9$.' },
      {
        title: 'Записываем ответ',
        explanation: '$x\\in(-\\infty;-3)\\cup(-3;-\\sqrt6)\\cup(\\sqrt6;3)\\cup(3;+\\infty)$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 16,
    topicSlug: 'economics-problems',
    topicName: 'Экономические задачи',
    sourcePage: 3,
    rawStatement:
      'В июле 2029 года планируется взять кредит в банке на 6 лет. Условия его возврата таковы: в январе 2030, 2031 и 2032 годов долг возрастает на 10% по сравнению с концом предыдущего года; в январе 2033, 2034 и 2035 годов долг возрастает на 20% по сравнению с концом предыдущего года; с февраля по июнь каждого года необходимо выплатить часть долга; в июле каждого года в период с 2030 по 2034 годы долг должен быть на одну и ту же сумму меньше долга на июль предыдущего года; в июле 2035 года необходимо выплатить 480 тысяч рублей и тем самым полностью погасить кредит. Какую сумму планируется взять в кредит, если общая сумма выплат после полного его погашения составит 2 млн 800 тысяч рублей?',
    conditionMd:
      'В июле $2029$ года планируется взять кредит в банке на $6$ лет. Условия его возврата таковы:\n\n— в январе $2030$, $2031$ и $2032$ годов долг возрастает на $10\\%$ по сравнению с концом предыдущего года;\n\n— в январе $2033$, $2034$ и $2035$ годов долг возрастает на $20\\%$ по сравнению с концом предыдущего года;\n\n— с февраля по июнь каждого года необходимо выплатить часть долга;\n\n— в июле каждого года в период с $2030$ по $2034$ годы долг должен быть на одну и ту же сумму меньше долга на июль предыдущего года;\n\n— в июле $2035$ года необходимо выплатить $480$ тысяч рублей и тем самым полностью погасить кредит.\n\nКакую сумму планируется взять в кредит, если общая сумма выплат после полного его погашения составит $2$ млн $800$ тысяч рублей?',
    imageUrl: null,
    correctAnswer: '1900000',
    explanationMd:
      'Что дано: S=D₀ (июль 2029), D₁..D₅ (июль 2030-2034) — арифметическая убывающая последовательность с шагом d. Финальный платёж 480 тыс. в июле 2035 полностью гасит долг после увеличения D₅ на 20% в январе 2035.\n\nШаг 1. D₅·1.2=480 000 → D₅=400 000.\n\nШаг 2. S−5d=400 000. (уравнение А)\n\nШаг 3. Общая сумма выплат = Σ(k=1..5) D_{k−1}·r_k + (D₀−D₅) + 480 000, где r₁=r₂=r₃=0.1, r₄=r₅=0.2.\n\nШаг 4. Σ D_{k−1}r_k = 0.1(D₀+D₁+D₂)+0.2(D₃+D₄) = 0.1(3S−3d)+0.2(2S−7d)=0.7S−1.7d.\n\nШаг 5. Сумма выплат = 0.7S−1.7d+5d+480 000 = 0.7S+3.3d+480 000 = 2 800 000 → 0.7S+3.3d=2 320 000. (уравнение Б)\n\nШаг 6. Из (А): d=(S−400 000)/5. Подставляем в (Б): 6.8S=12 920 000 → S=1 900 000.\n\nПроверка: d=300 000, D₀..D₅=1900000,1600000,1300000,1000000,700000,400000. Сумма выплат=0.7·1900000+3.3·300000+480000=1330000+990000+480000=2800000 ✓.\n\nОтвет: 1 900 000.',
    hintMd:
      'Используй, что финальный платёж даёт D₅ напрямую, а сумма всех выплат раскладывается как сумма начисленных процентов плюс погашение основного долга.',
    solutionSteps: [
      {
        title: 'Находим D₅ из финального платежа',
        explanation: '$D_5\\cdot1.2=480\\,000 \\;\\Rightarrow\\; D_5=400\\,000$.',
      },
      { title: 'Составляем первое уравнение', explanation: '$S-5d=400\\,000$.' },
      { title: 'Составляем уравнение на сумму выплат', explanation: '$0.7S+3.3d=2\\,320\\,000$.' },
      { title: 'Решаем систему', explanation: '$S=1\\,900\\,000$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 17,
    topicSlug: 'planimetry-circles',
    topicName: 'Планиметрия: окружности',
    sourcePage: 4,
    rawStatement:
      'Окружность с центром в точке O радиуса R вписана в угол с вершиной в точке B, равный 120°. Точки A и C — точки касания угла и окружности, а AE и CD — диаметры окружности. а) Докажите, что AD=3BC. б) Прямые BD и BE вторично пересекают окружность в точках N и P соответственно. Найдите PN, если R=13.',
    conditionMd:
      'Окружность с центром в точке $O$ радиуса $R$ вписана в угол с вершиной в точке $B$, равный $120°$. Точки $A$ и $C$ — точки касания угла и окружности, а $AE$ и $CD$ — диаметры окружности.\n\nа) Докажите, что $AD=3BC$.\n\nб) Прямые $BD$ и $BE$ вторично пересекают окружность в точках $N$ и $P$ соответственно. Найдите $PN$, если $R=13$.',
    imageUrl: null,
    correctAnswer: '1',
    explanationMd:
      'Что дано: окружность радиуса R вписана в угол 120° при вершине B (полуугол φ=60°), A,C — точки касания, AE,CD — диаметры.\n\nИдея: ввести координаты B=(0,0), биссектриса вдоль оси x, O=(R/sinφ,0). A=(Rcos²φ/sinφ,Rcosφ), C=(Rcos²φ/sinφ,−Rcosφ).\n\nШаг 1. D=2O−C, E=2O−A (диаметрально противоположные точки).\n\nШаг 2 (а). AD=2Rsinφ (общая формула), BC=Rcosφ/sinφ (касательная). При φ=60°: AD=2R·(√3/2)=R√3. BC=R·0.5/(√3/2)=R/√3=R√3/3. AD/BC=R√3/(R√3/3)=3 — доказано.\n\nШаг 3 (б). Решая уравнение окружности для прямой BD (параметр t вдоль BD), получаем квадратное 13t²−14t+1=0 с корнями t=1 (точка D) и t=1/13 (точка N). Аналогично для BE: t=1/13 даёт точку P (по симметрии).\n\nШаг 4. Координаты N=(1/13)D, P=(1/13)E; так как D,E симметричны относительно оси x, PN=2·(y-координата D)/13=R/13.\n\nШаг 5. При R=13: PN=13/13=1.\n\nОтвет: 1.',
    hintMd:
      'Введи координаты с вершиной угла в начале координат и биссектрисой вдоль оси x; найди точки касания и диаметрально противоположные точки, затем вторые точки пересечения прямых BD, BE с окружностью через параметризацию.',
    solutionSteps: [
      {
        title: 'Вводим координаты',
        explanation: '$B=(0,0)$, $O=(2R/\\sqrt3,0)$ (при φ=60°), $A$, $C$ — точки касания.',
      },
      {
        title: 'Доказываем пункт а',
        explanation: '$AD=2R\\sin60°=R\\sqrt3$, $BC=R/\\sqrt3$, отношение $=3$.',
      },
      {
        title: 'Находим N и P',
        explanation: 'Решая квадратное уравнение на прямых $BD$, $BE$: $N=D/13$, $P=E/13$.',
      },
      { title: 'Вычисляем PN', explanation: 'При $R=13$: $PN=R/13=1$.' },
    ],
    status: 'published',
  },
  {
    taskNumber: 18,
    topicSlug: 'parameters-trigonometric',
    topicName: 'Тригонометрические уравнения с параметром',
    sourcePage: 4,
    rawStatement:
      'Найдите все значения a, при каждом из которых уравнение cos(ax)=0,4 имеет на отрезке [-π;4π] ровно десять корней. При решении можно воспользоваться оценкой: 1,1<arccos0,4<1,2.',
    conditionMd:
      'Найдите все значения $a$, при каждом из которых уравнение $\\cos(ax)=0.4$ имеет на отрезке $[-\\pi;4\\pi]$ ровно десять корней.\n\nПри решении можно воспользоваться оценкой: $1.1<\\arccos0.4<1.2$.',
    imageUrl: null,
    correctAnswer:
      'a∈(-2-arccos(0.4)/(4π);-2+arccos(0.4)/(4π)]∪[2-arccos(0.4)/(4π);2+arccos(0.4)/(4π))',
    correctAnswerDisplay:
      '$a\\in\\left(-2-\\dfrac{\\arccos0.4}{4\\pi};-2+\\dfrac{\\arccos0.4}{4\\pi}\\right]\\cup\\left[2-\\dfrac{\\arccos0.4}{4\\pi};2+\\dfrac{\\arccos0.4}{4\\pi}\\right)$',
    explanationMd:
      'Что дано: cos(ax)=0.4 на x∈[−π;4π] (длина отрезка 5π), φ=arccos0.4∈(1.1;1.2).\n\nИдея: решения cos(y)=0.4 — это y=2πn±φ. При x=ax, подставляя границы x=−π и x=4π, считаем количество целых n в соответствующих интервалах для каждой из двух серий.\n\nШаг 1. Для a>0: серия "+φ" даёт целые n в [−a/2−φ/(2π); 2a−φ/(2π)]; серия "−φ" — в [−a/2+φ/(2π); 2a+φ/(2π)].\n\nШаг 2. При a=2 обе серии дают по 5 целых точек — итого 10 корней.\n\nШаг 3. Анализ малых отклонений a=2+ε показывает, что количество остаётся равным 10 при ε∈[−φ/(4π); φ/(4π)) (левая граница включена, так как соответствующий корень x=4π для серии "−φ" входит в замкнутый отрезок; правая граница исключена, так как при ней добавляется корень x=4π серии "+φ", что даёт уже 11).\n\nШаг 4. Значит для положительных a: a∈[2−φ/(4π); 2+φ/(4π)).\n\nШаг 5. По симметрии (cos(ax)=cos(−ax)) для отрицательных a: a∈(−2−φ/(4π); −2+φ/(4π)].\n\nОтвет: a∈(−2−arccos0.4/(4π); −2+arccos0.4/(4π)] ∪ [2−arccos0.4/(4π); 2+arccos0.4/(4π)).',
    hintMd:
      'Запиши решения cos(y)=0.4 как y=2πn±arccos0.4, подставь y=ax и посчитай количество целых n, попадающих в отрезок, соответствующий x∈[-π;4π], как функцию от a; найди границы, при которых количество корней меняется с 9 на 10 и с 10 на 11.',
    solutionSteps: [
      {
        title: 'Записываем общее решение',
        explanation:
          '$\\cos y=0.4 \\;\\Leftrightarrow\\; y=2\\pi n\\pm\\varphi$, где $\\varphi=\\arccos0.4$.',
      },
      {
        title: 'Считаем корни как функцию от a',
        explanation: 'При $a=2$ обе серии дают по $5$ корней на $[-\\pi;4\\pi]$ — итого $10$.',
      },
      {
        title: 'Находим границы устойчивости счёта',
        explanation: 'Количество остаётся $10$ при $a\\in[2-\\varphi/(4\\pi);2+\\varphi/(4\\pi))$.',
      },
      {
        title: 'Учитываем симметрию по знаку a',
        explanation: '$\\cos(ax)=\\cos(-ax)$ даёт зеркальный интервал для отрицательных $a$.',
      },
    ],
    status: 'published',
  },
  {
    taskNumber: 19,
    topicSlug: 'number-theory-digits',
    topicName: 'Числа и их цифры',
    sourcePage: 4,
    rawStatement:
      'На доске написаны три различных натуральных числа. Второе число равно учетверённой сумме цифр первого, а третье равно учетверённой сумме цифр второго. а) Может ли сумма этих чисел быть равна 2025? б) Может ли сумма этих чисел быть равна 2026? в) Найдите количество четырёхзначных чисел, которые могут быть первым числом в тройке, при условии, что третье число равно 16.',
    conditionMd:
      'На доске написаны три различных натуральных числа. Второе число равно учетверённой сумме цифр первого, а третье равно учетверённой сумме цифр второго.\n\nа) Может ли сумма этих чисел быть равна $2025$?\n\nб) Может ли сумма этих чисел быть равна $2026$?\n\nв) Найдите количество четырёхзначных чисел, которые могут быть первым числом в тройке, при условии, что третье число равно $16$.',
    imageUrl: null,
    answerType: 'multi_part',
    // Part а verified by direct example: N1=1941 (digit sum 15), N2=60,
    // N3=24, sum=2025, all distinct. Part б verified by exhaustive
    // search over all plausible digit sums S1=1..36 — no S1 yields a
    // self-consistent N1. Part в: N3=16 forces digitsum(N2)=4 with N2=4·S1
    // a multiple of 4, giving N2∈{4,40,112} hence S1∈{1,10,28}; counted
    // via stars-and-bars with inclusion-exclusion for digit bounds.
    correctAnswer: serializeMultiPartSpec({
      parts: [
        { id: 'a', label: 'а', answerType: 'short_answer', correctAnswer: 'да' },
        { id: 'b', label: 'б', answerType: 'short_answer', correctAnswer: 'нет' },
        { id: 'c', label: 'в', answerType: 'short_answer', correctAnswer: '385' },
      ],
    }),
    explanationMd:
      'Что дано: N1 (первое), N2=4·(сумма цифр N1), N3=4·(сумма цифр N2), все три различны.\n\n### А\nПример: N1=1941 (сумма цифр 1+9+4+1=15), N2=4·15=60, N3=4·6=24. Сумма=1941+60+24=2025, числа различны. Значит да.\n\n### Б\nПолный перебор сумм цифр S1=1..36 (и соответствующих N1=2026−4S1−4·(сумма цифр 4S1)) с проверкой самосогласованности не даёт ни одного решения. Значит нет.\n\n### В\nN3=16 ⟹ сумма цифр N2 равна 4. Так как N2=4·S1 всегда кратно 4, ищем кратные 4 от 4 до 144 (N1 четырёхзначное, S1≤36, N2≤144) с суммой цифр 4: это 4, 40, 112. Соответствующие S1=1, 10, 28.\n\nДля каждого S1 считаем количество четырёхзначных чисел с такой суммой цифр:\n\n- S1=1: 1 число (1000).\n- S1=10: 219 чисел.\n- S1=28: 165 чисел.\n\nИтого: 1+219+165=385.\n\nОтвет: а) да; б) нет; в) 385.',
    hintMd:
      'Для пункта в) определи, какие кратные 4 в диапазоне [4;144] имеют сумму цифр 4, затем для каждой соответствующей суммы цифр S1 первого числа посчитай количество четырёхзначных чисел методом включений-исключений.',
    solutionSteps: [
      {
        title: 'Строим пример для пункта а',
        explanation: '$N_1=1941,\\ N_2=60,\\ N_3=24$: сумма $=2025$.',
      },
      {
        title: 'Проверяем пункт б полным перебором',
        explanation:
          'Ни одна из сумм цифр $S_1=1,\\ldots,36$ не даёт самосогласованного $N_1$ с суммой $2026$.',
      },
      {
        title: 'Находим возможные S1 для пункта в',
        explanation:
          '$N_3=16 \\;\\Rightarrow\\;$ сумма цифр $N_2=4$, $N_2$ кратно $4$ $\\;\\Rightarrow\\; N_2\\in\\{4,40,112\\} \\;\\Rightarrow\\; S_1\\in\\{1,10,28\\}$.',
      },
      {
        title: 'Считаем четырёхзначные числа',
        explanation: 'Количества: $1$, $219$, $165$ — итого $385$.',
      },
    ],
    status: 'published',
  },
];

export function partForTaskNumber(taskNumber: number): 1 | 2 {
  return taskNumber <= 12 ? 1 : 2;
}

function difficultyForTaskNumber(taskNumber: number): 1 | 2 | 3 {
  return partForTaskNumber(taskNumber) === 1 ? 2 : 3;
}

function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function contentHashFor(subjectId: string, taskNumber: number, statement: string): string {
  return createHash('sha256')
    .update(`${subjectId}|${taskNumber}|${normalizeForHash(statement)}`)
    .digest('hex');
}

export async function importVariant8(db: Database) {
  await db
    .insert(schema.subjects)
    .values({ id: 'math', name: 'Математика' })
    .onConflictDoUpdate({ target: schema.subjects.id, set: { name: 'Математика' } });

  const topicIdBySlug = new Map<string, string>();
  for (const slug of new Set(importTasks.map((t) => t.topicSlug))) {
    const topicName = importTasks.find((t) => t.topicSlug === slug)!.topicName;
    const [topic] = await db
      .insert(schema.topics)
      .values({ subjectId: 'math', slug, name: topicName })
      .onConflictDoUpdate({
        target: [schema.topics.subjectId, schema.topics.slug],
        set: { name: topicName },
      })
      .returning();
    topicIdBySlug.set(slug, topic!.id);
  }

  const [collection] = await db
    .insert(schema.collections)
    .values({
      subjectId: 'math',
      slug: COLLECTION_SLUG,
      title: COLLECTION_TITLE,
      publisher: COLLECTION_PUBLISHER,
      year: SOURCE_YEAR,
      status: 'published',
    })
    .onConflictDoUpdate({
      target: schema.collections.slug,
      set: { title: COLLECTION_TITLE, publisher: COLLECTION_PUBLISHER, year: SOURCE_YEAR },
    })
    .returning();

  const [variant] = await db
    .insert(schema.variants)
    .values({
      collectionId: collection!.id,
      variantNumber: VARIANT,
      title: VARIANT_TITLE,
      year: SOURCE_YEAR,
      status: 'published',
      sourceFile: SOURCE_FILE,
      sourcePageStart: SOURCE_PAGE_START,
      sourcePageEnd: SOURCE_PAGE_END,
    })
    .onConflictDoUpdate({
      target: [schema.variants.collectionId, schema.variants.variantNumber],
      set: {
        title: VARIANT_TITLE,
        sourceFile: SOURCE_FILE,
        sourcePageStart: SOURCE_PAGE_START,
        sourcePageEnd: SOURCE_PAGE_END,
        updatedAt: new Date(),
      },
    })
    .returning();

  const existingRows = await db
    .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, 'math'),
        eq(schema.tasks.source, SOURCE),
        eq(schema.tasks.sourceVariant, VARIANT),
      ),
    );
  const existingIdByNumber = new Map(existingRows.map((r) => [r.taskNumber, r.id]));

  const taskIds: string[] = [];
  for (const t of importTasks) {
    const values = {
      subjectId: 'math',
      taskNumber: t.taskNumber,
      topicId: topicIdBySlug.get(t.topicSlug),
      difficulty: difficultyForTaskNumber(t.taskNumber),
      conditionMd: t.conditionMd,
      imageUrl: t.imageUrl,
      answerType: t.answerType ?? ('short_answer' as const),
      correctAnswer: t.correctAnswer,
      correctAnswerDisplay: t.correctAnswerDisplay ?? null,
      explanationMd: t.explanationMd,
      hintMd: t.hintMd,
      solutionSteps: t.solutionSteps,
      source: SOURCE,
      sourceUrl: null,
      sourceYear: SOURCE_YEAR,
      sourceDocument: SOURCE_DOCUMENT,
      sourceVariant: VARIANT,
      sourcePage: t.sourcePage,
      rawStatement: t.rawStatement,
      contentHash: contentHashFor('math', t.taskNumber, t.rawStatement),
      tags: [IMPORT_TAG],
      status: t.status,
    };

    const existingId = existingIdByNumber.get(t.taskNumber);
    if (existingId) {
      await db
        .update(schema.tasks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.tasks.id, existingId));
      taskIds.push(existingId);
    } else {
      const [row] = await db.insert(schema.tasks).values(values).returning({ id: schema.tasks.id });
      taskIds.push(row!.id);
    }
  }

  for (let i = 0; i < importTasks.length; i++) {
    await db
      .insert(schema.variantTasks)
      .values({ variantId: variant!.id, taskId: taskIds[i]!, position: importTasks[i]!.taskNumber })
      .onConflictDoUpdate({
        target: [schema.variantTasks.variantId, schema.variantTasks.taskId],
        set: { position: importTasks[i]!.taskNumber },
      });
  }

  return {
    total: importTasks.length,
    published: importTasks.filter((t) => t.status === 'published').length,
    needsReview: importTasks.filter((t) => t.status === 'needs_review').length,
    collectionId: collection!.id,
    variantId: variant!.id,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const result = await importVariant8(db);
    console.log(
      `Imported ${result.total} tasks from Вариант 8 (${result.published} published, ${result.needsReview} needs_review).`,
    );
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
