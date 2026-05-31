#!/usr/bin/env python3
# Web-OTA канал для IPA-Маккода (докачка вебки без переустановки приложения).
# Копирует 9 файлов вебки из terminal-bot/mini-app в makkod-ota/web/<build>/,
# считает sha256+size каждого и пишет web/manifest.json — указатель на свежий
# билд. IPA при открытии попапа «Версии» читает manifest по HTTPS с GitHub Pages,
# сверяет build с встроенным/активным и докачивает файлы при m.build > текущего.
# Канал независим от Vercel (web/TG идут туда отдельно).
#
# Запуск:  python3 build_web_channel.py [build]
# Без аргумента build берётся из window.APP_BUILD в app.js.

import hashlib
import json
import os
import re
import shutil
import sys

SRC = os.path.expanduser("~/terminal-bot/mini-app")
OTA = os.path.expanduser("~/makkod-ota")
WEB = os.path.join(OTA, "web")

# Канонический список — ровно то, что Capacitor кладёт в www и отдаёт по
# capacitor://localhost. Фиксируем, чтобы случайно не утянуть служебные файлы
# (.git, .vercel и т.п.) и чтобы порядок докачки в Swift был детерминирован.
WEBAPP_FILES = [
    "index.html",
    "app.js",
    "styles.css",
    "sw.js",
    "capacitor.js",
    "config.js",
    "tg-shim.js",
    "news.json",
    "icon.svg",
]


def read_build():
    with open(os.path.join(SRC, "app.js"), "r", encoding="utf-8") as f:
        head = f.read(8192)
    m = re.search(r'APP_BUILD\s*=\s*["\'](\d+)["\']', head)
    if not m:
        sys.exit("APP_BUILD не найден в начале app.js")
    return int(m.group(1))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    build = int(sys.argv[1]) if len(sys.argv) > 1 else read_build()
    dest = os.path.join(WEB, str(build))
    os.makedirs(dest, exist_ok=True)

    files = []
    for name in WEBAPP_FILES:
        src = os.path.join(SRC, name)
        if not os.path.isfile(src):
            sys.exit(f"нет исходного файла: {src}")
        dst = os.path.join(dest, name)
        shutil.copy2(src, dst)
        files.append({
            "name": name,
            "sha256": sha256_file(dst),
            "size": os.path.getsize(dst),
        })

    manifest = {"build": build, "files": files}
    manifest_path = os.path.join(WEB, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(x["size"] for x in files)
    print(f"web-channel build {build}: {len(files)} файлов, {total} байт → {dest}")
    print(f"manifest → {manifest_path}")
    for x in files:
        print(f"  {x['name']:14} {x['size']:>9}  {x['sha256'][:16]}…")


if __name__ == "__main__":
    main()
