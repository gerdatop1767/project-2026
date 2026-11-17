#!/usr/bin/env python3
"""ZYBRILKA → TikTok: one-tap publishing from Telegram + video stats (official TikTok API, no passwords).

Flow
  1. send_telegram.py posts every finished video with buttons «✅ Опубликовать» / «❌ Не надо».
  2. `tiktok_api.py poll` (scheduled hourly in Claude) reads button presses from the studio bot,
     downloads the approved video from that same Telegram message and publishes it via Content Posting API
     (Direct Post), then replies in Telegram with the result.
  3. `tiktok_api.py stats` writes zybrilka-content/analytics/tiktok_stats.json for the analyst agent.

Secrets (environment variables set by the owner, never in git):
  TELEGRAM_STUDIO_BOT_TOKEN, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
Token storage: TikTok tokens live ENCRYPTED (key derived from TIKTOK_CLIENT_SECRET) in a pinned message of the
owner's chat with the studio bot — works across fresh cloud sessions without git or extra secrets.

  python3 tiktok_api.py auth-url              # link the owner opens once (redirect → https://zybrilka.ru/)
  python3 tiktok_api.py auth-wait [--minutes 15]   # waits for the owner to send the redirected URL to the bot
  python3 tiktok_api.py poll                   # process button presses (publish / skip)
  python3 tiktok_api.py stats                  # recent videos with views/likes/comments/shares
  python3 tiktok_api.py status                 # is everything configured?
"""
import base64, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TG = os.environ.get("TELEGRAM_STUDIO_BOT_TOKEN", "")
CK = os.environ.get("TIKTOK_CLIENT_KEY", "")
CS = os.environ.get("TIKTOK_CLIENT_SECRET", "")
REDIRECT = os.environ.get("TIKTOK_REDIRECT_URI", "https://zybrilka.ru/")
SCOPES = "user.info.basic,video.publish,video.upload,video.list"
TOKEN_TAG = "🔐 zyb-tiktok-token v1"
DESC_MARK = "📝 Описание для TikTok:"
API = "https://open.tiktokapis.com/v2"


def die(msg):
    print("ERROR:", msg); sys.exit(1)


# ---------------- Telegram ----------------
def chat_id():
    env = os.environ.get("TELEGRAM_STUDIO_CHAT_ID", "")
    f = ROOT / "pipeline/telegram_chat_id.txt"
    return env or (f.read_text().strip() if f.exists() else "")


def tg(method, payload=None, raw=False):
    if not TG: die("TELEGRAM_STUDIO_BOT_TOKEN is not set")
    req = urllib.request.Request(f"https://api.telegram.org/bot{TG}/{method}", data=json.dumps(payload or {}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:  # never print the URL: it contains the bot token
        die(f"Telegram {method}: {e.code} {e.read()[:200]!r}")


def tg_file(file_id):
    path = tg("getFile", {"file_id": file_id})["result"]["file_path"]
    with urllib.request.urlopen(f"https://api.telegram.org/file/bot{TG}/{path}", timeout=300) as r:
        return r.read()


def say(text, reply_to=None):
    p = {"chat_id": chat_id(), "text": text[:4000], "disable_web_page_preview": True}
    if reply_to: p["reply_parameters"] = {"message_id": reply_to}
    tg("sendMessage", p)


# ---------------- encrypted token storage (pinned message) ----------------
def _fernet():
    from cryptography.fernet import Fernet
    if not CS: die("TIKTOK_CLIENT_SECRET is not set")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("zyb-studio:" + CS).encode()).digest()))


def load_tokens():
    pin = tg("getChat", {"chat_id": chat_id()})["result"].get("pinned_message") or {}
    txt = pin.get("text", "")
    if not txt.startswith(TOKEN_TAG): return None, None
    blob = txt.split("\n", 1)[1].strip()
    return json.loads(_fernet().decrypt(blob.encode())), pin["message_id"]


def save_tokens(tok, msg_id=None):
    body = TOKEN_TAG + "\n" + _fernet().encrypt(json.dumps(tok).encode()).decode()
    if msg_id:
        tg("editMessageText", {"chat_id": chat_id(), "message_id": msg_id, "text": body})
    else:
        m = tg("sendMessage", {"chat_id": chat_id(), "text": body, "disable_notification": True})["result"]
        tg("pinChatMessage", {"chat_id": chat_id(), "message_id": m["message_id"], "disable_notification": True})


