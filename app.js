"use strict";

// ---------- Storage (local cache; Supabase sync is layered on top below) ----------
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
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const ANY = "*";
const DEFAULT_CATS = ["T-shirts", "Shirts", "Pants", "Jeans", "Shorts", "Jackets", "Dresses", "Sweaters", "Activewear", "Underwear & socks", "Formal", "Seasonal"];
const letter = i => String.fromCharCode(65 + (i % 26));
const MASCOT = n => `assets/mascot/${n}.png`;
const TIPS = [
  "Keep everyday clothes between waist and eye level.",
  "Fold knitwear. Hanging stretches the shoulders.",
  "Put the things you rarely wear on the highest or lowest shelf.",
  "Group by category first, then by color.",
  "Leave a little free space in each section so it stays tidy."
];

let users = [], user = "", data = null;

// ---------- Toast, sync indicator, theme ----------
let toastTimer = null;
function toast(msg, kind = "ok") {
  const face = { ok: "14-face-happy", err: "15-face-sad", save: "10-saving-data" }[kind] || "14-face-happy";
  $("toastImg").src = MASCOT(face);
  $("toastText").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
}
function setSync(text) {
  $$("[data-sync-text]").forEach(e => { e.textContent = text; });
  const state = /saving|loading/i.test(text) ? "saving" : /not|could/i.test(text) ? "error" : "";
  $$("[data-sync-dot]").forEach(e => { e.classList.toggle("saving", state === "saving"); e.classList.toggle("error", state === "error"); });
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("wp-theme", t); } catch {}
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("wp-theme"); } catch {}
  applyTheme(t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
})();
document.addEventListener("click", e => {
  if (e.target.closest("[data-theme-toggle]")) applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

// ---------- Cloud (Supabase) ----------
const CFG = window.WP_CONFIG || {};
const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = CLOUD ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
let uidCloud = null, saveTimer = null;

// Always keep a local copy (works offline); in cloud mode also push to Supabase shortly after the last edit.
function persist() {
  Store.save(user, data);
  if (!CLOUD || !uidCloud) return;
  setSync("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushCloud, 800);
}
async function pushCloud() {
  saveTimer = null;
  const { error } = await sb.from("wardrobe_data").upsert({ user_id: uidCloud, data, updated_at: new Date().toISOString() });
  setSync(error ? "Not saved" : "Saved");
  if (error) { console.error(error); toast("Couldn’t save. We’ll retry on your next change.", "err"); }
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
const crumb = ({ w, s, c }) => `${esc(w.name)} <span>›</span> ${esc(s.name)} <span>›</span> ${esc(c.name)}`;
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

// ---------- Users (local mode) ----------
function initUsers() {
  users = Store.users();
  user = Store.current();
  if (!users.length) { users = ["Me"]; Store.saveUsers(users); }
  if (!users.includes(user)) user = users[0];
  setSync("Saved on this device");
  switchUser(user);
}
function switchUser(name) {
  user = name; Store.saveCurrent(name);
  data = Store.load(name) || newData();
  $("user").innerHTML = users.map(u => `<option ${u === name ? "selected" : ""}>${esc(u)}</option>`).join("");
  $("accountLine").textContent = `Data stays in this browser. Current user: ${name}.`;
  resetWizard();
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
  if (users.length < 2) return toast("You need at least one user.", "err");
  if (!confirm(`Delete user "${user}" and all their data?`)) return;
  Store.remove(user);
  users = users.filter(u => u !== user); Store.saveUsers(users);
  switchUser(users[0]);
};

// ---------- Auth ----------
let signUpMode = false;
function showAuth(on) {
  document.body.classList.remove("booting");
  document.body.classList.toggle("signed-out", on);
}
function setAuthMsg(text, isErr) {
  $("aMsg").hidden = !text;
  $("aMsg").textContent = text || "";
  $("aMsg").classList.toggle("err", !!isErr);
  $("aMascot").src = MASCOT(isErr ? "09-error" : "01-mascot-main");
}
function setAuthMode(signUp) {
  signUpMode = signUp;
  $("authTitle").innerHTML = signUp ? "Create your <span>account.</span>" : "Your wardrobe, <span>sorted.</span>";
  $("aGo").textContent = signUp ? "Create account" : "Sign in";
  $("aSwitch").textContent = signUp ? "I have an account" : "Create account";
  $("aPass").autocomplete = signUp ? "new-password" : "current-password";
  setAuthMsg("");
}
$("aSwitch").onclick = () => setAuthMode(!signUpMode);
$("authForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("aEmail").value.trim(), password = $("aPass").value;
  if (!email || password.length < 6) return setAuthMsg("Enter an email and a password of at least 6 characters.", true);
  setAuthMsg("");
  const { data: res, error } = signUpMode
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) return setAuthMsg(error.message, true);
  if (signUpMode && !res.session) setAuthMsg("Check your email to confirm your account, then sign in.");
};
$("aForgot").onclick = async () => {
  const email = $("aEmail").value.trim();
  if (!email) return setAuthMsg("Type your email above first.", true);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  setAuthMsg(error ? error.message : "Password reset link sent. Check your email.", !!error);
};
$("signOut").onclick = async () => {
  if (saveTimer) { clearTimeout(saveTimer); await pushCloud(); }
  await sb.auth.signOut();
};

async function startCloud(session) {
  uidCloud = session.user.id;
  user = session.user.email || "me";
  $("localUsers").classList.add("hide"); $("account").classList.remove("hide");
  $("accountLine").textContent = `Signed in as ${user}`;
  setSync("Loading…");
  const { data: row, error } = await sb.from("wardrobe_data").select("data").eq("user_id", uidCloud).maybeSingle();
  if (error) { console.error(error); setSync("Could not load"); toast("Couldn’t load from the cloud. Showing the copy on this device.", "err"); data = Store.load(user) || newData(); }
  else if (row) { data = row.data; setSync("Saved"); }
  else {
    // First sign-in: offer to bring over anything created in local mode.
    const local = Store.users().map(u => Store.load(u)).find(d => d && d.wardrobes && d.wardrobes.length);
    data = local && confirm("Import the wardrobe you created on this device into your account?") ? local : newData();
    Store.save(user, data); await pushCloud();
  }
  Store.save(user, data);
  resetWizard();
  showAuth(false); renderAll(); showTab(data.wardrobes.length ? "place" : "setup");
}
let starting = false;
async function initCloud() {
  document.body.classList.add("booting");
  $("localUsers").classList.add("hide");
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      const p = prompt("Choose a new password (min 6 characters):");
      if (p && p.length >= 6) { const { error } = await sb.auth.updateUser({ password: p }); toast(error ? error.message : "Password updated.", error ? "err" : "ok"); }
    }
    if (event === "SIGNED_OUT") { uidCloud = null; data = null; setAuthMode(false); showAuth(true); }
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
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  ["place", "layout", "setup", "data"].forEach(t => $(t).classList.toggle("hide", t !== id));
  renderAll();
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", e => {
  const b = e.target.closest(".nav-item");
  if (b && b.dataset.tab) showTab(b.dataset.tab);
});

// ---------- Place ----------
let placeCat = "", placeFreq = "weekly", pending = null;
function renderPlace() {
  if (!data.categories.includes(placeCat)) placeCat = data.categories[0] || "";
  $("placeCategories").innerHTML = data.categories.length
    ? data.categories.map(c => `<button type="button" class="chip ${c === placeCat ? "selected" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")
    : `<p class="muted">No categories yet. Add some in Setup.</p>`;
  $$("#wearGrid .wear").forEach(b => b.classList.toggle("selected", b.dataset.freq === placeFreq));
  if (!$("tipText").textContent) $("tipText").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
}
$("placeCategories").onclick = e => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  placeCat = b.dataset.cat; renderPlace();
};
$("wearGrid").onclick = e => {
  const b = e.target.closest("[data-freq]"); if (!b) return;
  placeFreq = b.dataset.freq; renderPlace();
};
document.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => {
  $("pQty").value = Math.min(999, Math.max(1, (parseInt($("pQty").value, 10) || 1) + +b.dataset.qty));
});

function emptyPlanCard(img, title, body) {
  return `<div class="card result-card warn-card"><img class="mascot" src="${MASCOT(img)}" alt=""><h2>${title}</h2><p class="muted">${body}</p></div>`;
}
$("find").onclick = () => {
  if (!data.wardrobes.length) {
    $("plan").innerHTML = emptyPlanCard("03-pointing-wardrobe", "Set up your wardrobes first", "Tell the duck how many wardrobes, shelves and sections you have.");
    return;
  }
  if (!placeCat) return toast("Pick a category first.", "err");
  const qty = Math.max(1, parseInt($("pQty").value, 10) || 1);
  const name = $("pName").value.trim() || placeCat;
  const plan = makePlan(placeCat, qty, placeFreq);
  pending = { name, category: placeCat, freq: placeFreq, plan };
  if (!plan.steps.length) {
    $("plan").innerHTML = emptyPlanCard("04-confused-searching", "No spot found", `No section accepts “${esc(placeCat)}” or has room. Add a section or raise a capacity in Setup.`);
    return;
  }
  const placed = qty - plan.left;
  $("plan").innerHTML = `<div class="card result-card">
    <p class="eyebrow">BEST MATCH</p>
    ${plan.steps.map(({ x, take }) => {
      const u = used(x.c.id), after = u + take;
      const pct = x.c.capacity ? Math.min(100, after / x.c.capacity * 100) : 0;
      return `<div class="step-row"><div class="step-path">${crumb(x)}</div>
        <div class="result-meta"><strong>${take} pc${take > 1 ? "s" : ""}</strong>
          <span class="tag">${x.c.category === ANY ? "Any" : esc(x.c.category)}</span>
          <span class="capacity ${x.c.capacity && after >= x.c.capacity ? "full" : ""}">● ${after}${x.c.capacity ? " / " + x.c.capacity : ""}</span></div>
        ${x.c.capacity ? `<div class="capacity-bar"><span class="${pct >= 100 ? "full" : ""}" style="width:${pct}%"></span></div>` : ""}</div>`;
    }).join("")}
    ${plan.left > 0 ? `<div class="overflow">${plan.left} piece(s) don’t fit anywhere. Add capacity or another section.</div>` : ""}
    <button class="btn primary full" id="confirm">Place ${placed} piece${placed > 1 ? "s" : ""} here</button>
  </div>`;
  $("confirm").onclick = () => {
    pending.plan.steps.forEach(({ x, take }) =>
      data.items.push({ id: uid(), name: pending.name, category: pending.category, qty: take, subId: x.c.id, freq: pending.freq }));
    persist(); pending = null;
    $("plan").innerHTML = `<div class="card result-card ok-card"><img class="mascot" src="${MASCOT("05-happy-after-tidy")}" alt=""><h2>All tidy!</h2><p class="muted">Placed ${placed} piece${placed > 1 ? "s" : ""}. Got another pile?</p></div>`;
    $("pName").value = ""; $("pQty").value = 1;
    toast(`${placed} piece${placed > 1 ? "s" : ""} placed.`);
  };
};

// ---------- Wardrobes view ----------
function renderLayout() {
  const q = $("search").value.trim().toLowerCase();
  const hits = q ? data.items.filter(i => (i.name + " " + i.category).toLowerCase().includes(q)) : [];
  const hitSubs = new Set(hits.map(i => i.subId));
  const byId = Object.fromEntries(allSubs().map(x => [x.c.id, x]));
  $("searchResult").innerHTML = !q ? "" : hits.length
    ? `<div class="card search-hits"><ul>${hits.map(i => `<li><b>${esc(i.name)}</b> (${i.qty}) — ${byId[i.subId] ? esc(where(byId[i.subId])) : "?"}</li>`).join("")}</ul></div>`
    : `<div class="card empty-state"><img class="mascot" src="${MASCOT("12-search")}" alt=""><p class="muted">Nothing found for “${esc(q)}”.</p></div>`;
  if (!data.wardrobes.length) {
    $("wardrobes").innerHTML = `<div class="card empty-state" style="grid-column:1/-1"><img class="mascot" src="${MASCOT("04-confused-searching")}" alt=""><h2>No wardrobes yet</h2><p class="muted">Head to Setup and tell the duck what you have.</p></div>`;
    return;
  }
  $("wardrobes").innerHTML = data.wardrobes.map(w => `
    <article class="wardrobe"><h2>${esc(w.name)}</h2>
    ${w.shelves.map(s => `<div class="shelf" style="--n:${s.subs.length || 1}">
      ${s.subs.map(c => {
        const u = used(c.id), items = data.items.filter(i => i.subId === c.id);
        const full = c.capacity && u >= c.capacity, pct = c.capacity ? Math.min(100, u / c.capacity * 100) : 0;
        const hit = hitSubs.has(c.id);
        return `<details class="section-card ${full ? "full" : ""} ${hit ? "hit" : ""}" ${hit ? "open" : ""}>
          <summary><b>${esc(c.name)}</b><small>${c.category === ANY ? "Any" : esc(c.category)} · ${full ? "FULL" : u + (c.capacity ? " / " + c.capacity : "") + " pcs"}</small>
          ${c.capacity ? `<div class="mini-bar"><i style="width:${pct}%"></i></div>` : ""}</summary>
          <ul>${items.map(i => `<li><span>${esc(i.name)} ×${i.qty}</span><button class="link" data-rm="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button></li>`).join("") || `<li class="empty">Empty</li>`}</ul>
        </details>`;
      }).join("")}</div>`).join("")}</article>`).join("");
}
$("search").oninput = renderLayout;
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); showTab("layout"); $("search").focus(); }
});
$("wardrobes").onclick = e => {
  const id = e.target.dataset.rm; if (!id) return;
  data.items = data.items.filter(i => i.id !== id); persist(); renderLayout();
};

// ---------- Setup wizard ----------
let setupStep = 1, dims = { w: 3, s: 4, c: 3 }, layoutDirty = false;
function resetWizard() {
  setupStep = 1; layoutDirty = false;
  if (data && data.wardrobes.length) {
    const w0 = data.wardrobes[0];
    dims = { w: data.wardrobes.length, s: w0.shelves.length || 1, c: (w0.shelves[0] && w0.shelves[0].subs.length) || 1 };
  } else dims = { w: 3, s: 4, c: 3 };
}
const MAXD = { w: 20, s: 20, c: 10 };

function renderSetup() {
  $("setupTitle").textContent = data.wardrobes.length ? "Make your storage fit you." : `Welcome, ${user}!`;
  $("setupMascot").src = MASCOT(setupStep === 1 ? "03-pointing-wardrobe" : setupStep === 2 ? "06-checklist" : "11-tips");
  $("setupBubble").innerHTML = setupStep === 1 ? "Show me<br><b>your wardrobes!</b>" : setupStep === 2 ? "What do you<br><b>store?</b>" : "Almost<br><b>there!</b>";
  $$("[data-panel]").forEach(p => p.hidden = +p.dataset.panel !== setupStep);
  $$("#setupProgress .progress-dot").forEach((d, i) => d.classList.toggle("active", i < setupStep));
  $("setupBack").hidden = setupStep === 1;
  $("setupNext").textContent = setupStep === 3 ? "Finish" : "Next";
  $("sW").textContent = dims.w; $("sS").textContent = dims.s; $("sC").textContent = dims.c;
  $("rebuildNote").hidden = !(data.wardrobes.length && layoutDirty);
  $("miniPreview").innerHTML = Array.from({ length: dims.w }, (_, i) => `<div class="mini-cab">Wardrobe ${i + 1}${
    Array.from({ length: dims.s }, () => `<div class="mini-shelf">${"<i></i>".repeat(dims.c)}</div>`).join("")}</div>`).join("");
  const cats = [...new Set([...DEFAULT_CATS, ...data.categories])];
  $("setupCategories").innerHTML = cats.map(c => `<button type="button" class="chip ${data.categories.includes(c) ? "selected" : ""}" data-sc="${esc(c)}">${esc(c)}</button>`).join("")
    + `<button type="button" class="chip add" id="catAdd">+ Add category</button>`;
  if (setupStep === 3) renderEditor();
}
document.querySelectorAll("[data-set]").forEach(b => b.onclick = () => {
  const k = b.dataset.set;
  dims[k] = Math.max(1, Math.min(MAXD[k], dims[k] + +b.dataset.step));
  layoutDirty = true; renderSetup();
});
$("setupProgress").onclick = e => {
  const g = e.target.dataset.go; if (!g) return;
  if (+g > 1 && !data.wardrobes.length && !applyLayout()) return;
  setupStep = +g; renderSetup();
};

// Returns false if the user cancelled.
function applyLayout() {
  if (data.wardrobes.length && !layoutDirty) return true;
  if (data.wardrobes.length && !confirm("This rebuilds your layout and removes all placed garments. Continue?")) return false;
  data.wardrobes = Array.from({ length: dims.w }, (_, i) => newWardrobe(i + 1, dims.s, dims.c));
  data.items = [];
  layoutDirty = false; persist();
  return true;
}
$("setupNext").onclick = () => {
  if (setupStep === 1 && !applyLayout()) return;
  if (setupStep < 3) { setupStep++; renderSetup(); window.scrollTo({ top: 0 }); return; }
  toast("Setup saved. Your wardrobe is ready."); setupStep = 1; showTab("place");
};
$("setupBack").onclick = () => { setupStep = Math.max(1, setupStep - 1); renderSetup(); };

$("setupCategories").onclick = e => {
  if (e.target.id === "catAdd") {
    const v = (prompt("New category name:") || "").trim();
    if (!v || data.categories.some(c => c.toLowerCase() === v.toLowerCase())) return;
    data.categories.push(v); persist(); renderSetup(); return;
  }
  const c = e.target.dataset.sc; if (!c) return;
  if (data.categories.includes(c)) {
    if (data.items.some(i => i.category === c)) return toast(`Garments are stored under “${c}”. Remove them first.`, "err");
    data.categories = data.categories.filter(x => x !== c);
    allSubs().forEach(x => { if (x.c.category === c) x.c.category = ANY; });
  } else data.categories.push(c);
  persist(); renderSetup();
};

// ---------- Setup: fine-tune editor ----------
function catOptions(sel) {
  return `<option value="${ANY}" ${sel === ANY ? "selected" : ""}>Any category</option>` +
    data.categories.map(c => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
}
function renderEditor() {
  if (!data.wardrobes.length) { $("editor").innerHTML = `<p class="muted">Nothing yet. Go back to step 1.</p>`; return; }
  $("editor").innerHTML = data.wardrobes.map(w => `
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
              <input data-f="c-cap" data-c="${c.id}" type="number" min="1" placeholder="Max pcs" value="${c.capacity ?? ""}" aria-label="Capacity">
              <button class="link" data-act="del-c" data-s="${s.id}" data-w="${w.id}" data-c="${c.id}" aria-label="Delete section">✕</button>
            </div>`).join("")}
          <button class="ed-add" data-act="add-c" data-w="${w.id}" data-s="${s.id}">+ section</button>
        </div>`).join("")}
      <button class="ed-add" data-act="add-s" data-w="${w.id}">+ shelf</button>
    </div>`).join("") + `<button class="btn ghost" data-act="add-w" style="margin-top:12px">+ Wardrobe</button>`;
}
const findSubById = id => allSubs().find(x => x.c.id === id);

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

// ---------- Data ----------
$("exp").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `wardrobe-${user}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup exported.");
};
$("imp").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t);
    if (!Array.isArray(d.wardrobes) || !Array.isArray(d.items) || !Array.isArray(d.categories)) throw 0;
    data = d; persist(); resetWizard(); renderAll(); toast("Backup imported.");
  }).catch(() => toast("That file is not a valid export.", "err"));
  e.target.value = "";
};
$("clearItems").onclick = () => {
  if (!confirm("Remove all garments? The wardrobe layout stays.")) return;
  data.items = []; persist(); renderAll(); toast("All garment records removed.");
};

function renderAll() { renderPlace(); renderLayout(); renderSetup(); }

if (CLOUD) initCloud(); else initUsers();
