// Backup Center: Home (Telegram, monthly, delay, maintenance), Backup/Restore, Data Center, Data Delete
const $ = (id) => document.getElementById(id);
const esc = A.esc;
const when = (ms) => ms ? new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
let OV = null, DC = null, homeTimer = null;
const ord = (n) => n + (['st', 'nd', 'rd'][n - 1] || 'th');

/* ===================== HOME ===================== */
function paintHome(o) {
  OV = o; const t = o.telegram, m = o.monthly || {};
  $('tg-big').textContent = t.configured ? 'Connected ✓' : 'Not connected';
  $('tg-sub').textContent = t.configured ? `${t.account ? t.account + ' · ' : ''}files → ${t.chat}${t.last_ok ? ' · last ' + A.fmtAgo(t.last_ok) : ''}` : 'Account add karo — warna backup Telegram par nahi ja sakta';
  $('tg-btns').innerHTML = `<button class="btn btn-outline" style="background:#fff" onclick="A.tgOpen()"><i class="fa-solid fa-user-plus"></i> ${t.configured ? 'Change' : 'Add account'}</button>` +
    (t.configured ? `<button class="btn btn-outline" style="background:#fff" onclick="A.tgTest()"><i class="fa-solid fa-paper-plane"></i> Test</button><button class="btn btn-danger" onclick="A.tgRemove()"><i class="fa-solid fa-user-minus"></i></button>` : '') +
    (t.last_err ? `<p style="width:100%;font-size:.7rem;background:rgba(0,0,0,.25);border-radius:10px;padding:6px 10px">⚠️ ${esc(t.last_err)}</p>` : '');
  $('mo-on').checked = m.enabled !== false;
  if (!$('mo-day').options.length) $('mo-day').innerHTML = '<option value="0">Last day</option>' + Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${ord(i + 1)}</option>`).join('');
  if (document.activeElement !== $('mo-day')) $('mo-day').value = String(m.day || 0);
  if (document.activeElement !== $('mo-time')) $('mo-time').value = m.time || '23:00';
  $('mo-next').textContent = o.next_monthly ? new Date(o.next_monthly.ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + eta(o.next_monthly.ms) + ')' : 'Band hai';
  $('mo-last').textContent = m.ranAt ? new Date(m.ranAt).toLocaleString() + ' → ' + (m.result || '') : (m.last ? m.last + ' (chal chuka)' : 'Abhi tak nahi');
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Math.abs((({ turbo: .3, normal: 1, slow: 2, ultra: 4 })[b.dataset.m]) - o.pace) < 0.01));
  $('pace-tag').textContent = 'x' + o.pace;
  const bs = o.backup; $('bk-int').value = String(bs.interval_hours || 0); if (document.activeElement !== $('bk-keep')) $('bk-keep').value = bs.keep || 10;
  $('bk-last').textContent = bs.last_auto ? 'Last auto-backup: ' + new Date(bs.last_auto * 1000).toLocaleString() : 'Auto-backup abhi tak nahi hua';
  const mt = o.maint || {}, cl = (mt.state || {}).cleanup || {};
  $('mt-on').checked = mt.cleanup !== false; $('mt-ttl-on').checked = mt.chatTtl !== false;
  const ct = (mt.state || {}).chat_ttl || {}; $('mt-ttl-last').textContent = ct.last ? new Date(ct.last).toLocaleString() + ' → ' + (ct.error ? 'ERR ' + ct.error : ct.result + ' deleted') : 'Abhi tak nahi (boot ke ~15 min baad)';
  $('mt-last').textContent = cl.last ? new Date(cl.last).toLocaleString() + ' → ' + (cl.error ? 'ERR ' + cl.error : cl.result + ' removed') : 'Abhi tak nahi (boot ke ~10 min baad pehli baar)';
  $('st-files').textContent = `${o.files.count} files · ${A.fmtBytes(o.files.size)}`; $('st-disk').textContent = A.fmtBytes(o.disk.free) + ' free';
  $('run-banner').innerHTML = o.running.length ? o.running.map(j => `<div class="os-note ok" style="margin:0 0 12px"><i class="fa-solid fa-spinner fa-spin"></i> <b>${esc(j.kind)}</b> chal raha hai: ${esc(String(j.progress).slice(0, 70))}</div>`).join('') : '';
}
const eta = (ms) => { const s = Math.round((ms - Date.now()) / 1000); if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min mein'; if (s < 86400) return Math.floor(s / 3600) + ' ghante mein'; return Math.floor(s / 86400) + ' din mein'; };
A.homeLoad = async function () { try { paintHome(await A.api('/api/overview')); } catch (e) { A.fail(e); } };

A.moSave = async function () { try { await A.api('/api/dc/monthly', { body: { enabled: $('mo-on').checked, day: parseInt($('mo-day').value, 10) || 0, time: $('mo-time').value || '23:00' } }); A.toast('Monthly schedule saved ✓'); A.homeLoad(); } catch (e) { A.fail(e); } };
A.moRun = async function () {
  if (!confirm('Har data type ki alag JSON file abhi Telegram par bhejein? (heavy — slow mode mein chalega)')) return;
  try { const r = await A.api('/api/dc/monthly', { body: { run: true } }); const j = await A.trackJob(r.job, 'Month-end backup'); if (j.status === 'done') A.toast('Telegram par bhej diya ✓'); A.homeLoad(); } catch (e) { A.fail(e); }
};
A.setPace = async function (mode) { try { await A.api('/api/pace', { body: { mode } }); A.toast('Speed: ' + mode); A.homeLoad(); } catch (e) { A.fail(e); } };
A.bkSaveSchedule = async function () { try { await A.api('/api/backup-settings', { body: { interval_hours: parseInt($('bk-int').value, 10) || 0, keep: parseInt($('bk-keep').value, 10) || 10 } }); A.toast('Schedule save ho gaya'); A.homeLoad(); } catch (e) { A.fail(e); } };
A.mtSave = async function () { try { await A.api('/api/maint', { body: { cleanup: $('mt-on').checked, chatTtl: $('mt-ttl-on').checked } }); A.toast('Maintenance saved'); } catch (e) { A.fail(e); } };
A.mtRun = async function (what) { try { const r = await A.api('/api/maint', { body: { run: what || true } }); const j = await A.trackJob(r.job, what === 'chat' ? 'Chat cleanup' : 'Cleanup'); if (j.status === 'done') A.toast((j.result.removed || 0) + (what === 'chat' ? ' messages deleted' : ' accounts removed')); A.homeLoad(); } catch (e) { A.fail(e); } };

/* ---- Telegram ---- */
A.tgOpen = async function () {
  $('m-tg').classList.add('show');
  try { const t = await A.api('/api/tg'); $('tg-id').value = t.api_id || ''; $('tg-chat').value = t.chat || 'me'; $('tg-hash').value = ''; $('tg-sess').value = '';
    $('tg-hash').placeholder = t.api_hash ? 'saved (' + t.api_hash + ') — leave empty to keep' : '32 character hash (my.telegram.org)';
    $('tg-sess').placeholder = t.session ? 'saved (' + t.session + ') — leave empty to keep' : '1BVts…  (StringSession)'; } catch (e) { }
};
A.tgSave = async function () {
  const v = await A.askDanger({ title: 'Save Telegram account', text: 'PIN daalo.', backup: null, okLabel: 'Save' }); if (!v) return;
  try { await A.api('/api/tg', { body: { api_id: $('tg-id').value, api_hash: $('tg-hash').value, session: $('tg-sess').value, chat: $('tg-chat').value, pin: v.pin } }); A.toast('Telegram account saved'); A.closeModal('m-tg'); A.homeLoad(); } catch (e) { A.fail(e); }
};
A.tgTest = async function () { try { const r = await A.api('/api/tg/test', { body: {} }); A.toast('✅ Message gaya: ' + r.account); A.homeLoad(); } catch (e) { A.fail(e); } };
A.tgRemove = async function () {
  const v = await A.askDanger({ title: 'Telegram account hatao?', text: 'Auto-delete aur monthly backup tab tak band rahenge jab tak naya account na add ho.', backup: null, okLabel: 'Remove' }); if (!v) return;
  try { await A.api('/api/tg/remove', { body: { pin: v.pin } }); A.toast('Removed'); A.homeLoad(); } catch (e) { A.fail(e); }
};

/* ===================== BACKUP ===================== */
A.bkLoad = async function () {
  try {
    const [c, b] = await Promise.all([A.api('/api/collections'), A.api('/api/backups')]);
    $('bk-cols').innerHTML = c.collections.length ? c.collections.map(x => `<label><input type="checkbox" class="bk-c" value="${esc(x.name)}" checked> ${esc(x.name)}${x.count != null ? ' (' + x.count + ')' : ''}</label>`).join('') : '<span class="muted">Koi collection nahi mili</span>';
    $('bk-list').innerHTML = b.backups.length ? b.backups.map(f => `<div class="row"><div><div class="row-t">${esc(f.name)}</div><div class="row-s">${A.fmtBytes(f.size)} · ${A.fmtAgo(f.mtime)}</div></div>
      <div class="row-btns"><button class="btn btn-outline mini" data-n="${esc(f.name)}" onclick="A.bkDownload(this.dataset.n)"><i class="fa-solid fa-download"></i></button>
      <button class="btn btn-primary mini" data-n="${esc(f.name)}" onclick="A.bkRestore(this.dataset.n)"><i class="fa-solid fa-rotate-left"></i></button>
      <button class="btn btn-danger mini" data-n="${esc(f.name)}" onclick="A.bkDelete(this.dataset.n)"><i class="fa-solid fa-trash"></i></button></div></div>`).join('') : '<span class="muted">Abhi koi backup nahi — upar se banao.</span>';
  } catch (e) { A.fail(e); }
};
A.bkCreate = async function (tg) {
  const cols = [...document.querySelectorAll('.bk-c:checked')].map(x => x.value), all = document.querySelectorAll('.bk-c').length;
  if (!cols.length) return A.toast('Kam se kam ek collection chuno', 'err');
  try {
    const r = await A.api('/api/backups', { body: { collections: cols.length === all ? null : cols, subcollections: $('bk-sub').checked, telegram: !!tg } });
    const j = await A.trackJob(r.job, 'Backup');
    if (j.status === 'done') A.toast(`Backup ready: ${j.result.docs} docs (${A.fmtBytes(j.result.size)})${j.result.telegram ? ' · Telegram ✓' : ''}`);
    A.bkLoad();
  } catch (e) { A.fail(e); }
};
A.bkDownload = (n) => { location.href = '/api/backups/' + encodeURIComponent(n) + '/download'; };
A.bkDelete = async function (n) { const v = await A.askDanger({ title: 'Backup delete?', text: n, backup: null, okLabel: 'Delete' }); if (!v) return; try { await A.api('/api/backups/' + encodeURIComponent(n) + '/delete', { body: { pin: v.pin } }); A.toast('Backup delete ho gaya'); A.bkLoad(); } catch (e) { A.fail(e); } };
async function safety() { const r = await A.api('/api/backups', { body: { subcollections: true } }); return (await A.trackJob(r.job, 'Restore se pehle backup')).status === 'done'; }
A.bkRestore = async function (n) {
  const v = await A.askDanger({ title: 'Restore karna hai?', text: `${n} ke docs Firestore mein overwrite honge.`, typed: 'RESTORE', backup: true, backupLabel: 'Restore se pehle abhi ka data backup lo', okLabel: 'Restore' }); if (!v) return;
  try { if (v.backup && !(await safety())) return; const r = await A.api('/api/backups/' + encodeURIComponent(n) + '/restore', { body: { pin: v.pin } }); const j = await A.trackJob(r.job, 'Restore'); if (j.status === 'done') A.toast(`${j.result.restored} docs restore ho gaye`); A.bkLoad(); } catch (e) { A.fail(e); }
};
A.bkUploadRestore = async function () {
  const f = $('restore-file').files[0]; if (!f) return A.toast('Pehle file select karo', 'err');
  const v = await A.askDanger({ title: 'Upload karke restore?', text: `${f.name} ke docs overwrite honge.`, typed: 'RESTORE', backup: true, backupLabel: 'Restore se pehle abhi ka data backup lo', okLabel: 'Restore' }); if (!v) return;
  try { if (v.backup && !(await safety())) return; const fd = new FormData(); fd.append('file', f); fd.append('pin', v.pin);
    const r = await A.api('/api/restore-upload', { form: fd }); const j = await A.trackJob(r.job, 'Restore'); if (j.status === 'done') { A.toast(`${j.result.restored} docs restore ho gaye`); $('restore-file').value = ''; } A.bkLoad(); } catch (e) { A.fail(e); }
};

/* ===================== DATA CENTER ===================== */
let upKey = null;
A.dcLoad = async function () {
  try {
    DC = await A.api('/api/dc/types');
    $('dc-types').innerHTML = DC.types.map((t, i) => { const a = t.auto || {}; return `<div class="card dc-card fade-up" style="animation-delay:${i * 40}ms" id="dc-${t.key}">
      <div class="dc-head"><div class="dc-ico" style="background:${t.color}"><i class="fa-solid ${t.icon}"></i></div><div style="flex:1;min-width:0;"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></div><div class="dc-count" id="dcn-${t.key}"><button class="btn btn-outline mini" onclick="A.dcCount('${t.key}')">count</button></div></div>
      <div class="dc-meta" id="dcm-${t.key}">&nbsp;</div>
      <div class="dc-btns"><button class="btn btn-outline" onclick="A.dcDownload('${t.key}')"><i class="fa-solid fa-download"></i> Download</button><button class="btn btn-outline" onclick="A.dcUpload('${t.key}')"><i class="fa-solid fa-upload"></i> Upload</button>
      ${t.deletable ? `<button class="btn btn-outline" onclick="A.dcAutoToggle('${t.key}')"><i class="fa-solid fa-clock-rotate-left"></i> Auto ${a.enabled ? '<span class="tag green">ON</span>' : ''}</button><button class="btn btn-danger" onclick="A.dcDelete('${t.key}')"><i class="fa-solid fa-trash"></i> Delete old</button>` : `<span class="muted" style="flex:1;align-self:center;font-size:.7rem;"><i class="fa-solid fa-lock"></i> Delete option nahi</span>`}</div>
      ${t.deletable ? `<div class="dc-auto" id="dca-${t.key}"><label class="ls-switch2"><input type="checkbox" id="dca-on-${t.key}" ${a.enabled ? 'checked' : ''}><i></i><span>Auto delete</span></label>
        <div class="dc-auto-row"><span>Older than</span><input class="inp" type="number" min="1" id="dca-days-${t.key}" value="${a.days || 30}" style="width:80px;margin:0;"><span>days, on</span><select class="inp" id="dca-day-${t.key}" style="width:112px;margin:0;background:#fff;"><option value="0" ${!a.day ? 'selected' : ''}>every day</option>${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${a.day === i + 1 ? 'selected' : ''}>day ${i + 1}</option>`).join('')}</select><span>at</span><input class="inp" type="time" id="dca-time-${t.key}" value="${a.time || '03:00'}" style="width:110px;margin:0;"></div>
        <div class="muted">Pehle Telegram par backup, phir delete. ${a.ranAt ? 'Last run: ' + new Date(a.ranAt).toLocaleString() + ' → ' + esc(String(a.result)) : ''}</div>
        <button class="btn btn-primary btn-full" onclick="A.dcAutoSave('${t.key}')"><i class="fa-solid fa-floppy-disk"></i> Save auto-delete</button></div>` : ''}</div>`; }).join('');
    $('dc-files').innerHTML = DC.files.length ? DC.files.map(f => `<div class="row"><div><div class="row-t">${esc(f.name)}</div><div class="row-s">${A.fmtBytes(f.size)} · ${A.fmtAgo(f.mtime)}</div></div><div class="row-btns"><button class="btn btn-outline mini" onclick="location.href='/api/dc/file/${encodeURIComponent(f.name)}'"><i class="fa-solid fa-download"></i></button></div></div>`).join('') : '<span class="muted">Abhi koi file nahi.</span>';
  } catch (e) { A.fail(e); }
};
// count ek-ek karke, user ke tap par (pehle sab 12 ek saath chalte the = heavy)
A.dcCount = async function (key) {
  const n = $('dcn-' + key); n.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try { const s = await A.api('/api/dc/' + key + '/summary'); n.innerHTML = '<b>' + s.count + '</b><small>docs</small>'; $('dcm-' + key).innerHTML = s.count ? `Oldest ${when(s.oldest)} · Newest ${when(s.newest)}` : 'Empty'; }
  catch (e) { n.innerHTML = '<small>error</small>'; }
};
A.dcDownload = async function (key) { try { const r = await A.api('/api/dc/' + key + '/export', { body: {} }); const j = await A.trackJob(r.job, 'Export'); if (j.status === 'done') { A.toast(j.result.docs + ' docs exported'); location.href = '/api/dc/file/' + encodeURIComponent(j.result.name); setTimeout(A.dcLoad, 800); } } catch (e) { A.fail(e); } };
A.dcUpload = function (key) {
  upKey = key; const f = $('dc-file'); f.value = '';
  f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    const v = await A.askDanger({ title: 'Upload & restore?', text: `${file.name} → "${key}" mein wapas likha jayega (existing docs overwrite).`, typed: 'RESTORE', backup: null, okLabel: 'Restore' }); if (!v) return;
    try { const fd = new FormData(); fd.append('file', file); fd.append('pin', v.pin); const r = await A.api('/api/dc/' + upKey + '/upload', { form: fd }); const j = await A.trackJob(r.job, 'Restore'); if (j.status === 'done') { A.toast(j.result.restored + ' docs restored'); A.dcLoad(); } else if (j.error) A.toast(j.error, 'err'); } catch (e) { A.fail(e); }
  };
  f.click();
};
A.dcAutoToggle = (key) => $('dca-' + key).classList.toggle('open');
A.dcAutoSave = async function (key) { try { await A.api('/api/dc/' + key + '/auto', { body: { enabled: $('dca-on-' + key).checked, days: parseInt($('dca-days-' + key).value, 10) || 30, time: $('dca-time-' + key).value || '03:00', day: parseInt($('dca-day-' + key).value, 10) || 0 } }); A.toast('Auto-delete saved'); A.dcLoad(); } catch (e) { A.fail(e); } };
A.dcDelete = async function (key) {
  const t = DC.types.find(x => x.key === key); const days = prompt(`"${t.label}" kitne din se purana delete karein?`, '30'); if (days === null) return;
  const n = parseInt(days, 10); if (isNaN(n) || n < 0) return A.toast('Sahi din daalo', 'err');
  const v = await A.askDanger({ title: `Purana ${t.label} delete?`, text: `${n} din se purana sab pehle Telegram par upload hoga, phir database se DELETE.`, typed: 'DELETE', backup: null, okLabel: 'Delete' }); if (!v) return;
  try { const r = await A.api('/api/dc/' + key + '/delete', { body: { days: n, pin: v.pin } }); const j = await A.trackJob(r.job, 'Delete'); if (j.status === 'done') A.toast(`${j.result.deleted || 0} docs deleted (backup Telegram par gaya)`); else if (j.error) A.toast(j.error, 'err'); A.dcLoad(); } catch (e) { A.fail(e); }
};

