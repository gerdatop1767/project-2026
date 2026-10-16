# Anonymous progress and sign-in (decision record)

Status: **analysis only — nothing is implemented.** Once real auth is on
(`authConfig` passed to `buildApp`), the API ignores the legacy
`x-anon-id` header, so progress made before sign-in is not visible to the
new account. This note records what is affected, a safe way to carry it
over, and the recommendation.

## What is bound to `x-anon-id` today

`x-anon-id` is a UUID the browser generates and keeps in `localStorage`
(`apps/web/src/lib/api.ts`, `getAnonId`). In the old anonymous mode the API
upserted a `users` row with that id and used it as `request.userId`. Rows
that therefore exist under anonymous ids (all reference `users.id`):

| Table | Unique per | Nature |
| --- | --- | --- |
| `attempts` | — | append-only log of answers |
| `mistakes` | (user, task) | current wrong answers |
| `favorites` | (user, task) | bookmarks |
| `essay_acknowledgements` | (user, task) | "I solved it" for essay tasks |
| `user_skill_statistics` | (user, skill) | **aggregates** |
| `user_error_statistics` | (user, error signature) | **aggregates** |
| `user_subject_profiles` | (user, subject) | onboarding answers + completion |
| `learning_sessions` | — | session bookkeeping |
| `user_daily_activity` | (user, date) | per-day counters (streak) |

(`auth_identities` / `auth_sessions` only ever belong to real accounts.)

## A safe way to carry it over: "adopt", not "merge"

Merging two accounts is the hard part (unique keys collide, aggregates
would have to be summed or recomputed). Adopting avoids all of it by only
ever moving anonymous data into an account that **has none yet**:

1. Allowed only in the request that **created** the account
   (`findOrCreateUserByIdentity(...).created === true`) and only while the
   account owns no rows in the tables above. No unique-key collisions are
   then possible and aggregates stay correct as-is.
2. One transaction: `UPDATE <table> SET user_id = :new WHERE user_id = :anon`
   for each table above, then mark the anonymous `users` row as claimed
   (new nullable `claimed_by uuid`/`claimed_at`, or a small `anon_claims`
   audit table with a UNIQUE on the anon id) so it can never be adopted
   twice.
3. Refuse if the anonymous id belongs to a real account (has an
   `auth_identities` row), is already claimed, or does not exist.

## Why a forged header must not be enough

The anon id is a bearer secret with no server-side proof: whoever knows the
UUID can claim its history. UUIDv4 is not guessable, but it is not secret
either — it sits in `localStorage` on shared computers, in every request
header, and possibly in proxy/access logs. An attacker who learns a
victim's id could pull that history into their own account (and the victim
loses it). Mitigations, all required:

- the claim is **one-shot** and **first-registration-only** (above), so an
  existing, established account can never absorb someone else's data;
- the id must come in the same authenticated request as the sign-in, never
  from a query/body the page can pre-fill without a session;
- rate limit the claim, and log claim attempts (account id + anon id hash);
- best: stop depending on a client-chosen secret — issue the anonymous
  identity from the server as a signed, httpOnly cookie going forward, so
  possession of the cookie (not a copyable header) is the proof. That
  needs the anonymous mode itself to come back, which contradicts closing
  the trainer to signed-out users.

## Size

Roughly 0.5–1 day for the adopt path (one migration for the claim marker,
one transaction over 9 tables, tests for each guard above) plus a focused
security review of the claim endpoint. The signed-cookie variant is larger
and out of scope while the trainer is closed to anonymous users.

## Recommendation

Temporarily **accept the loss**; do not ship a claim endpoint without its
own review. Rationale: the trainer has only just been wired to real auth
(the auth routes did not exist in production before PR #59), so the amount
of anonymous history is expected to be small — mostly the owner's own test
data — and the onboarding it implies is cheap to redo. Before relying on
that, the owner can check the real size (read-only, on the DB, by the
owner):

```sql
select count(distinct user_id) as anon_users, count(*) as attempts from attempts
where user_id not in (select user_id from auth_identities);
```

If that shows meaningful history from real users, implement the adopt path
above as its own PR.
