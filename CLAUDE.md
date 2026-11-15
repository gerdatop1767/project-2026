# ZYBRILKA — MASTER INSTRUCTIONS FOR CLAUDE CODE

## 0. PROJECT IDENTITY

Project name: **ZYBRILKA** (Зубрилка).

ZYBRILKA is a modern free EGE (ЕГЭ) preparation trainer:
- website;
- Telegram Mini App;
- mobile-first UX;
- free core functionality;
- future monetization may include advertising / optional ad removal, but do not build monetization first.

The main idea is NOT simply "a website with EGE tasks".
The core product loop is:

**task → answer → instant check → clear explanation → identify topic/error → similar task → progress → next session**

The product should remember mistakes and use them to personalize future training.

The user is building this project primarily from an iPad and wants Claude Code to handle the coding work. Keep the project understandable, maintainable and easy to continue.

---

# 1. CRITICAL WORKING RULES

## 1.1 Do not rush into huge amounts of code

Before implementing a major part:
1. Understand the current state of the repository.
2. Read this CLAUDE.md.
3. Inspect existing architecture and code.
4. Propose the plan for the current stage.
5. Implement in small logical blocks.
6. Test the result.
7. Fix errors.
8. Commit the completed logical block to Git.
9. Push the commit to GitHub.
10. Only then move to the next major block.

Do NOT rewrite working parts unnecessarily.

Do NOT create thousands of lines of code in one uncontrolled step.

Prefer small, reversible changes.

---

# 2. GITHUB SAFETY RULE — VERY IMPORTANT

The project must be continuously backed up to GitHub.

The goal is to minimize the risk of losing the project because of:
- account problems;
- session loss;
- Claude access problems;
- accidental deletion;
- environment failure;
- device failure;
- broken local/cloud workspace.

## After every completed logical part:

Claude must:

1. Check the changed files.
2. Run the relevant tests/checks/build.
3. Review the diff.
4. Create a meaningful Git commit.
5. Push the commit to the connected GitHub repository.
6. Confirm that the push succeeded.
7. Continue only after the backup is safely on GitHub.

Example commit names:
- `feat: add onboarding`
- `feat: add diagnostic test`
- `feat: add task checking`
- `feat: add progress tracking`
- `feat: add achievements`
- `feat: add admin dashboard`
- `feat: add task import pipeline`
- `fix: correct adaptive training logic`

### IMPORTANT

Do not wait until the end of the entire project to push to GitHub.

**GitHub is the primary remote backup.**

If automatic pushing is impossible because of permissions, authentication, or a tool limitation:
- clearly tell me immediately;
- do not pretend it was pushed;
- create the commit locally if possible;
- give me the exact next action needed;
- never silently skip the backup.

Before destructive or large refactors:
- create a checkpoint commit first;
- then make the changes.

Never use destructive Git commands such as:
- `git reset --hard`
- `git clean -fd`
- force push
- deleting branches
unless I explicitly approve it.

Never overwrite unrelated work.

---

# 3. DEVELOPMENT PRINCIPLES

Priorities:

1. Correctness
2. Security
3. Stable architecture
4. Performance
5. Mobile UX
6. Clean code
7. Visual quality
8. Speed of development

Do not sacrifice security or data integrity just to make something work quickly.

The application must be:
- fast;
- responsive;
- mobile-first;
- comfortable on iPhone/iPad/Android;
- compatible with Safari and Telegram WebView;
- accessible;
- visually polished;
- easy to maintain.

Avoid unnecessary:
- microservices;
- Kubernetes;
- complicated DevOps;
- excessive dependencies;
- premature abstractions.

Start with a simple architecture that can later scale.

---

# 4. BEFORE CODING THE PROJECT

First analyze and propose:

### Architecture
- frontend;
- backend/API;
- database;
- authentication;
- Telegram Mini App integration;
- admin panel;
- analytics;
- task import system;
- file/storage strategy;
- deployment strategy.

### Technology stack
Choose a modern, stable and practical stack.

Explain briefly:
- why each technology is chosen;
- what can run locally;
- what needs a server;
- how migration to production will work.

