"""FF Backup Center (service 3) — Telegram backup, full backup/restore, Data Center (12 types), data delete, monthly schedule.
Saare heavy kaam yahan, taaki Main panel aur Payment bot kabhi slow na ho. Sab kaam slow-mode (delay) ke saath."""
import os, sys, time, shutil, threading
import datetime as dt
from flask import Flask, jsonify, request, send_from_directory, send_file, g

from werkzeug.middleware.proxy_fix import ProxyFix

import fb, security, backup, sysmon, datacenter, tgbackup, jobs, slow, keepalive, opsapi

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024

ok = lambda **k: jsonify(ok=True, **k)
bad = lambda msg, code=400: (jsonify(ok=False, error=msg), code)


@app.after_request
def headers(r):
    r.headers["X-Content-Type-Options"] = "nosniff"
    r.headers["X-Frame-Options"] = "DENY"
    r.headers["Referrer-Policy"] = "same-origin"
    if request.path.startswith("/api/") or request.path.endswith((".html", ".js", ".css")) or request.path == "/":
        r.headers["Cache-Control"] = "no-store"
    return r


@app.before_request
def _t0():
    g._t0 = sysmon.req_start()


@app.after_request
def _t1(resp):
    try:
        if not request.path.startswith(("/api/server/live", "/health", "/api/jobs")):
            sysmon.req_end(getattr(g, "_t0", time.time()), resp.status_code)
    except Exception:
        pass
    return resp


@app.route("/")
def index():
    return send_from_directory(PUBLIC, "index.html")


@app.route("/<path:p>")
def static_files(p):
    if p.startswith("api/"):
        return bad("Not found", 404)
    return send_from_directory(PUBLIC, p)


opsapi.register_owner_auth(app)


def _job_slim():
    j = [x for x in backup._jobs.values() if x["status"] == "running"]
    return {"status": "running" if j else "idle", "job": (j[0]["kind"] + ": " + str(j[0]["progress"])[:60]) if j else None}


opsapi.register_ops(app, bot_status_fn=_job_slim, disk_dir=backup.BACKUP_DIR)


# ------------------------------------------------------------------ jobs
@app.get("/api/jobs/<jid>")
@security.login_required
def job(jid):
    j = backup.get_job(jid)
    return ok(job=j) if j else bad("Job nahi mila", 404)


def _start(kind, fn, *a, **kw):
    j = backup.run_job(kind, fn, *a, **kw)
    if not j:
        return bad("Doosra backup/restore/delete abhi chal raha hai, thoda ruko.", 409)
    return ok(job=j["id"])





# ------------------------------------------------------------------ overview (home screen)
@app.get("/api/overview")
@security.login_required
def overview():
    st = datacenter.get_settings()
    bks = backup.list_backups()
    try: total, used, free = shutil.disk_usage(backup.BACKUP_DIR)
    except Exception: total = used = free = 0
    running = [{"id": j["id"], "kind": j["kind"], "progress": j["progress"]} for j in backup._jobs.values() if j["status"] == "running"]
    return ok(telegram=tgbackup.public_cfg(), monthly=st.get("monthly") or {}, next_monthly=datacenter.next_monthly(st),
              backup=backup.get_settings(), files={"count": len(bks), "size": sum(b["size"] for b in bks), "latest": bks[0] if bks else None},
              disk={"free": free, "total": total}, running=running, pace=slow.FACTOR, maint={**jobs.maint_cfg(), "state": jobs.state})


PACES = {"turbo": 0.3, "normal": 1.0, "slow": 2.0, "ultra": 4.0}


@app.post("/api/pace")
@security.login_required
def pace():
    d = request.get_json(silent=True) or {}
    try: f = float(PACES.get(d.get("mode"), d.get("factor")))
    except Exception: return bad("Speed mode galat hai")
    return ok(pace=backup.set_pace(f))


@app.post("/api/maint")
@security.login_required
def maint():
    d = request.get_json(silent=True) or {}
    if d.get("run"):
        if d.get("run") == "chat":
            return _start("chat-ttl", lambda job: {"removed": jobs.run_chat_ttl()})
        return _start("cleanup", lambda job: {"removed": jobs.run_cleanup()})
    patch = {}
    if "cleanup" in d: patch["cleanup"] = bool(d["cleanup"])
    if "chatTtl" in d: patch["chatTtl"] = bool(d["chatTtl"])
    if patch:
        jobs.save_maint(patch)
    return ok(maint=jobs.maint_cfg())


# ------------------------------------------------------------------ DATA CENTER (8 data types) + TELEGRAM
@app.get("/api/dc/types")
@security.login_required
def dc_types():
    st = datacenter.get_settings()
    return ok(types=[{"key": k, **v, "auto": ((st.get("types") or {}).get(k) or {}).get("auto") or {}} for k, v in datacenter.TYPES.items()],
              monthly=st.get("monthly") or {}, telegram=tgbackup.public_cfg(), files=[f for f in backup.list_backups() if f["name"].startswith("ff_")][:20])


_sum_cache = {}


