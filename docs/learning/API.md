# Learning Engine — API

Все пути — под `/api/v1`. Личные эндпоинты зарегистрированы в приватной области: в production без сессии отвечают `401`. Все числа считает сервер из попыток самого ученика. Чужие данные запросить нельзя: идентификатор ученика берётся только из сессии. Ответы отдаются с `cache-control: no-store`.

## `GET /me/learning/overview?subject=math|russian`
Модель ученика (`LearningOverviewResponse`).

```jsonc
{
  "hasProfile": true,
  "subjects": [{
    "subjectId": "math", "selected": true, "targetScore": "80_plus",
    "totals": { "attempts": 42, "correct": 30, "solvedTasks": 27, "accuracy": 71 },
    "skills": [{
      "key": "math.equations-advanced", "examNumber": 13, "part": 2, "title": "Уравнения (развёрнутый ответ)",
      "mastery": 35, "confidence": 72, "level": "weak", "attempts": 7, "correct": 4, "incorrect": 3,
      "lastAttemptAt": "…", "daysSince": 2, "trend": "down", "repeatedErrorTasks": 1, "recoveredTasks": 0,
      "recent": { "attempts": 7, "wrong": 3 }, "openMistakes": 2, "stuckAfterExplanation": 0,
      "myAverageRating": 8.5, "hardButCorrect": 1, "availableTasks": 35
    }]
  }]
}
```

- **Предметы:** только выбранные в профиле. Без профиля — все предметы ЕГЭ.
- **`level`:** `none | low_data | weak | developing | strong`. При `none` и `low_data` процент в UI не показывается.

## `GET /me/learning/recommendations?subject=&limit=1..12`
Рекомендации с конкретными заданиями (`LearningRecommendationsResponse`). По умолчанию `limit = 6`.

```jsonc
{ "recommendations": [{
  "subjectId": "math", "skillKey": "math.equations-advanced", "examNumber": 13,
  "title": "Уравнения (развёрнутый ответ)", "kind": "weak", "priority": 84,
  "reason": "За последние 7 попыток — 3 ошибки. Освоение 35%.",
  "benefit": "Задание второй части: даёт больше первичных баллов, чем задания с кратким ответом.",
  "suggestedTasks": 5, "taskIds": ["…", "…"]
}]}
```

`kind`: `repeated_errors | weak | declining | hard_for_me | low_data | stale | unexplored` (см. ALGORITHMS § 2).

## `GET /me/learning/analytics?subject=math|russian` (обязательный)
`LearningAnalyticsResponse`:
- `periods.{day,week,month,all}` — `{attempts, correct, accuracy, solvedTasks}`;
- `timeSpentMinutes` — `{week, all, measuredAttempts}`;
- `byNumber` — `SkillState` + `nextAction`;
- списки `strong | weak | insufficient | declining | improving` (ключи навыков);
- `errors` — `{mostWrong, repeated, afterExplanation}`.

Работает и для предмета, не выбранного в профиле.

## `POST /me/learning/sessions` — умная тренировка
Тело запроса:

| Поле | Тип | Описание |
|---|---|---|
| `subjectId` | string? | Предмет тренировки |
| `limit` | 1..50, по умолчанию 5 (с `smart` — 3..50) | Число заданий |
| `unseenOnly` | boolean? | Только задания, которые ученик ещё не решал |
| `randomizeTopTier` | boolean? | Только для старого пути |
| `focusSkill` | string? | Ключ навыка этого предмета — тренировка «Начать» по рекомендации. Навык другого предмета → `400` |
| `mix` | `{weak, mistakes, stale, strong}`, каждое 0..1, сумма > 0 | Доли корзин |
| `smart` | `{mode, skillKeys?, difficulty?}` | Умная тренировка с настройкой (`SMART-TRAINING.md`): режим `subject / topics / problems / stats / mixed`, темы, сложность `easy / medium / hard / mixed`. Ошибки: `409 not_enough_tasks {available}`, `422 no_problem_topics / no_topics / unknown_topic` |

Ответ — как раньше (`LearningSessionResponse`) плюс `pick`:

```jsonc
"pick": { "bucket": "weak", "skillKey": "russian.09-root-vowels", "examNumber": 9,
          "title": "Правописание корней", "reason": "Слабое место: №9 · Правописание корней (освоение 38%)." }
```

- **`GET /me/learning/sessions/:id/next`** — следующий слот плана.
- **`GET /me/learning/smart-setup?subject=math|russian`** — темы предмета для экрана настройки: освоение, уровень, доступные задания, открытые ошибки, признак проблемы с причинами; `problemKeys`, `subjectTasks`.
- **Итог** (`status: "completed"`) добавляет в `summary`:
  - `skills: [{skillKey, examNumber, title, before, after, attempts, correct}]`;
  - `next` — топ-3 рекомендации по обновлённой модели.

## `GET|PUT /tasks/:id/difficulty-rating`
- **PUT** `{ "rating": 1..10 }` (целое).
- **Ответ** (`DifficultyRatingResponse`):

  ```jsonc
  { "myRating": 7,
    "community": { "count": 6, "used": 5, "median": 8, "confident": true, "band": "hard" } }
  ```

- **Ошибки:**

  | Код | Когда |
  |---|---|
  | `400` | Оценка не 1..10 или неверный id |
  | `401` | Гость |
  | `404` | Задание не найдено или не опубликовано |
  | `409 not_attempted` | Нет ни ответа, ни показа ответа |
  | `429 too_many_ratings` | Больше 30 записей за минуту |

- **Повторы:** одно и то же значение повторно не записывается. Параллельные запросы дают одну строку (PK).

## Прежние эндпоинты (не используются веб-приложением)
- `GET /me/learning/mastery` — строки `user_skill_statistics`.
- `GET /me/learning/next-task`, `GET /me/learning/path` — фазы 7–8. Теперь читают заполненные навыки.
- `GET /me/learning/errors` — сигнатуры ошибок.

## Персональное обучение
Маршруты рекомендаций с диагнозом, советов, планов, прогресса по номеру и настроек уведомлений описаны в `PERSONAL-PLANS.md` § API.
