"""Service 3 ke background kaam (heavy): Data Center scheduler (auto-delete + monthly backup) aur unverified-signup cleanup.
Sab supervised threads mein — crash ho to khud dobara chalte hain."""
import time
import fb, datacenter, slow, keepalive, backup, usage

state = {"dc_tick": {"last": None, "error": None}, "cleanup": {"last": None, "result": None, "error": None}, "chat_ttl": {"last": None, "result": None, "error": None}}
_cfg = {"t": 0, "v": {}}


def maint_cfg():
    if time.time() - _cfg["t"] > 60:
        try:
            d = fb.get_db().collection("bot_meta").document("maintenance").get(timeout=15)
            _cfg["v"] = (d.to_dict() or {}) if d.exists else {}
        except Exception:
            pass
        _cfg["t"] = time.time()
    return _cfg["v"]


def save_maint(patch):
    fb.get_db().collection("bot_meta").document("maintenance").set(patch, merge=True)
    _cfg["v"] = {**_cfg["v"], **patch}; _cfg["t"] = time.time()


def cleanup_unverified(minutes=20):
    """Email+password signup jinhone `minutes` mein verify nahi kiya: Auth account + (khaali) Firestore doc delete.
    Users 200-200 ke page mein, har page ke baad 3s aaram."""
    from firebase_admin import auth
    cutoff = (time.time() - minutes * 60) * 1000
    db = fb.get_db(); n = 0
    page = auth.list_users(max_results=200)
    while page:
        for u in page.users:
            if not u.email or u.email_verified or u.disabled: continue
            ids = {p.provider_id for p in u.provider_data}
            if "google.com" in ids or "password" not in ids: continue
            if (u.user_metadata.creation_timestamp or 0) > cutoff: continue
            ref = db.collection("users").document(u.uid); snap = ref.get(timeout=20)
            slow.rest(0.3)
            if snap.exists:
                d = snap.to_dict() or {}
                if float(d.get("depositBalance") or 0) + float(d.get("withdrawBalance") or 0) + float(d.get("balance") or 0) > 0: continue
                slow.delete_tree(db, ref)
            try: auth.delete_user(u.uid); n += 1
            except Exception as e: print("[cleanup] delete fail", u.email, e, flush=True)
            slow.rest(0.5)
        slow.rest(3)
        page = page.get_next_page()
    if n: print(f"[cleanup] {n} unverified signup(s) removed", flush=True)
    return n


def _purge_col(db, col, cutoff_ms):
    n = 0
    while True:
        docs = list(col.where("at", "<", cutoff_ms).limit(200).stream())
        if not docs: return n
        b = db.batch()
        for d in docs: b.delete(d.reference)
        b.commit(); n += len(docs); slow.rest(0.3)
        if len(docs) < 200: return n


def purge_chat_messages(max_docs=20000):
    """Chat messages older than the message life (cconfig/world.ttlHours, default 24h) are deleted from the chat database:
    world room + groups (ttlHours) and every friend chat (DM) after 7 days. Phones also hide them instantly, this just frees the database."""
    db = fb.get_chat_db()
    w = db.collection("cconfig").document("world").get()
    ttl = max(1, min(168, int(((w.to_dict() or {}).get("ttlHours") if w.exists else 24) or 24)))
    cutoff = int((time.time() - ttl * 3600) * 1000)
    removed = _purge_col(db, db.collection("cworld"), cutoff)
    dm_cutoff = int((time.time() - 7 * 86400) * 1000)      # friend chats (DM): the server keeps 7 days (phones keep their own copy)
    for root, cut in (("cchats", dm_cutoff), ("cgroups", cutoff)):
        for s in db.collection(root).select([]).stream():
            removed += _purge_col(db, s.reference.collection("msgs"), cut)
            slow.rest(0.15)
            if removed >= max_docs: return removed
    return removed


def run_chat_ttl():
    try:
        n = purge_chat_messages()
        state["chat_ttl"].update(last=int(time.time() * 1000), result=n, error=None)
        return n
    except Exception as e:
        state["chat_ttl"].update(last=int(time.time() * 1000), error=str(e)[:160])
        raise


def run_cleanup():
    try:
        n = cleanup_unverified()
        state["cleanup"].update(last=int(time.time() * 1000), result=n, error=None)
        return n
    except Exception as e:
        state["cleanup"].update(last=int(time.time() * 1000), error=str(e)[:160])
        raise


def _loop():
    t0 = time.time()
    last = {"dc": t0 - 600 + 120, "clean": t0 - 21600 + 600, "ttl": t0 - 43200 + 900, "usage": t0 - 600 + 400}
    time.sleep(150)                      # boot ke 2.5 min baad
    while True:
        t = time.time()
        if t - last["dc"] >= 600:
            last["dc"] = t
            try: datacenter._tick(); state["dc_tick"].update(last=int(t * 1000), error=None)
            except Exception as e: state["dc_tick"].update(error=str(e)[:160]); print("[jobs] dc:", e, flush=True)
            slow.rest(5)
        if t - last["usage"] >= 600:
            last["usage"] = t
            try: usage.tick(backup.run_job)
            except Exception as e: print("[jobs] usage:", e, flush=True)
            slow.rest(5)
        if t - last["clean"] >= 21600 and maint_cfg().get("cleanup", True):
            last["clean"] = t
            try: run_cleanup()
            except Exception as e: print("[jobs] cleanup:", e, flush=True)
            slow.rest(5)
        if t - last["ttl"] >= 43200 and maint_cfg().get("chatTtl", True):
            last["ttl"] = t
            try: run_chat_ttl()
            except Exception as e: print("[jobs] chat ttl:", e, flush=True)
            slow.rest(5)
        time.sleep(30)


def start():
    keepalive.supervised("ff-jobs", _loop)
