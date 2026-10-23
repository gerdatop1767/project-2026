# Ручная проверка входа (VK ID + почта) перед включением обязательной авторизации

Это пошаговый чек-лист для владельца проекта. Он описывает проверку сборки из PR #60 (`feat/auth-profile-onboarding`) на VPS. **Реальный вход через VK до выполнения этого чек-листа не проверен ни разу** — ни тестами, ни CI.

Обозначения: 🔒 — только чтение, ничего не меняет; ✏️ — меняет состояние (деплой, перезапуск, запись в БД).

Правила безопасности для всех шагов:

- Не присылайте сырые логи. В `docker logs zybrilka-api` строки `incoming request` для `/api/v1/auth/vk/callback` содержат OAuth-параметры `code`, `state`, `device_id` в URL (проверено). В `docker logs zybrilka-web` могут быть строки `GET /login?token=…` с токеном входа по почте — **их не копировать**. Пользуйтесь только фильтрами из раздела 3.
- Не выводите `infra/.env` (`cat`, `env`, `docker inspect`, `docker compose config`) — там пароли. Раздел 1 показывает только «задано / не задано».
- Не отправляйте скриншоты с адресной строкой VK и страницей согласия, где видны `state`/`code`.

Во всех командах ниже (bash; выполняйте из каталога репозитория на VPS, где лежит `infra/docker-compose.yml`):

```bash
dc() { docker compose --env-file infra/.env -f infra/docker-compose.yml "$@"; }
```

`dc` — это та же команда, которой уже разворачивался стек (проект Compose называется `infra` по имени каталога compose-файла). Перед любым ✏️-шагом убедитесь, что вы в нужном проекте: `docker ps --format '{{.Names}}' | grep '^zybrilka-'` должен показать работающие `zybrilka-postgres`, `zybrilka-api`, `zybrilka-web`, `zybrilka-caddy`. Если список пуст — вы не в том каталоге: **стоп**, ничего не запускать (иначе Compose попытается создать второй стек).

Блоки со словами «в подоболочке» (`( set -euo pipefail … )`) завершаются на первой же ошибке и не трогают вашу сессию; **успехом считается только строка `… OK` в конце вывода**, а не отсутствие красного текста.

## 0. Что именно проверяется (по коду)

| Этап                        | Маршрут / код                                                                                | Что происходит                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Старт                       | `GET /api/v1/auth/vk/start`                                                                  | 503 `vk_not_configured`, если нет `VK_CLIENT_ID`/`VK_CLIENT_SECRET`/`VK_REDIRECT_URI`; иначе кладёт cookie `vk_pkce` (state + code_verifier, 10 мин) и редиректит на `https://id.vk.ru/authorize` (`response_type=code`, PKCE `S256`, `scope=email`) |
| Возврат                     | `GET /api/v1/auth/vk/callback?code&device_id&state`                                          | проверяет cookie и `state`; обменивает код на VK (`POST id.vk.ru/oauth2/auth`, таймаут 5 с); запрашивает профиль (`POST id.vk.ru/oauth2/user_info`, таймаут 5 с, не обязателен)                                                                         |
| Ошибки callback             | 400 `invalid_callback` / `invalid_state`; 502 `vk_login_failed`; 504 `vk_timeout`; 503       | браузер покажет JSON — **запишите его текст**                                                                                                                                                                                                          |
| Успех                       | 302 на `/onboarding` (онбординг не завершён) или на `/` (завершён) + cookie `session_id`     | решает сервер по БД                                                                                                                                                                                                                                    |

Что должно меняться в БД:

| Событие                    | Таблицы / поля                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Первый вход через VK       | `users` +1 строка; `auth_identities` +1 (`provider='vk'`); `users.first_name/last_name/avatar_url` — если VK их вернул; `auth_sessions` +1 (срок 30 дней)                              |
| Онбординг                  | `user_subject_profiles` — строки по выбранным предметам, `onboarding_completed_at` заполнено                                                                                           |
| Выход                      | `auth_sessions` — строка этой сессии удалена                                                                                                                                          |
| Повторный вход через VK    | `users` и `auth_identities` **без новых строк**; `auth_sessions` +1; имя/аватар обновляются только непустыми значениями VK; `users.last_seen_at` не обновляется (в коде этого нет)     |

Эти изменения подтверждены прогоном на настоящем PostgreSQL 16 (запросы из раздела 4).

## 1. 🔒 Конфигурация без раскрытия секретов

```bash
git rev-parse --short HEAD && git status -sb | head -3

dc exec -T api node -e '
const e = process.env, st = (k) => (e[k] ? "set" : "MISSING");
console.log("NODE_ENV =", e.NODE_ENV);
for (const k of ["VK_CLIENT_ID", "VK_CLIENT_SECRET", "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET"]) console.log(k, "=", st(k));
console.log("VK_REDIRECT_URI =", JSON.stringify(e.VK_REDIRECT_URI));
console.log("WEB_BASE_URL    =", JSON.stringify(e.WEB_BASE_URL));
'
```

