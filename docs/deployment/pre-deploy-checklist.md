# Чек-лист перед развёртыванием: ветка `feat/math-2027-yashchenko-variants`

Чек-лист собран на заключительной проверке перед деплоем 31.10.2026.

Всё, что помечено ✅, проверено локально:
- на тестовой PostgreSQL 16;
- через собранные production-артефакты.

С боевой базой и VPS проверка не работала. Подробные результаты — в `docs/testing/ege-2027-pre-deploy-report.md`.

Общая документация по стеку — `docs/DEPLOYMENT.md`. На текущем VPS используются:
- checkout `/opt/Zybrilka-release`;
- локальный файл `infra/docker-compose.deploy.yml`, которого **нет в репозитории**;
- переменные из `/opt/Zybrilka/infra/.env`.

Команды ниже записаны для этой схемы. Сокращение:

```bash
C="docker compose -p infra --project-directory /opt/Zybrilka-release --env-file /opt/Zybrilka/infra/.env -f /opt/Zybrilka-release/infra/docker-compose.deploy.yml"
```

## 1. Готовность приложения

| Что | Статус |
|---|---|
| `pnpm check` (format, lint, typecheck, 3548 тестов, build) | ✅ проходит |
| Production-сборка web (`vite build`) и API/db/shared (`tsc`) | ✅ |
| Бандл API `pnpm deploy --prod`: импортёры В1–В25 есть и запускаются из него | ✅ |
| Миграции на пустой PostgreSQL 16 (36 штук) | ✅ |
| Обновление базы с данными учеников с версии `main` | ✅ данные не изменились |
| Повторный деплой поверх базы с данными (идемпотентность) | ✅ данные и id заданий не изменились |
| `docker compose config` | ✅ валиден, 8 сервисов |
| Сборка Docker-образов | ⚠️ здесь не завершена: у контейнеров сборки нет доступа к npm. Собрать на VPS — шаг 3.2 |
| Секреты в Git | ✅ нет: `.env` никогда не коммитился, токены в тестах — заведомые заглушки |

Миграция ветки относительно `main` одна — `0035_exam_sources_scoring.sql`. В ней:
- только `ADD COLUMN` (6 столбцов);
- у `NOT NULL` задан `DEFAULT`;
- ничего не удаляется.

Во всех 36 миграциях нет `DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE`.

## 2. Обязательные переменные окружения

Файл — `/opt/Zybrilka/infra/.env`. Шаблон — `infra/.env.example`. Все переменные из `infra/docker-compose.yml` в шаблоне есть.

| Переменная | Обязательна | Зачем |
|---|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | да | база; пароль — реальный секрет, не `change-me…` |
| `WEB_BASE_URL` | да | `https://zybrilka.ru`: ссылки и OAuth-возвраты |
| `APP_VERSION` | желательно | видна в `/health` — по ней видно, что поднялась новая версия |
| `TELEGRAM_BOT_TOKEN` | да для Mini App | вход в Telegram Mini App, бот. Без него `/auth/telegram` отвечает 503 |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | нет (по умолчанию 3600) | срок годности `initData` |
| `TELEGRAM_BOT_POLLING` | нет | режим получения обновлений ботом |
| `VK_CLIENT_ID`, `VK_CLIENT_SECRET`, `VK_REDIRECT_URI` | да для входа на сайте | вход через VK ID |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `YANDEX_REDIRECT_URI` | да для входа на сайте | вход через Яндекс ID |
| `ADMIN_OWNER_USER_IDS` | нет | id владельцев админки; пусто — админки нет ни у кого |

`DATABASE_URL` для `api`, `worker` и `migrate` собирается в compose из `POSTGRES_*`. В production без него API не стартует — так задумано.

Новых переменных в этом релизе нет.

## 3. Команды

### 3.1. Резервная копия — до любых изменений

```bash
mkdir -p /opt/Zybrilka/backups
$C exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "/opt/Zybrilka/backups/zybrilka-$(date +%Y%m%d-%H%M%S).dump"
ls -la /opt/Zybrilka/backups/ | tail -3            # файл есть и не пустой
```

Проверьте, что копию можно прочитать:

```bash
pg_restore --list <файл> | head
```

Это читает только оглавление копии и ничего не восстанавливает.

### 3.2. Код и сборка

```bash
cd /opt/Zybrilka-release
git fetch origin feat/math-2027-yashchenko-variants
git checkout feat/math-2027-yashchenko-variants
git pull origin feat/math-2027-yashchenko-variants
git log --oneline -1                               # ожидаемый последний коммит ветки
$C config --quiet                                  # конфигурация валидна
$C build api web                                   # (и worker, если он в файле)
```

### 3.3. Миграции

