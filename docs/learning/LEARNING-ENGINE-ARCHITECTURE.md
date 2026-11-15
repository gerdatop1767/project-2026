# Learning Engine — архитектура

## Путь данных
```
POST /tasks/:id/attempt ──► submitAttempt (одна транзакция)
                              ├─ attempts            (попытка; ответ проверяет сервер)
                              ├─ mistakes            («Мои ошибки»)
                              ├─ user_daily_activity (серия)
                              ├─ task_skills         (если у задания ещё нет навыка — syncTaskSkills для него)
                              ├─ user_skill_statistics (пересчёт навыка из полной истории)
                              ├─ task_statistics     (статистика задания)
                              ├─ user_error_statistics
                              └─ xp_events           (опыт)

GET /me/learning/overview|recommendations|analytics ──► buildStudentModel ──► recommendSkills / nextActionFor
POST /me/learning/sessions ──► planTraining ──► pickForSlot (на каждом шаге) ──► trainingOutcome (итог)
```

Двойного учёта нет:
- одна попытка — одна строка `attempts`;
- статистика навыка каждый раз пересчитывается из полной истории, а не прибавлением;
- итоги предмета дедуплицируют задания с двумя навыками.

## Где что лежит
| Слой | Файл | Что делает |
|---|---|---|
| Реестр ЕГЭ | `packages/shared/src/examSpecs.ts` | Темы (`EXAM_TOPICS`), номера трёх редакций, `examEditionForTask`, `topicKeysForTask` |
| Навыки | `packages/shared/src/learning/examSkills.ts` | `examSkillsForTask(task)` — навыки задания по метаданным; `examSkillInfo(key)` — № в актуальной редакции |
| Освоение | `packages/shared/src/learning/mastery.ts` | `calculateSkillMastery`, `skillLevel` (ALGORITHMS § 1) |
| Сложность | `packages/shared/src/learning/difficultyRating.ts` | Агрегат оценок 1–10, `effectiveDifficulty` (ALGORITHMS § 5) |
| Рекомендации и план | `packages/shared/src/learning/engine.ts` | `recommendSkills`, `planTraining`, `splitByMix`, `targetDifficultyFor`, `nextActionFor`, DTO |
| Связи задание→навык | `packages/db/src/learningSkills.ts` | `syncTaskSkills`, `ensureExamSkillRows` |
| Покрытие | `packages/db/src/learningCoverage.ts` | `learningCoverage`, `coverageMarkdown` |
| Старт API | `apps/api/src/modules/learning/bootstrap.ts` | Синхронизация связей и пересчёт статистики после каждого деплоя |
| Пересчёт навыка | `apps/api/src/modules/learning/service.ts` | `updateSkillStatisticsForTaskAttempt`, `rebuildUserSkillStatistics` |
| Модель ученика | `apps/api/src/modules/learning/engine/model.ts` | `buildStudentModel` |
| Подбор заданий | `apps/api/src/modules/learning/engine/picker.ts` | `pickTasksForSkill` (ALGORITHMS § 3) |
| Тренировка | `apps/api/src/modules/learning/engine/training.ts` | `startPlannedTraining`, `pickForSlot`, `trainingOutcome` |
| Сервис и маршруты | `apps/api/src/modules/learning/engine/{service,routes}.ts` | overview / recommendations / analytics |
| Оценка сложности | `apps/api/src/modules/learning/difficultyRating/*` | GET/PUT оценки |
| Сессии | `apps/api/src/modules/learning/learningSession/*` | Умная тренировка (план) и варианты |
| UI | `apps/web/src/ui/LearningEngine/*` | `RecommendationsList`, `SkillsPanel`, `DifficultyRating` |
| UI тренировки | `apps/web/src/screens/LearningSession/LearningSession.tsx`, `ui/LearningSession/LearningSessionBadge.tsx` | Причина выбора задания, итог «Что изменилось / Что дальше» |

