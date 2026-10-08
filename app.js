"use strict";

// ---------- Storage (swap this adapter for Supabase later) ----------
const Store = {
  users() { return read("wp:users", []); },
  saveUsers(list) { write("wp:users", list); },
  current() { return read("wp:current", ""); },
  saveCurrent(name) { write("wp:current", name); },
  load(user) { return read("wp:data:" + user, null); },
  save(user, data) { write("wp:data:" + user, data); },
  remove(user) { try { localStorage.removeItem("wp:data:" + user); } catch {} }
};
function read(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const ANY = "*";
const DEFAULT_CATS = ["T-shirts", "Shirts", "Pants", "Jeans", "Shorts", "Jackets", "Dresses", "Sweaters", "Activewear", "Underwear & socks", "Formal", "Seasonal"];
const letter = i => String.fromCharCode(65 + (i % 26));

let users = [], user = "", data = null;

// ---------- Cloud (Supabase) ----------
const CFG = window.WP_CONFIG || {};
const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = CLOUD ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
let uidCloud = null, saveTimer = null;

function setSync(text) { $("sync").textContent = text; }
// Always keep a local copy (works offline); in cloud mode also push to Supabase shortly after the last edit.
function persist() {
  Store.save(user, data);
  if (!CLOUD || !uidCloud) return;
  setSync("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushCloud, 800);
}
async function pushCloud() {
  const { error } = await sb.from("wardrobe_data").upsert({ user_id: uidCloud, data, updated_at: new Date().toISOString() });
  setSync(error ? "Not saved — will retry on next change" : "Saved");
  if (error) console.error(error);
}
window.addEventListener("beforeunload", () => { if (saveTimer) { clearTimeout(saveTimer); pushCloud(); } });

// ---------- Model ----------
function newData() { return { categories: [...DEFAULT_CATS], wardrobes: [], items: [] }; }
function newSub(i) { return { id: uid(), name: "Section " + letter(i), category: ANY, capacity: null }; }
function newShelf(n, subs) { return { id: uid(), name: "Shelf " + n, subs: Array.from({ length: subs }, (_, i) => newSub(i)) }; }
function newWardrobe(n, shelves, subs) {
  return { id: uid(), name: "Wardrobe " + n, shelves: Array.from({ length: shelves }, (_, i) => newShelf(i + 1, subs)) };
}

function allSubs() {
  const out = [];
  data.wardrobes.forEach(w => w.shelves.forEach((s, si) => s.subs.forEach(c => out.push({ w, s, c, si, n: w.shelves.length }))));
  return out;
}
const used = subId => data.items.filter(i => i.subId === subId).reduce((a, i) => a + i.qty, 0);
const room = c => (c.capacity ? c.capacity - used(c.id) : Infinity);
const where = ({ w, s, c }) => `${w.name} › ${s.name} › ${c.name}`;

// Rank sections for a pile of clothes, then split the pile across the best ones.
function makePlan(category, qty, freq) {
  const ranked = allSubs()
    .filter(x => (x.c.category === category || x.c.category === ANY) && room(x.c) > 0)
    .map(x => {
      let score = x.c.category === category ? 100 : 50;
      if (room(x.c) >= qty) score += 30;
      const half = (x.n - 1) / 2;
      const d = half ? Math.abs(x.si - half) / half : 0;   // 0 = middle shelf, 1 = top/bottom
      if (freq === "daily") score -= d * 20;
      if (freq === "rare") score += d * 20;
      return { ...x, score };
    })
    .sort((a, b) => b.score - a.score);
  const steps = [];
  let left = qty;
  for (const x of ranked) {
    if (left <= 0) break;
    const take = Math.min(left, room(x.c));
    steps.push({ x, take });
    left -= take;
  }
  return { steps, left };
}

// ---------- Users ----------
function initUsers() {
  users = Store.users();
  user = Store.current();
  if (!users.length) { users = ["Me"]; Store.saveUsers(users); }
  if (!users.includes(user)) user = users[0];
  switchUser(user);
}
function switchUser(name) {
  user = name; Store.saveCurrent(name);
  data = Store.load(name) || newData();
  $("user").innerHTML = users.map(u => `<option ${u === name ? "selected" : ""}>${esc(u)}</option>`).join("");
  renderAll();
  showTab(data.wardrobes.length ? "place" : "setup");
}
$("user").onchange = e => switchUser(e.target.value);
$("newUser").onclick = () => {
  const n = (prompt("New user name:") || "").trim();
  if (!n || users.includes(n)) return;
  users.push(n); Store.saveUsers(users); switchUser(n);
};
$("delUser").onclick = () => {
  if (users.length < 2) return alert("You need at least one user.");
  if (!confirm(`Delete user "${user}" and all their data?`)) return;
  Store.remove(user);
  users = users.filter(u => u !== user); Store.saveUsers(users);
  switchUser(users[0]);
};

// ---------- Auth ----------
let signUpMode = false;
function showAuth(on) {
  $("auth").classList.toggle("hide", !on);
  $("tabs").classList.toggle("hide", on);
  if (on) ["place", "layout", "setup", "data"].forEach(t => $(t).classList.add("hide"));
}
function setAuthMode(signUp) {
  signUpMode = signUp;
  $("authTitle").textContent = signUp ? "Create account" : "Sign in";
  $("aGo").textContent = signUp ? "Create account" : "Sign in";
  $("aSwitch").textContent = signUp ? "I have an account" : "Create account";
  $("aPass").autocomplete = signUp ? "new-password" : "current-password";
  $("aMsg").textContent = "";
}
$("aSwitch").onclick = () => setAuthMode(!signUpMode);
$("aGo").onclick = async () => {
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  if (!email || password.length < 6) { $("aMsg").textContent = "Enter an email and a password of at least 6 characters."; return; }
  $("aMsg").textContent = "";
  const { data: res, error } = signUpMode
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) { $("aMsg").textContent = error.message; return; }
  if (signUpMode && !res.session) $("aMsg").textContent = "Check your email to confirm your account, then sign in.";
};
$("aForgot").onclick = async () => {
  const email = $("aEmail").value.trim();
  if (!email) { $("aMsg").textContent = "Type your email above first."; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("aMsg").textContent = error ? error.message : "Password reset link sent. Check your email.";
};
$("signOut").onclick = async () => {
  if (saveTimer) { clearTimeout(saveTimer); await pushCloud(); saveTimer = null; }
  await sb.auth.signOut();
};

async function startCloud(session) {
  uidCloud = session.user.id;
  user = session.user.email || "me";
  $("user").classList.add("hide"); $("newUser").classList.add("hide"); $("delUser").classList.add("hide");
  $("account").classList.remove("hide"); $("email").textContent = user;
  setSync("Loading…");
  const { data: row, error } = await sb.from("wardrobe_data").select("data").eq("user_id", uidCloud).maybeSingle();
  if (error) { console.error(error); setSync("Could not load"); data = Store.load(user) || newData(); }
  else if (row) { data = row.data; setSync("Saved"); }
  else {
    // First sign-in: offer to bring over anything created in local mode.
    const local = Store.users().map(u => Store.load(u)).find(d => d && d.wardrobes && d.wardrobes.length);
    data = local && confirm("Import the wardrobe you created on this device into your account?") ? local : newData();
    Store.save(user, data); await pushCloud();
  }
  Store.save(user, data);
  showAuth(false); renderAll(); showTab(data.wardrobes.length ? "place" : "setup");
}
let starting = false;
async function initCloud() {
  $("user").classList.add("hide"); $("newUser").classList.add("hide");
  $("tabs").classList.add("hide"); ["place", "layout", "setup", "data"].forEach(t => $(t).classList.add("hide"));
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      const p = prompt("Choose a new password (min 6 characters):");
      if (p && p.length >= 6) { const { error } = await sb.auth.updateUser({ password: p }); alert(error ? error.message : "Password updated."); }
    }
    if (event === "SIGNED_OUT") { uidCloud = null; data = null; $("account").classList.add("hide"); showAuth(true); }
    else if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && uidCloud !== session.user.id && !starting) {
      // Defer: supabase-js must not be awaited inside this callback.
      starting = true;
      setTimeout(() => startCloud(session).finally(() => { starting = false; }), 0);
    }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) showAuth(true);
}