### Database
Design the main schema.

### API
Design the main API routes/endpoints.

### Project structure
Show the folder structure.

### Security
Explain:
- authentication;
- authorization;
- admin protection;
- Telegram init data validation;
- input validation;
- rate limiting;
- XSS/SQL injection/CSRF where applicable;
- secret management;
- abuse prevention;
- anti-cheat for battles.

### Import system
Explain the architecture for importing EGE tasks.

### Analytics
Explain how user/task statistics will be collected.

### MVP
Separate:
- MVP;
- phase 2;
- later features.

Do NOT start by building everything at once.

---

# 5. DESIGN PROCESS

Before implementing the complete UI, create **5 genuinely different design concepts**.

They must differ by:
- layout;
- visual hierarchy;
- card structure;
- navigation;
- typography;
- interaction style;
- mascot placement;
- dashboard composition.

Do NOT make five versions that are basically the same design with different colors.

Each concept should demonstrate:
- home;
- training/task screen;
- progress;
- achievements;
- mascot;
- mobile layout.

After selecting a concept, create a coherent design system:
- colors;
- typography;
- spacing;
- border radius;
- shadows;
- buttons;
- inputs;
- cards;
- badges;
- progress bars;
- charts;
- navigation;
- modals;
- toasts;
- tooltips.

The ZYBRILKA mascot is a bison 🦬.

If I provide a logo or mascot asset:
- treat it as a fixed brand asset;
- do not redesign it without asking;
- use it consistently.

Use the mascot in meaningful states:
- onboarding;
- greeting;
- empty states;
- success;
- mistakes;
- streaks;
- achievements;
- loading;
- results;
- battles;
- hints.

Do not place the mascot everywhere just for decoration.

Animations should be lightweight and fast.
Prefer CSS/lightweight motion over heavy video assets.

---

# 6. ONBOARDING

First entry:

1. Welcome to ZYBRILKA.
2. Ask which EGE subjects the user takes.
3. Offer a short diagnostic test.
4. Explain that the diagnostic helps personalize training.
5. Give approximately 10–20 tasks.
6. Prefer adaptive diagnostics if practical.
7. Generate an initial skill profile.

Example:

- Derivatives — 82%
- Trigonometry — 64%
- Logarithms — 41%
- Parameters — 35%

Then offer personalized training.

Store:
- onboarding_completed;
- selected subjects;
- diagnostic results;
- date of diagnostic.

Allow "Retake diagnostic" in settings.

Onboarding should be short and clear.

---

# 7. CORE TRAINING

Training modes:

- by topic;
- my mistakes;
- review;
- smart/adaptive training;
- full EGE variant.

Filters:
- subject;
- topic;
- task number;
- difficulty;
- quantity.

Task screen:
- condition;
- image if needed;
- answer field/options;
- check button.

After checking:
- immediately show correct/incorrect;
- show correct answer;
- show a clear explanation;
- show topic;
- show error type where possible;
- optionally show hint;
- offer a similar task.

When the user makes a mistake, save:
- task ID;
- user's answer;
- correct answer;
- subject;
- topic;
- task number;
- date;
- difficulty;
- whether explanation was opened;
- result of similar task.

---

# 8. ADAPTIVE TRAINING

The system must actually use user statistics.

It should prioritize weak areas using factors such as:
- error rate;
- recent errors;
- repeated errors;
- number of attempts;
- difficulty;
- time since last practice;
- recent improvement;
- previous similar-task performance.

Example:
If a student repeatedly fails logarithm tasks, the next training session should contain more logarithm tasks.

Do not make adaptive training a fake UI feature.

---

# 9. PROGRESS

Show:
- total solved;
- correct/incorrect;
- accuracy;
- progress by subject;
- progress by topic;
- weak topics;
- errors;
- daily/weekly/monthly/all-time dynamics;
- training streak;
- XP/level if implemented.

Stats should be useful for improving results, not just decorative.

---

# 10. ACHIEVEMENTS

