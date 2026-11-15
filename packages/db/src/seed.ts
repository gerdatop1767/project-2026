import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import { syncSubjects } from './syncSubjects.js';
import * as schema from './schema.js';

/**
 * Small MVP seed for the task engine (docs/ARCHITECTURE.md §13 S2):
 * math task numbers 1-5, a couple of tasks each. These are explicitly
 * NOT official FIPI material — `source` says so on every row — just
 * original demo content so the task screen has something real to
 * fetch while the Import Center (later stage) brings in a real bank.
 *
 * Idempotent: re-running replaces only the rows this seed itself
 * created (matched by `source`), never touching tasks added later by
 * an admin or a real import.
 */
const DEMO_SOURCE = 'Zybrilka demo (не ФИПИ)';

interface SeedTask {
  taskNumber: number;
  topicSlug: string;
  topicName: string;
  difficulty: 1 | 2 | 3;
  conditionMd: string;
  correctAnswer: string;
  explanationMd: string;
}

const seedTasks: readonly SeedTask[] = [
  {
    taskNumber: 1,
    topicSlug: 'practical-arithmetic',
    topicName: 'Числа и вычисления',
    difficulty: 1,
    conditionMd:
      'Билет на автобус стоит 50 рублей. Школьникам предоставляется скидка 20%. Сколько рублей стоит билет для школьника?',
    correctAnswer: '40',
    explanationMd:
      'Скидка составляет 20% от 50 рублей, то есть 0.2 × 50 = 10 рублей. Цена со скидкой: 50 − 10 = 40 рублей.',
  },
  {
    taskNumber: 1,
    topicSlug: 'practical-arithmetic',
    topicName: 'Числа и вычисления',
    difficulty: 1,
    conditionMd:
      'Товар стоил 2000 рублей. Его цена выросла на 15%. Сколько рублей стал стоить товар?',
    correctAnswer: '2300',
    explanationMd: 'Рост цены: 0.15 × 2000 = 300 рублей. Новая цена: 2000 + 300 = 2300 рублей.',
  },
  {
    taskNumber: 2,
    topicSlug: 'data-reading',
    topicName: 'Чтение данных',
    difficulty: 1,
    conditionMd:
      'В таблице показано количество осадков (в мм) по месяцам: январь — 40, февраль — 35, март — 50, апрель — 45. На сколько миллиметров осадков в марте больше, чем в феврале?',
    correctAnswer: '15',
    explanationMd: 'В марте выпало 50 мм, в феврале — 35 мм. Разница: 50 − 35 = 15 мм.',
  },
  {
    taskNumber: 2,
    topicSlug: 'data-reading',
    topicName: 'Чтение данных',
    difficulty: 1,
    conditionMd:
      'За неделю температура воздуха была: пн 10°C, вт 12°C, ср 9°C, чт 11°C, пт 13°C. Найдите среднюю температуру за эти 5 дней.',
    correctAnswer: '11',
    explanationMd:
      'Сумма температур: 10 + 12 + 9 + 11 + 13 = 55. Среднее значение: 55 / 5 = 11 градусов.',
  },
  {
    taskNumber: 3,
    topicSlug: 'planimetry',
    topicName: 'Планиметрия',
    difficulty: 2,
    conditionMd:
      'Периметр квадрата равен 24 см. Найдите площадь этого квадрата в квадратных сантиметрах.',
    correctAnswer: '36',
    explanationMd:
      'Сторона квадрата: 24 / 4 = 6 см. Площадь квадрата: 6 × 6 = 36 квадратных сантиметров.',
  },
  {
    taskNumber: 3,
    topicSlug: 'planimetry',
    topicName: 'Планиметрия',
    difficulty: 2,
    conditionMd:
      'Площадь прямоугольника равна 48 см², а одна из его сторон равна 6 см. Найдите периметр прямоугольника в сантиметрах.',
    correctAnswer: '28',
    explanationMd:
      'Вторая сторона: 48 / 6 = 8 см. Периметр: 2 × (6 + 8) = 2 × 14 = 28 сантиметров.',
  },
  {
    taskNumber: 4,
    topicSlug: 'probability',
    topicName: 'Вероятность',
    difficulty: 2,
    conditionMd:
      'В коробке лежат 10 шаров: 4 красных и 6 синих. Наугад вынимают один шар. Найдите вероятность того, что шар окажется красным.',
    correctAnswer: '0.4',
    explanationMd: 'Вероятность равна отношению красных шаров к общему числу: 4 / 10 = 0.4.',
  },
  {
    taskNumber: 4,
    topicSlug: 'probability',
    topicName: 'Вероятность',
    difficulty: 2,
    conditionMd: 'Монету бросают дважды. Найдите вероятность того, что оба раза выпадет орёл.',
    correctAnswer: '0.25',
    explanationMd:
      'События независимы, вероятность орла в каждом броске 0.5. Вероятность двух орлов подряд: 0.5 × 0.5 = 0.25.',
  },
  {
    taskNumber: 5,
    topicSlug: 'simple-equations',
    topicName: 'Уравнения',
    difficulty: 1,
    conditionMd: 'Найдите корень уравнения 3x − 7 = 11.',
    correctAnswer: '6',
    explanationMd: '3x = 11 + 7 = 18, откуда x = 18 / 3 = 6.',
  },
  {
    taskNumber: 5,
    topicSlug: 'simple-equations',
    topicName: 'Уравнения',
    difficulty: 1,
    conditionMd: 'Найдите корень уравнения 5(x + 2) = 35.',
    correctAnswer: '5',
    explanationMd: 'x + 2 = 35 / 5 = 7, откуда x = 7 − 2 = 5.',
  },
];

export async function seed(db: Database) {
  await syncSubjects(db);

  const topicIdBySlug = new Map<string, string>();
  for (const slug of new Set(seedTasks.map((t) => t.topicSlug))) {
    const topicName = seedTasks.find((t) => t.topicSlug === slug)!.topicName;
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

  // `task_skills` is derived from task metadata (learningSkills.ts) and is
  // recreated by the next sync; drop it so the demo tasks can be replaced.
  const demoTaskIds = db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, DEMO_SOURCE)));
  await db.delete(schema.taskSkills).where(inArray(schema.taskSkills.taskId, demoTaskIds));
  await db
    .delete(schema.tasks)
    .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, DEMO_SOURCE)));

  await db.insert(schema.tasks).values(
    seedTasks.map((t) => ({
      subjectId: 'math',
      taskNumber: t.taskNumber,
      topicId: topicIdBySlug.get(t.topicSlug),
      difficulty: t.difficulty,
      conditionMd: t.conditionMd,
      correctAnswer: t.correctAnswer,
      explanationMd: t.explanationMd,
      source: DEMO_SOURCE,
      sourceYear: 2026,
      status: 'published' as const,
    })),
  );

  return { taskCount: seedTasks.length };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema });
    const result = await seed(db);
    console.log(`Seeded ${result.taskCount} demo tasks.`);
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