# ---------------- TikTok OAuth ----------------
def oauth(form):
    data = urllib.parse.urlencode(dict(form, client_key=CK, client_secret=CS)).encode()
    req = urllib.request.Request(f"{API}/oauth/token/", data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read())
    if "access_token" not in j: die(f"TikTok OAuth: {j.get('error')} {j.get('error_description')}")
    j["obtained_at"] = int(time.time()); return j


def access_token():
    tok, mid = load_tokens()
    if not tok: die("TikTok is not authorised yet: run `tiktok_api.py auth-url` and `auth-wait`")
    if time.time() > tok["obtained_at"] + tok.get("expires_in", 86400) - 600:
        new = oauth({"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
        save_tokens(new, mid); tok = new
    return tok["access_token"]


def tt(path, body, method="POST"):
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": f"Bearer {access_token()}", "Content-Type": "application/json; charset=UTF-8"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}") or {"error": {"code": str(e.code)}}


# ---------------- publishing ----------------
def publish(video: bytes, description: str):
    info = tt("/post/publish/creator_info/query/", {})
    opts = (info.get("data") or {}).get("privacy_level_options") or []
    want = os.environ.get("TIKTOK_PRIVACY", "PUBLIC_TO_EVERYONE")
    privacy = want if want in opts else ("SELF_ONLY" if "SELF_ONLY" in opts else (opts[0] if opts else "SELF_ONLY"))
    post = {"title": description[:2200], "privacy_level": privacy, "disable_duet": False, "disable_comment": False,
            "disable_stitch": False, "video_cover_timestamp_ms": 1500, "brand_organic_toggle": True, "is_aigc": True}
    n = len(video)
    init = tt("/post/publish/video/init/", {"post_info": post, "source_info": {"source": "FILE_UPLOAD", "video_size": n,
                                                                            "chunk_size": n, "total_chunk_count": 1}})
    err = (init.get("error") or {}).get("code", "ok")
    if err != "ok" and "unaudited" in json.dumps(init).lower() and privacy != "SELF_ONLY":
        post["privacy_level"] = privacy = "SELF_ONLY"   # app not audited yet: TikTok only allows private posts
        init = tt("/post/publish/video/init/", {"post_info": post, "source_info": {"source": "FILE_UPLOAD", "video_size": n,
                                                                                "chunk_size": n, "total_chunk_count": 1}})
        err = (init.get("error") or {}).get("code", "ok")
    if err != "ok": return False, f"init: {init.get('error')}", privacy
    d = init["data"]
    put = urllib.request.Request(d["upload_url"], data=video, method="PUT",
                                 headers={"Content-Type": "video/mp4", "Content-Length": str(n), "Content-Range": f"bytes 0-{n - 1}/{n}"})
    urllib.request.urlopen(put, timeout=600).read()
    for _ in range(40):
        time.sleep(6)
        st = tt("/post/publish/status/fetch/", {"publish_id": d["publish_id"]}).get("data") or {}
        if st.get("status") == "PUBLISH_COMPLETE":
            ids = st.get("publicaly_available_post_id") or []
            return True, (f"https://www.tiktok.com/video/{ids[0]}" if ids else d["publish_id"]), privacy
        if st.get("status") == "FAILED": return False, f"status: {st.get('fail_reason')}", privacy
    return True, f"отправлено, TikTok ещё обрабатывает (publish_id {d['publish_id']})", privacy


def caption_description(caption):
    return caption.split(DESC_MARK, 1)[1].strip() if DESC_MARK in (caption or "") else (caption or "").strip()


# ---------------- commands ----------------
def cmd_poll():
    ups = tg("getUpdates", {"allowed_updates": ["callback_query", "message"], "timeout": 0})["result"]
    last = None
    for u in ups:
        last = u["update_id"]; cq = u.get("callback_query")
        if not cq or str(cq["message"]["chat"]["id"]) != str(chat_id()): continue
        msg = cq["message"]; action = cq.get("data", "")
        tg("answerCallbackQuery", {"callback_query_id": cq["id"], "text": "Принято, работаю…"})
        markup_off = {"chat_id": chat_id(), "message_id": msg["message_id"], "reply_markup": {"inline_keyboard": []}}
        if action == "skip":
            tg("editMessageReplyMarkup", markup_off); say("❌ Ок, этот ролик не публикую.", msg["message_id"]); continue
        if action != "publish" or not msg.get("document"): continue
        tg("editMessageReplyMarkup", markup_off)
        say("⏳ Публикую в TikTok…", msg["message_id"])
        try:
            ok, res, privacy = publish(tg_file(msg["document"]["file_id"]), caption_description(msg.get("caption", "")))
        except Exception as e:  # report, never crash the hourly run
            ok, res, privacy = False, f"{type(e).__name__}: {e}", "?"
        note = " (приватно: приложение TikTok ещё на проверке)" if ok and privacy == "SELF_ONLY" else ""
        say((f"✅ Опубликовано{note}: {res}" if ok else f"⚠️ Не получилось опубликовать: {res}"), msg["message_id"])
    if last is not None:
        tg("getUpdates", {"offset": last + 1, "timeout": 0})  # acknowledge processed updates
    print(f"poll: {len(ups)} updates processed")


def cmd_auth_url():
    if not CK: die("TIKTOK_CLIENT_KEY is not set")
    q = urllib.parse.urlencode({"client_key": CK, "scope": SCOPES, "response_type": "code", "redirect_uri": REDIRECT, "state": "zybstudio"})
    url = f"https://www.tiktok.com/v2/auth/authorize/?{q}"
    say("🔗 Вход в TikTok для студии. Открой ссылку, разреши доступ, потом скопируй ВЕСЬ адрес страницы, "
        "на которую попадёшь (zybrilka.ru/?code=…), и пришли его сюда сообщением в течение 10 минут:\n" + url)
    print("auth url sent to Telegram")


def cmd_auth_wait(minutes=15):
    end = time.time() + minutes * 60; offset = None
    while time.time() < end:
        ups = tg("getUpdates", {"offset": offset, "timeout": 25, "allowed_updates": ["message"]} if offset else {"timeout": 25, "allowed_updates": ["message"]})["result"]
        for u in ups:
            offset = u["update_id"] + 1; m = u.get("message") or {}
            if str(m.get("chat", {}).get("id")) != str(chat_id()): continue
            code = re.search(r"[?&]code=([^&\s]+)", m.get("text", ""))
            if code:
                tok = oauth({"grant_type": "authorization_code", "code": urllib.parse.unquote(code.group(1)), "redirect_uri": REDIRECT})
                old, mid = load_tokens(); save_tokens(tok, mid)
                tg("deleteMessage", {"chat_id": chat_id(), "message_id": m["message_id"]})  # remove the code from the chat
                say("✅ TikTok подключён к студии. Теперь кнопка «Опубликовать» под роликами работает.")
                if offset: tg("getUpdates", {"offset": offset, "timeout": 0})
                print("authorised"); return
    die("no code received in time")


def cmd_stats():
    fields = "id,title,video_description,create_time,duration,view_count,like_count,comment_count,share_count,share_url"
    vids, cursor = [], None
    for _ in range(3):
        body = {"max_count": 20}
        if cursor: body["cursor"] = cursor
        r = tt(f"/video/list/?fields={fields}", body)
        d = r.get("data") or {}
        vids += d.get("videos") or []
        if not d.get("has_more"): break
        cursor = d.get("cursor")
    out = ROOT / "analytics/tiktok_stats.json"
    out.write_text(json.dumps({"fetched_at": int(time.time()), "videos": vids}, ensure_ascii=False, indent=1))
    print(f"{len(vids)} videos -> {out}")


def cmd_status():
    print("bot token:", bool(TG), "| chat:", bool(chat_id()), "| client key:", bool(CK), "| client secret:", bool(CS))
    if TG and CS:
        tok, _ = load_tokens(); print("tiktok authorised:", bool(tok))


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"poll": cmd_poll, "auth-url": cmd_auth_url, "stats": cmd_stats, "status": cmd_status,
     "auth-wait": lambda: cmd_auth_wait(int(sys.argv[sys.argv.index("--minutes") + 1]) if "--minutes" in sys.argv else 15)}[c]()
