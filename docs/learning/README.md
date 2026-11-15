# Learning Engine — с чего начать

Learning Engine — система персонального обучения Зубрилки. Каждый ответ ученика проходит через одну модель ученика, и из неё берутся статистика, рекомендации и умные тренировки:

```
ответ → попытка → навык (тема ЕГЭ) → модель ученика → аналитика / рекомендации / умная тренировка
```

| Документ | О чём |
|---|---|
| [LEARNING-ENGINE-ARCHITECTURE.md](LEARNING-ENGINE-ARCHITECTURE.md) | Модули, таблицы, путь данных, где что лежит |
| [ALGORITHMS.md](ALGORITHMS.md) | Формулы: освоение навыка, рекомендации, подбор заданий, тренировка, сложность |
| [IMPORT-INTEGRATION.md](IMPORT-INTEGRATION.md) | Как новые варианты подключаются автоматически, что делать при импорте |
| [API.md](API.md) | Эндпоинты, ответы, защита |
| [TESTING.md](TESTING.md) | Какие тесты есть и как их запускать |
| [LEARNING-COVERAGE.md](LEARNING-COVERAGE.md) | Покрытие заданий навыками по номерам ЕГЭ |
| [LEARNING-ENGINE-AUDIT.md](LEARNING-ENGINE-AUDIT.md) | Аудит перед переработкой (ноябрь 2026): что было сломано |

## Главное за минуту
- **Навык = тема спецификации ЕГЭ** (`EXAM_TOPICS` в `packages/shared/src/examSpecs.ts`), например `math.finance` или `russian.15-n-nn`.
  - Ключ навыка не зависит от года, варианта и редакции.
  - Задание связывается с навыком по своим метаданным (`subjectId`, `source`, `sourceYear`, `taskNumber`), а не по списку id.
- **Связи создаёт `syncTaskSkills`** (`packages/db/src/learningSkills.ts`) — при каждом старте API, а для отдельного задания ещё и в момент ответа. Ручных шагов после импорта нет.
- **Модель ученика** — `apps/api/src/modules/learning/engine/model.ts`. Освоение считается одной формулой (`calculateSkillMastery`) и для хранимой статистики, и для модели.
- **Всё, что влияет на прогресс, считается на сервере.** Клиент только показывает.

## Миграции этого блока
| Миграция | Что делает |
|---|---|
| `0040_task_difficulty_ratings.sql` | Новая таблица оценок сложности 1–10. PK (`user_id`, `task_id`), `CHECK 1..10`, индекс по заданию. |
| `0041_learning_session_training_plan.sql` | Новая колонка `learning_sessions.training_plan jsonb` (nullable). Существующие строки не меняются. |

Обе миграции только добавляют. Их применяет обычный сервис `migrate` при деплое. На production мы их сами не запускали.

**После первого деплоя** API при старте:
1. связывает все задания с навыками;
2. пересчитывает статистику навыков всех учеников из истории их попыток.

Это видно в логе: `learning: task skills synced` и `learning: skill statistics up to date`.

## Ручные команды (не нужны в обычной работе)
```
DATABASE_URL=… pnpm --filter @zybrilka/db learning:sync-skills   # связать задания с навыками
DATABASE_URL=… pnpm --filter @zybrilka/db learning:coverage      # таблица покрытия
DATABASE_URL=… pnpm --filter @zybrilka/api skills:rebuild-stats  # пересчитать статистику навыков всех учеников
```
