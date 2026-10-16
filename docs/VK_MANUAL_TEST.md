# Ручная проверка входа (VK ID + почта) перед включением обязательной авторизации

Это пошаговый чек-лист для владельца проекта. Он описывает проверку сборки из PR #60 (`feat/auth-profile-onboarding`) на VPS. **Реальный вход через VK до выполнения этого чек-листа не проверен ни разу** — ни тестами, ни CI.

Обозначения: 🔒 — только чтение, ничего не меняет; ✏️ — меняет состояние (деплой, перезапуск, запись в БД).

Правила безопасности для всех шагов:

- Не присылайте сырые логи. В `docker logs zybrilka-api` строки `incoming request` для `/api/v1/auth/vk/callback` содержат OAuth-параметры `code`, `state`, `device_id` в URL (проверено). В `docker logs zybrilka-web` могут быть строки `GET /login?token=…` с токеном входа по почте — **их не копировать**. Пользуйтесь только фильтрами из раздела 3.
- Не выводите `infra/.env` (`cat`, `env`, `docker inspect`, `docker compose config`) — там пароли. Раздел 1 показывает только «задано / не задано».
- Не отправляйте скриншоты с адресной строкой VK и страницей согласия, где видны `state`/`code`.

Во всех командах ниже:

```bash
cd <каталог репозитория на VPS>          # где лежит infra/docker-compose.yml
C="docker compose --env-file infra/.env -f infra/docker-compose.yml"
```

## 0. Что именно проверяется (по коду)

| Этап                        | Маршрут / код                                                                                | Что происходит                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Старт                       | `GET /api/v1/auth/vk/start`                                                                  | 503 `vk_not_configured`, если нет `VK_CLIENT_ID`/`VK_CLIENT_SECRET`/`VK_REDIRECT_URI`; иначе кладёт cookie `vk_pkce` (state + code_verifier, 10 мин) и редиректит на `https://id.vk.ru/authorize` (`response_type=code`, PKCE `S256`, `scope=email`) |
| Возврат                     | `GET /api/v1/auth/vk/callback?code&device_id&state`                                          | проверяет cookie и `state`; обменивает код на VK (`POST id.vk.ru/oauth2/auth`, таймаут 5 с); запрашивает профиль (`POST id.vk.ru/oauth2/user_info`, таймаут 5 с, не обязателен)                                                                         |
| Ошибки callback             | 400 `invalid_callback` / `invalid_state`; 502 `vk_login_failed`; 504 `vk_timeout`; 503       | браузер покажет JSON — **запишите его текст**                                                                                                                                                                                                          |
| Успех                       | 302 на `/onboarding` (онбординг не завершён) или на `/` (завершён) + cookie `session_id`     | решает сервер по БД                                                                                                                                                                                                                                    |
| Вход по почте (запасной)    | `POST /api/v1/auth/magic-link` → письмо → `/login?token=…` → `POST /api/v1/auth/verify`      | не зависит от VK, но требует рабочего SMTP (раздел 5)                                                                                                                                                                                                  |

Что должно меняться в БД:

| Событие                    | Таблицы / поля                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Первый вход через VK       | `users` +1 строка; `auth_identities` +1 (`provider='vk'`); `users.first_name/last_name/avatar_url` — если VK их вернул; `auth_sessions` +1 (срок 30 дней)                              |
| Онбординг                  | `user_subject_profiles` — строки по выбранным предметам, `onboarding_completed_at` заполнено                                                                                           |
| Выход                      | `auth_sessions` — строка этой сессии удалена                                                                                                                                          |
| Повторный вход через VK    | `users` и `auth_identities` **без новых строк**; `auth_sessions` +1; имя/аватар обновляются только непустыми значениями VK; `users.last_seen_at` не обновляется (в коде этого нет)     |
| Вход по почте              | `magic_link_tokens` +1 (только хеш), затем `consumed_at`; `users` +1 и `auth_identities` +1 (`provider='email'`) — **отдельный аккаунт**, не связанный с VK; `auth_sessions` +1        |

Эти изменения подтверждены прогоном на настоящем PostgreSQL 16 (запросы из раздела 4).