// ---------- Tabs ----------
function showTab(id) {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === id));
  ["place", "layout", "setup", "data"].forEach(t => $(t).classList.toggle("hide", t !== id));
  renderAll();
}
$("tabs").onclick = e => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); };

// ---------- Place ----------
let pending = null;
function renderPlace() {
  $("pCat").innerHTML = data.categories.map(c => `<option>${esc(c)}</option>`).join("");
}
$("find").onclick = () => {
  if (!data.wardrobes.length) { $("plan").innerHTML = `<div class="plan warn">Set up your wardrobes first (Setup tab).</div>`; return; }
  const category = $("pCat").value, freq = $("pFreq").value;
  const qty = Math.max(1, parseInt($("pQty").value, 10) || 1);
  const name = $("pName").value.trim() || category;
  const plan = makePlan(category, qty, freq);
  pending = { name, category, freq, plan };
  if (!plan.steps.length) {
    $("plan").innerHTML = `<div class="plan warn">No section accepts "${esc(category)}" or has room. Add a section or raise a capacity in Setup.</div>`;
    return;
  }
  $("plan").innerHTML = `<div class="plan">
    <ul>${plan.steps.map(({ x, take }) => `<li><b>${esc(where(x))}</b>: ${take} pc${take > 1 ? "s" : ""}
      <span class="hint">(${used(x.c.id)}${x.c.capacity ? "/" + x.c.capacity : ""} now)</span></li>`).join("")}</ul>
    ${plan.left > 0 ? `<p class="warn">${plan.left} piece(s) don't fit anywhere. Add capacity or another section.</p>` : ""}
    <button class="btn" id="confirm">Place ${qty - plan.left} piece(s) here</button></div>`;
  $("confirm").onclick = () => {
    pending.plan.steps.forEach(({ x, take }) =>
      data.items.push({ id: uid(), name: pending.name, category: pending.category, qty: take, subId: x.c.id, freq: pending.freq }));
    persist(); pending = null;
    $("plan").innerHTML = `<div class="plan">Placed.</div>`;
    $("pName").value = ""; $("pQty").value = 1;
  };
};

// ---------- Wardrobes view ----------
function renderLayout() {
  const q = $("search").value.trim().toLowerCase();
  const hits = q ? data.items.filter(i => (i.name + " " + i.category).toLowerCase().includes(q)) : [];
  const hitSubs = new Set(hits.map(i => i.subId));
  const byId = Object.fromEntries(allSubs().map(x => [x.c.id, x]));
  $("searchResult").innerHTML = q
    ? (hits.length ? `<ul>${hits.map(i => `<li>${esc(i.name)} (${i.qty}) — ${byId[i.subId] ? esc(where(byId[i.subId])) : "?"}</li>`).join("")}</ul>` : `<p class="hint">Nothing found.</p>`)
    : "";
  if (!data.wardrobes.length) { $("wardrobes").innerHTML = `<div class="card">No wardrobes yet. Go to Setup.</div>`; return; }
  $("wardrobes").innerHTML = data.wardrobes.map(w => `
    <div class="wardrobe"><h3>${esc(w.name)}</h3>
    ${w.shelves.map(s => `<div class="shelf"><div class="sname">${esc(s.name)}</div><div class="subs">
      ${s.subs.map(c => {
        const u = used(c.id), items = data.items.filter(i => i.subId === c.id);
        const pct = c.capacity ? Math.min(100, u / c.capacity * 100) : 0;
        return `<details class="sub ${hitSubs.has(c.id) ? "hit" : ""}" ${hitSubs.has(c.id) ? "open" : ""}>
          <summary><b>${esc(c.name)}</b><br><span class="cat">${c.category === ANY ? "Any" : esc(c.category)}</span>
          · ${u}${c.capacity ? "/" + c.capacity : ""}
          ${c.capacity ? `<div class="bar"><i class="${pct >= 100 ? "full" : ""}" style="width:${pct}%"></i></div>` : ""}</summary>
          <ul>${items.map(i => `<li><span>${esc(i.name)} ×${i.qty}</span><button class="link" data-rm="${i.id}" aria-label="Remove">✕</button></li>`).join("") || `<li class="hint">Empty</li>`}</ul>
        </details>`;
      }).join("")}</div></div>`).join("")}</div>`).join("");
}
$("search").oninput = renderLayout;
$("wardrobes").onclick = e => {
  const id = e.target.dataset.rm; if (!id) return;
  data.items = data.items.filter(i => i.id !== id); persist(); renderLayout();
};

// ---------- Setup ----------
function renderSetup() {
  $("welcome").classList.toggle("hide", data.wardrobes.length > 0);
  $("welcome").innerHTML = `<h2>Welcome, ${esc(user)}</h2><p class="hint" style="margin:0">Start by generating a layout: how many wardrobes, shelves and sections you have. You can rename and adjust everything afterwards.</p>`;
  $("catList").innerHTML = data.categories.map(c => `<span class="chip">${esc(c)} <button data-cat-del="${esc(c)}" aria-label="Remove ${esc(c)}">×</button></span>`).join("");
  renderEditor();
}
function catOptions(sel) {
  return `<option value="${ANY}" ${sel === ANY ? "selected" : ""}>Any category</option>` +
    data.categories.map(c => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
}
function renderEditor() {
  if (!data.wardrobes.length) { $("editor").innerHTML = `<p class="hint">Nothing yet. Generate a layout above.</p>`; return; }
  $("editor").innerHTML = data.wardrobes.map((w, wi) => `
    <div class="ed-wardrobe">
      <div class="ed-head"><input data-f="w-name" data-w="${w.id}" value="${esc(w.name)}" aria-label="Wardrobe name">
        <button class="link" data-act="del-w" data-w="${w.id}">Delete</button></div>
      ${w.shelves.map(s => `
        <div class="ed-shelf">
          <div class="ed-head"><input data-f="s-name" data-w="${w.id}" data-s="${s.id}" value="${esc(s.name)}" aria-label="Shelf name">
            <button class="link" data-act="del-s" data-w="${w.id}" data-s="${s.id}">Delete</button></div>
          ${s.subs.map(c => `
            <div class="ed-sub">
              <input data-f="c-name" data-c="${c.id}" value="${esc(c.name)}" aria-label="Section name">
              <select data-f="c-cat" data-c="${c.id}" aria-label="Category">${catOptions(c.category)}</select>
              <input data-f="c-cap" data-c="${c.id}" type="number" min="1" placeholder="Capacity" value="${c.capacity ?? ""}" aria-label="Capacity">
              <button class="link" data-act="del-c" data-s="${s.id}" data-w="${w.id}" data-c="${c.id}" aria-label="Delete section">✕</button>
            </div>`).join("")}
          <button class="link" data-act="add-c" data-w="${w.id}" data-s="${s.id}">+ section</button>
        </div>`).join("")}
      <button class="link" data-act="add-s" data-w="${w.id}">+ shelf</button>
    </div>`).join("") + `<button class="btn ghost" data-act="add-w">+ Wardrobe</button>`;
}

function findSubById(id) { return allSubs().find(x => x.c.id === id); }

$("editor").addEventListener("input", e => {
  const f = e.target.dataset.f; if (!f) return;
  const v = e.target.value;
  if (f === "w-name") data.wardrobes.find(w => w.id === e.target.dataset.w).name = v;
  if (f === "s-name") data.wardrobes.find(w => w.id === e.target.dataset.w).shelves.find(s => s.id === e.target.dataset.s).name = v;
  if (f === "c-name") findSubById(e.target.dataset.c).c.name = v;
  if (f === "c-cat") findSubById(e.target.dataset.c).c.category = v;
  if (f === "c-cap") findSubById(e.target.dataset.c).c.capacity = parseInt(v, 10) > 0 ? parseInt(v, 10) : null;
  persist();
});
$("editor").addEventListener("click", e => {
  const a = e.target.dataset.act; if (!a) return;
  const { w: wid, s: sid, c: cid } = e.target.dataset;
  const W = data.wardrobes.find(w => w.id === wid);
  const S = W && W.shelves.find(s => s.id === sid);
  const dropItems = subIds => { data.items = data.items.filter(i => !subIds.includes(i.subId)); };
  const hasItems = subIds => data.items.some(i => subIds.includes(i.subId));
  if (a === "add-w") data.wardrobes.push(newWardrobe(data.wardrobes.length + 1, 4, 3));
  if (a === "add-s") W.shelves.push(newShelf(W.shelves.length + 1, 3));
  if (a === "add-c") S.subs.push(newSub(S.subs.length));
  if (a === "del-c") {
    if (hasItems([cid]) && !confirm("This section contains garments. Delete them too?")) return;
    dropItems([cid]); S.subs = S.subs.filter(c => c.id !== cid);
  }
  if (a === "del-s") {
    const ids = S.subs.map(c => c.id);
    if (hasItems(ids) && !confirm("This shelf contains garments. Delete them too?")) return;
    dropItems(ids); W.shelves = W.shelves.filter(s => s.id !== sid);
  }
  if (a === "del-w") {
    const ids = W.shelves.flatMap(s => s.subs.map(c => c.id));
    if (hasItems(ids) && !confirm("This wardrobe contains garments. Delete them too?")) return;
    dropItems(ids); data.wardrobes = data.wardrobes.filter(w => w.id !== wid);
  }
  persist(); renderEditor();
});

$("generate").onclick = () => {
  const clamp = (el, max) => Math.min(max, Math.max(1, parseInt(el.value, 10) || 1));
  const W = clamp($("gW"), 20), S = clamp($("gS"), 20), C = clamp($("gC"), 10);
  if (data.wardrobes.length && !confirm("This replaces your current layout and removes all placed garments. Continue?")) return;
  data.wardrobes = Array.from({ length: W }, (_, i) => newWardrobe(i + 1, S, C));
  data.items = [];
  persist(); renderSetup();
};
$("catAdd").onclick = () => {
  const v = $("catNew").value.trim();
  if (!v || data.categories.some(c => c.toLowerCase() === v.toLowerCase())) return;
  data.categories.push(v); $("catNew").value = ""; persist(); renderSetup();
};
$("catList").onclick = e => {
  const c = e.target.dataset.catDel; if (!c) return;
  if (data.items.some(i => i.category === c)) return alert(`Garments are stored under "${c}". Remove them first.`);
  data.categories = data.categories.filter(x => x !== c);
  allSubs().forEach(x => { if (x.c.category === c) x.c.category = ANY; });
  persist(); renderSetup();
};

// ---------- Data ----------
$("exp").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `wardrobe-${user}.json`; a.click();
};
$("imp").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t);
    if (!Array.isArray(d.wardrobes) || !Array.isArray(d.items) || !Array.isArray(d.categories)) throw 0;
    data = d; persist(); renderAll();
  }).catch(() => alert("That file is not a valid export."));
  e.target.value = "";
};
$("clearItems").onclick = () => {
  if (!confirm("Remove all garments? The wardrobe layout stays.")) return;
  data.items = []; persist(); renderAll();
};

function renderAll() { renderPlace(); renderLayout(); renderSetup(); }

if (CLOUD) initCloud(); else initUsers();
