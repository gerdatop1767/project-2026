#!/usr/bin/env python3
"""Memory of video topics that survives fresh cloud sessions (scheduled runs cannot push to git).

Topics live as plain text in the SAME pinned message of the owner's chat with the studio bot as the
encrypted TikTok tokens (after the line TOPICS_TAG). Without tokens the message holds only the topics.

  python3 topics.py list            # every topic already made, newest first: date | task | title | slug
  python3 topics.py add --title "Лишняя цифра в ответе" --task "рус 8" --slug 002-lishnyaya-cifra
"""
import argparse, datetime, sys
from tiktok_api import TOKEN_TAG, TOPICS_TAG, chat_id, tg

LIMIT = 3600  # Telegram message limit is 4096; oldest topics are dropped first


def _pin():
    pin = tg("getChat", {"chat_id": chat_id()})["result"].get("pinned_message") or {}
    txt = pin.get("text", "")
    if txt.startswith(TOKEN_TAG) or txt.startswith(TOPICS_TAG):
        return txt, pin["message_id"]
    return "", None


def load():
    txt, _ = _pin()
    if TOPICS_TAG not in txt: return []
    return [l[2:].strip() for l in txt.split(TOPICS_TAG, 1)[1].splitlines() if l.startswith("• ")]


def add(title, task, slug):
    txt, mid = _pin()
    head = txt.split(TOPICS_TAG)[0].rstrip() if txt else ""
    date = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).strftime("%d.%m")
    items = [f"{date} | {task} | {title} | {slug}"] + load()
    while True:
        body = (head + "\n\n" if head else "") + TOPICS_TAG + "\n" + "\n".join("• " + i for i in items)
        if len(body) <= LIMIT or len(items) == 1: break
        items.pop()
    if mid:
        tg("editMessageText", {"chat_id": chat_id(), "message_id": mid, "text": body})
    else:
        m = tg("sendMessage", {"chat_id": chat_id(), "text": body, "disable_notification": True})["result"]
        tg("pinChatMessage", {"chat_id": chat_id(), "message_id": m["message_id"], "disable_notification": True})
    print("saved:", items[0])


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["list", "add"])
    ap.add_argument("--title"); ap.add_argument("--task", default="-"); ap.add_argument("--slug", default="-")
    a = ap.parse_args()
    if a.cmd == "list":
        t = load(); print("\n".join(t) if t else "(тем пока нет)")
    else:
        if not a.title: sys.exit("--title is required")
        add(a.title, a.task, a.slug)