Examples:
- 10 correct in a row;
- 100 solved tasks;
- 50 tasks in one day;
- repeat 10 previously failed tasks correctly;
- complete a diagnostic;
- maintain a streak.

Achievements can display rarity:

> Earned by 8.4% of active users

Define clearly what population is used for rarity.

Avoid pointless gamification.

---

# 11. LEADERBOARDS

Possible periods:
- day;
- week;
- month;
- all time.

Do not rank users only by raw number of tasks.

If implemented, consider:
- correctness;
- difficulty;
- XP;
- battle results;
- anti-abuse rules.

Do not let users easily farm points with trivial tasks.

---

# 12. PVP BATTLES

Modes:
- fast battle;
- rated battle.

Basic concept:
- two users receive the same tasks;
- correctness matters;
- speed can matter;
- rated mode changes rating.

Example:
10 tasks, same for both users.

Need:
- anti-cheat;
- server-side result validation;
- rate limits;
- protection from duplicate submissions;
- protection from obvious farming.

---

# 13. DIGITAL SCRATCHBOARD / CANVAS

For math and relevant subjects, add:

**"Расширить поле"**

It opens a large digital scratchboard where the user can:
- draw/write with finger or stylus;
- erase;
- undo;
- clear;
- zoom if practical.

First version does NOT need handwriting recognition.

The main goal is a comfortable digital draft board.

Must work well on touch devices and Telegram WebView.

---

# 14. ERROR SYSTEM

Every mistake should become useful data.

Store and analyze:
- task;
- answer;
- correct answer;
- topic;
- subject;
- task number;
- difficulty;
- timestamp;
- repeated attempts;
- similar-task performance.

"Мои ошибки" should be a real training mode, not just a history page.

---

# 15. TASK DATABASE

Suggested fields:

- id;
- subject;
- year;
- number;
- topic;
- subtopic;
- difficulty;
- condition;
- image;
- options;
- correct answer;
- explanation;
- source;
- source_url;
- status;
- date_added;
- solve_count;
- correct_count;
- complaint_count.

Support relevant EGE materials for:
- 2027;
- 2026;
- 2025;
- 2024;
- older years where relevant.

Never mix different EGE formats without clearly marking the year and validity.

For future/current EGE:
- use official/current specifications and materials where available;
- clearly label the year.

## 15.1 Learning Engine compatibility (mandatory)

Every change to importers, task structure or task metadata must stay compatible with the Learning Engine (`docs/learning/`, start with `docs/learning/README.md`):

- a task's EGE skill is derived from `subjectId`, `taskNumber`, `source`, `sourceYear` (`examSkillsForTask`); keep them correct, number = the number in the source's own edition;
- a new exam format/edition/number goes into `packages/shared/src/examSpecs.ts` BEFORE importing it;
- never hand-write `task_skills` for EGE topics and never hard-code task ids in learning code;
- after an import run `pnpm --filter @zybrilka/db learning:coverage`, expect 0 tasks without a skill, and update `docs/learning/LEARNING-COVERAGE.md`;
- keep `docs/learning/*` in sync with the code when changing learning logic.

---

# 16. EXPLANATIONS

Every task should ideally have an explanation.

Priority:
1. official explanation, if legally and technically available;
2. verified human-written explanation;
3. AI-generated draft explanation that must be reviewed/verified before publication if reliability is uncertain.

Never publish uncertain AI answers blindly.

---

# 17. COMPLAINTS

Every task should have:

**⚠️ Пожаловаться**

Reasons:
- wrong answer;
- condition error;
- explanation error;
- image problem;
- not EGE-compliant;
- duplicate;
- other.

Optional comment.

Complaint should include:
- task ID;
- subject;
- number;
- year;
- reason;
- comment;
- user ID;
- task link.

Admin should be able to:
- open;
- accept;
- reject;
- mark fixed.

---

# 18. ADMIN PANEL

Admin dashboard should eventually show:

### Users
- total users;
- new users today/week/month/year;
- arbitrary date range;
- DAU;
- users who solved 1+;
- 2+;
- 10+;
- 50+;
- 100+;
- users who entered but did nothing.