Ожидается:

- `NODE_ENV = production`;
- `VK_CLIENT_ID`, `VK_CLIENT_SECRET` = `set`;
- `VK_REDIRECT_URI = "https://zybrilka.ru/api/v1/auth/vk/callback"` — без пробелов, без `/` в конце (`JSON.stringify` покажет лишние символы);
- `WEB_BASE_URL = "https://zybrilka.ru"`;

Если что-то `MISSING`: значения не дошли до контейнера. Они читаются из `infra/.env` при создании контейнера; после правки файла нужно ✏️ `dc up -d --no-deps api` (контейнер пересоздастся сам, потому что env изменился). Сам `.env` не печатайте.

Вручную сверьте в консоли VK ID (раздел приложения): «Доверенный Redirect URL» совпадает с `VK_REDIRECT_URI` посимвольно, базовый домен — `zybrilka.ru`, приложение включено, ID приложения совпадает с `VK_CLIENT_ID`. Разрешённые данные: имя, фамилия, аватар (и email — запрашивается как `scope=email`).

## 2. 🔒 Доступность маршрутов

```bash
# 2.1 живость и версия
curl -sS -o /dev/null -w '/health                      %{http_code}\n' https://zybrilka.ru/health

# 2.2 анонимный /auth/me — должен быть 200 и {"user":null}
curl -sS -w '  -> %{http_code}\n' https://zybrilka.ru/api/v1/auth/me

# 2.3 приватный API закрыт; поддельный x-anon-id не помогает
curl -sS -o /dev/null -w 'progress/summary             %{http_code}\n' https://zybrilka.ru/api/v1/progress/summary
curl -sS -o /dev/null -w 'progress/summary (fake anon) %{http_code}\n' -H 'x-anon-id: 7f0c1d5e-3b2a-4c6d-8e9f-0a1b2c3d4e5f' https://zybrilka.ru/api/v1/progress/summary

# 2.4 старт VK: проверяем КУДА редиректит, не печатая state/code_challenge
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' https://zybrilka.ru/api/v1/auth/vk/start | python3 -c '
import sys, urllib.parse as u
code, _, url = sys.stdin.read().partition(" ")
p = u.urlparse(url); q = u.parse_qs(p.query)
print(code, p.scheme + "://" + p.netloc + p.path)
print("redirect_uri =", q.get("redirect_uri"))
print("scope =", q.get("scope"), "| method =", q.get("code_challenge_method"), "| response_type =", q.get("response_type"))
print("has state:", "state" in q, "| has code_challenge:", "code_challenge" in q)'

# 2.5 callback без параметров не падает
curl -sS -w '  -> %{http_code}\n' https://zybrilka.ru/api/v1/auth/vk/callback

# 2.6 страницы SPA
curl -sS -o /dev/null -w '/onboarding %{http_code}\n' https://zybrilka.ru/onboarding

# 2.7 сеть VPS -> VK (только код ответа)
dc exec -T api node -e 'fetch("https://id.vk.ru/", { method: "HEAD", signal: AbortSignal.timeout(5000) }).then((r) => console.log("id.vk.ru ->", r.status)).catch((e) => console.log("id.vk.ru UNREACHABLE:", e.name))'
```

| Шаг | Ожидается                                                                                         | Если иначе                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `200`                                                                                             | `502/504` — api не поднялся: `dc ps`, `dc logs --tail 30 api` (в этих логах нет callback-параметров, пока вы не открывали вход)                                                                                                                    |
| 2.2 | `200` и `{"user":null}`                                                                           | `404` — работает старый образ api (без маршрутов входа): пересоберите (раздел 6)                                                                                                                                                                   |
| 2.3 | оба `401`                                                                                         | `200` — защита не включена (старый образ)                                                                                                                                                                                                         |
| 2.4 | `302 https://id.vk.ru/authorize`, `redirect_uri` равен значению из раздела 1, `scope = ['email']` | `503` — `vk_not_configured` (раздел 1); `redirect_uri` другой — поправьте `VK_REDIRECT_URI`; вместо `302` HTML сайта — Caddy отдаёт устаревший файл, см. `docs/DEPLOYMENT.md` («Verify the edge»)                                                |
| 2.5 | `{"error":"invalid_callback"}` и `400` | `404` — работает старый образ api (без маршрутов входа) |
| 2.6 | `200`                                                                                             | `404` — web не обновлён                                                                                                                                                                                                                           |
| 2.7 | `id.vk.ru -> 200/301/302/403` (любой HTTP-ответ)                                                  | `UNREACHABLE` — VPS не достаёт VK (DNS/файрвол): вход невозможен, исправлять сеть                                                                                                                                                                 |

## 3. 🔒 Логи без токенов, кодов, cookie и персональных данных

Используйте **только** эти два фильтра; они выводят белый список полей. Проверены на образцах: коды, `device_id`, токены, секрет и значения полей профиля не попадают в вывод.

