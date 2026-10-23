#!/usr/bin/env python3
"""Pasang aturan comment->DM untuk SATU Reels (aturan hanya berlaku di Reels itu).

Pakai:  python3 add_reel.py <link-reels> [--follow] "kata=isi DM" "kata2,kata3=isi DM lain"
  --follow = orang harus follow dulu (DM pertama berisi tombol, isi DM dikirim setelah dicek follow)
Menjalankan ulang untuk Reels yang sama = MENGGANTI aturan lama Reels itu.
"""
import json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path

BASE = Path(__file__).parent
W = BASE / "worker"

for line in (BASE / ".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())
TOKEN = os.environ["ACCESS_TOKEN"]


def find_media_id(shortcode):
    url = "https://graph.instagram.com/v21.0/me/media?fields=id,permalink&limit=100"
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
        data = json.load(urllib.request.urlopen(req, timeout=15))
        for m in data.get("data", []):
            if f"/{shortcode}/" in m["permalink"]:
                return m["id"]
        url = data.get("paging", {}).get("next")
    sys.exit("Reels tidak ketemu di akun ini. Cek link-nya.")


FOLLOW = "--follow" in sys.argv
sys.argv = [x for x in sys.argv if x != "--follow"]
if len(sys.argv) < 3:
    sys.exit(__doc__)
m = re.search(r"instagram\.com/(?:[^/]+/)?(?:reel|p|reels)/([\w-]+)", sys.argv[1])
if not m:
    sys.exit("Link tidak dikenali.")
media_id = find_media_id(m.group(1))

cfg_path = BASE / "config.json"
if not cfg_path.exists():
    shutil.copy(BASE / "config.example.json", cfg_path)
cfg = json.loads(cfg_path.read_text())

new = []
for pair in sys.argv[2:]:
    kw, dm = pair.split("=", 1)
    rule = {"keywords": [x.strip() for x in kw.split(",")], "media_id": media_id, "dm": dm}
    if FOLLOW:
        rule["require_follow"] = True
    new.append(rule)
cfg["rules"] = [r for r in cfg["rules"] if r.get("media_id") != media_id] + new
cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
print(f"OK: {len(new)} aturan untuk media {media_id}")

# kirim ke Worker (KV) supaya langsung aktif tanpa deploy ulang
shutil.copy(cfg_path, W / "config.json")
r = subprocess.run(["npx", "wrangler", "kv", "key", "put", "--binding=STORE", "config",
                    "--path", "config.json", "--remote"], cwd=W, capture_output=True, text=True,
                   env={**os.environ, "WRANGLER_SEND_METRICS": "false"})
print("Worker diperbarui" if r.returncode == 0 else "GAGAL update Worker:\n" + r.stderr[-500:])
