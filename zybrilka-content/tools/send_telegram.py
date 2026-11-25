#!/usr/bin/env python3
"""Deliver a finished video to the owner's Telegram DM as a FILE (document, original quality).

Needs env (set by the owner in the cloud environment settings, never in git):
  TELEGRAM_STUDIO_BOT_TOKEN  — token of the studio bot from @BotFather
  TELEGRAM_STUDIO_CHAT_ID    — optional; if empty, the single private chat that pressed Start in the bot is used

python3 send_telegram.py <video_dir>     # sends final/<slug>.mp4 + script summary
python3 send_telegram.py --whoami        # prints chat ids that wrote to the bot
python3 send_telegram.py --text "msg"    # plain message (run reports, failures)
"""
import json, os, sys, urllib.request, uuid
from pathlib import Path

TOKEN = os.environ.get("TELEGRAM_STUDIO_BOT_TOKEN", "")
CHAT = os.environ.get("TELEGRAM_STUDIO_CHAT_ID", "")
API = f"https://api.telegram.org/bot{TOKEN}"


def call(method, fields=None, files=None):
    if not TOKEN: sys.exit("TELEGRAM_STUDIO_BOT_TOKEN is not set in the environment")
    if files:
        b = uuid.uuid4().hex; body = bytearray()
        for k, v in (fields or {}).items():
            body += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        for k, (name, data, ctype) in files.items():
            body += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n".encode() + data + b"\r\n"
        body += f"--{b}--\r\n".encode()
        req = urllib.request.Request(f"{API}/{method}", data=bytes(body), headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    else:
        req = urllib.request.Request(f"{API}/{method}", data=json.dumps(fields or {}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:  # never print the URL (it contains the token)
        sys.exit(f"Telegram {method} failed: {e.code} {e.read()[:300]!r}")


def main():
    if "--whoami" in sys.argv:
        for u in call("getUpdates").get("result", []):
            m = u.get("message") or {}
            if m.get("chat", {}).get("type") == "private":
                print(m["chat"]["id"], m["chat"].get("username"), m["chat"].get("first_name"))
        return
    global CHAT
    saved = Path(__file__).resolve().parent.parent / "pipeline/telegram_chat_id.txt"
    if not CHAT and saved.exists():
        CHAT = saved.read_text().strip()
    if not CHAT:  # auto-detect: the owner pressed Start in the studio bot (only private chats count)
        ids = {u["message"]["chat"]["id"] for u in call("getUpdates").get("result", [])
               if (u.get("message") or {}).get("chat", {}).get("type") == "private"}
        if len(ids) != 1:
            sys.exit(f"cannot detect owner chat: {len(ids)} private chats found; open the bot, press Start, or set TELEGRAM_STUDIO_CHAT_ID")
        CHAT = str(ids.pop()); saved.write_text(CHAT + "\n")  # Telegram keeps updates only 24h — remember the chat
    if "--text" in sys.argv:
        call("sendMessage", {"chat_id": CHAT, "text": sys.argv[sys.argv.index("--text") + 1][:4000]}); print("sent text"); return
    vd = Path(sys.argv[1]); sb = json.loads((vd / ("reel.json" if (vd / "reel.json").exists() else "storyboard.json")).read_text())
    slug = sb.get("slug", vd.name); mp4 = vd / f"final/{slug}.mp4"
    meta = sb.get("telegram", {})
    if meta.get("tiktok_description"):  # fixed format: tiktok_api.py publishes exactly the text after the marker
        cap = f"{meta.get('header') or '🦬 ' + slug}\n\n📝 Описание для TikTok:\n{meta['tiktok_description']}"
    else:
        cap = meta.get("caption") or f"🦬 {slug}"
    buttons = {"inline_keyboard": [[{"text": "✅ Опубликовать в TikTok", "callback_data": "publish"},
                                    {"text": "❌ Не надо", "callback_data": "skip"}]]}
    r = call("sendDocument", {"chat_id": CHAT, "caption": cap[:1024], "disable_content_type_detection": "true",
                              "reply_markup": json.dumps(buttons, ensure_ascii=False)},
             {"document": (mp4.name, mp4.read_bytes(), "video/mp4")})
    print("sent", mp4.name, r.get("ok"))
    if meta.get("details"):
        call("sendMessage", {"chat_id": CHAT, "text": meta["details"][:4000]})


if __name__ == "__main__":
    main()
