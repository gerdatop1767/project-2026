# syntax=docker/dockerfile:1
#
# Production image for @zybrilka/web (S1 static build). Multi-stage:
# a Node/pnpm builder produces the Vite production bundle, then a
# minimal nginx runtime serves the static files — no Node, pnpm or
# dev dependencies ship in the final image.
#
# Build context is the repo root (this is a pnpm workspace and the
# build needs pnpm-lock.yaml + the other workspace package.json files
# to resolve, plus @zybrilka/shared's actual source — see the build
# stage below):
#
#   docker build -f apps/web/Dockerfile -t zybrilka-web .
#
# --platform=linux/amd64 pins the build target explicitly, regardless
# of the architecture of the machine actually running `docker build`
# (e.g. an ARM dev/CI host). Without this, building on a non-amd64
# host under emulation can let pnpm resolve the wrong native optional
# dependency for Vite's bundler, which then fails to load at runtime
# on the (linux/amd64) production VPS.

FROM --platform=linux/amd64 node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# --- deps: install with the lockfile frozen, cached separately from source ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# --- build: @zybrilka/shared first, then apps/web (`web...` = web and the
# workspace packages it depends on, in dependency order — same as the api
# and worker images).
#
# Both forms of shared are needed:
# - the app bundle imports it through the @zybrilka/source condition
#   (vite.config.ts → resolve.conditions), i.e. straight from its .ts source;
# - vite.config.ts itself is loaded by Node before that setting applies, and
#   it imports @zybrilka/shared too (seo/prerender.ts → src/lib/seo.ts →
#   seoPages.ts → EXAM_TASK_SPECS). Node resolves the package's "default"
#   export, dist/index.js, which only exists after shared is built.
#   dist/ is never copied in (.dockerignore): it is built here, from source. ---
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter "@zybrilka/web..." build

# --- runtime: static files behind nginx, nothing else ---
FROM --platform=linux/amd64 nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

EXPOSE 80
