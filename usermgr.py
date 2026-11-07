"""User manager (Firebase 1 / main): search, poora profile, naam edit, password set / reset link, missing fields add, ban-lite (disable).

Paisa (balance) fields yahan se edit nahi hote — wo transactions ke saath Main panel (add / cut) se badalne chahiye,
warna balance history aur asli balance alag ho jate hain."""
import re, time, random, datetime as dt
import fb, slow

# Yahan se kabhi edit nahi: paisa + identity
PROTECTED = {"balance", "depositBalance", "withdrawBalance", "totalEarned", "totalDeposited", "totalWithdrawn", "uid", "email", "playerId"}
# User app (register.js) jo fields banata hai — jo kisi user mein na ho wo "missing" dikhte hain
DEFAULTS = {
    "appName": "", "email": "", "phone": "", "balance": 0, "depositBalance": 0, "withdrawBalance": 0, "uid": "", "playerId": "",
    "joined_matches": [], "score": 0, "kills": 0, "matchesPlayed": 0, "matchesWon": 0, "totalEarned": 0,
    "gameName": "", "gameUid": "", "isUidVerified": False, "photoUrl": "", "nameChangesLeft": 2,
}
FIELD_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,59}$")
AUDIT = "admin_audit"


def _users():
    return fb.get_db().collection("users")


def _audit(action, uid, **meta):
    """Kaun sa kaam hua (password kabhi nahi likhta)."""
    try:
        fb.get_db().collection(AUDIT).add({"at": int(time.time() * 1000), "action": action, "uid": uid, "by": "backup-center", **meta})
    except Exception as e:
        print("[usermgr] audit:", e, flush=True)


# ------------------------------------------------------------------ search
def _brief(uid, d):
    return {"uid": uid, "appName": d.get("appName") or "", "email": d.get("email") or "", "playerId": d.get("playerId") or "", "phone": d.get("phone") or ""}


def search(q, limit=15):
    q = (q or "").strip()
    if len(q) < 2:
        raise ValueError("Kam se kam 2 akshar likho")
    seen, out = set(), []

    def add(uid, d):
        if uid not in seen and len(out) < limit:
            seen.add(uid); out.append(_brief(uid, d or {}))

    users = _users()
    if "@" in q:                                       # email
        try:
            from firebase_admin import auth
            u = auth.get_user_by_email(q.lower())
            s = users.document(u.uid).get()
            add(u.uid, s.to_dict() if s.exists else {"email": u.email, "appName": u.display_name or ""})
        except Exception:
            pass
        for s in users.where("email", "==", q.lower()).limit(limit).stream():
            add(s.id, s.to_dict())
    if q.isdigit():                                    # player id / phone
        for f in ("playerId", "phone"):
            for s in users.where(f, "==", q).limit(limit).stream():
                add(s.id, s.to_dict())
    if re.fullmatch(r"[A-Za-z0-9]{20,36}", q):         # uid
        s = users.document(q).get()
        if s.exists:
            add(s.id, s.to_dict())
    if len(out) < limit:                               # naam prefix
        for s in users.where("appName", ">=", q).where("appName", "<=", q + "\uf8ff").limit(limit).stream():
            add(s.id, s.to_dict())
    return out


# ------------------------------------------------------------------ full profile
def _auth_info(uid):
    from firebase_admin import auth
    try:
        u = auth.get_user(uid)
    except Exception:
        return None
    um = u.user_metadata
    return {"uid": u.uid, "email": u.email, "emailVerified": u.email_verified, "displayName": u.display_name, "phone": u.phone_number,
            "disabled": u.disabled, "photoUrl": u.photo_url, "providers": [p.provider_id for p in u.provider_data],
            "createdAt": um.creation_timestamp if um else None, "lastSignIn": um.last_sign_in_timestamp if um else None}


def _chat_profile(uid):
    try:
        if not fb.chat_separate():
            s = fb.get_db().collection("cprofiles").document(uid).get()
        else:
            s = fb.get_chat_db().collection("cprofiles").document(uid).get()
        return {"id": s.id, **fb.enc(s.to_dict() or {})} if s.exists else None
    except Exception:
        return None


def get_user(uid):
    snap = _users().document(uid).get()
    doc = fb.enc(snap.to_dict() or {}) if snap.exists else None
    au = _auth_info(uid)
    if doc is None and au is None:
        raise LookupError("User nahi mila")
    missing = [k for k in DEFAULTS if doc is not None and k not in doc]
    return {"uid": uid, "doc": doc, "auth": au, "chat": _chat_profile(uid), "missing": missing, "protected": sorted(PROTECTED),
            "has_doc": doc is not None}


# ------------------------------------------------------------------ edits
def _name_ok(name):
    name = (name or "").strip()
    if len(name) < 3 or len(name) > 40:
        raise ValueError("Naam 3 se 40 akshar ka hona chahiye")
    return name


def set_name(uid, name, reset_limit=False):
    """Account naam: Auth displayName + users.appName + (chat profile ho to) cprofiles.name."""
    from firebase_admin import auth
    name = _name_ok(name)
    res = {"name": name, "auth": False, "doc": False, "chat": False}
    try:
        auth.update_user(uid, display_name=name); res["auth"] = True
    except Exception as e:
        res["auth_err"] = str(e)[:100]
    patch = {"appName": name}
    if reset_limit:
        patch["nameChangesLeft"] = 2
    _users().document(uid).set(patch, merge=True); res["doc"] = True
    try:
        cdb = fb.get_chat_db() if fb.chat_separate() else fb.get_db()
        ref = cdb.collection("cprofiles").document(uid)
        if ref.get().exists:
            ref.update({"name": name}); res["chat"] = True
    except Exception as e:
        res["chat_err"] = str(e)[:100]
    _audit("set_name", uid, name=name)
    return res