### Tasks
- total tasks;
- active;
- hidden;
- under review;
- complaints;
- by subject;
- by task number.

### Activity
- tasks solved today;
- week;
- month;
- year;
- all time;
- by subject;
- by task number;
- correct/incorrect.

### Funnel
- first visit;
- first answer;
- 10 tasks;
- return visit.

### Retention
Track useful retention metrics if practical.

Charts:
- new users;
- active users;
- solves;
- subject activity;
- retention;
- funnel.

Statistics should update close to real time where practical.

---

# 19. IMPORT CENTER

This is an important part of the admin system.

Goal:
Allow importing new EGE tasks and variants efficiently.

Preferred architecture:

**source → detect new material → download/ingest → parse → structure → answer detection → classify → quality checks → deduplicate → draft → admin review → publish**

Admin should be able to:
- add a source URL;
- upload PDF;
- upload DOCX;
- upload JSON;
- upload CSV;
- upload images where needed;
- import in bulk;
- see import status;
- see successful items;
- see duplicates;
- see items needing review.

If scheduled monitoring is implemented, it must respect the source's:
- API rules;
- terms;
- automation permissions;
- robots/access restrictions;
- copyright/storage/use restrictions.

Do NOT bypass:
- CAPTCHA;
- authentication;
- access controls;
- anti-bot protections;
- technical restrictions.

If automation is not allowed, use:
- official API;
- official export;
- manual upload;
- permitted metadata/linking.

Every imported task should retain source information.

Deduplication:
- source ID;
- hash;
- normalized text;
- similarity;
- other reliable identifiers.

If a possible duplicate is found:
- show existing task;
- show incoming task;
- let admin skip/merge/add.

Before publishing:
show a preview:
- condition;
- options;
- answer;
- explanation;
- source;
- year;
- task number;
- topic;
- warnings.

Uncertain answers must be flagged for review.

---

# 20. SOURCES AND LEGAL/CONTENT SAFETY

Do not blindly scrape random websites.

For every source, determine:
- whether an API exists;
- whether automation is permitted;
- whether storing the task content is permitted;
- attribution requirements;
- usage restrictions.

Prefer official/permission-compatible sources.

Do not bypass technical restrictions.

If copyrighted content cannot legally be stored, design the system around:
- permitted APIs;
- user-provided uploads where appropriate;
- metadata;
- links/references;
- original explanations;
- content for which the project has permission.

---

# 21. TELEGRAM MINI APP

Architecture must support:
- Telegram Mini App;
- secure Telegram authentication;
- server-side validation of Telegram init data;
- user linking;
- Telegram-specific UX;
- WebView compatibility.

Never trust Telegram user data sent only from the frontend.

Validate authentication server-side.

---

# 22. SUPPORT BOT

Create a Telegram support workflow.

A complaint can be forwarded to the support/admin bot with:
- task ID;
- user ID;
- reason;
- comment;
- link;
- subject;
- number;
- year.

Admin buttons:
- open;
- accept;
- reject;
- fixed.

Protect the admin side with secure authorization.

---

# 23. SECURITY

Security is a first-class requirement.

Use:
- server-side validation;
- secure authentication;
- role-based authorization;
- protected admin routes;
- Telegram init data validation;
- environment variables for secrets;
- rate limiting;
- safe database queries;
- output escaping;
- secure headers where applicable;
- CORS configured correctly;
- abuse/spam protection;
- anti-cheat for battles;
- minimal personal data collection.

Never place:
- bot tokens;
- database passwords;
- private API keys;
- admin secrets

inside frontend code or public repositories.

---

# 24. PERFORMANCE

Target:
- fast initial load;
- mobile-first;
- optimized images;
- lazy loading;
- code splitting;
- caching;
- pagination;
- efficient DB queries;
- virtualization where needed.

Test:
- iPhone;
- iPad;
- Android;
- Safari;
- Telegram WebView.

Do not optimize blindly.
Measure important bottlenecks.

---

# 25. ANALYTICS