@app.get("/api/dc/<key>/summary")
@security.login_required
def dc_summary(key):
    if key not in datacenter.TYPES: return bad("Unknown type", 404)
    hit = _sum_cache.get(key)
    if hit and time.time() - hit[0] < 600 and not request.args.get("fresh"):      # summary poora type stream karta hai — 10 min cache
        return ok(**hit[1])
    try:
        r = datacenter.summary(key); _sum_cache[key] = (time.time(), r); return ok(**r)
    except Exception as e: return bad(f"Firestore error: {e}", 500)


@app.post("/api/dc/<key>/export")
@security.login_required
def dc_export(key):
    if key not in datacenter.TYPES: return bad("Unknown type", 404)
    return _start("dc-export", lambda job: (lambda r: {"name": os.path.basename(r[0]), "docs": r[1]})(datacenter.export_file(key, job)))


@app.post("/api/dc/<key>/upload")
@security.pin_required
def dc_upload(key):
    if key not in datacenter.TYPES: return bad("Unknown type", 404)
    f = request.files.get("file")
    if not f: return bad("File select karo")
    tmp = os.path.join(backup.BACKUP_DIR, f"dcup_{int(time.time())}.json")
    f.save(tmp)

    def run(job):
        try: return datacenter.restore_file(job, key, tmp)
        finally:
            try: os.remove(tmp)
            except OSError: pass
    return _start("dc-restore", run)


@app.post("/api/dc/<key>/delete")
@security.pin_required
def dc_delete(key):
    if key not in datacenter.TYPES or not datacenter.TYPES[key]["deletable"]: return bad("Is type ka delete option nahi hai", 400)
    d = request.get_json(silent=True) or {}
    try: days = int(d.get("days"))
    except Exception: return bad("Din (days) dalo")
    if days < 0 or days > 3650: return bad("Days 0-3650 ke beech hona chahiye")
    if not tgbackup.public_cfg()["configured"]: return bad("Pehle Telegram account add karo — delete se pehle backup Telegram par jata hai", 400)
    return _start("dc-delete", lambda job: datacenter.delete_older(job, key, days))


@app.post("/api/dc/<key>/auto")
@security.login_required
def dc_auto(key):
    if key not in datacenter.TYPES or not datacenter.TYPES[key]["deletable"]: return bad("Is type ka auto-delete nahi hai", 400)
    d = request.get_json(silent=True) or {}
    if d.get("enabled") and not tgbackup.public_cfg()["configured"]: return bad("Auto-delete ke liye Telegram account add karna zaroori hai (backup pehle jata hai)", 400)
    try: datacenter.set_auto(key, d.get("enabled"), d.get("days") or 30, str(d.get("time") or "03:00"), d.get("day") or 0)
    except Exception as e: return bad(str(e))
    return ok()


@app.get("/api/dc/file/<name>")
@security.login_required
def dc_file(name):
    p = backup.backup_path(name)
    if not p or not name.startswith("ff_"): return bad("File nahi mili", 404)
    return send_file(p, as_attachment=True, download_name=name)


@app.post("/api/dc/monthly")
@security.login_required
def dc_monthly():
    d = request.get_json(silent=True) or {}
    if d.get("run"):
        if not tgbackup.public_cfg()["configured"]: return bad("Telegram account add nahi hai", 400)
        return _start("dc-month", lambda job: datacenter.month_end_backup(job))
    patch = {"enabled": bool(d.get("enabled"))}
    if "day" in d: patch["day"] = max(0, min(31, int(d.get("day") or 0)))
    if d.get("time"): patch["time"] = str(d["time"])[:5]
    datacenter.save_settings({"monthly": patch})
    return ok()


@app.get("/api/tg")
@security.login_required
def tg_get(): return ok(**tgbackup.public_cfg())


@app.post("/api/tg")
@security.pin_required
def tg_save():
    d = request.get_json(silent=True) or {}
    try: tgbackup.save_cfg(d.get("api_id"), d.get("api_hash"), d.get("session"), d.get("chat") or "me")
    except Exception as e: return bad(f"Save error: {e}")
    return ok(**tgbackup.public_cfg())


@app.post("/api/tg/test")
@security.login_required
def tg_test():
    try: who = tgbackup.send(text="✅ FF Admin — Telegram backup account connected.")
    except Exception as e: return bad(str(e), 400)
    return ok(account=who)


@app.post("/api/tg/remove")
@security.pin_required
def tg_remove():
    tgbackup.remove_cfg(); return ok()


# ------------------------------------------------------------------ backups
_col_cache = {"t": 0.0, "v": None}
_col_lock = threading.Lock()


@app.get("/api/collections")
@security.login_required
def collections():
    """Collection counts: 2 min cache + har count ke beech 0.4s aaram (pehle sab ek saath)."""
    if _col_cache["v"] is not None and time.time() - _col_cache["t"] < 120:
        return ok(collections=_col_cache["v"])
    with _col_lock:
        if _col_cache["v"] is not None and time.time() - _col_cache["t"] < 120:
            return ok(collections=_col_cache["v"])
        try:
            cols = backup.list_root_collections()
        except Exception as e:
            return bad(f"Firestore error: {e}", 500)
        out = []
        for c in cols:
            out.append({"name": c, "count": backup.count_docs(c)})
            slow.rest(0.4)
        _col_cache.update(t=time.time(), v=out)
    return ok(collections=out)