```bash
$C run --rm migrate                                # применит 0035; повторный запуск безопасен
```

### 3.4. Контент: варианты ЕГЭ-2027 Ященко 1–25

Сначала посмотрите, что умеет локальный файл. Он не из репозитория.

```bash
$C config --services | grep -c sync-content
$C config | grep -c importEge2027YashchenkoVariant
```

- **В локальном файле есть `sync-content`, и в нём есть все 25 импортёров** (второе число — 25). Контент загрузится при `up`. Отдельно запускать ничего не нужно.
- **Иначе** — разовый запуск тем же образом, что у `migrate`. Файл при этом не меняется.

```bash
for n in $(seq 1 25); do
  $C run --rm migrate node node_modules/@zybrilka/db/dist/importEge2027YashchenkoVariant$n.js || break
done
```

Каждая строка должна закончиться словами `Imported 20 tasks … (N published, M needs_review)`. После вариантов 1–25 итог такой: 488 published, 12 needs_review.

Повторный запуск безопасен. Это upsert по (варианту, номеру): id заданий и прогресс учеников сохраняются. Статус тоже обновляется, поэтому В4 №15 уйдёт в needs_review.

### 3.5. Запуск

```bash
$C up -d api web          # и worker, если он обновлялся
$C ps                     # api/web — healthy, migrate — exited (0)
```

## 4. Проверка работоспособности после деплоя

```bash
curl -fsS https://zybrilka.ru/health
# {"status":"ok","version":"<APP_VERSION>","db":"ok",...}

curl -fsS https://zybrilka.ru/api/v1/collections | grep -o '"slug":"ege-2027-yashchenko"'
# сборник есть

$C exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select status, count(*) from tasks where source like '"'"'Ященко ЕГЭ 2027%'"'"' group by 1"'
# published|488, needs_review|12
```

Ручная проверка — 10 минут. Её не заменяет ни один локальный тест.

1. Откройте `https://zybrilka.ru` в Safari на iPhone. Нажмите «Войти»: вход через VK ID и через Яндекс ID проходит до конца.
2. Откройте Mini App из настоящего Telegram на iOS и Android:
   - вход происходит автоматически;
   - новый пользователь видит онбординг;
   - старый сразу попадает на главную.
3. Задания → Вариант → «ЕГЭ 2027 Ященко» → Вариант 4. Должно быть «1 из 19», №15 в ленте номеров нет.
4. Решите одно задание верно и одно неверно:
   - после верного ответа на экране «+15 XP»;
   - «Мои ошибки» показывают неверное;
   - в «Статистике» «Решено» увеличилось на 1.
5. Закройте и снова откройте Mini App: прогресс на месте.
6. Откройте задание с рисунком (В11 №9) в светлой и тёмной теме. Подписи на месте, у формул нет синих пятен.

## 5. Откат

Код:

```bash
cd /opt/Zybrilka-release
git checkout <предыдущий рабочий коммит>
$C build api web && $C up -d api web
```

Предыдущий рабочий коммит:
- текущий `main` на момент проверки — `2d92a5f`;
- либо то, что было развёрнуто до этого.

База: миграция 0035 только добавляет столбцы. Старый код их не читает и с новой схемой работает. **Откатывать схему не нужно.**

Контент 2027:
- старая версия его не показывает, если у неё нет сборника ЕГЭ-2027;
- если показывает, то только `published`.

Удалять задания ради отката не нужно.

Восстановление из копии (`docs/DEPLOYMENT.md` → Restore) — разрушительная операция. Её применяют только при повреждении данных:
- сначала новая резервная копия;
- затем `pg_restore --clean`;
- никогда в рамках обычного отката.

## 6. Известные ограничения

Подробно — в отчёте, раздел «Оставшиеся ограничения».

- **Сайт, вход.** Только VK ID и Яндекс ID. Оба OAuth проверяются лишь на настоящем домене, ручной шаг 4.1.
- **Mini App.** Проверено эмуляцией запуска (`#tgWebAppData`, подписанный тестовым токеном), но не в настоящем Telegram. Ручной шаг 4.2.
- **Лимит входа через Telegram.** 30 входов за 10 минут на один IP. Ученики за общим NAT (школа, мобильный оператор) могут упереться в него, и тогда Mini App молча останется в гостевом режиме. Решение о лимите — за владельцем.
- **Safari/WebKit и Firefox.** Локально не проверялись: в окружении есть только Chromium.
- **Ещё не реализовано:** начальной диагностики нет (онбординг — самооценка); экран «Достижения» — заглушка.
- **Задания.** 12 заданий ЕГЭ-2027 скрыты (needs_review), см. `docs/imports/ege-2027-yashchenko-v1-v25-final-audit.md`.