Предупреждения и ошибки входа (после попытки входа):

```bash
docker logs --since 30m zybrilka-api 2>&1 | python3 -c '
import sys, json
KEEP = ("time", "level", "msg", "vkLogin", "vkProfile", "status", "vkError", "topLevelKeys", "userKeys")
for line in sys.stdin:
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get("level", 30) >= 40 or "vkProfile" in d or "vkLogin" in d:
        print({k: d[k] for k in KEEP if k in d})'
```

Ход запросов входа (путь без query-строки + HTTP-статус):

```bash
docker logs --since 30m zybrilka-api 2>&1 | python3 -c '
import sys, json
req = {}
for line in sys.stdin:
    try:
        d = json.loads(line)
    except Exception:
        continue
    i = d.get("reqId")
    if d.get("msg") == "incoming request" and "req" in d:
        req[i] = (d["req"].get("method"), d["req"].get("url", "").split("?")[0])
    elif d.get("msg") == "request completed" and i in req:
        method, path = req[i]
        if path.startswith("/api/v1/auth"):
            print(method, path, d["res"]["statusCode"], "%dms" % round(d.get("responseTime", 0)))'
```

Как читать:

| Вывод                                                                            | Значение и что делать                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| нет предупреждений, `callback … 302`                                             | вход и запрос профиля прошли                                                                                                                                                                                                                    |
| `vkProfile: timeout / network`                                                   | профиль не получен, вход прошёл. Сеть/скорость VPS→VK (шаг 2.7)                                                                                                                                                                                 |
| `vkProfile: http`, `status: 4xx`                                                 | VK отклонил запрос профиля: токен/`client_id`/права. Вход прошёл, имя/аватар не заполнятся                                                                                                                                                      |
| `vkProfile: invalid_response`, `topLevelKeys`                                    | ответ без объекта `user`: форма ответа отличается от предположенной. Пришлите **только** строку (ключи без значений)                                                                                                                            |
| `vkProfile: no_usable_fields`, `userKeys: […]`                                   | объект `user` есть, но поля названы иначе (ожидались `first_name`, `last_name`, `avatar`). Пришлите строку — по именам ключей поправим код                                                                                                      |
| `vkLogin: http`, `status: 400`, `vkError: invalid_grant`                         | код отклонён: чаще всего `redirect_uri` в запросе не совпадает с зарегистрированным, код использован повторно или истёк. Сверьте раздел 1                                                                                                         |
| `vkLogin: http`, `vkError: invalid_client`                                       | неверные `VK_CLIENT_ID`/`VK_CLIENT_SECRET` (или приложению нужен другой тип секрета)                                                                                                                                                            |
| `vkLogin: timeout` (в браузере 504 `vk_timeout`)                                 | VK не ответил за 5 с. Повторите; если стабильно — сеть (шаг 2.7)                                                                                                                                                                                |
| `vkLogin: invalid_response`                                                      | VK ответил 200 без `user_id`: форма ответа обмена кода другая (возможно, нужен иной параметр). Пришлите строку                                                                                                                                  |
| `callback 400` без записей `vkLogin`                                             | не дошло до VK: cookie `vk_pkce` отсутствует (`invalid_callback`) или `state` не совпал/истёк (`invalid_state`). Открывайте вход и подтверждайте в **одной** вкладке/браузере, не дольше 10 минут; не заходите через `www.zybrilka.ru` в середине |

## 4. 🔒 Проверка БД (только чтение, без ids/имён/URL)

Функция-обёртка: сессия БД открывается в режиме «только чтение» (`default_transaction_read_only=on`), пароль не печатается:

```bash
dbq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' zybrilka-postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -P pager=off'; }
```

**4.1. Снимок счётчиков** — выполняйте до и после каждого шага теста и сравнивайте:

```bash
dbq <<'SQL'
select 'users_total' as metric, count(*)::text as value from users
union all select 'users_created_last_hour', count(*)::text from users where created_at > now() - interval '1 hour'
union all select 'identities_vk', count(*)::text from auth_identities where provider = 'vk'
union all select 'identities_email', count(*)::text from auth_identities where provider = 'email'
union all select 'vk_duplicate_identities (must be 0)', (count(*) - count(distinct provider_user_id))::text from auth_identities where provider = 'vk'
union all select 'sessions_active', count(*)::text from auth_sessions where expires_at > now()
union all select 'users_without_identity_created_last_hour (must be 0)', count(*)::text from users u where u.created_at > now() - interval '1 hour' and not exists (select 1 from auth_identities i where i.user_id = u.id)
union all select 'subject_profiles_completed', count(*)::text from user_subject_profiles where onboarding_completed_at is not null
union all select 'magic_links_pending_last_hour', count(*)::text from magic_link_tokens where created_at > now() - interval '1 hour' and consumed_at is null and expires_at > now()
union all select 'magic_links_consumed_last_hour', count(*)::text from magic_link_tokens where created_at > now() - interval '1 hour' and consumed_at is not null;
SQL
```

