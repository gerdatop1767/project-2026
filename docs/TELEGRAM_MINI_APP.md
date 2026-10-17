# Telegram Mini App, VK profile photo and linked sign-in methods

Status: **implemented and covered by automated tests, NOT yet verified against
a real Telegram bot / Mini App or a real VK login.** Section 6 lists exactly
what must be checked by hand before anyone relies on it.

## 1. How it works

### Telegram Mini App sign-in

1. Telegram opens the web app with signed launch data. The page reads it from
   `Telegram.WebApp.initData` or from the URL hash (`#tgWebAppData=…`).
2. With no session yet, the page sends **only the raw `initData` string** to
   `POST /api/v1/auth/telegram`.
3. The API verifies it exactly as Telegram documents ("Validating data
   received via the Mini App"):
   - `data_check_string` = all fields except `hash`, `key=value`, sorted by
     key, joined with `\n`;
   - `secret_key = HMAC_SHA256("WebAppData", TELEGRAM_BOT_TOKEN)`;
   - `HMAC_SHA256(secret_key, data_check_string)` must equal `hash`
     (constant-time compare);
   - `auth_date` must not be older than `TELEGRAM_AUTH_MAX_AGE_SECONDS`
     (default 3600) nor in the future; duplicated fields are rejected.
4. Identity = the **numeric Telegram user id** from the verified data (never
   the username, which can change). Known id → that account; unknown id and
   nobody signed in → a new account (first launch); then a normal
   `session_id` cookie session (same as VK / email).
5. Name and photo: `first_name`/`last_name` from the signed data; the avatar
   from the signed `photo_url` (https, allow-listed Telegram hosts) or, when
   Telegram did not send one, fetched once through the Bot API
   (`getUserProfilePhotos` → `getFile` → download, size-capped, validated as a
   real JPEG/PNG/WebP, stored in our database). A missing photo never blocks
   login. The user's own name/photo always win and are never overwritten.
6. Nothing the browser sends next to `initData` (ids, `initDataUnsafe`) is
   trusted. The bot token exists only in the API's environment.
7. After an explicit «Выйти» inside Telegram the app does not sign straight
   back in until the WebView is reopened.

### VK profile photo

At VK login the API calls, server-to-server with the token VK just issued,
both `id.vk.ru/oauth2/user_info` and `api.vk.com/method/users.get`
(`fields=photo_max_orig,photo_400_orig,photo_200_orig,photo_200,photo_100,
photo_50` — no extra scopes). The best real photo is stored in
`users.avatar_url`: the original upload when VK provides it, otherwise the
largest sized variant that exists; **never enlarged**. VK's grey "camera"
placeholder, non-https URLs and hosts outside VK's CDN list count as "no
photo". If both sources fail, login still succeeds with whatever data exists.
VK image URLs are not guaranteed to be permanent; the app falls back to the
default icon if one stops loading, and the next VK login refreshes it.

### Priority rules (one place: `modules/profile/service.ts`)

- Name: user's own name (`users.display_name`) > provider first + last name.
- Avatar: uploaded image > provider photo URL > image fetched via the bot.
- Provider data never overwrites the user's own choices; a provider that sends
  nothing never clears stored data. If an account holds both VK and Telegram,
  only the provider that first filled the profile refreshes it (no flip-flop);
  an *empty* field is filled by whichever provider signs in.

### Profile editing

`PATCH /me/profile` (name; normalized server-side: NFC, control/zero-width
chars removed, spaces collapsed, ≤ 40 characters, `<` `>` refused),
`PUT/DELETE /me/avatar` (raw JPEG/PNG/WebP body; the server decides the type
from the bytes — never the header or file name; 64–4096 px; ≤ 1 MiB; SVG/GIF
refused; stored in Postgres table `user_avatars`), `GET /me/avatars/:source`
(owner only; `nosniff` + sandbox CSP). All act on the session's own account;
there is no user id in any request. The web client center-crops and
downscales to ≤ 512 px JPEG (EXIF stripped) before uploading. Authenticated
writes and the sign-in POSTs reject browsers' cross-site requests
(`Sec-Fetch-Site`), on top of `SameSite=Lax` cookies.

### Linking sign-in methods

Profile → «Способы входа» (`GET /me/identities`):

- **VK**: «Подключить» → `/api/v1/auth/vk/start?link=1` → VK → callback →
  back to `/profile?link=…`. The target account comes from the *session*,
  is stored with the PKCE state in the short-lived httpOnly cookie, and is
  re-checked at the callback (state, single-use, same account still signed in).
- **Telegram**: inside the Mini App, «Подключить» sends the signed `initData`
  to `POST /me/identities/telegram`.
- Rules enforced in one transaction: one identity ↔ one user; an identity
  that belongs to another account is **refused** (409, clear message), never
  moved and **never merged**; one account holds at most one identity per
  provider; the **last** sign-in method cannot be removed
  (`DELETE /me/identities/:provider` → 409 `last_identity`).
- Not implemented: adding an *email* to an account that has none, and merging
  two existing accounts. A user who already has a VK-only account and opens
  the Mini App for the first time gets a **separate** Telegram account until
  they link Telegram from inside the Mini App (while signed in to the VK
  account). Support can see this as two users; there is deliberately no
  automatic merge.

## 2. Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | API env (`infra/.env`) | Token from @BotFather. **Server only.** Empty = Telegram sign-in answers 503 `telegram_not_configured`. |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | API env | Max age of `auth_date` (60–86400, default 3600). |

`infra/docker-compose.yml` passes both to the `api` service. Nothing about
Telegram is needed in the frontend build (no `VITE_` variable); the official
`telegram-web-app.js` helper is injected only when the page runs inside
Telegram.

## 3. Setting up the bot and Mini App (owner steps)

1. In @BotFather: `/newbot` (or use an existing bot) and copy the token into
   `TELEGRAM_BOT_TOKEN` in `infra/.env` on the server. Never paste it into
   chat, git, or the frontend.
2. Give the bot a Mini App that opens the site: either
   `/newapp` (Direct Link Mini App) or **Bot Settings → Menu Button →
   Configure menu button → URL** = `https://zybrilka.ru/` (must be HTTPS on
   the production domain; the API is same-origin under `/api/v1`).
   If asked for a domain (`/setdomain` is for the Login Widget, not needed
   for Mini Apps), use `zybrilka.ru`.
3. Redeploy the API (after PR merge) so the new variables are picked up.

## 4. How to verify (manual, on a phone)

1. Open the bot in Telegram → tap the menu button / Mini App link.
   Expected: no login screen; the app opens signed in (new account → goes to
   onboarding); Профиль shows your Telegram name, and a photo if Telegram
   exposes one.
2. Close and reopen: same account, no duplicate (check `auth_identities` has
   one `telegram` row for your id).
3. Профиль → Личные данные: change the name and upload a photo; reopen the
   Mini App — your values stay (Telegram does not overwrite them).
4. Linking test A (Telegram account first): in the Mini App, Профиль →
   Способы входа → ВКонтакте «Подключить». This leaves the Mini App for VK in
   the WebView and returns to `/profile?link=ok`. Then sign in with VK in a
   normal browser: you must land in the **same** account (same progress).
   Whether a given Telegram client lets the VK redirect round-trip inside the
   WebView (cookies must survive) is exactly what this step tests; if it opens
   an external browser instead, the link attempt there has no session and
   fails with 401 — report it, do not work around it.
   Linking test B (VK account first): Telegram can only be linked from a
   session that is open *inside* the Mini App WebView, which has its own
   cookies. Sign in to the VK/email account on the Mini App's login screen
   (VK button or email link), then use «Подключить» next to Telegram.
5. Try to link a VK/Telegram account that already owns another profile:
   expect the clear "already linked to another profile" message and no change.
6. API logs while testing: `docker compose -f infra/docker-compose.yml logs
   api | grep -E "tgAuth|tgPhoto|vkPhotoApi|vkAvatar|vkProfile"`. Fields:
   `tgAuth` = rejection reason of a Telegram launch; `tgPhoto` = coarse
   reason the bot photo lookup failed (`no_photo` is silent); `vkPhotoApi` =
   `users.get` failure kind (`api_error` + `vkErrorCode`, `http` + status…);
   `vkAvatar` = why a photo URL was ignored (`host_not_allowed`, …). They
   never contain tokens, codes, names or URLs.

## 5. Deploy notes

- Migration `0022_*` is **additive**: new table `user_avatars`, new nullable
  columns `users.display_name`, `users.profile_source`. It is applied by the
  existing `migrate` service on the next `up -d`. Old API containers keep
  working against the new schema (they simply do not use it); the new
  `/auth/me` shape only *adds* fields. Do not run it on production before the
  owner agrees to the deploy.
- Avatars are stored in Postgres (≤ 1 MiB each, one row per user and source),
  so they are covered by the existing database backups.

## 6. What is NOT verified (read before trusting)

- **Telegram, end to end**: signature verification is tested against an
  independent signer written from the documented algorithm, but it has not
  been run with a real bot token and a real Mini App launch. Whether
  `photo_url` is present depends on the launch type; the bot fallback only
  works for users the bot may see. Telegram's own documentation could not be
  fetched when this was written — the algorithm is implemented from knowledge
  of it; the real launch test is the confirmation.
- **VK**: whether VK ID access tokens are accepted by
  `api.vk.com/method/users.get`, and the exact `user_info` key names, are
  taken from third-party client libraries. Each source is optional and failure
  is logged by kind, so a wrong assumption degrades to the smaller photo, not
  to a broken login — but only one real VK login will tell which source works.
- Mobile Telegram safe areas (`--tg-safe-area-inset-*`) are wired through the
  shared `--safe-*` CSS variables but need a look on a real device
  (iOS + Android), including fullscreen mode.