Track useful product events, for example:
- signup/first visit;
- onboarding completed;
- diagnostic started/completed;
- task opened;
- answer submitted;
- correct/incorrect;
- explanation opened;
- similar task opened;
- similar task solved;
- training completed;
- streak;
- achievement;
- battle started/completed;
- complaint submitted.

Do not collect unnecessary personal data.

---

# 26. DATA MODEL / PRODUCT LOGIC

Design the database so the following can be represented cleanly:

- users;
- user subjects;
- diagnostic results;
- tasks;
- topics;
- answers/attempts;
- mistakes;
- similar-task relationships;
- training sessions;
- progress;
- achievements;
- achievement unlocks;
- streaks;
- XP/levels;
- leaderboards;
- battles;
- battle results;
- complaints;
- admin users/roles;
- imports;
- import items;
- sources;
- analytics events.

Use migrations.

Do not manually modify production DB structure without migrations.

---

# 27. DEPLOYMENT STRATEGY

Start simple.

During development:
- local/test environment;
- temporary/test database where appropriate.

Then:
- production server;
- PostgreSQL;
- secure environment variables;
- backups;
- domain;
- HTTPS;
- Telegram Mini App configuration.

The architecture should make migration from test DB to PostgreSQL straightforward.

Do not introduce complicated infrastructure unless it is actually necessary.

---

# 28. GIT WORKFLOW

Use clear branches/commits when practical.

Minimum requirement:

**Every completed logical feature = tested + committed + pushed to GitHub.**

Before a major refactor:
- checkpoint commit;
- then refactor.

After each meaningful milestone:
- push to GitHub.

Examples:
- `feat: onboarding`
- `feat: diagnostic`
- `feat: task engine`
- `feat: adaptive training`
- `feat: progress`
- `feat: achievements`
- `feat: battles`
- `feat: admin`
- `feat: import center`
- `fix: task validation`

Keep commits focused.

Do not mix unrelated changes into one commit.

---

# 29. IF SOMETHING BREAKS

Do not panic and rewrite the whole project.

Process:
1. reproduce;
2. inspect logs/errors;
3. identify root cause;
4. make the smallest safe fix;
5. test;
6. commit;
7. push to GitHub.

If the current approach is fundamentally wrong:
- create a Git checkpoint;
- explain why;
- propose alternatives;
- only then make a larger change.

---

# 30. TOKEN / CONTEXT EFFICIENCY

The user wants Claude to conserve usage.

Therefore:
- do not repeatedly reread unchanged files;
- do not dump huge files into chat unnecessarily;
- inspect only relevant files;
- summarize progress briefly;
- avoid repeating the full architecture every time;
- reuse existing components;
- do not rebuild existing functionality;
- work in logical chunks.

Before coding, identify exactly which files need to change.

After coding, report:
- what changed;
- tests run;
- Git commit;
- GitHub push status;
- next step.

Keep reports concise.

---

# 31. IMPORTANT RULE ABOUT USER APPROVAL

For major architectural decisions, destructive changes, production deployment, paid services, or irreversible operations:
- explain what will happen;
- ask for approval when necessary.

For normal safe coding tasks:
- proceed without unnecessary confirmation.

Do not ask the user to approve every tiny edit.

---

# 32. FIRST TASK FOR CLAUDE

When this file is first loaded, DO NOT immediately build the whole project.

First:

1. Read this file completely.
2. Inspect the repository.
3. Determine whether this is a new or existing project.
4. Check the current Git status and remote.
5. Check whether GitHub is connected.
6. If there are uncommitted changes, report them before changing anything.
7. Propose the architecture and stack.
8. Propose database schema.
9. Propose API structure.
10. Propose project structure.
11. Propose Telegram Mini App architecture.
12. Propose admin architecture.
13. Propose Import Center architecture.
14. Propose analytics architecture.
15. Propose MVP roadmap.
16. Identify risks and unknowns.
17. Explain what should be built first.
18. DO NOT write the full application yet.

After I approve the architecture, implement it in small stages.

Remember:

**The project is ZYBRILKA.**
**GitHub backup after every completed logical part is mandatory.**
**Do not lose work.**