**4.2. Форма последних VK-аккаунтов** (только флаги и счётчики):

```bash
dbq <<'SQL'
select u.created_at > now() - interval '1 hour'                                                       as created_last_hour,
       u.first_name is not null                                                                       as has_first_name,
       u.last_name  is not null                                                                       as has_last_name,
       u.avatar_url is not null                                                                       as has_avatar,
       coalesce(u.avatar_url ~ '^https://', false)                                                    as avatar_is_https,
       exists (select 1 from user_subject_profiles p
               where p.user_id = u.id and p.onboarding_completed_at is not null)                      as onboarded,
       (select count(*) from auth_sessions s where s.user_id = u.id)                                  as sessions_total,
       (select count(*) from auth_sessions s where s.user_id = u.id and s.expires_at > now())         as sessions_active
from users u
join auth_identities i on i.user_id = u.id and i.provider = 'vk'
order by u.created_at desc
limit 5;
SQL
```

Ожидаемые изменения (проверено на PostgreSQL 16.13 с имитацией ответов VK):

| Шаг теста                                      | Что должно измениться                                                                                  | Строка 4.2 (последний VK-аккаунт)              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 1. первый вход                                 | `users_total +1`, `users_created_last_hour +1`, `identities_vk +1`, `sessions_active +1`               | `t, t, t, t, t, f, 1, 1`                       |
| 2. онбординг сохранён                          | `subject_profiles_completed +N` (число выбранных предметов)                                            | `onboarded = t`                                |
| 3. выход                                       | `sessions_active −1`                                                                                   | `sessions_total` на 1 меньше                   |
| 4. повторный вход                              | `sessions_active +1`; **`users_total`, `identities_vk` без изменений**; дублей и «пустых» users нет     | имя/аватар на месте, `onboarded = t`           |

Если `has_first_name`/`has_avatar` = `f` после первого входа — смотрите логи (раздел 3, строки `vkProfile`). Если `users_without_identity… ≠ 0` или `vk_duplicate_identities ≠ 0` — немедленно сообщите: это дубли/мусорные строки.

## 5. Запасной способ входа

Вход по почте (одноразовая ссылка, SMTP) **снят**. Запасной способ на сайте, если VK ID не работает, — **Яндекс ID** (см. [`YANDEX_ID.md`](./YANDEX_ID.md)). Аккаунты, у которых уже есть почта и пароль, по-прежнему входят по паролю.

## 6. ✏️ Действия, которые меняют состояние

Для проверки нужна сборка PR #60 на VPS (отдельного стенда нет): до слияния её придётся запускать **на production**. Пока вход не подтверждён, это риск блокировки входа для всех, поэтому — только с откатом. Каждый шаг этого раздела требует вашего подтверждения (см. раздел 9). Порядок строгий: 6.0 → 6.1 → 6.2 → 6.3 → 6.4.

Как устроен стек (по `infra/docker-compose.yml`), и почему не используется `up -d --build` без списка сервисов:

```text
postgres ──► migrate ──► sync-subjects ──► sync-content ──► api
                                                       └──► worker
web ──► caddy
```

- `migrate`, `sync-subjects`, `sync-content` — одноразовые (`restart: 'no'`). Образ у них общий с `api`: `zybrilka-api:latest`. `sync-content` прогоняет все импортёры контента (10 по математике + 18 по русскому).
- `dc up -d --build` без имён сервисов пересобирает **все** образы, запускает всю цепочку одноразовых сервисов и перезапускает `worker` и `caddy` — для проверки входа это лишнее и не нужно. Так же ведёт себя `dc up -d api` без `--no-deps`: он потянет `migrate → sync-subjects → sync-content`.
- Для этой проверки миграция `0021` нужна, а синхронизация контента — нет: PR #60 не меняет содержимого заданий (изменения в файлах импортёров — только форматирование Prettier из PR #62). Поэтому порядок такой: собрать только `api` и `web` → явно выполнить только `migrate` → пересоздать только `api` и `web` с `--no-deps --no-build`. `postgres`, `worker`, `caddy` не трогаются.
- Образы выбираются по имени и тегу из compose-файла: `zybrilka-api:latest` (сервисы `api`, `migrate`, `sync-*`), `zybrilka-web:latest` (сервис `web`). `dc build` перетегирует `:latest` на новый образ только после успешной сборки; уже запущенные контейнеры продолжают работать на старом образе, пока их не пересоздали. При `up --no-build` Compose берёт образ по тегу `:latest` и пересоздаёт контейнер, если ID образа отличается от того, на котором он запущен. Это же даёт откат (6.5).

**6.0 🔒 Предусловия.** Всё должно совпасть, иначе дальше не идти:

