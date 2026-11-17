# Оркестратор: ZYBRILKA Content Run

Запускается по расписанию 2 раза в день, каждый раз в новой облачной сессии. Главный агент сам ролик не делает. Он ведёт 4 агента по очереди, решает спорные места, доставляет результат владельцу в Telegram и сохраняет всё в Git.

## 0. Подготовка (≤ 3 мин)
1. Репозиторий `gerdatop1767/project-2026` должен лежать в рабочей папке. Если его нет, подключи его через `add_repo` и склонируй.
2. `git fetch origin chore/add-emil-design-eng-skill && git checkout chore/add-emil-design-eng-skill && git merge --ff-only origin/chore/add-emil-design-eng-skill`. Инструменты студии и агенты живут в этой ветке.
3. Зависимости ставит setup-скрипт окружения. Если `python3 -c "import piper, faster_whisper, cv2"` падает, выполни `pip install piper-tts faster-whisper opencv-contrib-python-headless`.
4. `RUN_ID=$(TZ=Europe/Moscow date +%Y-%m-%d-%H%M)`, затем `mkdir -p zybrilka-content/runs/$RUN_ID`.

## 1. Исследование
Агент `zyb-trend-researcher`, вход — папка запуска. Ожидается `brief.md` и `brief.json` с 5 идеями.

## 2. Сценарий и утверждение
Агент `zyb-scriptwriter`, вход — папка запуска. Ожидается папка ролика с `voiceover.json`, `storyboard.json`, `script.md`, озвучкой и пометкой `APPROVED`. Если не утверждено, вызови его ещё раз с указанием взять следующую идею (не больше 2 раз).

## 3. Производство
Агент `zyb-producer`, вход — путь к папке ролика. Ожидается `final/<slug>.mp4` и `qa/report.json`.

## 4. Контроль
Агент `zyb-qa`, вход — путь к папке ролика. Ожидается `qa/verdict.md`.
- `REJECTED`: передай fix-лист `zyb-producer` (а если проблема в тексте или фактах — `zyb-scriptwriter`), затем снова `zyb-qa`. **Не больше 2 циклов правок.**
- После двух неудачных циклов ролик не отправляется как готовый. В Telegram уходит текстовый отчёт о проблеме (шаг 5b).

## 5. Доставка в Telegram
a) `APPROVED`. Перед отправкой допиши в `storyboard.json` объект `"telegram"`:
- `caption` (≤ 1024 символов): `🦬 <название>` · рубрика · длительность; описание для TikTok, хештеги и строки авторов фото из `script.md`;
- `details` — коротко: идея и почему зайдёт (1–2 строки), источники фактов, QA (WER, lip-sync corr, LUFS).

Затем выполни `python3 zybrilka-content/tools/send_telegram.py <video_dir>`. Видео уходит **файлом** (document).

b) Сбой на любом шаге: `python3 zybrilka-content/tools/send_telegram.py --text "⚠️ Зубрилка-студия <RUN_ID>: <что сломалось, на каком шаге, что нужно от владельца>"`.

Если Telegram недоступен (нет токена или chat id), всё равно доведи ролик до конца, закоммить и напиши это в итоговом ответе сессии.

## 6. Бэкап
1. `git add zybrilka-content .claude/agents`. Итоговые mp4 в Git не попадают (`.gitignore`), их копия — в Telegram. Всё, что нужно для перерендера, коммитится.
2. Коммит `feat(content): auto video <NNN-slug> (<RUN_ID>)`.
3. `git push origin chore/add-emil-design-eng-skill`. При сетевой ошибке повтори до 4 раз с паузой. Если на удалённой ветке есть новые коммиты — `git fetch` + `git merge`, без force.

## Правила
- Все агенты подчиняются `pipeline/CREATIVE_RULES.md`: ролик 12–25 с, небанальная полезная тема, разнообразие образа, планов, фонов и анимаций, только лицензированные материалы.
- CTA во всех новых роликах ведёт в Telegram-бота **@Zybrilka_bot**, а не на сайт (ролик 001 — исключение, не трогать).
- **Ничего не публиковать в TikTok.** Публикует только владелец.
- Голос и персонаж не менять (`character/voice/VOICE.md`, `character/CHARACTER.md`).
- Платные генерации запрещены. Fish Audio — только бесплатная модель из VOICE.md.
- Один запуск — один ролик. Итоговый ответ сессии: ссылка на папку ролика, вердикт QA, статус Telegram и push.
