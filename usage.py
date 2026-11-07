"""Firebase usage (dono Firestore projects): storage, kaun-sa data kitna, aaj ke reads/writes/deletes, pehle vs ab.

Firebase 1 = main database (FIREBASE_CREDENTIALS_B64), Firebase 2 = chat database (FIREBASE_CREDENTIALS_B641).

STORAGE: Firestore Admin SDK "kitni storage use hui" seedha nahi batata. Isliye har collection ke docs ka size Firestore ke
  storage-size formula se *estimate* hota hai (sample ke docs ka average x total docs; count aggregation bahut sasta hai).
  "Exact" scan har doc padhta hai (reads kharch hote hain). Index storage ka bhi andaza judta hai. Sahi final number ke liye
  Firebase Console -> Firestore -> Usage dekho (panel mein link hai).
READS / WRITES / DELETES: Google Cloud Monitoring API se (document/read_count, write_count, delete_count). Iske liye service
  account ko "Monitoring Viewer" role + Cloud Monitoring API enable chahiye — nahi hai to panel saaf batata hai kya karna hai.
"""
import os, time, json, datetime as dt
import fb, slow

DBS = ("main", "chat")
LABEL = {"main": "Firebase 1 (Main)", "chat": "Firebase 2 (Chat)"}
SNAP_DOC = ("bot_meta", "usage_snapshots")
CFG_DOC = ("bot_meta", "usage_cfg")
HISTORY_KEEP = 90
# Spark (free) plan ke daily / storage limits — Blaze ho to panel mein badal sakte ho
LIMITS_DEFAULT = {"storage_gb": 1.0, "reads": 50000, "writes": 20000, "deletes": 20000}
GIB = 1024 ** 3
SAMPLE_DEFAULT = 30

# Subcollections jo backup.KNOWN_SUBS mein hain (collection-group ke naam se count/size hote hain)
SUBS = {
    "main": {"users": ("transactions", "notifications", "matchHistory"), "gift_codes": ("redeems",), "chats": ("messages",), "groups": ("messages",)},
    "chat": {"cchats": ("msgs",), "cgroups": ("msgs",)},
}


# ------------------------------------------------------------------ db helpers
def chat_separate():
    return fb.chat_separate()


def db_of(which):
    if which == "chat":
        if not chat_separate():
            raise RuntimeError("Firebase 2 (chat) alag project nahi hai — FIREBASE_CREDENTIALS_B641 set karo")
        return fb.get_chat_db()
    return fb.get_db()


def dbs_available():
    return [w for w in DBS if w == "main" or chat_separate()]


# ------------------------------------------------------------------ size estimate (Firestore storage-size rules)
def _ssz(s):
    return len(str(s).encode("utf-8")) + 1


def _vsz(v):
    if v is None or isinstance(v, bool):
        return 1
    if isinstance(v, (int, float)):
        return 8
    if isinstance(v, str):
        return len(v.encode("utf-8")) + 1
    if isinstance(v, (bytes, bytearray)):
        return len(v)
    if isinstance(v, dt.datetime):
        return 8
    if isinstance(v, dict):
        return sum(_ssz(k) + _vsz(x) for k, x in v.items())
    if isinstance(v, (list, tuple)):
        return sum(_vsz(x) for x in v)
    p = getattr(v, "path", None)                      # DocumentReference
    if p:
        return sum(_ssz(x) for x in str(p).split("/")) + 16
    if hasattr(v, "latitude"):                        # GeoPoint
        return 16
    return 8


def name_size(path):
    return sum(_ssz(x) for x in path.split("/")) + 16


def doc_bytes(path, data):
    """(raw_bytes, index_bytes) ka andaza ek doc ke liye."""
    nsz = name_size(path)
    raw = nsz + 32 + sum(_ssz(k) + _vsz(v) for k, v in (data or {}).items())
    idx = 0

    def walk(v):
        nonlocal idx
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                idx += nsz + _vsz(x) + 32                # array-contains entry
        else:
            idx += 2 * (nsz + _vsz(v) + 32)              # ascending + descending
    for v in (data or {}).values():
        walk(v)
    return raw, idx


# ------------------------------------------------------------------ scan
def _count(q):
    try:
        r = q.count().get()
        return int(r[0][0].value)
    except Exception:
        return None


