#!/usr/bin/env python3
# Web-OTA канал для IPA-Маккода (докачка вебки без переустановки приложения).
# Копирует 9 файлов вебки из terminal-bot/mini-app в makkod-ota/web/<build>/,
# считает sha256+size каждого и пишет ДВА манифеста:
#   1) web/manifest.json          — указатель на свежий билд (верхняя кнопка
#      «проверить обновления» сверяет его build с текущим);
#   2) web/<build>/manifest.json  — пер-билдовый манифест ровно этого билда, по
#      нему Swift качает выбранную из списка версию (откат/переключение). Без
#      него откат невозможен: общий манифест всегда latest, и его sha256 не
#      сойдутся со старыми файлами.
# IPA читает манифесты по HTTPS с GitHub Pages. Канал независим от Vercel.
#
# Запуск:
#   python3 build_web_channel.py [build]   — собрать билд из mini-app (build из
#                                            аргумента или window.APP_BUILD).
#   python3 build_web_channel.py --backfill — до-создать web/<N>/manifest.json
#                                            для всех уже лежащих папок (по их
#                                            собственным файлам, без копирования).

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


def write_manifest(path, build, files):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"build": build, "files": files}, f, ensure_ascii=False, indent=2)
        f.write("\n")


def manifest_for_dir(dirpath, build):
    """Считает files-список по 9 файлам, уже лежащим в dirpath."""
    files = []
    for name in WEBAPP_FILES:
        p = os.path.join(dirpath, name)
        if not os.path.isfile(p):
            sys.exit(f"нет файла для манифеста: {p}")
        files.append({"name": name, "sha256": sha256_file(p), "size": os.path.getsize(p)})
    return files


def backfill():
    """Для каждой web/<N>/ с полным набором файлов — пишет <N>/manifest.json."""
    done = []
    for entry in sorted(os.listdir(WEB)):
        d = os.path.join(WEB, entry)
        if not (os.path.isdir(d) and entry.isdigit()):
            continue
        if not all(os.path.isfile(os.path.join(d, n)) for n in WEBAPP_FILES):
            print(f"  пропуск {entry}: не все файлы на месте")
            continue
        files = manifest_for_dir(d, int(entry))
        write_manifest(os.path.join(d, "manifest.json"), int(entry), files)
        done.append(entry)
    print(f"backfill: пер-билдовые манифесты записаны для {len(done)} билдов: {', '.join(done)}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--backfill":
        backfill()
        return

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

    # Пер-билдовый манифест ровно этого билда (для отката на него из списка
    # версий) + общий указатель на свежий билд (для верхней кнопки).
    write_manifest(os.path.join(dest, "manifest.json"), build, files)
    manifest_path = os.path.join(WEB, "manifest.json")
    write_manifest(manifest_path, build, files)

    total = sum(x["size"] for x in files)
    print(f"web-channel build {build}: {len(files)} файлов, {total} байт → {dest}")
    print(f"manifest → {manifest_path} + {os.path.join(dest, 'manifest.json')}")
    for x in files:
        print(f"  {x['name']:14} {x['size']:>9}  {x['sha256'][:16]}…")


if __name__ == "__main__":
    main()