```bash
docker ps --format '{{.Names}}' | grep '^zybrilka-'        # postgres, api, web, caddy (и worker) работают
git status --short                                           # ДОЛЖНО быть пусто. Если нет — стоп: не делайте stash/reset/clean, спросите
git rev-parse --short HEAD; git symbolic-ref -q --short HEAD || echo "(detached HEAD)"
docker compose version                                      # нужен Compose v2 (флаг --wait)
df -h . /var/lib/docker | cat                                # нужно свободное место под дамп и две сборки (порядка нескольких ГБ)
dc ps -a --format '{{.Service}} {{.State}}' | cat            # migrate/sync-*: exited — нормально
```

**6.1 ✏️ Резервная копия БД** (персональные данные внутри; файл остаётся в домашнем каталоге VPS, не в репозитории, права `600`). Блок прерывается при любой ошибке; указатель на дамп создаётся только после успешной проверки, поэтому прежний дамп не может сойти за свежий:

```bash
(
  set -euo pipefail
  umask 077
  PTR="$HOME/zybrilka-pre-auth.dump.path"
  rm -f -- "$PTR"                                   # убираем указатель на прошлый дамп (сам прошлый файл не удаляем)
  OUT="$HOME/zybrilka-pre-auth-$(date +%Y%m%d-%H%M%S).dump"
  PART="$OUT.partial"
  [ ! -e "$OUT" ] && [ ! -e "$PART" ] || { echo "FAIL: $OUT already exists"; exit 1; }
  trap 'rm -f -- "$PART" "$PART.list"' EXIT         # удаляет только временные файлы ЭТОГО запуска
  dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$PART"
  [ -s "$PART" ] || { echo "FAIL: dump is empty"; exit 1; }
  dc exec -T postgres pg_restore -l < "$PART" > "$PART.list"              # архив читается?
  grep -q 'TABLE DATA public users ' "$PART.list" || { echo "FAIL: dump has no data for table users"; exit 1; }
  grep -q 'TABLE DATA public attempts ' "$PART.list" || { echo "FAIL: dump has no data for table attempts"; exit 1; }
  mv -- "$PART" "$OUT"
  printf '%s\n' "$OUT" > "$PTR"
  ls -l -- "$OUT"
  echo "DUMP OK: $OUT"
)
echo "exit code: $?"          # должно быть 0, и в выводе выше должна быть строка «DUMP OK»
```

Если не `DUMP OK` или код не `0` — дальше не идти; возможные причины: нет места (`df -h`), `postgres` не запущен, неверный каталог (6.0).

**6.2 ✏️ Зафиксировать то, на чём сейчас работает production** (код и образы, которые реально запущены, а не просто тег `:latest`). Блок отказывается перезаписать уже существующий снимок — повторный запуск после выкатки затёр бы точку отката:

```bash
(
  set -euo pipefail
  umask 077
  STATE="$HOME/zybrilka-pre-auth.state"
  if [ -e "$STATE" ]; then echo "FAIL: $STATE already exists - a snapshot was already taken. Do NOT re-run this step after deploying."; exit 1; fi
  for img in zybrilka-api zybrilka-web; do
    if docker image inspect "$img:pre-auth" >/dev/null 2>&1; then echo "FAIL: $img:pre-auth already exists - refusing to overwrite the rollback image"; exit 1; fi
  done
  if [ -n "$(git status --porcelain)" ]; then echo "FAIL: working tree is not clean"; exit 1; fi
  API_ID=$(docker inspect -f '{{.Image}}' zybrilka-api)       # ID образа, на котором запущен контейнер
  WEB_ID=$(docker inspect -f '{{.Image}}' zybrilka-web)
  docker tag "$API_ID" zybrilka-api:pre-auth
  docker tag "$WEB_ID" zybrilka-web:pre-auth
  {
    echo "git_sha=$(git rev-parse HEAD)"
    echo "git_ref=$(git symbolic-ref -q --short HEAD || echo DETACHED)"
    echo "api_image=$API_ID"
    echo "web_image=$WEB_ID"
  } > "$STATE"
  cat "$STATE"
  echo "SNAPSHOT OK"
)
echo "exit code: $?"
```

Файл состояния хранит только SHA коммита, имя ветки и ID образов — секретов в нём нет. Теги `pre-auth` не дают очистке Docker удалить старые образы, но `docker image prune -a` и `docker system prune -a` их удалят — **не запускайте prune ни в каком виде, пока проверка не закончена**.

**6.3 ✏️ Выкатить сборку PR #60 (только `api` и `web`).** Сначала задайте имя remote, который указывает на репозиторий проекта (`git remote` покажет имена без URL; в документации проекта он называется `new-origin`, на VPS мог быть `origin`):