## Таблицы
| Таблица | Роль | Ключи |
|---|---|---|
| `skills` | Навыки. Тема ЕГЭ: `slug` = ключ темы с точкой (`math.finance`). Навыки-методы №13–19 — `slug` без точки (`substitution`). | unique (`subject_id`, `slug`) |
| `task_skills` | Задание ↔ навык. `source = 'import'` для тем ЕГЭ, `canonical` для методов. | unique (`task_id`, `skill_id`) |
| `user_skill_statistics` | Освоение навыка учеником: `mastery`, `confidence`, счётчики, `last_attempt_at` | unique (`user_id`, `skill_id`) |
| `user_subject_profiles` | Выбранные предметы, `target_score`, `self_reported_score` | unique (`user_id`, `subject_id`) |
| `task_difficulty_ratings` | Оценка сложности 1–10 | PK (`user_id`, `task_id`), CHECK 1..10 |
| `learning_sessions.training_plan` | План умной тренировки: слоты и освоение навыков на старте | — |
| `attempts`, `mistakes`, `task_statistics`, `user_error_statistics` | Источник истины (попытки) и производные | — |

## Единые определения
- **Номер ЕГЭ** для ученика — номер в актуальной редакции (ЕГЭ-2027 = 2026), его даёт `examSkillInfo(key).examNumber`. Задание старой редакции Ященко-2027 попадает в навык своей темы. Например, их №13 «Финансы» — это №16.
- **Тема** — навык (`EXAM_TOPICS`).
- **Подтема** — `tasks.topic` (мелкие темы импортёров). Используется для фильтров в «Тренировке» и не влияет на навыки.
- **Выбранные предметы** — `user_subject_profiles`. Без профиля модель берёт все предметы ЕГЭ, чтобы новому ученику было с чего начать.

## Параллельные запросы и повторные запуски
- **Одна блокировка на ученика.** Транзакция ответа первой берёт `SELECT … FOR UPDATE` строки `user_xp` ученика (`prepareForAward`). Поэтому ответы одного ученика записываются строго по очереди. Каждый следующий видит попытки предыдущего.
- **Пересчёт статистики** (`rebuildUserSkillStatistics` — при старте API и в `skills:rebuild-stats`) берёт ту же блокировку (`lockUserLearningState`) и работает в одной транзакции на ученика:
  - один запрос за всей историей;
  - одна запись для всех навыков.

  Ответ, записанный во время пересчёта, не будет затёрт старым значением. Повторный запуск (рестарт API) безопасен: при тех же попытках получаются те же строки, а без изменений связей ученики не пересчитываются.
- **Синхронизация связей** (`syncTaskSkills`) ничего не пишет, если всё уже связано:
  - строки `skills` вставляются только недостающие, обновляются только изменившиеся;
  - связи вставляются с `ON CONFLICT DO NOTHING`.

  Поэтому вызов в транзакции ответа не блокирует строки навыков.
- **Умная тренировка, `/next`:** задание добавляется в сессию условным `UPDATE` (сессия активна и в ней столько заданий, сколько видел запрос). Двойное нажатие выдаёт одно задание: второй запрос возвращает то, что выдал первый.

## Старые модули
- **`GET /me/learning/next-task` и `GET /me/learning/path`** (фазы 7–8) по-прежнему работают и теперь читают заполненную статистику навыков. Веб-приложение их не использует.
- **Умная тренировка:**
  - сессии с планом идут через Learning Engine;
  - сессии, начатые до миграции 0041, доводятся старым путём (`getLearningPath`);
  - тот же старый путь используется, если для предмета нет ни одного задания со связями.

## Порядок расширения
- **Новый номер или новая редакция:** добавить спецификацию в `examSpecs.ts` (тему, номер, редакцию, правило `examEditionForTask`). Задания свяжутся при следующем старте API. Проверка — `learning:coverage`.
- **Новый предмет:**
  - добавить его темы и номера в `examSpecs.ts`;
  - добавить его id в `EXAM_SUBJECTS` (`engine/model.ts`) и в схему запроса `routes.ts`.
- **Новый сигнал рекомендаций:**
  - поле в `SkillState`, расчёт в `buildStudentModel`;
  - правило в `recommendSkill` (`engine.ts`);
  - юнит-тест в `engine.test.ts`.
- **Другие пропорции тренировки** — параметр `mix` в `POST /me/learning/sessions` или константа `DEFAULT_TRAINING_MIX`.