/* ===================== DATA DELETE ===================== */
async function runDelete(path, body, label) { const r = await A.api(path, { body }); const j = await A.trackJob(r.job, label); if (j.status === 'done') { const x = j.result || {}; A.toast(`${x.deleted != null ? x.deleted + ' docs delete' : 'Delete'} ho gaye${x.backup ? ' · backup: ' + x.backup : ''}`); } }
A.ddLoad = async function () {
  try { const c = await A.api('/api/collections');
    $('dd-cols').innerHTML = c.collections.length ? c.collections.map(x => `<div class="row"><div><div class="row-t">${esc(x.name)}</div><div class="row-s">${x.count != null ? x.count + ' docs' : 'count unavailable'}</div></div><button class="btn btn-danger mini" data-c="${esc(x.name)}" onclick="A.ddCol(this.dataset.c)"><i class="fa-solid fa-trash"></i> Delete</button></div>`).join('') : '<span class="muted">Koi collection nahi</span>';
    $('dd-old-col').innerHTML = c.collections.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join(''); } catch (e) { A.fail(e); }
};
A.ddCol = async function (name) { const v = await A.askDanger({ title: `"${name}" poora delete?`, text: 'Collection ke saare docs aur subcollections hamesha ke liye hat jayenge.', typed: name, okLabel: 'Delete all' }); if (!v) return; try { await runDelete('/api/data/delete-collection', { collection: name, confirm: v.typed, pin: v.pin, backup: v.backup }, 'Delete'); A.ddLoad(); } catch (e) { A.fail(e); } };
A.ddOlder = async function () {
  const col = $('dd-old-col').value, field = $('dd-old-field').value.trim(), days = parseFloat($('dd-old-days').value);
  if (!col || !field || isNaN(days) || days < 0) return A.toast('Collection, field aur days bharo', 'err');
  const v = await A.askDanger({ title: 'Purana data delete?', text: `${col} ke woh docs jinka "${field}" ${days} din se purana hai.`, okLabel: 'Delete' }); if (!v) return;
  try { await runDelete('/api/data/delete-older', { collection: col, field, days, type: $('dd-old-type').value, pin: v.pin, backup: v.backup }, 'Cleanup'); } catch (e) { A.fail(e); }
};
A.ddDoc = async function () {
  const path = $('dd-doc-path').value.trim().replace(/^\/+|\/+$/g, ''); if (!path || path.split('/').length % 2 !== 0) return A.toast('Path format: collection/docId', 'err');
  const v = await A.askDanger({ title: 'Document delete?', text: path, okLabel: 'Delete' }); if (!v) return;
  try { await runDelete('/api/data/delete-doc', { path, recursive: $('dd-doc-sub').checked, pin: v.pin, backup: v.backup }, 'Delete'); $('dd-doc-path').value = ''; } catch (e) { A.fail(e); }
};

/* ===================== hooks ===================== */
A.onOpen = function () { A.renderSwitcher(); A.homeLoad(); clearInterval(homeTimer); homeTimer = setInterval(() => { if (!document.hidden && $('tab-home').classList.contains('show')) A.homeLoad(); }, 30000); };
A.onTab = function (id) { if (id === 'home') A.homeLoad(); if (id === 'backup') A.bkLoad(); if (id === 'dc') A.dcLoad(); };