```bash
REMOTE=<имя remote>        # например: new-origin
(
  set -euo pipefail
  STATE="$HOME/zybrilka-pre-auth.state"; PTR="$HOME/zybrilka-pre-auth.dump.path"
  [ -s "$STATE" ] || { echo "FAIL: step 6.2 was not completed"; exit 1; }
  [ -s "$PTR" ] || { echo "FAIL: no dump pointer - step 6.1 was not completed"; exit 1; }
  DUMP=$(cat "$PTR")
  [ -s "$DUMP" ] && [ -n "$(find "$DUMP" -mmin -60)" ] || { echo "FAIL: dump is missing or older than 60 minutes - redo 6.1"; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "FAIL: working tree is not clean"; exit 1; }
  docker ps --format '{{.Names}}' | grep -qx zybrilka-postgres || { echo "FAIL: zybrilka-postgres is not running"; exit 1; }
  trap 'rc=$?; [ "$rc" -eq 0 ] || echo "DEPLOY FAILED (exit $rc). Check the state with 6.4; run 6.5 to return code and images to the recorded state (safe to run even if nothing was replaced)."' EXIT

  git fetch "$REMOTE" feat/auth-profile-onboarding
  git switch --detach FETCH_HEAD
  echo "code is now at: $(git rev-parse --short HEAD)   <- сверьте с SHA в PR #60"

  dc build api web                                   # 1. только эти два образа; ничего не запущено заново
  dc run --rm --no-deps -T migrate                   # 2. только миграции (добавляет 3 nullable-столбца в users)
  dc up -d --no-deps --no-build --wait --wait-timeout 120 api web    # 3. пересоздать только api и web
  dc ps api web
  echo "DEPLOY OK"
)
echo "exit code: $?"
```

Что произойдёт и чего не произойдёт:

- Если упал любой шаг — выполните 6.5: он вернёт код и образы на записанное состояние и безопасен, даже если ничего заменено не было (при падении сборки контейнеры и теги `:latest` не менялись, но рабочее дерево уже на коде PR).
- Шаг 2 запускает ровно один одноразовый контейнер `migrate` (код выхода команды = код миграции). Старый `api` в это время продолжает работать: миграция только добавляет пустые nullable-столбцы.
- Шаг 3 пересоздаёт `api` и `web` (несколько секунд недоступности); `postgres`, `worker`, `caddy` и одноразовые `sync-*` не запускаются. `--wait` дожидается healthcheck обоих образов; по таймауту команда вернёт ошибку.
- Синхронизация контента (`sync-subjects`, `sync-content`) **не выполняется** — для проверки входа она не нужна. Обычный полный деплой после слияния делайте по `docs/DEPLOYMENT.md` (раздел «Update from Git»), это отдельное решение владельца.

**6.4 🔒 Проверка после выкатки:** повторите раздел 2 (маршруты) и убедитесь, что запущены именно новые образы:

```bash
. ~/zybrilka-pre-auth.state
[ "$(docker inspect -f '{{.Image}}' zybrilka-api)" != "$api_image" ] && echo "api: new image running" || echo "api: STILL the old image"
[ "$(docker inspect -f '{{.Image}}' zybrilka-web)" != "$web_image" ] && echo "web: new image running" || echo "web: STILL the old image"
```

Если `STILL the old image` — выкатка не произошла, проверьте вывод 6.3; не переходите к браузерному тесту.

**6.5 ✏️ Откат (если вход не работает и быстро не чинится).** Возвращает **и образы, и код** к состоянию, записанному в 6.2, и сам проверяет результат. Дамп БД автоматически не восстанавливается — он не нужен: миграция `0021` только добавила пустые nullable-столбцы, старый код их не замечает:

```bash
(
  set -euo pipefail
  STATE="$HOME/zybrilka-pre-auth.state"
  [ -s "$STATE" ] || { echo "FAIL: no state file - cannot roll back automatically"; exit 1; }
  . "$STATE"                     # git_sha, git_ref, api_image, web_image (файл создан шагом 6.2)
  docker image inspect "$api_image" "$web_image" >/dev/null   # старые образы ещё на месте?
  docker tag "$api_image" zybrilka-api:latest
  docker tag "$web_image" zybrilka-web:latest
  dc up -d --no-deps --no-build --wait --wait-timeout 120 api web
  git switch --detach "$git_sha"
  if [ "$git_ref" != DETACHED ] && [ "$(git rev-parse "$git_ref")" = "$git_sha" ]; then git switch "$git_ref"; fi
  [ "$(docker inspect -f '{{.Image}}' zybrilka-api)" = "$api_image" ] || { echo "ROLLBACK MISMATCH: api"; exit 1; }
  [ "$(docker inspect -f '{{.Image}}' zybrilka-web)" = "$web_image" ] || { echo "ROLLBACK MISMATCH: web"; exit 1; }
  echo "code is now at: $(git rev-parse --short HEAD)"
  echo "ROLLBACK OK: api and web run the recorded images, code is back at the recorded commit"
)
echo "exit code: $?"
curl -sS -o /dev/null -w '/health %{http_code}\n' https://zybrilka.ru/health
```