def _coerce(v):
    """Panel se aayi value -> Firestore value (JSON types as-is; {'__t':...} codec bhi chalta hai)."""
    return fb.dec(v, fb.get_db())


def set_fields(uid, sets=None, deletes=None):
    sets, deletes = sets or {}, deletes or []
    for k in list(sets) + list(deletes):
        if not FIELD_RE.match(str(k)):
            raise ValueError(f"Field naam galat: {k}")
        if k in PROTECTED:
            raise ValueError(f"'{k}' yahan se edit nahi hota (paisa / identity field) — Main panel use karo")
    if not sets and not deletes:
        raise ValueError("Kuch badla nahi")
    ref = _users().document(uid)
    if not ref.get().exists and deletes:
        raise LookupError("Is user ka Firestore profile hai hi nahi")
    from google.cloud.firestore_v1 import DELETE_FIELD
    if sets:
        ref.set({k: _coerce(v) for k, v in sets.items()}, merge=True)
    if deletes:
        ref.update({k: DELETE_FIELD for k in deletes})
    _audit("set_fields", uid, set=sorted(sets), deleted=sorted(deletes))
    return {"set": sorted(sets), "deleted": sorted(deletes)}


def _new_player_id():
    for _ in range(25):
        pid = str(random.randint(1000000, 9999999))
        if not list(_users().where("playerId", "==", pid).limit(1).stream()):
            return pid
    raise RuntimeError("Unique playerId nahi ban paya, dobara try karo")


def fill_missing(uid):
    """Jo standard fields nahi hain unhe default value ke saath add karo (existing kabhi overwrite nahi)."""
    ref = _users().document(uid); snap = ref.get()
    au = _auth_info(uid)
    if not snap.exists and not au:
        raise LookupError("User nahi mila")
    cur = snap.to_dict() or {} if snap.exists else {}
    add = {}
    for k, dv in DEFAULTS.items():
        if k in cur:
            continue
        if k == "uid": add[k] = uid
        elif k == "email": add[k] = (au or {}).get("email") or ""
        elif k == "appName": add[k] = (au or {}).get("displayName") or ((au or {}).get("email") or "Player").split("@")[0]
        elif k == "phone": add[k] = (au or {}).get("phone") or ""
        elif k == "photoUrl": add[k] = (au or {}).get("photoUrl") or ""
        elif k == "playerId": add[k] = _new_player_id()
        else: add[k] = list(dv) if isinstance(dv, list) else dv
    if add:
        ref.set(add, merge=True)
    _audit("fill_missing", uid, added=sorted(add))
    return {"added": sorted(add), "created_doc": not snap.exists}


def set_password(uid, password):
    from firebase_admin import auth
    password = password or ""
    if len(password) < 6 or len(password) > 128:
        raise ValueError("Password 6 se 128 akshar ka hona chahiye")
    auth.update_user(uid, password=password)              # Google-only user ko bhi email+password login mil jata hai
    _audit("set_password", uid)
    return {"changed": True}


def reset_link(uid):
    from firebase_admin import auth
    u = auth.get_user(uid)
    if not u.email:
        raise ValueError("Is user ka email nahi hai")
    link = auth.generate_password_reset_link(u.email)
    _audit("reset_link", uid)
    return {"link": link, "email": u.email}


def set_auth_flags(uid, disabled=None, email_verified=None):
    from firebase_admin import auth
    kw = {}
    if disabled is not None: kw["disabled"] = bool(disabled)
    if email_verified is not None: kw["email_verified"] = bool(email_verified)
    if not kw:
        raise ValueError("Kuch badla nahi")
    auth.update_user(uid, **kw)
    _audit("auth_flags", uid, **kw)
    return kw


# ------------------------------------------------------------------ Auth stats (job)
def auth_stats(job):
    """Firebase Auth ke saare users: total / verified / disabled / provider-wise. 200-200 ke page, beech mein aaram."""
    from firebase_admin import auth
    n = ver = dis = goo = pwd = phn = 0
    recent = 0; week = (time.time() - 7 * 86400) * 1000
    page = auth.list_users(max_results=200)
    while page:
        for u in page.users:
            n += 1
            ver += 1 if u.email_verified else 0
            dis += 1 if u.disabled else 0
            ids = {p.provider_id for p in u.provider_data}
            goo += 1 if "google.com" in ids else 0
            pwd += 1 if "password" in ids else 0
            phn += 1 if "phone" in ids else 0
            if (u.user_metadata.creation_timestamp or 0) > week: recent += 1
        job["progress"] = f"{n} users…"
        slow.rest(1.5)
        page = page.get_next_page()
    fs = None
    try:
        r = fb.get_db().collection("users").count().get(); fs = int(r[0][0].value)
    except Exception:
        pass
    return {"auth_total": n, "verified": ver, "unverified": n - ver, "disabled": dis, "google": goo, "password": pwd, "phone": phn,
            "new_7d": recent, "firestore_users": fs, "at": int(time.time() * 1000)}