## 1. 🔒 Конфигурация без раскрытия секретов

```bash
git rev-parse --short HEAD && git status -sb | head -3

$C exec -T api node -e '
const e = process.env, st = (k) => (e[k] ? "set" : "MISSING");
console.log("NODE_ENV =", e.NODE_ENV);
for (const k of ["VK_CLIENT_ID", "VK_CLIENT_SECRET", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]) console.log(k, "=", st(k));
console.log("VK_REDIRECT_URI =", JSON.stringify(e.VK_REDIRECT_URI));
console.log("WEB_BASE_URL    =", JSON.stringify(e.WEB_BASE_URL));
console.log("SMTP_HOST =", e.SMTP_HOST || "-", "| SMTP_PORT =", e.SMTP_PORT, "| SMTP_FROM =", JSON.stringify(e.SMTP_FROM));
'
```

Ожидается:

- `NODE_ENV = production`;
- `VK_CLIENT_ID`, `VK_CLIENT_SECRET` = `set`;
- `VK_REDIRECT_URI = "https://zybrilka.ru/api/v1/auth/vk/callback"` — без пробелов, без `/` в конце (`JSON.stringify` покажет лишние символы);
- `WEB_BASE_URL = "https://zybrilka.ru"`;
- если рассчитываете на вход по почте: `SMTP_HOST/SMTP_USER/SMTP_PASSWORD` = `set` (достаточно любого пропущенного значения, чтобы почта вернула 503).

Если что-то `MISSING`: значения не дошли до контейнера. Они читаются из `infra/.env` при создании контейнера; после правки файла нужно ✏️ `$C up -d --no-deps api` (контейнер пересоздастся сам, потому что env изменился). Сам `.env` не печатайте.

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
$C exec -T api node -e 'fetch("https://id.vk.ru/", { method: "HEAD", signal: AbortSignal.timeout(5000) }).then((r) => console.log("id.vk.ru ->", r.status)).catch((e) => console.log("id.vk.ru UNREACHABLE:", e.name))'
```

| Шаг | Ожидается                                                                                         | Если иначе                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `200`                                                                                             | `502/504` — api не поднялся: `$C ps`, `$C logs --tail 30 api` (в этих логах нет callback-параметров, пока вы не открывали вход)                                                                                                                    |
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

## 5. Запасной вход по почте (SMTP): может ли он реально выручить

Проверено по коду и на локальных имитациях:

- Вход по почте **не зависит от VK**: письмо → ссылка `https://zybrilka.ru/login?token=…` (15 минут, одноразовая, в БД только хеш) → `POST /auth/verify` → сессия. На экране входа кнопка почты и кнопка VK всегда показаны вместе, так что пользователь может выбрать почту, если VK не работает.
- **Условие работоспособности — рабочий SMTP-аккаунт:** обязательны `SMTP_HOST`, `SMTP_USER` **и** `SMTP_PASSWORD`. Реле без логина/пароля не поддерживается (ответ как «не настроено»). Порт 465 — TLS сразу, остальные (по умолчанию 587) — STARTTLS по возможности.
- Пока SMTP не настроен: `POST /auth/magic-link` отвечает `503 email_not_configured`, экран показывает «Отправка писем сейчас недоступна». То есть **сейчас запасного входа нет**, если в `infra/.env` пусто.
- Известные шероховатости (в коде не исправлены, влияют на диагностику):
  - настроенный, но неработающий SMTP (неверный пароль, недоступный хост) даёт **500**, а не 503; текст ошибки в теле ответа содержит имя SMTP-хоста (проверено), экран показывает общее «Не удалось отправить письмо»;
  - «чёрная дыра» вместо SMTP-сервера держит запрос около 30 секунд до 500;
  - при сбое отправки строка токена остаётся в `magic_link_tokens` (безвредно, истечёт сама);
  - лимит: 10 запросов за 10 минут с одного IP;
  - отдельный аккаунт: вход по почте не связан с VK-аккаунтом того же человека (прогресс не общий).
- Доставляемость письма от `no-reply@zybrilka.ru` (SPF/DKIM/DMARC у домена) из кода проверить нельзя.

Проверка (✏️ создаёт строку в `magic_link_tokens`; письмо уйдёт на ваш адрес):