Почему откат согласован: `docker tag <ID> :latest` возвращает тегу `:latest` именно тот образ, что работал до выкатки; `up --no-build` пересоздаёт контейнеры, потому что их образ отличается от текущего `:latest`; блок сравнивает ID запущенных образов с записанными и возвращает рабочее дерево на записанный коммит, чтобы следующая сборка не взяла код из PR. Образы из неудачной сборки остаются без тега (их можно изучить, пока не запущен prune).

После окончания проверки (откат или успешное слияние и обычный деплой) теги `pre-auth` и файл состояния удаляются **вручную и осознанно**, только после подтверждения владельца: `docker rmi zybrilka-api:pre-auth zybrilka-web:pre-auth` (убирает теги, образ остаётся, пока на него ссылается контейнер) и `mv ~/zybrilka-pre-auth.state ~/zybrilka-pre-auth.state.old`.

**6.6 ✏️ Перезапуск только api после правки `infra/.env`:** `dc up -d --no-deps api` — контейнер пересоздаётся сам, потому что env изменился (кратковременная недоступность API). Сам `.env` правит владелец; значения секретов в чат и логи не вставлять.

**Чего не делать** (любое из этого может удалить данные, раскрыть секреты или перезапустить лишнее): `dc down`, `dc down -v` и `docker volume rm` (удаляют контейнеры/тома БД); `docker image prune`/`docker system prune` (с `-a` и без — пока идёт проверка); `git reset --hard`, `git clean`, `git stash` на VPS; `dc up -d --build` без списка сервисов; `dc config`, `cat infra/.env`, `env`, `docker inspect` контейнера целиком (печатают пароли); сырые `docker logs` (раздел 3); перезапуск `caddy`/`worker`/`postgres` без необходимости.

## 7. Пошаговый план проверки в браузере

Откройте Safari в приватной вкладке (чистые cookie) на `https://zybrilka.ru`. После **каждого** шага при желании снимайте 4.1. Записывайте для каждого: что увидели, и — если пришёл JSON с ошибкой — его текст.

1. Лендинг показывается без входа. Адрес `/statistics` ведёт на экран входа.
2. «Продолжить через VK ID» → страница VK → подтвердите доступ. **Критерий 1:** вернулись на `zybrilka.ru/onboarding` (а не на JSON с ошибкой, не на пустую страницу).
3. Пройдите онбординг. **Критерий 2:** попали в главное меню; в профиле видны ваши имя и фамилия из VK и аватар (если нет — запустите фильтр «предупреждения и ошибки»).
4. Обновите страницу. **Критерий 3:** остались внутри, онбординг заново не предлагается.
5. Решите одно задание, ответьте неверно. **Критерий 4:** в «Мои ошибки» появилась запись, в статистике +1 попытка.
6. Добавьте задание в избранное. Профиль → «Выйти из аккаунта». **Критерий 5:** оказались на экране входа.
7. Откройте `/statistics` и кнопкой «Назад» браузера вернитесь на приватную страницу. **Критерий 6:** снова экран входа, данных не видно.
8. Снова «Продолжить через VK ID». **Критерий 7:** сразу в главное меню (без онбординга), те же имя и аватар, ошибки и избранное на месте.
9. Выполните шаги из раздела 4 (4.1 и 4.2) и раздела 3 и сверьте с таблицей ожиданий.
10. (Запасной вход) выполните проверку из раздела 5 на свой адрес.
11. Вердикт: если критерии 1–7 выполнены — пришлите результаты (таблицу критериев, 4.1/4.2 и отфильтрованные строки логов) для решения о слиянии; если нет — откат из 6.5 и текст ошибки.

Только после успешных критериев 1–7 вход через VK можно считать проверенным; до этого он считается **непроверенным**.

## 8. Анонимный прогресс: оценить объём до включения обязательной авторизации

Контекст и разбор безопасности — в `docs/ANONYMOUS_PROGRESS.md`. Запрос ниже заменяет упрощённый запрос из того документа: он учитывает все девять таблиц, показывает только счётчики и даты, ids не выводит.

