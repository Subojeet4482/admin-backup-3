// Backup Center: Firebase usage (Firebase 1 + Firebase 2) + User manager
const $ = (id) => document.getElementById(id);
const esc = A.esc;
const LABEL = { main: 'Firebase 1 · Main', chat: 'Firebase 2 · Chat' };
const FX = { ov: null, ops: {}, sel: 'main', cols: {} };
const fdate = (ms) => ms ? new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const fdt = (ms) => ms ? new Date(ms).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const pct = (a, b) => b > 0 ? Math.min(999, a / b * 100) : 0;
const cls = (p) => p >= 85 ? 'hi' : p >= 60 ? 'mid' : '';
const used = (t) => t ? (t.raw || 0) + (t.idx || 0) : 0;
const bar = (p) => `<div class="fx-bar"><i class="${cls(p)}" style="width:${Math.min(100, p).toFixed(1)}%"></i></div>`;
const delta = (now, then, fmt) => { const d = now - then; if (!d) return '<span class="fx-est">same</span>'; return `<span class="${d > 0 ? 'fx-up' : 'fx-down'}">${d > 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(d))}</span>`; };
const eta = (ms) => { const s = Math.max(0, Math.round((ms - Date.now()) / 1000)); return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm'; };

/* ===================== FIREBASE USAGE ===================== */
A.fxLoad = async function () {
  try {
    FX.ov = await A.api('/api/fbu/overview');
    if (FX.ov.dbs.chat && !FX.ov.dbs.chat.available && FX.sel === 'chat') FX.sel = 'main';
    fxPaint();
    const dbs = ['main'].concat(FX.ov.dbs.chat && FX.ov.dbs.chat.available ? ['chat'] : []);
    await Promise.all(dbs.map(async (w) => { try { FX.ops[w] = (await A.api('/api/fbu/ops?db=' + w)).ops; } catch (e) { FX.ops[w] = { ok: false, msg: e.message, fix: {} }; } }));
    fxPaint();
    loadCols(FX.sel);
  } catch (e) { A.fail(e); }
};
A.fxRefreshLive = async function () {
  try { for (const w of Object.keys(FX.ov.dbs).filter(k => FX.ov.dbs[k].available)) FX.ops[w] = (await A.api('/api/fbu/ops?db=' + w + '&fresh=1')).ops; fxPaint(); A.toast('Live data refresh ho gaya'); } catch (e) { A.fail(e); }
};

function colHtml(w) {
  const d = FX.ov.dbs[w];
  if (!d.available) return `<div class="fx-col"><h4>${LABEL[w]}</h4><div class="fx-sub">Alag project set nahi hai.</div><div class="fx-warn">Render env mein <b>FIREBASE_CREDENTIALS_B641</b> daalo (chat project ki key). Abhi chat bhi main database mein chal raha hai.</div></div>`;
  const s = d.snap || {}, lat = s.latest, t = lat && lat.totals, lim = d.limits, lb = d.limit_bytes, u = used(t), p = pct(u, lb), ops = FX.ops[w];
  let h = `<div class="fx-col"><h4>${LABEL[w]}</h4><div class="pid">${esc(d.project || '—')}</div>`;
  if (t) {
    h += `<div class="fx-big">${A.fmtBytes(u)}</div><div class="fx-sub">≈ storage / ${lim.storage_gb} GB · ${p.toFixed(1)}%</div>${bar(p)}
      <div class="fx-sub"><b>${A.fmtBytes(Math.max(0, lb - u))}</b> bacha · ${num(t.docs)} docs</div>`;
  } else h += '<div class="fx-sub">Abhi scan nahi hua — <b>Scan now</b> dabao.</div>';
  if (ops && ops.ok) {
    h += ['reads', 'writes', 'deletes'].map(k => { const n = ops.metrics[k].today, L = lim[k], q = pct(n, L); return `<div class="fx-m"><div class="t"><span>${k[0].toUpperCase() + k.slice(1)} aaj</span><span>${num(n)} / ${num(L)}</span></div>${bar(q)}<div class="fx-est">${num(Math.max(0, L - n))} bacha</div></div>`; }).join('') +
      `<div class="fx-est" style="margin-top:6px">Quota reset: ${eta(ops.resets_at)} mein (Pacific midnight)</div>`;
  } else if (ops) {
    h += `<div class="fx-warn">⚠️ Reads / writes nahi dikh rahe: ${esc(ops.msg || 'Monitoring access nahi')}.` +
      (ops.fix && ops.fix.iam ? `<br>1) <a href="${esc(ops.fix.api)}" target="_blank" rel="noopener">Monitoring API enable</a> 2) <a href="${esc(ops.fix.iam)}" target="_blank" rel="noopener">Service account ko "Monitoring Viewer" role do</a>` : '') + '</div>';
  } else h += '<div class="fx-sub" style="margin-top:8px"><i class="fa-solid fa-spinner fa-spin"></i> reads / writes…</div>';
  return h + '</div>';
}

function fxPaint() {
  const ov = FX.ov; if (!ov) return;
  $('fx-cmp').innerHTML = colHtml('main') + colHtml('chat');
  $('fx-seg').innerHTML = ['main', 'chat'].map(w => `<button class="${FX.sel === w ? 'on' : ''}" ${ov.dbs[w].available ? '' : 'disabled style="opacity:.45"'} onclick="A.fxSel('${w}')">${LABEL[w]}</button>`).join('');
  const w = FX.sel, d = ov.dbs[w]; if (!d.available) { $('fx-detail').innerHTML = ''; return; }
  const s = d.snap || {}, lat = s.latest, now = lat && lat.totals, first = s.first, prev = s.prev, hist = s.history || [], ops = FX.ops[w];
  let h = '';
  /* pehle vs ab */
  h += `<div class="card"><div class="card-h"><i class="fa-solid fa-clock-rotate-left"></i> Pehle kitna tha → ab kitna hai</div>`;
  if (now) {
    const row = (lbl, e) => e ? `<div class="fx-kv"><span>${lbl} (${fdate(e.at)})</span><b>${A.fmtBytes(used(e))} · ${num(e.docs)} docs</b></div>` : '';
    h += row('Pehla scan', first) + (prev ? row('Pichla scan', prev) : '') +
      `<div class="fx-kv"><span>Ab (${fdt(lat.at)})</span><b>${A.fmtBytes(used(now))} · ${num(now.docs)} docs</b></div>`;
    if (first && first.at !== lat.at) h += `<div class="fx-kv"><span>Pehle se badlav</span><b>${delta(used(now), used(first), A.fmtBytes)} · ${delta(now.docs, first.docs, num)} docs</b></div>`;
    if (prev) h += `<div class="fx-kv"><span>Pichle scan se badlav</span><b>${delta(used(now), used(prev), A.fmtBytes)} · ${delta(now.docs, prev.docs, num)} docs</b></div>`;
    h += `<div class="fx-kv"><span>Sirf data / Index (≈)</span><b>${A.fmtBytes(now.raw)} / ${A.fmtBytes(now.idx)}</b></div>`;
    if (hist.length > 1) h += spark(hist);
    h += `<div class="fx-note">${lat.exact ? '✅ Exact scan (har doc padha).' : `ℹ️ Andaza — har collection ke ${lat.sample} docs ka average × total docs. Ye scan ${num(lat.reads_used)} reads lagaye.`} Firebase ka asli billing number alag ho sakta hai${d.console ? ` — <a href="${esc(d.console)}" target="_blank" rel="noopener">Console → Usage</a> dekho` : ''}.</div>`;
  } else h += '<div class="muted">Abhi koi scan nahi. Upar <b>Scan now</b> dabao.</div>';
  h += '</div>';
  /* 7 din ke reads/writes */
  if (ops && ops.ok) {
    const days = ops.metrics.reads.days, wr = Object.fromEntries(ops.metrics.writes.days.map(x => [x.d, x.n])), mx = Math.max(1, ...days.map(x => x.n));
    h += `<div class="card"><div class="card-h"><i class="fa-solid fa-chart-column"></i> Pichle 7 din — reads</div><div class="fx-days">${days.map(x => `<div title="${x.d}: ${num(x.n)} reads, ${num(wr[x.d] || 0)} writes"><small>${num(x.n)}</small><i style="height:${Math.max(3, x.n / mx * 100)}%"></i><small>${x.d.slice(5)}</small></div>`).join('')}</div>
      <div class="fx-note">Writes: ${days.map(x => `${x.d.slice(5)}: <b>${num(wr[x.d] || 0)}</b>`).join(' · ')}</div></div>`;
  }
  /* collections */
  h += `<div class="card"><div class="card-h"><i class="fa-solid fa-database"></i> Kaun sa data kitna hai</div>`;
  if (lat) {
    const tot = Math.max(1, used(now));
    const crow = (c, isSub) => { const sz = c.raw + c.idx; return `<div class="fx-colrow"><div class="h"><div class="n">${esc(c.name)}${isSub ? ` <span class="fx-est">(sub: ${esc(c.parents.join(', '))})</span>` : ''}</div><div class="s">${num(c.docs)} docs · <b>${A.fmtBytes(sz)}</b>${c.exact ? '' : ' ~'}</div></div>
      <div class="fx-share"><i style="width:${Math.max(1, sz / tot * 100).toFixed(1)}%"></i></div>
      ${isSub ? '' : `<div class="b"><button class="btn btn-outline" data-c="${esc(c.name)}" onclick="A.fxBackup(this.dataset.c,false)"><i class="fa-solid fa-download"></i> Backup + Download</button><button class="btn btn-outline" data-c="${esc(c.name)}" onclick="A.fxBackup(this.dataset.c,true)"><i class="fa-brands fa-telegram"></i> Telegram</button><button class="btn btn-danger" data-c="${esc(c.name)}" onclick="A.fxDelete(this.dataset.c)"><i class="fa-solid fa-trash"></i> Delete</button></div>`}</div>`; };
    h += lat.collections.map(c => crow(c, false)).join('') + (lat.subs.length ? `<div class="fx-note" style="margin:10px 0 0"><b>Subcollections</b> (parent doc ke andar — parent ke saath backup / delete hote hain)</div>` + lat.subs.map(c => crow(c, true)).join('') : '');
  } else h += '<div class="muted">Scan ke baad collection-wise breakdown yahan aayega.</div>';
  h += '</div>';
  /* upload / restore */
  h += `<div class="card"><div class="card-h"><i class="fa-solid fa-upload"></i> Backup upload / restore (${LABEL[w]})</div><p class="muted">.ffbak.gz / .json backup file. Sirf isi database ka backup chalega — galat database ka file ho to server mana kar dega. Existing docs overwrite honge.</p>
    <input type="file" id="fx-file" accept=".gz,.json" class="inp"><button class="btn btn-danger btn-full" onclick="A.fxRestore()"><i class="fa-solid fa-upload"></i> Upload &amp; Restore</button></div>`;
  $('fx-detail').innerHTML = h;
}

function spark(hist) {
  const v = hist.map(x => used(x)), mn = Math.min(...v), mx = Math.max(...v), W = 300, H = 56, r = (mx - mn) || 1;
  const pts = v.map((y, i) => [(v.length === 1 ? W : i / (v.length - 1) * W), H - 6 - (y - mn) / r * (H - 14)]);
  return `<svg class="fx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#4f46e5"/>`).join('')}</svg><div class="fx-est">Storage trend — ${hist.length} scans (${fdate(hist[0].at)} → ${fdate(hist[hist.length - 1].at)})</div>`;
}
async function loadCols() { /* collection list FX.ov se hi aati hai (scan data); live count nahi — reads bachane ke liye */ }
A.fxSel = (w) => { FX.sel = w; fxPaint(); };

A.fxScan = async function () {
  const sample = parseInt($('fx-acc').value, 10); let pin;
  if (sample === 0) {
    const known = Object.values((FX.ov && FX.ov.dbs) || {}).reduce((a, d) => a + ((((d.snap || {}).latest || {}).totals || {}).docs || 0), 0);
    const v = await A.askDanger({ title: 'Exact scan?', text: `Har doc padha jayega — lagbhag ${num(known) || 'kai'} reads lagenge (free limit 50,000 / din). Sirf zaroorat ho tab karo.`, backup: null, okLabel: 'Scan', danger: false }); if (!v) return; pin = v.pin;
  }
  try { const r = await A.api('/api/fbu/scan', { body: { db: 'both', sample, pin } }); const j = await A.trackJob(r.job, 'Firebase scan'); if (j.status === 'done') A.toast('Scan complete ✓'); A.fxLoad(); } catch (e) { A.fail(e); }
};

A.fxBackup = async function (col, tg) {
  try {
    const r = await A.api('/api/backups', { body: { db: FX.sel, collections: [col], subcollections: true, telegram: !!tg } });
    const j = await A.trackJob(r.job, 'Backup ' + col);
    if (j.status !== 'done') return;
    A.toast(`${j.result.docs} docs backup${tg ? ' · Telegram ✓' : ''}`);
    if (!tg) location.href = '/api/backups/' + encodeURIComponent(j.result.name) + '/download';
  } catch (e) { A.fail(e); }
};
A.fxDelete = async function (col) {
  const v = await A.askDanger({ title: `"${col}" poora delete? (${LABEL[FX.sel]})`, text: 'Collection ke saare docs aur subcollections hamesha ke liye hat jayenge. Neeche backup tick rakho to pehle backup ban jata hai.', typed: col, okLabel: 'Delete all' }); if (!v) return;
  try { const r = await A.api('/api/data/delete-collection', { body: { db: FX.sel, collection: col, confirm: v.typed, pin: v.pin, backup: v.backup } }); const j = await A.trackJob(r.job, 'Delete'); if (j.status === 'done') A.toast(`${j.result.deleted || 0} docs delete${j.result.backup ? ' · backup: ' + j.result.backup : ''}`); A.fxLoad(); } catch (e) { A.fail(e); }
};
A.fxRestore = async function () {
  const f = $('fx-file').files[0]; if (!f) return A.toast('Pehle file select karo', 'err');
  const v = await A.askDanger({ title: `Restore → ${LABEL[FX.sel]}?`, text: `${f.name} ke docs overwrite honge.`, typed: 'RESTORE', backup: null, okLabel: 'Restore' }); if (!v) return;
  try { const fd = new FormData(); fd.append('file', f); fd.append('pin', v.pin); fd.append('db', FX.sel); const r = await A.api('/api/restore-upload', { form: fd }); const j = await A.trackJob(r.job, 'Restore'); if (j.status === 'done') { A.toast(`${j.result.restored} docs restore ho gaye`); A.fxLoad(); } else if (j.error) A.toast(j.error, 'err'); } catch (e) { A.fail(e); }
};

/* ---- limits & alerts ---- */
A.fxLimits = function () {
  const c = FX.ov.cfg, row = (w) => `<div style="margin-bottom:12px"><b style="font-size:.82rem">${LABEL[w]}</b><div class="fx-lim" style="margin-top:6px">
    <div><label>Storage (GB)</label><input class="inp" type="number" step="0.1" id="lm-${w}-storage_gb" value="${c.limits[w].storage_gb}"></div>
    <div><label>Reads / din</label><input class="inp" type="number" id="lm-${w}-reads" value="${c.limits[w].reads}"></div>
    <div><label>Writes / din</label><input class="inp" type="number" id="lm-${w}-writes" value="${c.limits[w].writes}"></div>
    <div><label>Deletes / din</label><input class="inp" type="number" id="lm-${w}-deletes" value="${c.limits[w].deletes}"></div></div></div>`;
  $('lm-body').innerHTML = row('main') + (FX.ov.dbs.chat.available ? row('chat') : '') +
    `<label class="lbl">Alert kab bheje (limit ka %)</label><input class="inp" type="number" min="10" max="100" id="lm-pct" value="${c.alert_pct}">
     <label class="chk"><input type="checkbox" id="lm-auto" ${c.auto ? 'checked' : ''}> Roz apne-aap quick scan (sasta, ~100-500 reads) + Telegram alert</label>
     <p class="fx-note">Default Spark (free) plan ke limits hain: 1 GB storage, 50,000 reads, 20,000 writes, 20,000 deletes roz. Blaze plan ho to apne hisaab se badlo. Alert ke liye Telegram account add hona chahiye.</p>`;
  $('m-limits').classList.add('show');
};
A.fxLimitsSave = async function () {
  const g = (w, k) => parseFloat($(`lm-${w}-${k}`).value), limits = {};
  for (const w of ['main', 'chat']) if ($('lm-' + w + '-reads')) limits[w] = { storage_gb: g(w, 'storage_gb'), reads: g(w, 'reads'), writes: g(w, 'writes'), deletes: g(w, 'deletes') };
  try { await A.api('/api/fbu/cfg', { body: { limits, alert_pct: parseInt($('lm-pct').value, 10), auto: $('lm-auto').checked } }); A.closeModal('m-limits'); A.toast('Limits save ho gaye'); A.fxLoad(); } catch (e) { A.fail(e); }
};

/* ===================== USER MANAGER ===================== */
let UM = { uid: null, data: null };
const initial = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
A.umSearch = async function () {
  const q = $('um-q').value.trim(); if (q.length < 2) return A.toast('Kam se kam 2 akshar likho', 'err');
  $('um-res').innerHTML = '<span class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Dhoondh raha hu…</span>';
  try {
    const r = await A.api('/api/um/search?q=' + encodeURIComponent(q));
    $('um-res').innerHTML = r.users.length ? r.users.map(u => `<div class="um-item" data-u="${esc(u.uid)}" onclick="A.umOpen(this.dataset.u)"><div class="um-av">${esc(initial(u.appName || u.email))}</div><div style="min-width:0"><b>${esc(u.appName || '(no name)')}</b><small>${esc(u.email || '—')} · ID ${esc(u.playerId || '—')}</small><small>${esc(u.uid)}</small></div></div>`).join('') : '<span class="muted">Koi user nahi mila. Email, Player ID, UID ya naam ka shuruaati hissa try karo.</span>';
  } catch (e) { $('um-res').innerHTML = ''; A.fail(e); }
};
A.umStats = async function () {
  try { const r = await A.api('/api/um/stats', { body: {} }); const j = await A.trackJob(r.job, 'Users count'); if (j.status !== 'done') return; const s = j.result;
    $('um-stats').innerHTML = [['Auth users', s.auth_total], ['Verified', s.verified], ['Unverified', s.unverified], ['Google', s.google], ['Password', s.password], ['Disabled', s.disabled], ['Naye (7 din)', s.new_7d], ['Firestore profiles', s.firestore_users == null ? '—' : s.firestore_users]].map(x => `<div><b>${num(x[1])}</b><small>${x[0]}</small></div>`).join(''); } catch (e) { A.fail(e); }
};

A.umOpen = async function (uid) {
  UM.uid = uid; $('um-body').innerHTML = '<span class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Load ho raha hai…</span>'; $('m-user').classList.add('show');
  try { UM.data = await A.api('/api/um/user/' + encodeURIComponent(uid)); umPaint(); } catch (e) { $('m-user').classList.remove('show'); A.fail(e); }
};
const fval = (v) => typeof v === 'string' ? v : JSON.stringify(v);
function umPaint() {
  const d = UM.data, a = d.auth, doc = d.doc, name = (doc && doc.appName) || (a && a.displayName) || '';
  const badges = a ? [`<span class="tag ${a.emailVerified ? 'green' : 'gold'}">${a.emailVerified ? 'Email verified' : 'Not verified'}</span>`, a.disabled ? '<span class="tag red">DISABLED</span>' : '', ...a.providers.map(p => `<span class="tag">${esc(p)}</span>`)].join('') : '<span class="tag red">Auth account nahi mila</span>';
  const prot = new Set(d.protected);
  let h = `<div class="sheet-title" style="margin-bottom:6px">${esc(name || 'User')}</div><div class="muted" style="margin:-4px 0 4px;word-break:break-all">${esc((a && a.email) || (doc && doc.email) || '')}<br>UID: ${esc(d.uid)}${doc && doc.playerId ? ' · Player ID: ' + esc(doc.playerId) : ''}</div><div class="um-badges">${badges}</div>
   ${a ? `<div class="muted" style="margin-top:8px;font-size:.7rem">Joined ${fdt(a.createdAt)} · Last login ${fdt(a.lastSignIn)}</div>` : ''}<div style="height:12px"></div>`;
  h += `<div class="um-sec"><h5><i class="fa-solid fa-signature"></i> Account naam</h5><input class="inp" id="um-name" value="${esc(name)}" maxlength="40" style="margin-bottom:8px"><label class="chk" style="margin:0 0 10px"><input type="checkbox" id="um-reset-lim"> Naam badalne ka limit bhi reset (2)</label><button class="btn btn-primary btn-full" onclick="A.umSaveName()"><i class="fa-solid fa-floppy-disk"></i> Naam save karo</button><div class="fx-note">Login naam (Firebase Auth) + app naam + chat profile naam teeno ek saath badalte hain.</div></div>`;
  h += `<div class="um-sec"><h5><i class="fa-solid fa-key"></i> Password</h5><input class="inp" id="um-pass" type="text" placeholder="Naya password (min 6)" autocomplete="off" style="margin-bottom:8px"><div class="btn-row"><button class="btn btn-primary" style="flex:1" onclick="A.umSetPass()"><i class="fa-solid fa-lock"></i> Set password</button><button class="btn btn-outline" style="flex:1" onclick="A.umResetLink()"><i class="fa-solid fa-link"></i> Reset link</button></div><div id="um-link"></div><div class="fx-note">Purana password dikh nahi sakta (Firebase hash rakhta hai) — sirf naya set kar sakte ho. Google-only user ko bhi password milne par wo email+password se login kar sakta hai.</div></div>`;
  if (a) h += `<div class="um-sec"><h5><i class="fa-solid fa-user-shield"></i> Account status</h5><div class="btn-row"><button class="btn ${a.disabled ? 'btn-success' : 'btn-danger'}" style="flex:1" onclick="A.umAuth('disabled',${!a.disabled})">${a.disabled ? '<i class="fa-solid fa-unlock"></i> Enable login' : '<i class="fa-solid fa-ban"></i> Disable login'}</button>${a.emailVerified ? '' : '<button class="btn btn-outline" style="flex:1" onclick="A.umAuth(\'email_verified\',true)"><i class="fa-solid fa-circle-check"></i> Mark verified</button>'}</div></div>`;
  h += `<div class="um-sec"><h5><i class="fa-solid fa-id-card"></i> Poora profile (Firestore)</h5>`;
  if (!d.has_doc) h += '<div class="warn" style="margin-bottom:8px">Is user ka Firestore profile nahi bana. "Missing fields add karo" se ban jayega.</div>';
  else {
    h += Object.keys(doc).sort().map(k => { const lock = prot.has(k); return `<div class="um-field"><label class="${lock ? 'lock' : ''}" title="${esc(k)}">${lock ? '🔒 ' : ''}${esc(k)}</label><input class="inp um-fv" data-k="${esc(k)}" data-t="${typeof doc[k]}" value="${esc(fval(doc[k]))}" ${lock ? 'disabled' : ''}>${lock ? '<span></span>' : `<button class="um-x" data-k="${esc(k)}" onclick="A.umDelField(this.dataset.k)" title="Delete field">✕</button>`}</div>`; }).join('');
    h += '<div class="fx-note">🔒 paisa / identity fields yahan se edit nahi hote — balance Main panel (add / cut) se badlo taaki history sahi rahe.</div><button class="btn btn-primary btn-full" style="margin-top:10px" onclick="A.umSaveFields()"><i class="fa-solid fa-floppy-disk"></i> Badle hue fields save karo</button>';
  }
  h += `<div class="um-add"><input class="inp" id="um-nk" placeholder="naya field"><input class="inp" id="um-nv" placeholder='value (text / 5 / true / ["a"])'></div><button class="btn btn-outline btn-full" style="margin-top:8px" onclick="A.umAddField()"><i class="fa-solid fa-plus"></i> Field add karo</button>`;
  if (d.missing.length || !d.has_doc) h += `<div class="fx-note" style="margin-top:12px"><b>Missing:</b> ${d.has_doc ? d.missing.map(esc).join(', ') : 'poora profile'}</div><button class="btn btn-success btn-full" style="margin-top:8px" onclick="A.umFill()"><i class="fa-solid fa-wand-magic-sparkles"></i> Missing fields add karo (defaults)</button>`;
  h += '</div>';
  if (d.chat) h += `<div class="um-sec"><h5><i class="fa-solid fa-comments"></i> Chat profile (Firebase 2)</h5>${['name', 'username', 'bio'].map(k => `<div class="fx-kv"><span>${k}</span><b>${esc(d.chat[k] == null || d.chat[k] === '' ? '—' : d.chat[k])}</b></div>`).join('')}<div class="fx-note">Chat naam upar "Account naam" se sync hota hai. Username badalna yahan se band hai (unique mapping toot sakti hai).</div></div>`;
  h += '<button class="btn btn-outline btn-full" onclick="A.closeModal(\'m-user\')">Close</button>';
  $('um-body').innerHTML = h;
}
async function umCall(path, body, okMsg, title, text, extra) {
  const v = await A.askDanger({ title, text, backup: null, okLabel: 'Confirm', danger: false, ...(extra || {}) }); if (!v) return null;
  try { const r = await A.api('/api/um/user/' + encodeURIComponent(UM.uid) + path, { body: { ...body, pin: v.pin } }); A.toast(okMsg); return r; } catch (e) { A.fail(e); return null; }
}
A.umSaveName = async function () { const r = await umCall('/name', { name: $('um-name').value, reset_limit: $('um-reset-lim').checked }, 'Naam badal gaya ✓', 'Naam badalna hai?', 'PIN daalo.'); if (r) A.umOpen(UM.uid); };
A.umSetPass = async function () { const p = $('um-pass').value; if (p.length < 6) return A.toast('Password kam se kam 6 akshar', 'err'); const r = await umCall('/password', { password: p }, 'Password set ho gaya ✓', 'Password badalna hai?', 'User ka naya password set hoga. PIN daalo.'); if (r) $('um-pass').value = ''; };
A.umResetLink = async function () { const r = await umCall('/password', { reset_link: true }, 'Link ban gaya', 'Reset link banana hai?', 'PIN daalo.'); if (r) { $('um-link').innerHTML = `<div class="um-link">${esc(r.link)}</div><button class="btn btn-outline btn-full mini" style="margin-top:6px" onclick="navigator.clipboard.writeText(this.dataset.l).then(()=>A.toast('Copy ho gaya'))" data-l="${esc(r.link)}"><i class="fa-regular fa-copy"></i> Copy link</button>`; } };
A.umAuth = async function (k, v) { const r = await umCall('/auth', { [k]: v }, 'Update ho gaya ✓', k === 'disabled' ? (v ? 'Login disable karna hai?' : 'Login enable karna hai?') : 'Email verified mark karna hai?', 'PIN daalo.'); if (r) A.umOpen(UM.uid); };
A.umFill = async function () { const r = await umCall('/fill', {}, 'Missing fields add ho gaye ✓', 'Missing fields add karein?', 'Sirf jo fields nahi hain wahi default value ke saath banenge; existing data nahi badlega.'); if (r) A.umOpen(UM.uid); };
A.umDelField = async function (k) { const r = await umCall('/fields', { set: {}, delete: [k] }, `"${k}" delete ho gaya`, `Field "${k}" delete?`, 'Ye field is user ke profile se hat jayegi.'); if (r) A.umOpen(UM.uid); };
function parseNew(s) { const t = s.trim(); if (t === '') return ''; try { return JSON.parse(t); } catch (e) { return s; } }
A.umAddField = async function () {
  const k = $('um-nk').value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(k)) return A.toast('Field naam: English letters / numbers / _ (max 60)', 'err');
  const r = await umCall('/fields', { set: { [k]: parseNew($('um-nv').value) }, delete: [] }, `"${k}" add ho gaya ✓`, `Field "${k}" add karein?`, 'PIN daalo.'); if (r) A.umOpen(UM.uid);
};
A.umSaveFields = async function () {
  const set = {}, doc = UM.data.doc;
  for (const el of document.querySelectorAll('.um-fv:not([disabled])')) {
    const k = el.dataset.k, t = el.dataset.t, raw = el.value; if (raw === fval(doc[k])) continue;
    if (t === 'string') set[k] = raw;
    else { try { set[k] = JSON.parse(raw); } catch (e) { return A.toast(`"${k}" ki value sahi format mein nahi (number / true / JSON)`, 'err'); } }
  }
  if (!Object.keys(set).length) return A.toast('Koi badlav nahi', 'err');
  const r = await umCall('/fields', { set, delete: [] }, `${Object.keys(set).length} field save ho gaye ✓`, 'Profile save karein?', Object.keys(set).join(', ')); if (r) A.umOpen(UM.uid);
};

/* ===================== hooks ===================== */
const prevTab = A.onTab;
A.onTab = function (id) { if (prevTab) prevTab(id); if (id === 'fbx') A.fxLoad(); };
