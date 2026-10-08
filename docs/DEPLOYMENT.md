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
`sync-content` job that upserts the EGE-2026 Ященко **content**
(conditionMd, solutionSteps, correctAnswerDisplay, ...) for all five
variants (Вариант 1-5, 95 tasks) into their existing task rows and
exits — running each variant's importer strictly in order (V1 through
V5, `&&`-chained so the job's own exit code is non-zero and `api`/
`worker` never start if any one of them fails) — `api` and `worker`
(both wait for
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
row by its stable `id`; `sync-content` upserts each of the 19 tasks by
its stable identity (subject + source + variant + task number), never
by a freshly-generated id — neither touches `attempts`/`mistakes`/
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
- **`https://zybrilka.ru/health` (or `/api/*`) returns the website
  instead of the API response, even though `infra/Caddyfile` routes it
  correctly** — the running `caddy` container is still serving an
  older in-memory config from before that routing existed.
  `infra/Caddyfile` is bind-mounted, not baked into the image, so a
  plain `docker compose up -d` never notices its contents changed and
  never restarts a `caddy` container whose own service definition
  didn't change. The `caddy` service runs with `--watch` (see
  **Caddy** above) specifically so this can't happen again once it's
  running with that flag; if it's still happening, confirm the running
  container's command actually includes `--watch`
  (`docker compose -f infra/docker-compose.yml exec caddy pgrep -fa caddy`)
  and if not, `docker compose -f infra/docker-compose.yml up -d caddy`
  once to pick it up.

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

## Caddy

`infra/Caddyfile` defines both hosts:

- `www.zybrilka.ru` — permanent redirect to the apex domain.
- `zybrilka.ru` — `/api/*` and `/health` reverse-proxy to `api:3000`
  with no path stripping (the API already registers those exact paths
  itself, see `apps/api/src/app.ts`); everything else reverse-proxies
  to `web:80`, with gzip/zstd encoding. Client-side route fallback
  (unknown paths → `index.html`) is handled by `web`'s own nginx
  config, not by Caddy.

Validate the file without starting anything:

```bash
docker run --rm -v "$(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile
```

`caddy`'s compose service runs with `--watch`, so once it's running
with that flag it reloads automatically whenever `infra/Caddyfile`
changes on disk — no container restart needed for a routing change to
take effect (see the comment on that service in
`infra/docker-compose.yml` for why this matters: it's a bind-mounted
file, and `docker compose up -d` alone never notices its contents
changed). If you're updating an existing deployment whose `caddy`
container predates `--watch`, `docker compose up -d` still picks it up
correctly on that one deploy — a `command:` change is a service
definition change, so compose recreates the container for it exactly
like it would for a new image tag.

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