```bash
dbq <<'SQL'
with anon as (
  select u.id from users u
  where not exists (select 1 from auth_identities i where i.user_id = u.id)
)
select 'anon_users_total' as metric, (select count(*) from anon)::text as value
union all select 'attempts',                   (select count(*) from attempts a where a.user_id in (select id from anon))::text
union all select 'anon_users_with_attempts',   (select count(distinct a.user_id) from attempts a where a.user_id in (select id from anon))::text
union all select 'first_attempt_day',          coalesce((select min(a.created_at)::date::text from attempts a where a.user_id in (select id from anon)), '-')
union all select 'last_attempt_day',           coalesce((select max(a.created_at)::date::text from attempts a where a.user_id in (select id from anon)), '-')
union all select 'anon_users_active_last_7d',  (select count(distinct a.user_id) from attempts a where a.user_id in (select id from anon) and a.created_at > now() - interval '7 days')::text
union all select 'anon_users_active_last_30d', (select count(distinct a.user_id) from attempts a where a.user_id in (select id from anon) and a.created_at > now() - interval '30 days')::text
union all select 'mistakes',                   (select count(*) from mistakes m where m.user_id in (select id from anon))::text
union all select 'favorites',                  (select count(*) from favorites f where f.user_id in (select id from anon))::text
union all select 'essay_acknowledgements',     (select count(*) from essay_acknowledgements e where e.user_id in (select id from anon))::text
union all select 'subject_profiles_completed', (select count(*) from user_subject_profiles p where p.user_id in (select id from anon) and p.onboarding_completed_at is not null)::text
union all select 'learning_sessions',          (select count(*) from learning_sessions l where l.user_id in (select id from anon))::text
union all select 'daily_activity_rows',        (select count(*) from user_daily_activity d where d.user_id in (select id from anon))::text
union all select 'skill_stat_rows',            (select count(*) from user_skill_statistics s where s.user_id in (select id from anon))::text
union all select 'error_stat_rows',            (select count(*) from user_error_statistics s where s.user_id in (select id from anon))::text;

select count(*) filter (where n >= 1)   as users_1plus_attempts,
       count(*) filter (where n >= 10)  as users_10plus,
       count(*) filter (where n >= 50)  as users_50plus,
       count(*) filter (where n >= 200) as users_200plus
from (select a.user_id, count(*) n from attempts a
      where not exists (select 1 from auth_identities i where i.user_id = a.user_id)
      group by a.user_id) t;
SQL
```

Как принимать решение (ориентир, не правило):

| Результат                                                                                         | Решение                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| единицы пользователей, в основном вы сами (`users_10plus` небольшое, нет активности за 30 дней)    | **принять потерю**: данные в БД не удаляются, будут просто не видны новым аккаунтам; сделайте дамп (6.1), онбординг пройдут заново                                     |
| заметная активность за 7–30 дней у реальных людей                                                  | не включать обязательную авторизацию сразу: сначала один из вариантов ниже                                                                                           |

Варианты сохранения (все — отдельные PR, в этом чек-листе не реализованы):

1. **Переходный режим с флагом** `AUTH_REQUIRED` (по умолчанию выключен): вход (VK/почта) доступен, но тренажёр пока работает и анонимно, как раньше. Даёт ещё и мгновенный «выключатель» без отката образов, и снимает блокировку при неработающем входе. Включается, когда вход подтверждён и решён вопрос переноса.
2. **Перенос при первой регистрации** («усыновление»): `UPDATE user_id` по девяти таблицам в одной транзакции, только для только что созданного аккаунта без своих данных, одноразово, с ограничением частоты и журналом (подробно — в `docs/ANONYMOUS_PROGRESS.md`). Оценка 0,5–1 день + проверка безопасности. Подделка заголовка `x-anon-id` без этих ограничений позволяет присвоить чужую историю.
3. **Только дамп** (6.1) и принять потерю: данные можно будет вернуть позже одним из вариантов выше.

## 9. Что требует вашего подтверждения перед выполнением на production

Ничего из раздела 6 нельзя выполнять «по инерции» — каждое из действий ниже должен явно разрешить владелец:

| Действие                                                      | Почему нужно подтверждение                                                                                                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Дамп БД                                                   | создаёт на VPS файл с персональными данными пользователей (место хранения, права, срок жизни — ваше решение); нагружает БД на время дампа                                                                         |
| 6.2 Теги `pre-auth` и файл состояния                          | создаёт теги Docker и файл в `$HOME`; безопасно, но от них зависит откат                                                                                                                                         |
| 6.3 Выкатка непринятой ветки PR #60                           | production начинает работать на несмерженном коде с обязательной авторизацией; применяется необратимая вперёд миграция `0021` к production-БД; `api` и `web` пересоздаются (короткий простой); сборка занимает CPU/диск |
| 6.3 `git switch --detach` на VPS                              | меняет рабочее дерево production-репозитория                                                                                                                                                                     |
| Вход через VK тестовым аккаунтом (раздел 7)                   | создаёт в production-БД настоящий аккаунт с вашими именем и аватаром VK; автоматической очистки в этом документе нет                                                                                             |
| 6.5 Откат                                                     | пересоздаёт `api` и `web` (простой), возвращает код                                                                                                                                                              |
| 6.6 Правка `infra/.env` и перезапуск `api`                    | меняет секреты/конфигурацию и перезапускает сервис                                                                                                                                                               |
| Удаление тегов `pre-auth`, старых дампов                      | необратимо; делается только после окончания проверки                                                                                                                                                            |
| Обычный полный деплой после слияния PR #60                    | отдельное решение: запускает `migrate` + `sync-subjects` + `sync-content` (все импортёры) и может перезапустить `worker`/`caddy`                                                                                  |
| Слияние PR #60 в `main`                                       | только после критериев 1–7 из раздела 7                                                                                                                                                                          |

Без подтверждения безопасны только 🔒-шаги (разделы 1–4, 6.0, 6.4, 8): они читают конфигурацию, маршруты, отфильтрованные логи и БД в режиме «только чтение».
