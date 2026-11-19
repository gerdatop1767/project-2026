# ZYBRILKA (Зубрилка)

Free EGE preparation trainer: website + Telegram Mini App.

- Product and working rules: [CLAUDE.md](CLAUDE.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- AI SEO Center (blog + autonomous SEO agent): [docs/SEO_CENTER.md](docs/SEO_CENTER.md)

## Structure

| Path | What |
|---|---|
| `apps/web` | React + Vite SPA |
| `apps/api` | Fastify API (`GET /health`) |
| `apps/worker` | Background worker (jobs added in later stages) |
| `packages/shared` | Zod schemas and types shared by all apps |
| `packages/db` | Drizzle schema, migrations, DB client |

## Requirements

- Node.js 22 (see `.nvmrc`)
- pnpm 10 (`corepack enable`)
- PostgreSQL 16 — optional for local development; tests use in-memory PGlite

## Getting started

```sh
pnpm install
cp .env.example .env        # adjust DATABASE_URL, or remove it to run without a DB
pnpm --filter @zybrilka/db db:migrate
pnpm dev                    # web on http://localhost:5173, API on http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run web, API and worker in watch mode |
| `pnpm check` | Everything CI runs: format, lint, typecheck, test, build |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm build` | Build every package |
| `pnpm --filter @zybrilka/db db:generate --name <name>` | Create a migration from schema changes |
| `pnpm --filter @zybrilka/db db:migrate` | Apply migrations (uses `DATABASE_URL`) |