def _measure(query, sample, total):
    """query ke docs ka (docs, raw, idx, reads). sample=0 -> sab padho (exact); warna sample docs ka average x total."""
    n = raw = idx = 0
    lim = query if not sample else query.limit(int(sample))
    for s in slow.paced(lim.stream(), 50, 0.3):
        r, i = doc_bytes(s.reference.path, s.to_dict() or {})
        n += 1; raw += r; idx += i
    reads = n
    if not sample:
        return {"docs": n, "raw": raw, "idx": idx, "reads": reads, "exact": True}
    if n == 0:
        return {"docs": total or 0, "raw": 0, "idx": 0, "reads": 1, "exact": True}
    if total is None:                                     # count nahi mila — sample hi dikhao (adhoora ho sakta hai)
        return {"docs": n, "raw": raw, "idx": idx, "reads": reads, "exact": n < int(sample)}
    if total <= n:                                        # sample mein poori collection aa gayi — exact
        return {"docs": n, "raw": raw, "idx": idx, "reads": reads, "exact": True}
    f = total / n
    return {"docs": total, "raw": int(raw * f), "idx": int(idx * f), "reads": reads, "exact": False}


def scan_db(job, which, sample=SAMPLE_DEFAULT):
    """Ek database ka poora storage breakdown. sample=0 -> exact (har doc padhta hai = reads kharch)."""
    db = db_of(which)
    cols = sorted(c.id for c in db.collections())
    out, reads = [], 0
    for i, c in enumerate(cols):
        job["progress"] = f"{LABEL[which]}: {c} ({i + 1}/{len(cols)})"
        ref = db.collection(c)
        total = _count(ref); reads += 1
        m = _measure(ref, sample, total)
        reads += m.pop("reads")
        out.append({"name": c, **m})
        slow.rest(0.3)
    groups = {}
    for root, names in SUBS[which].items():
        if root in cols:
            for n in names:
                groups.setdefault(n, []).append(root)
    subs = []
    for n, roots in groups.items():
        job["progress"] = f"{LABEL[which]}: {'/'.join(roots)}/…/{n}"
        q = db.collection_group(n)
        total = _count(q); reads += 1
        m = _measure(q, sample, total)
        reads += m.pop("reads")
        subs.append({"name": n, "parents": roots, **m})
        slow.rest(0.3)
    allx = out + subs
    res = {"db": which, "project": fb.project_ids().get(which), "at": int(time.time() * 1000), "sample": int(sample or 0),
           "exact": all(x.get("exact") for x in allx) if allx else True, "reads_used": reads,
           "collections": sorted(out, key=lambda x: -x["idx"]), "subs": sorted(subs, key=lambda x: -x["idx"]),
           "totals": {"docs": sum(x["docs"] for x in allx), "raw": sum(x["raw"] for x in allx), "idx": sum(x["idx"] for x in allx)}}
    save_scan(res)
    return res


def run_scan(job, which="both", sample=SAMPLE_DEFAULT):
    """which = main | chat | both."""
    targets = dbs_available() if which == "both" else [which]
    done = {}
    for w in targets:
        r = scan_db(job, w, sample)
        done[w] = {"docs": r["totals"]["docs"], "raw": r["totals"]["raw"], "idx": r["totals"]["idx"], "reads": r["reads_used"]}
        alerts(w, r)
    return done


# ------------------------------------------------------------------ settings + snapshots (main DB: bot_meta)
def _doc(name):
    return fb.get_db().collection(name[0]).document(name[1])


def get_cfg():
    try:
        d = _doc(CFG_DOC).get(timeout=20)
        c = (d.to_dict() or {}) if d.exists else {}
    except Exception:
        c = {}
    lim = c.get("limits") or {}
    return {"limits": {w: {**LIMITS_DEFAULT, **(lim.get(w) or {})} for w in DBS},
            "alert_pct": int(c.get("alert_pct") or 80), "auto": c.get("auto", True) is not False,
            "last_alert": c.get("last_alert") or {}, "last_auto": c.get("last_auto") or 0}


def save_cfg(patch):
    cur = get_cfg(); out = {}
    if "limits" in patch:
        lims = {}
        for w in DBS:
            src = (patch["limits"] or {}).get(w) or {}
            lims[w] = {}
            for k, dv in LIMITS_DEFAULT.items():
                if k in src:
                    v = float(src[k])
                    if v <= 0 or v > 1e9:
                        raise ValueError(f"{k} sahi number hona chahiye")
                    lims[w][k] = v if k == "storage_gb" else int(v)
        out["limits"] = lims
    if "alert_pct" in patch:
        out["alert_pct"] = max(10, min(100, int(patch["alert_pct"])))
    if "auto" in patch:
        out["auto"] = bool(patch["auto"])
    if out:
        _doc(CFG_DOC).set(out, merge=True)
    return get_cfg()