@app.get("/api/backups")
@security.login_required
def backups():
    return ok(backups=backup.list_backups(), settings=backup.get_settings(), dir=backup.BACKUP_DIR)


@app.post("/api/backups")
@security.login_required
def backup_create():
    d = request.get_json(silent=True) or {}
    cols = [c for c in (d.get("collections") or []) if isinstance(c, str) and "/" not in c] or None
    subs = bool(d.get("subcollections", True))
    if d.get("telegram"):
        if not tgbackup.public_cfg()["configured"]:
            return bad("Telegram account add nahi hai", 400)

        def run(job):
            res = backup.do_backup(job, cols, subs, "manual")
            job["progress"] = "Telegram par bhej raha hu…"
            tgbackup.send([(os.path.join(backup.BACKUP_DIR, res["name"]), f"🗂 Manual backup — {res['docs']} docs")])
            res["telegram"] = True
            return res
        return _start("backup", run)
    return _start("backup", backup.do_backup, cols, subs, "manual")


@app.get("/api/backups/<name>/download")
@security.login_required
def backup_download(name):
    p = backup.backup_path(name)
    return send_file(p, as_attachment=True, download_name=name) if p else bad("File nahi mili", 404)


@app.post("/api/backups/<name>/delete")
@security.pin_required
def backup_delete(name):
    return ok() if backup.delete_backup(name) else bad("File nahi mili", 404)


@app.post("/api/backups/<name>/restore")
@security.pin_required
def backup_restore(name):
    p = backup.backup_path(name)
    if not p:
        return bad("File nahi mili", 404)
    only = (request.get_json(silent=True) or {}).get("collections")
    return _start("restore", backup.do_restore, p, only)


@app.post("/api/restore-upload")
@security.pin_required
def restore_upload():
    f = request.files.get("file")
    if not f:
        return bad("File select karo")
    fn = f.filename or ""
    ext = ".ffbak.gz" if fn.endswith(".ffbak.gz") else (".json.gz" if fn.endswith(".json.gz") else ".json")
    tmp = os.path.join(backup.BACKUP_DIR, f"upload_{int(time.time())}{ext}")
    f.save(tmp)

    def run(job, path):
        try:
            return backup.do_restore(job, path)
        finally:
            try: os.remove(path)
            except OSError: pass
    return _start("restore", run, tmp)


@app.post("/api/backup-settings")
@security.login_required
def backup_settings():
    d = request.get_json(silent=True) or {}
    backup.save_settings(d.get("interval_hours"), d.get("keep"))
    return ok(settings=backup.get_settings())


# ------------------------------------------------------------------ data delete
@app.post("/api/data/delete-collection")
@security.pin_required
def del_collection():
    d = request.get_json(silent=True) or {}
    col = (d.get("collection") or "").strip()
    if not col or "/" in col:
        return bad("Collection ka naam galat hai")
    if d.get("confirm") != col:
        return bad("Confirm text collection ke naam se match nahi hua")
    return _start("delete", backup.do_delete_collection, col, bool(d.get("backup", True)))


@app.post("/api/data/delete-doc")
@security.pin_required
def del_doc():
    d = request.get_json(silent=True) or {}
    path = (d.get("path") or "").strip().strip("/")
    if not path or len(path.split("/")) % 2 != 0:
        return bad("Doc path galat (format: collection/docId)")
    return _start("delete", backup.do_delete_doc, path, bool(d.get("recursive", True)), bool(d.get("backup", True)))


@app.post("/api/data/delete-older")
@security.pin_required
def del_older():
    d = request.get_json(silent=True) or {}
    col, field = (d.get("collection") or "").strip(), (d.get("field") or "").strip()
    try:
        days = float(d.get("days"))
    except (TypeError, ValueError):
        return bad("Days number hona chahiye")
    if not col or "/" in col or not field or days < 0:
        return bad("Collection / field / days check karo")
    return _start("delete", backup.do_delete_older, col, field, days,
                  "ts" if d.get("type") == "ts" else "ms", bool(d.get("backup", True)))



@app.errorhandler(500)
def _json_500(e):
    if request.path.startswith("/api/"):
        return jsonify(ok=False, error="Server error"), 500
    return e


# ------------------------------------------------------------------ boot
_booted, _boot_lock = False, threading.Lock()


def boot():
    global _booted
    with _boot_lock:
        if _booted: return
        _booted = True
    if not security.creds_ready():
        print("[warn] OWNER_EMAIL/PASSWORD/PIN set nahi — login disabled", flush=True)
    if not security.secret_from_env():
        print("[warn] SESSION_SECRET set nahi — restart par logout ho jayega", flush=True)
    backup.start_scheduler()
    jobs.start()
    keepalive.start()


boot()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 10000)))