```bash
curl -sS -w '  -> %{http_code}\n' -X POST https://zybrilka.ru/api/v1/auth/magic-link \
  -H 'content-type: application/json' -d '{"email":"<ваш адрес>"}'
```

| Результат                           | Значение                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"ok":true}` `200`, письмо пришло  | запасной вход работает (откройте ссылку в браузере: должно привести в приложение; затем снимок 4.1 покажет `magic_links_consumed_last_hour +1`, `identities_email +1`)        |
| `{"ok":true}`, письма нет           | SMTP принял, но не доставил (спам, SPF/DKIM) — смотрите папку «Спам» и журнал почтового провайдера                                                                           |
| `503 email_not_configured`          | один из `SMTP_HOST/USER/PASSWORD` пуст (раздел 1)                                                                                                                            |
| `500` (в теле `getaddrinfo`/`ECONN…`)| хост/порт неверны или недоступны; строки с `msg` в логах (фильтр «предупреждения и ошибки», раздел 3)                                                                       |
| `500` (в логе `Invalid login`)      | неверные логин/пароль SMTP                                                                                                                                                   |
| `429`                               | превышен лимит попыток — подождите 10 минут                                                                                                                                  |

Ссылку из письма **не пересылайте** — это одноразовый вход в аккаунт.

## 6. ✏️ Действия, которые меняют состояние

Для проверки нужна сборка PR #60 на VPS (отдельного стенда нет): до слияния её придётся запускать **на production**. Пока вход не подтверждён, это риск блокировки входа для всех, поэтому — только с откатом.

**6.1 Резервная копия БД** (персональные данные внутри — храните вне репозитория, права `600`):

```bash
umask 077
$C exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > ~/zybrilka-pre-auth-$(date +%Y%m%d-%H%M%S).dump
ls -l ~/zybrilka-pre-auth-*.dump
$C exec -T postgres pg_restore -l < "$(ls -t ~/zybrilka-pre-auth-*.dump | head -1)" | head -3
```

(Команда в `docs/DEPLOYMENT.md` без `-T` и с переменными хоста может дать пустой/испорченный файл — используйте вариант выше; последняя строка проверяет, что дамп читается.)

**6.2 Сохранить текущие образы для отката:**

```bash
docker tag zybrilka-api:latest zybrilka-api:pre-auth
docker tag zybrilka-web:latest zybrilka-web:pre-auth
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'zybrilka-(api|web):pre-auth'
```

**6.3 Выкатить сборку из PR #60:**

```bash
git remote                                  # имена remotes (без URL); дальше <remote> — тот, что указывает на репозиторий проекта
git fetch <remote> feat/auth-profile-onboarding
git switch --detach <remote>/feat/auth-profile-onboarding
git rev-parse --short HEAD                  # сверить с SHA обновлённого PR #60 (последний: 31b8932)
$C up -d --build                            # применит миграцию 0021 через сервис migrate
$C ps
```

Ожидается: `migrate` и `sync-*` завершились с кодом 0, `api`, `web` — `Up`; затем проходит раздел 2.

**6.4 Откат (если вход не работает и быстро не чинится):**

```bash
docker tag zybrilka-api:pre-auth zybrilka-api:latest
docker tag zybrilka-web:pre-auth zybrilka-web:latest
$C up -d --no-build --no-deps api web
curl -sS -o /dev/null -w '%{http_code}\n' https://zybrilka.ru/health
```

Миграция `0021` остаётся в БД — это три пустых nullable-столбца, старый код их не замечает. Возврат дампа (`docs/DEPLOYMENT.md`, «Restore») нужен только если что-то повредило данные — для этого шага не требуется. После отката верните репозиторий на `main`: `git switch main && git pull --ff-only <remote> main`.

**6.5 Перезапуск только api после правки `infra/.env`:** `$C up -d --no-deps api` (контейнер пересоздаётся сам).

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
11. Вердикт: если критерии 1–7 выполнены — пришлите результаты (таблицу критериев, 4.1/4.2 и отфильтрованные строки логов) для решения о слиянии; если нет — откат из 6.4 и текст ошибки.

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