def _snap_all():
    try:
        d = _doc(SNAP_DOC).get(timeout=20)
        return (d.to_dict() or {}) if d.exists else {}
    except Exception:
        return {}


def save_scan(res):
    """Latest scan + history (pehla entry hamesha 'first' mein bacha rehta hai -> 'pehle kitna tha')."""
    w = res["db"]
    allx = _snap_all(); cur = allx.get(w) or {}
    h = list(cur.get("history") or [])
    entry = {"at": res["at"], "docs": res["totals"]["docs"], "raw": res["totals"]["raw"], "idx": res["totals"]["idx"], "exact": res["exact"]}
    h.append(entry)
    first = cur.get("first") or entry
    _doc(SNAP_DOC).set({w: {"latest": res, "history": h[-HISTORY_KEEP:], "first": first}}, merge=True)


def snapshot(which):
    c = _snap_all().get(which) or {}
    h = c.get("history") or []
    return {"latest": c.get("latest"), "history": h, "first": c.get("first"), "prev": h[-2] if len(h) >= 2 else None}


# ------------------------------------------------------------------ reads / writes / deletes (Cloud Monitoring)
_sess = {}
_ops_cache = {}
OPS_TTL = 60


class MonitoringError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg); self.code = code


def _session(which):
    if which not in _sess:
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        info = fb.service_info(which)
        creds = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/monitoring.read"])
        _sess[which] = (AuthorizedSession(creds), info.get("project_id"))
    return _sess[which]


def _nth_sunday(year, month, n):
    first = dt.date(year, month, 1)
    return 1 + (6 - first.weekday()) % 7 + 7 * (n - 1)


def pt_offset(utc_now):
    """Pacific Time ka UTC offset (ghante). Firebase quota roz PT ki raat 12 baje reset hota hai."""
    y = utc_now.year
    start = dt.datetime(y, 3, _nth_sunday(y, 3, 2), 10, tzinfo=dt.timezone.utc)     # 2:00 PST
    end = dt.datetime(y, 11, _nth_sunday(y, 11, 1), 9, tzinfo=dt.timezone.utc)      # 2:00 PDT
    return -7 if start <= utc_now < end else -8


def pt_day_start(utc_now):
    off = dt.timedelta(hours=pt_offset(utc_now))
    local = utc_now + off
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - off


def _iso(t):
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _series(sess, pid, metric, start, end, period=3600):
    r = sess.get(f"https://monitoring.googleapis.com/v3/projects/{pid}/timeSeries", timeout=12, params={
        "filter": f'metric.type="firestore.googleapis.com/document/{metric}"',
        "interval.startTime": _iso(start), "interval.endTime": _iso(end),
        "aggregation.alignmentPeriod": f"{period}s", "aggregation.perSeriesAligner": "ALIGN_SUM",
        "aggregation.crossSeriesReducer": "REDUCE_SUM", "view": "FULL"})
    if r.status_code != 200:
        txt = r.text or ""
        if r.status_code in (401, 403):
            code = "api_disabled" if ("has not been used" in txt or "disabled" in txt.lower()) else "denied"
            raise MonitoringError(code, txt[:300])
        raise MonitoringError("other", f"HTTP {r.status_code}: {txt[:200]}")
    pts = []
    for ts in r.json().get("timeSeries", []):
        for p in ts.get("points", []):
            v = p.get("value", {})
            n = int(float(v.get("int64Value", v.get("doubleValue", 0)) or 0))
            e = dt.datetime.fromisoformat(p["interval"]["endTime"].replace("Z", "+00:00"))
            pts.append((e, n))
    return pts


def _fix_links(pid):
    return {"iam": f"https://console.cloud.google.com/iam-admin/iam?project={pid}",
            "api": f"https://console.cloud.google.com/apis/library/monitoring.googleapis.com?project={pid}"}


