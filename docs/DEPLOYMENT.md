# Deployment

Production deployment of the full stack to a VPS:
GitHub → Docker → Caddy → {Web, API} → PostgreSQL, plus a Worker.
GitHub → Docker → Zybrilka Web → Caddy → HTTPS → `zybrilka.ru`.

S3.2 added API/Worker/PostgreSQL as their own compose services next to
the existing Web/Caddy — this file covers the whole stack now.

## Prerequisites

- A VPS with Docker Engine + the Compose plugin installed (`docker compose version`).
  Nothing else needs installing on the host — Node/pnpm only run inside builds.
- DNS: `zybrilka.ru` and `www.zybrilka.ru` A/AAAA records pointing at the VPS's public IP.
- Ports 80 and 443 open and free on the VPS (Caddy needs both for HTTP→HTTPS redirect and ACME).
- A clone of this repo on the VPS, on the branch you intend to run.
- `infra/.env` on the VPS only (copy from `infra/.env.example`, fill in
  a real `POSTGRES_PASSWORD`) — **never commit this file.** Compose
  loads it automatically because it sits next to `docker-compose.yml`.

## Build

```bash
git clone <repo-url> zybrilka && cd zybrilka
docker compose -f infra/docker-compose.yml build
```

Builds four images:

- `apps/web/Dockerfile` — a Node 22 + pnpm 10.33.0 stage runs
  `pnpm install --frozen-lockfile` and `vite build`, then only the
  compiled `dist/` is copied into a minimal `nginx:1.27-alpine` runtime
  image — no Node, pnpm or dev dependencies ship in the final image.
- `apps/api/Dockerfile` and `apps/worker/Dockerfile` — same shape: a
  Node/pnpm builder compiles `@zybrilka/shared` → `@zybrilka/db` →
  the app itself (dependency order via `pnpm --filter <name>... build`),
  then `pnpm deploy --prod` produces a self-contained package directory
  (workspace: deps resolved to real copied files) that a minimal
  `node:22-alpine` runtime stage just runs — no pnpm or dev deps ship.
- `postgres` and `caddy` use their official upstream images directly
  (`postgres:16-alpine`, `caddy:2-alpine`), nothing to build.

## Start

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Starts, in dependency order: `postgres` (with a persistent named
volume, `postgres_data` — survives `down`/`up` and a container
rebuild), a one-shot `migrate` job that applies any pending Drizzle
**schema** migrations and exits, a one-shot `sync-subjects` job that
upserts the canonical `subjects` rows and exits, a one-shot
`sync-content` job that upserts task **content** (conditionMd,
solutionSteps, correctAnswerDisplay, explanationMd, ...) for the full
catalog — ten EGE-2026 Ященко math variants (Вариант 1-10, 190 tasks)
followed by all eighteen EGE Russian 2027 Дощинский variants (Вариант
1-18, 486 tasks) — into their existing task rows and exits, running
every importer strictly in order (math V1 through V10, then Russian V1
through V18, `&&`-chained so the job's own exit code is non-zero and
`api`/`worker` never start if any one importer fails) — `api` and
`worker` (both wait for
`sync-content` to finish successfully), `web`, and `caddy` (the only
container publishing `80`/`443`), which reverse-proxies `/api/*` and
`/health` to `api:3000` and everything else to `web:80`,
obtaining/renewing its own TLS certificate automatically.

`migrate`, `sync-subjects`, and `sync-content` solve different problems
and all three run on every deploy: `migrate` changes the table *shape*
(adding a column like `correct_answer_display`); `sync-subjects`
ensures every subject Onboarding can offer (`packages/db/src/
canonicalSubjects.ts`) has a real `subjects` row, since `PUT
/me/learning-profile` rejects any `subjectId` without one; `sync-content`
changes the task *content*. Before `sync-content` existed, a code
change to `packages/db/src/importEge2026Variant1.ts` (new LaTeX, a
fixed illustration, a new `correctAnswerDisplay` value) only ever
reached a database that had never been imported before — an
already-seeded production database kept showing whatever content was
present the first time someone ran the import script by hand, silently
drifting further from the repo on every content-only deploy (this is
exactly what happened before the EGE Fidelity: Final Polish
content-migration fix — production kept the plain-text, pre-LaTeX task
content from its first import indefinitely). Before `sync-subjects`
existed, the same class of bug hit Onboarding: only `migrate` and
`sync-content` (which only ever upserts the single `'math'` subject row
as a side effect of importing math tasks) ran automatically, so a
production database that was never seeded with the full subject list
only had `'math'` — a user picking any other subject in Onboarding's
"какие предметы сдаёшь?" step got a generic "Не удалось сохранить
профиль" the moment they tried to save. Both `sync-subjects` and
`sync-content` are safe to run unconditionally on a live database with
real users: `sync-subjects` only ever inserts-or-updates a `subjects`
row by its stable `id`; `sync-content` upserts each task by its stable
identity (subject + source + variant + task number), never by a
freshly-generated id — neither touches `attempts`/`mistakes`/
bookmarks/`user_subject_profiles`. See each service's own comment in
`infra/docker-compose.yml`, `packages/db/src/syncSubjects.test.ts`, and
`packages/db/src/importEge2026Variant1.test.ts`'s "content migration"
tests for the exact guarantees.