def live_ops(which, fresh=False):
    """Aaj (PT din) + pichle 7 din ke reads/writes/deletes. Monitoring access na ho to ok=False + kya karna hai."""
    hit = _ops_cache.get(which)
    if hit and not fresh and time.time() - hit[0] < OPS_TTL:
        return hit[1]
    pid = None
    try:
        sess, pid = _session(which)
        now = dt.datetime.now(dt.timezone.utc)
        t0 = pt_day_start(now); off = dt.timedelta(hours=pt_offset(now))
        res = {"ok": True, "project": pid, "day_start": int(t0.timestamp() * 1000),
               "resets_at": int((t0 + dt.timedelta(days=1)).timestamp() * 1000), "metrics": {}}
        for key, metric in (("reads", "read_count"), ("writes", "write_count"), ("deletes", "delete_count")):
            pts = _series(sess, pid, metric, now - dt.timedelta(days=7), now)
            days = {}
            for e, n in pts:
                d = ((e - dt.timedelta(seconds=1)) + off).strftime("%Y-%m-%d")      # PT din
                days[d] = days.get(d, 0) + n
            today = sum(n for e, n in pts if e > t0)
            res["metrics"][key] = {"today": today, "days": [{"d": d, "n": days[d]} for d in sorted(days)][-7:]}
        out = res
    except MonitoringError as e:
        out = {"ok": False, "code": e.code, "project": pid, "detail": str(e)[:300], "fix": _fix_links(pid) if pid else {},
               "msg": ("Cloud Monitoring API enable nahi hai" if e.code == "api_disabled" else
                       "Service account ko 'Monitoring Viewer' role chahiye" if e.code == "denied" else "Monitoring se data nahi aaya")}
    except Exception as e:
        out = {"ok": False, "code": "error", "project": pid, "detail": str(e)[:300], "fix": {}, "msg": "Monitoring se connect nahi hua: " + str(e)[:120]}
    _ops_cache[which] = (time.time(), out)
    return out


# ------------------------------------------------------------------ alerts (Telegram) + daily auto scan
def _alert_text(which, lines):
    return f"⚠️ {LABEL[which]} — usage alert\n" + "\n".join("• " + x for x in lines)


def alerts(which, scan=None, ops=None):
    """Limit ka alert_pct% cross hone par Telegram message (din mein ek hi baar, har cheez ke liye)."""
    try:
        import tgbackup
        if not tgbackup.public_cfg()["configured"]:
            return
        cfg = get_cfg(); lim = cfg["limits"][which]; pct = cfg["alert_pct"]
        lines, keys = [], []
        if scan:
            used = scan["totals"]["raw"] + scan["totals"]["idx"]
            p = used / (lim["storage_gb"] * GIB) * 100
            if p >= pct:
                lines.append(f"Storage ~{p:.0f}% bhar gaya ({_fmt(used)} / {lim['storage_gb']:g} GB)"); keys.append("storage")
        if ops and ops.get("ok"):
            for k in ("reads", "writes", "deletes"):
                n = ops["metrics"][k]["today"]; p = n / lim[k] * 100
                if p >= pct:
                    lines.append(f"{k.capitalize()} aaj {p:.0f}% ({n:,} / {lim[k]:,})"); keys.append(k)
        if not lines:
            return
        today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
        last = (cfg.get("last_alert") or {}).get(which) or {}
        fresh = [k for k in keys if last.get(k) != today]
        if not fresh:
            return
        tgbackup.send(text=_alert_text(which, [l for l, k in zip(lines, keys) if k in fresh]))
        _doc(CFG_DOC).set({"last_alert": {which: {k: today for k in keys}}}, merge=True)
    except Exception as e:
        print("[usage] alert:", e, flush=True)


def _fmt(n):
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


_last_ops_check = {"t": 0.0}


def tick(run_job):
    """jobs._loop se har ~10 min: roz ek baar quick scan (agar auto on), aur ghante mein ek baar ops alert-check."""
    cfg = get_cfg()
    if cfg["auto"] and time.time() - float(cfg.get("last_auto") or 0) >= 86400:
        j = run_job("usage-scan", lambda job: run_scan(job, "both", SAMPLE_DEFAULT))
        if j:
            _doc(CFG_DOC).set({"last_auto": int(time.time())}, merge=True)
            while j["status"] == "running":
                time.sleep(2)
    if time.time() - _last_ops_check["t"] >= 3600:
        _last_ops_check["t"] = time.time()
        for w in dbs_available():
            ops = live_ops(w, fresh=True)
            if ops.get("ok"):
                alerts(w, None, ops)
            slow.rest(1)


# ------------------------------------------------------------------ overview (panel ke liye)
def overview():
    cfg = get_cfg(); pids = fb.project_ids(); out = {"cfg": cfg, "dbs": {}, "separate": chat_separate()}
    for w in DBS:
        if w == "chat" and not chat_separate():
            out["dbs"][w] = {"available": False, "label": LABEL[w]}
            continue
        s = snapshot(w); lim = cfg["limits"][w]
        out["dbs"][w] = {"available": True, "label": LABEL[w], "project": pids.get(w), "limits": lim, "snap": s,
                         "limit_bytes": int(lim["storage_gb"] * GIB),
                         "console": f"https://console.firebase.google.com/project/{pids.get(w)}/firestore/usage" if pids.get(w) else None}
    return out