Always pass `--build` on a fresh `up` — `migrate`/`sync-subjects`/
`sync-content`/`api` share one image tag (`zybrilka-api:latest`);
`--build` guarantees that tag exists before `migrate`'s container is
created. Each of `migrate`/`sync-subjects`/`sync-content` has its own
`build:` block (identical to `api`'s, cached after the first build) so
that a deploy workflow which runs an explicit `pull` step before
building doesn't try to fetch `zybrilka-api:latest` from a registry —
it only exists locally, never pushed anywhere.

## Troubleshooting

- **Onboarding fails to save with "Не удалось сохранить профиль.
  Попробуй ещё раз." for some (not all) subjects** — the `subjects`
  table is missing a canonical row the frontend lets a user pick (`PUT
  /me/learning-profile` correctly answers `400 unknown_subject` in that
  case; Onboarding's catch-all turns any save failure into that one
  generic message). If you're running an older `infra/docker-compose.yml`
  without `sync-subjects`, either pull the current one or run the same
  command it does, once, by hand: `docker compose -f
  infra/docker-compose.yml run --rm sync-subjects` (safe on a live
  database — see that service's comment in that file). If you're
  already on a `docker-compose.yml` with `sync-subjects` and still see
  this, check its logs (`docker compose -f infra/docker-compose.yml
  logs sync-subjects`) for an error.
- **Task content on the live site (e.g. a task's condition or solution)
  doesn't match what's in `importEge2026Variant1.ts` after a deploy**
  — before the `sync-content` service existed, this was a standing
  bug: `docker compose up` only ever ran `migrate` (schema), never the
  content import, so an already-seeded database kept whatever content
  it got on its *first* import forever, no matter how many times the
  import script's literals changed afterwards. If you're running an
  older `infra/docker-compose.yml` without `sync-content`, either pull
  the current one or run the same command it does, once, by hand:
  `docker compose -f infra/docker-compose.yml run --rm sync-content`
  (safe on a live database — see `sync-content`'s comment in that
  file). If you're already on a `docker-compose.yml` with
  `sync-content` and still see stale content, check that service's own
  logs (`docker compose -f infra/docker-compose.yml logs sync-content`)
  for an error — it exits non-zero on failure, which would also block
  `api`/`worker` from starting (they depend on it completing).
- **`pull access denied for zybrilka-api`** — some sort of `docker
  compose pull` ran before the image was built locally. `postgres` and
  `caddy` are the only services meant to be pulled; `web`/`api`/
  `worker`/`migrate` are always built locally from this repo, never
  pulled. If your deploy tooling runs `pull` as a separate step, make
  sure it either skips these four services or runs after `build`.
- **`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` "is not set,
  defaulting to a blank string"** — `infra/.env` doesn't exist yet (or
  isn't in `infra/`, next to `docker-compose.yml` — that's where
  Compose looks for it regardless of the directory you invoke `docker
  compose` from). Copy `infra/.env.example` to `infra/.env` on the VPS
  and fill in real values; this file is gitignored and must be created
  by hand on each server, once.
- **A `vite build` failure resolving `@zybrilka/shared`** from
  anywhere under `apps/web/src` — `apps/web/Dockerfile`'s build stage
  must `COPY packages/shared packages/shared` before `apps/web`, since
  `vite.config.ts` resolves that package via its `@zybrilka/source`
  condition straight to `.ts` source, not just the compiled `dist/`.
- **`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`** from `pnpm --filter
  @zybrilka/{api,worker} deploy` — pnpm v10 refuses to deploy a
  workspace with `workspace:*` dependencies unless every one is
  "injected" (hard-copied) via a workspace-wide
  `injectWorkspacePackages: true`, which this repo deliberately doesn't
  set (it would replace the live-source `@zybrilka/source` symlink
  convention with static copies for every dev/test run, not just the
  Docker build). Both Dockerfiles already pass `--legacy` to `deploy`
  for exactly this reason — if you see this error, check that flag
  wasn't dropped from `apps/api/Dockerfile` / `apps/worker/Dockerfile`.
- **`https://zybrilka.ru/health`, `/api/*` or `/auth/vk/start` returns the
  website instead of the API response, even though
  `infra/caddy/Caddyfile` routes it correctly** — the running `caddy`
  container is still serving an older config. Historically the
  Caddyfile was bind-mounted as a *single file*: Docker pins that
  file's inode when the container is created, `git pull` replaces a
  changed file with a new inode, so the container keeps the old content
  and neither `up -d` (service definition unchanged → no recreate;
  `--build` does nothing for the image-only `caddy` service) nor
  `--watch` (watches the stale in-container file) ever sees the change.
  The compose file now mounts the *directory* `infra/caddy/`, which
  avoids this; the container that predates this change must be
  recreated **once**:

  ```bash
  docker compose --env-file infra/.env -f infra/docker-compose.yml \
    up -d --force-recreate --no-deps caddy
  ```

  See **Verify the edge** under **Caddy** to confirm what is actually
  loaded.

## Sign-in, profile data and access control

How the trainer decides who may do what (all server-side, in `apps/api`):

- Every `/api/v1/*` route except `/api/v1/auth/*` (and `/health`) answers
  **401** without a valid `session_id` cookie. The old anonymous
  `x-anon-id` header is ignored when auth is configured (it is only still
  honored by the pre-auth test setups).
- First sign-in (VK ID or email) creates one account per
  `(provider, provider user id)`; a repeat sign-in or a replayed callback
  resolves to the same account.
- After VK sign-in the API calls VK's `user_info` endpoint server-to-server
  with the access token VK issued for that authorization code and stores
  `first_name`, `last_name`, `avatar` on `users` (migration `0021`).
  A missing/blank field never overwrites a stored value; a failed lookup
  never fails the login. **That endpoint and its response shape come from
  third-party client libraries, not VK's own docs — confirm with one real
  login** (`users.first_name/last_name/avatar_url` filled in the DB).
- Every call to VK is bounded by `VK_REQUEST_TIMEOUT_MS` (default 5000). A
  stalled token exchange ends the callback with 504 `vk_timeout`; a stalled
  or failing profile lookup never blocks sign-in. When the profile cannot
  be read the API logs ONE warning (`docker compose logs api | grep "VK
  profile"`) with `vkProfile` = `timeout|network|http|invalid_response|
  no_usable_fields`, the HTTP status and — for a 200 without usable fields
  — the key NAMES VK sent (never values, tokens, codes or cookies). After
  the first real login, no such warning means the assumed `user_info` shape
  was right; `no_usable_fields` tells you which keys to map instead.
- Profile editing (name, avatar), the best VK photo (`users.get`), Telegram
  Mini App sign-in and linking VK/Telegram to one account are described in
  [TELEGRAM_MINI_APP.md](TELEGRAM_MINI_APP.md), including the extra
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_AUTH_MAX_AGE_SECONDS` variables, migration
  `0022_*` (additive) and the log fields to grep for
  (`vkPhotoApi`, `vkAvatar`, `tgAuth`, `tgPhoto`).
- "Onboarding finished" is `user_subject_profiles.onboarding_completed_at`
  (set by `PUT /me/learning-profile`). `/auth/me` returns it as
  `onboardingCompleted`; the VK callback redirects an unfinished account to
  `/onboarding` and a finished one to the main menu. There is no separate
  diagnostic test yet — onboarding (subjects → level → target) is the
  existing first-run flow.
- Logout deletes the `auth_sessions` row and expires the cookie with the
  same attributes it was set with.

Deploy note: migration `0021_*` only adds three nullable `text` columns to
`users` and is applied by the existing `migrate` service on the next
`up -d`; it needs no manual step and keeps every existing row.

## Stop

```bash
docker compose -f infra/docker-compose.yml down
```

Leaves every named volume (`caddy_data`, `caddy_config`,
`postgres_data`) and the built images in place — certificates aren't
re-requested and the database isn't touched on the next `up`. Add `-v`
only if you explicitly want to destroy volumes too (never do this in
production without a fresh backup — see **Backup** below).

## Restart

```bash
docker compose -f infra/docker-compose.yml restart          # everything
docker compose -f infra/docker-compose.yml restart api      # just one service
```

## Logs

```bash
docker compose -f infra/docker-compose.yml logs -f api
docker compose -f infra/docker-compose.yml logs -f worker
docker compose -f infra/docker-compose.yml logs -f postgres
docker compose -f infra/docker-compose.yml logs -f web
docker compose -f infra/docker-compose.yml logs -f caddy
```

## Health check

```bash
docker compose -f infra/docker-compose.yml ps          # all services' health state
curl -s https://zybrilka.ru/health                      # {"status":"ok","db":"ok",...}
```

`postgres` and `api` both carry a Docker `HEALTHCHECK`; `web` already
had one. `503`/`{"db":"down"}` from `/health` means the API is up but
can't reach Postgres — check `docker compose logs postgres` first.

## Migrations

Applied automatically by the `migrate` one-shot service on every
`up --build` (see **Start** above) — safe to re-run: Drizzle tracks
already-applied migrations in its own `__drizzle_migrations` table and
skips them. Never runs `DROP DATABASE`/`DROP SCHEMA CASCADE` or any
other destructive statement; migration files are plain, reviewable SQL
under `packages/db/migrations/`.

To run migrations manually (e.g. to watch the output live) instead of
waiting for `up`:

```bash
docker compose -f infra/docker-compose.yml run --rm migrate
```

## Update from Git

```bash
git fetch new-origin
git checkout <branch>
git pull new-origin <branch>
docker compose -f infra/docker-compose.yml up -d --build
```

Rebuilds every image that changed, re-runs pending migrations via
`migrate`, and replaces only the containers whose image actually
changed — `postgres`'s data volume is never touched by this.

To redeploy only one service (e.g. a web-only content fix):

```bash
docker compose -f infra/docker-compose.yml up -d --build web
```

### Release: cookies, reminders, support (migration 0032)

- **Migration needed:** `0032_support_reminders` — only adds tables
  (`reminder_settings`, `reminder_deliveries`, `telegram_link_tokens`,
  `support_threads`, `support_messages`) and one nullable column
  (`telegram_bot_chats.support_requested_at`). No existing row changes; the
  `migrate` service applies it on `up -d --build`. Take a backup first
  (`pg_dump`) as for any migration.
- **Rebuild:** `api` (reminders, link token, support inbox, consent-aware
  analytics), `worker` (bot support/linking, reminder and reply jobs — it
  sends to Telegram, so it needs the same `TELEGRAM_BOT_TOKEN` as now;
  reminders and replies are sent even with `TELEGRAM_BOT_POLLING=false`,
  but users can only write to support while polling is on), `web`.
- **No new environment variables.** Docs: COOKIES.md, REMINDERS.md, SUPPORT.md.

## Caddy

`infra/caddy/Caddyfile` defines both hosts:

- `www.zybrilka.ru` — permanent redirect to the apex domain.
- `zybrilka.ru` — `/api/*` and `/health` reverse-proxy to `api:3000`
  with no path stripping (the API already registers those exact paths
  itself, see `apps/api/src/app.ts`); the unprefixed VK OAuth aliases
  `/auth/vk/start` and `/auth/vk/callback` are rewritten to
  `/api/v1/auth/vk/...` first; everything else reverse-proxies to
  `web:80`, with gzip/zstd encoding. Client-side route fallback
  (unknown paths → `index.html`) is handled by `web`'s own nginx
  config, not by Caddy.

Validate the file without starting anything:

```bash
docker run --rm -v "$(pwd)/infra/caddy:/etc/caddy:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

The `caddy` service bind-mounts the **directory** `infra/caddy/` (not
the single file) and runs with `--watch`, so a `git pull` that changes
the Caddyfile is picked up by the running container and Caddy reloads
it without a restart. A single-file mount would NOT work: it pins the
old inode and `git pull` swaps the file for a new one (see the
troubleshooting entry about `/health` returning the website). Never
mount `infra/` itself into the container — it contains `infra/.env`.

### Verify the edge

Safe checks (no secrets, no OAuth parameters printed):

```bash
C="docker compose --env-file infra/.env -f infra/docker-compose.yml"

# 1. Which Caddyfile does the RUNNING container see? (expect the
#    vkAuthAlias block; its absence means a stale mount.)
$C exec caddy grep -c vkAuthAlias /etc/caddy/Caddyfile

# 2. Same file as on the host? Compare checksums.
sha256sum infra/caddy/Caddyfile
$C exec caddy sha256sum /etc/caddy/Caddyfile

# 3. What config did Caddy actually load? (expect a rewrite to
#    /api/v1... for /auth/vk/start in the output.)
$C exec caddy wget -qO- http://localhost:2019/config/ | grep -c 'api/v1'

# 4. Is the API reachable from inside the infrastructure, and does the
#    route redirect? Prints only the status code and the Location
#    origin+path (never the query string, which carries the OAuth params).
$C exec api node -e "fetch('http://127.0.0.1:3000/api/v1/auth/vk/start',{redirect:'manual'}).then(r=>{const l=r.headers.get('location');console.log(r.status,l?new URL(l).origin+new URL(l).pathname:'')})"

# 5. Through the public edge (status and server only).
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://zybrilka.ru/auth/vk/start
```

Check 4 answering **404** means the running `api` image predates the
auth module (or was built without `authConfig` wiring — fixed by
`apps/api/src/createApp.ts`): rebuild it with
`$C up -d --build --no-deps api`; `--build` matters here because `api`,
unlike `caddy`, is built from this repo.

Expected: 302 (or 503 `vk_not_configured` if VK_* are unset) from the
API and from the edge — `200 text/html` from the edge means Caddy is
still serving the SPA for that path.

## DNS requirements

Both `zybrilka.ru` and `www.zybrilka.ru` must resolve to the VPS's
public IP **before** `caddy` starts, so Let's Encrypt's HTTP-01
challenge can reach it on port 80.

## HTTPS

Fully automatic — Caddy requests and renews Let's Encrypt certificates
for both hosts on first request and redirects HTTP → HTTPS by default.
No manual certificate generation or renewal cron job needed.

## Backup

Manual `pg_dump` from the running container — safe to run any time,
takes a consistent snapshot without stopping the stack:

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > "zybrilka-$(date +%Y%m%d-%H%M%S).dump"
```

No automated/off-box backup schedule is configured yet — that needs a
separate, explicit decision (where dumps are stored, retention, who
has access) before it's set up.

## Restore

**Destructive — only run this deliberately, never as part of a normal
deploy, and take a fresh backup first if the current data has any value.**

```bash
# Stop writers so nothing races the restore.
docker compose -f infra/docker-compose.yml stop api worker

docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < zybrilka-YYYYMMDD-HHMMSS.dump

docker compose -f infra/docker-compose.yml start api worker
```

`--clean --if-exists` drops and recreates existing objects before
restoring — this is the destructive part. Never run this against a
database you haven't just backed up, and never automate it.

## Rollback

```bash
git log --oneline -5                 # find the previous good commit
git checkout <previous-commit-or-tag>
docker compose -f infra/docker-compose.yml up -d --build
```

A schema rollback (undoing a migration) is not automated — Drizzle
migrations are forward-only here. If a bad migration shipped, restore
from a pre-migration backup instead of trying to hand-write a down
migration.


## Деплой на текущий VPS

Для production на текущем VPS используется отдельный checkout `/opt/Zybrilka-release` и файл `infra/docker-compose.deploy.yml`. Не заменяйте их стандартным Compose-файлом: пути сборки и конфигурация рассчитаны на эту схему.

Переменные окружения находятся в `/opt/Zybrilka/infra/.env`. Не выводите их содержимое и не добавляйте файл в Git.

Проверить конфигурацию перед деплоем:

```bash
docker compose -p infra --project-directory /opt/Zybrilka-release --env-file /opt/Zybrilka/infra/.env -f /opt/Zybrilka-release/infra/docker-compose.deploy.yml config --quiet
```

Применить миграции базы данных:

```bash
docker compose -p infra --project-directory /opt/Zybrilka-release --env-file /opt/Zybrilka/infra/.env -f /opt/Zybrilka-release/infra/docker-compose.deploy.yml run --rm migrate
```

Перезапустить API и веб-приложение после обновления их образов:

```bash
docker compose -p infra --project-directory /opt/Zybrilka-release --env-file /opt/Zybrilka/infra/.env -f /opt/Zybrilka-release/infra/docker-compose.deploy.yml up -d api web
```

Проверить состояние контейнеров и API:

```bash
docker compose -p infra --project-directory /opt/Zybrilka-release --env-file /opt/Zybrilka/infra/.env -f /opt/Zybrilka-release/infra/docker-compose.deploy.yml ps
curl -fsS https://zybrilka.ru/health
```

Перед миграциями или рискованными изменениями базы создавайте резервную копию и проверяйте её доступность. Не удаляйте неизвестные файлы и резервные копии в `/opt/Zybrilka`.
