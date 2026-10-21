// The Soul-noma Crew board. This page is the main Sebastopol Events page with
// a password gate and three more views (Asks & Offers, Evergreen, Archive).
// After the password, it decrypts the crew posts, hands app.js its hooks
// through window.SE, then loads app.js, which runs everything else.

const PW_HASH = "a93c78692ee2fb2a203d377ff6cca9d05876e0e6d7444a54522863c9c341a3b9";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DAY = 864e5;
const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const T0 = iso(today);
const P = (s) => new Date(s + "T00:00:00");
const fmt = (dt, y) => dt.toLocaleDateString(undefined, y ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// ---------- Gate ----------
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(pw, box) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(box.salt), iterations: box.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
let started = false;
async function unlock(pw) {
  if ((await sha(pw)) !== PW_HASH) return false;
  store.set("crew-pw", pw);
  if (started) return true;
  started = true;
  document.body.classList.remove("locked");
  const crew = await fetch("crew/crew.enc.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => b && decrypt(pw, b))
    .catch(() => null);
  begin(crew);
  return true;
}
$("gform").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!(await unlock($("pw").value.trim()))) { $("gerr").textContent = "That password is not right."; $("pw").select(); }
});
{ const saved = store.get("crew-pw"); if (saved) unlock(saved); }

// ---------- Posts ----------
let POSTS = [], SYNCED = "", API = null, EVENTS_TODAY = 0;
const PEOPLE = {};
const isGift = (d) => d.pay === "free";
const SHELF = (d) => d.urg ? 3 : d.k === "ask" ? 21 : d.k === "event" ? 10 :
  ({ "Housing & Stays": 45, "Rides & Vehicles": 10, "Goods & Gear": 30, "Work & Jobs": 45, "Pets & Animals": 21, "Kids & Family": 30 })[d.cat] || 30;
const PAY = { free: "Infinite Gift", paid: "Paid", trade: "Trade", donation: "Sliding scale", unclear: "Inquire" };
const CREW_DOMAIN = { "Healing & Bodywork": "wellbeing", "Ceremony & Spirit": "wellbeing", "Classes & Workshops": "learning", "Music & Arts": "art-culture",
  "Food & Farm": "food-farms", "Land & Garden": "land-water", "Kids & Family": "neighbors", "Gatherings & Events": "neighbors" };
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 2));
const overlap = (a, b) => { let n = 0; a.forEach((w) => b.has(w) && n++); return n / Math.max(1, Math.min(a.size, b.size)); };

function prep(posts) {
  for (const d of posts) {
    d._date = P(d.date);
    const age = (today - d._date) / DAY;
    if (d.life === "standing") {
      d._state = age <= 24 * 30.4 ? "dir" : "arch";
      d._h = age < 183 ? 1 : age < 365 ? 0.6 : 0.25;
      d._hot = false;
    } else {
      d._exp = d.until ? P(d.until) : new Date(d._date.getTime() + SHELF(d) * DAY);
      if (d._exp < d._date) d._exp = new Date(d._date.getTime() + SHELF(d) * DAY);
      d._state = d._exp >= today ? "live" : "arch";
      d._left = Math.round((d._exp - today) / DAY);
      if (d._state === "arch") { d._h = 0; d._hot = false; }
      else {
        const span = Math.max(1, (d._exp - d._date) / DAY);
        d._h = d.until ? (age <= 14 ? 1 : age <= 45 ? 0.6 : 0.35) : Math.max(0, Math.min(1, d._left / span));
        d._hot = age <= 7 && (d.urg || (!!d.until && d._left <= 2));
        if (d._hot) d._h = Math.max(d._h, 0.75);
        if (!d._hot && d.until && d._left <= 2 && age > 7) d._h = Math.min(d._h, 0.3);
      }
    }
    const p = (PEOPLE[d.uid] ||= { n: 0, first: d.date, svcs: new Set() });
    p.n++;
    if (d.date < p.first) p.first = d.date;
    if (d.svc) p.svcs.add(d.svc);
  }
  return posts;
}

// Live crew events with a date join the calendar; a match on the same day is
// marked on the listed event instead of shown twice.
function mergeEvents(list) {
  EVENTS_TODAY = list.filter((e) => e.day === T0).length;
  const byDay = new Map();
  for (const e of list) { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); }
  const added = [];
  for (const d of POSTS) {
    if (d._state !== "live" || d.k !== "event" || !d.until || d.until < T0) continue;
    d._state = "events";
    const w = words(d.t);
    const same = (byDay.get(d.until) ?? []).find((e) => overlap(words(e.title), w) >= 0.5);
    if (same) { same._crew = d; continue; }
    if (d.until === T0) EVENTS_TODAY++;
    added.push({
      id: "crew-" + d.id, title: d.t, day: d.until, start: d.until + "T12:00:00", end: d.until + "T13:00:00", allDay: true,
      domain: CREW_DOMAIN[d.cat] || "neighbors", area: /sebastopol/i.test(d.where || "") ? "sebastopol" : "nearby", town: d.where || "",
      org: d.who, description: d.s, source: "crew", sourceLabel: "the Soul-noma Crew chat", _crew: d,
    });
  }
  return list.concat(added);
}

// ---------- Board views ----------
const S = { lens: store.get("crew-lens") || "gift", q: "", f: "", kind: "", shown: {} };
const hcls = (d) => d._hot ? "h-hot" : d._h > 0.6 ? "h-fresh" : d._h > 0.3 ? "h-aging" : "h-fading";
const meter = (d) => d._state === "dir"
  ? `<svg class="cb-ever" role="img" aria-label="Evergreen"><use href="#tree"/></svg>`
  : `<b class="cb-hm ${hcls(d)}" role="img" aria-label="Health ${Math.round(d._h * 100)}%">${[1, 2, 3, 4].map((i) => `<i class="${d._h >= (i - 1) / 4 + 0.01 || (i === 1 && d._state === "live") ? "on" : ""}"></i>`).join("")}</b>`;
function ago(dt) { const n = Math.round((today - dt) / DAY); return n <= 0 ? "today" : n === 1 ? "1d ago" : n < 30 ? n + "d ago" : n < 365 ? Math.round(n / 30) + "mo ago" : fmt(dt, true); }
function due(d) {
  if (d._state !== "live") return "";
  if (d._left <= 0) return d.urg ? "Today" : "Ends today";
  if (d._left === 1) return "Ends tomorrow";
  if (d._left < 7) return "Ends " + d._exp.toLocaleDateString(undefined, { weekday: "short" });
  return d.until ? "Until " + fmt(d._exp) : "";
}
function pills(d) {
  const a = [];
  if (d._hot) a.push(`<span class="cb-p u">${d.urg ? "Urgent" : "Ending"}</span>`);
  if (d._state !== "dir") a.push(`<span class="cb-p ${d.k}">${d.k === "ask" ? "Ask" : d.k === "event" ? "Event" : "Offer"}</span>`);
  a.push(`<span class="cb-p">${esc(d.cat)}</span>`);
  if (d.where) a.push(`<span class="cb-p">${esc(d.where)}</span>`);
  a.push(isGift(d) ? `<span class="cb-p gift">∞ Infinite Gift</span>` : `<span class="cb-p money">${esc(d.price || PAY[d.pay])}</span>`);
  return a.join("");
}
function row(d, count) {
  const cls = ["cb-item", d._hot ? "u" : "", d._state === "arch" ? "dead" : d._h <= 0.3 ? "fade" : ""].join(" ");
  const right = d._state === "dir"
    ? `<span class="due">${count > 1 ? count + "×" : ""}</span><span class="age">${ago(d._date)}</span>`
    : `<span class="due">${due(d)}</span><span class="age">${ago(d._date)}</span>`;
  const pl = pills(d);
  return `<details class="${cls}" data-cb-id="${d.id}"><summary><span>${meter(d)}</span><div class="cb-main">
    <div class="cb-l1"><span class="cb-ttl">${esc(d._state === "dir" && d.svc ? d.svc : d.t)}</span><span class="cb-who">${esc(d.who)}</span><span class="cb-pills">${pl}</span></div>
    <div class="cb-sum">${esc(d.s)}</div><div class="cb-pills m">${pl}</div></div>
    <div class="cb-right">${right}<span class="cb-rbtn">Reply</span></div></summary></details>`;
}
function draft(d) {
  const first = d.who.split(" ")[0];
  const lead = d._state === "dir" ? `I'd love to hear more about your ${(d.svc || "offering").toLowerCase()}.` : d.k === "ask" ? "I might be able to help." : d.k === "event" ? "I'd love to come." : "I'm interested.";
  return `Hi ${first}! I saw your post in Soul-noma Crew on ${fmt(d._date)}: "${d.t}". ${lead} `;
}
function phrase(d) {
  const w = (d.txt || d.s).replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}'’\s-]/gu, " ").split(/\s+/).filter(Boolean);
  let best = 0, score = -1;
  for (let i = 0; i + 6 <= Math.min(w.length, 60); i++) { const s = w.slice(i, i + 6).reduce((n, x) => n + Math.min(x.length, 9), 0); if (s > score) { score = s; best = i; } }
  return w.slice(best, best + 6).join(" ") || d.t;
}
function replyBox(d, withText) {
  const p = PEOPLE[d.uid], others = [...p.svcs].filter((x) => x !== d.svc).slice(0, 4), first = esc(d.who.split(" ")[0]);
  return `<div class="cb-detail" data-cb-post="${d.id}"><div class="cb-main">${withText ? `<p class="cb-orig">${esc(d.txt || d.s)}</p>` : ""}
    <p class="cb-person"><b>${esc(d.who)}</b> · ${p.n} ${p.n === 1 ? "post" : "posts"} in the Crew since ${fmt(P(p.first), true)}${others.length ? " · also offers " + others.map(esc).join(", ") : ""}</p></div>
    <div class="cb-reply"><label for="r-${d.id}">Reply</label><textarea id="r-${d.id}">${esc(draft(d))}</textarea>
    <div class="cb-acts"><button class="cb-ghost" data-cb-act="find">1 · Find post</button><button class="cb-go" data-cb-act="copy">2 · Copy reply</button><span class="cb-ok" hidden>Copied</span></div>
    <p class="cb-hint">In Signal: ⌘F, paste, open the post, tap ${first} → Message. Then copy your reply.</p></div></div>`;
}

const lensOk = (d) => (S.lens === "gift" ? isGift(d) : !isGift(d));
const match = (d) => !S.q || [d.t, d.s, d.who, d.where, d.cat, d.svc, d.price, d.txt].join(" ").toLowerCase().includes(S.q);
const banner = `<div class="cb-gb"><svg viewBox="180 110 320 180" aria-hidden="true"><path stroke="var(--moss)" fill="none" stroke-width="22" stroke-linecap="round" d="M340,200 C340,123 458,123 458,200 C458,277 340,277 340,200"/><path stroke="var(--rust-btn)" fill="none" stroke-width="22" stroke-linecap="round" d="M340,200 C340,123 222,123 222,200 C222,277 340,277 340,200"/><circle cx="340" cy="200" r="8" fill="var(--gold)"/></svg><h2>Do something you love for others, <em>and let them do something they love for you.</em></h2></div>`;

function shell(sec) {
  if (sec.dataset.ready) return;
  sec.dataset.ready = "1";
  sec.innerHTML = `<div class="tools cb-tools">
      <div class="tool-line"><div class="seg cb-lens" role="group" aria-label="Gifts or paid"><button data-lens="gift">∞ Infinite Gifts</button><button data-lens="paid">Paid &amp; Trade</button></div>
      <input class="search cb-q" type="search" placeholder="Search" autocomplete="off" aria-label="Search posts"></div>
      <div class="chips cb-chips" role="group" aria-label="Filter"></div>
      <div class="cb-legend"><span><b class="cb-hm h-hot"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i></b>Urgent</span><span><b class="cb-hm h-fresh"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></b>Fresh</span><span><b class="cb-hm h-aging"><i class="on"></i><i class="on"></i><i></i><i></i></b>Aging</span><span><b class="cb-hm h-fading"><i class="on"></i><i></i><i></i><i></i></b>Fading</span><span><svg class="cb-ever" aria-hidden="true"><use href="#tree"/></svg>Evergreen</span></div>
    </div><div class="cb-banner"></div><div class="cb-out"></div>`;
  let t;
  sec.querySelector(".cb-q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); S.shown = {}; renderBoard(sec.id.slice(5)); }, 150); });
  sec.querySelector(".cb-lens").addEventListener("click", (e) => { const b = e.target.closest("[data-lens]"); if (!b) return; S.lens = b.dataset.lens; store.set("crew-lens", S.lens); S.f = ""; S.shown = {}; renderBoard(sec.id.slice(5)); });
  sec.querySelector(".cb-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-f],[data-kind]"); if (!b) return;
    if (b.dataset.kind !== undefined) S.kind = S.kind === b.dataset.kind ? "" : b.dataset.kind; else S.f = b.dataset.f; S.shown = {}; renderBoard(sec.id.slice(5)); });
}
function group(title, items, key, fn) {
  if (!items.length) return "";
  const lim = S.shown[key] || 40;
  return `<section class="cb-group" data-key="${esc(key)}"><h2 class="sec-head"><span>${title}</span><span class="n">${items.length}</span></h2>
    <div class="cb-list">${items.slice(0, lim).map(fn).join("")}</div>
    ${items.length > lim ? `<div class="cb-more"><button data-more="${esc(key)}">Show ${Math.min(40, items.length - lim)} more</button></div>` : ""}</section>`;
}
function renderBoard(tab) {
  const sec = $("view-" + tab);
  shell(sec);
  sec.querySelector(".cb-q").value = S.q;
  sec.querySelectorAll("[data-lens]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lens === S.lens)));
  sec.querySelector(".cb-legend").hidden = false;
  sec.querySelector(".cb-banner").innerHTML = S.lens === "gift" ? banner : "";
  const base = POSTS.filter((d) => d._state === tab && lensOk(d) && match(d));
  if (S.f && !base.some((d) => d.cat === S.f)) S.f = "";
  const c = {}; base.forEach((d) => (c[d.cat] = (c[d.cat] || 0) + 1));
  const kinds = tab === "dir" ? "" : ["ask", "offer"].concat(tab === "arch" ? ["event"] : []).map((k) =>
    `<button class="chip" data-kind="${k}" aria-pressed="${S.kind === k}">${k === "ask" ? "Asks" : k === "offer" ? "Offers" : "Events"} <span class="n">${base.filter((d) => d.k === k).length}</span></button>`).join("") + `<span class="cb-sep"></span>`;
  sec.querySelector(".cb-chips").innerHTML = kinds + `<button class="chip" data-f="" aria-pressed="${!S.f}">All <span class="n">${base.length}</span></button>` +
    Object.keys(c).sort((a, b) => c[b] - c[a]).map((k) => `<button class="chip" data-f="${esc(k)}" aria-pressed="${S.f === k}">${esc(k)} <span class="n">${c[k]}</span></button>`).join("");
  const list = base.filter((d) => (!S.f || d.cat === S.f) && (!S.kind || tab === "dir" || d.k === S.kind));
  let html = "";
  if (tab === "live") {
    const wk = list.filter((d) => (today - d._date) / DAY <= 7).sort((a, b) => (b._hot - a._hot) || (a._hot && b._hot ? a._exp - b._exp : 0) || b._date - a._date);
    const older = list.filter((d) => !wk.includes(d)).sort((a, b) => (b._hot - a._hot) || b._h - a._h || b._date - a._date);
    html = group("This week", wk, "wk", (d) => row(d)) + group("Earlier", older, "old", (d) => row(d));
  } else if (tab === "dir") {
    const g = {};
    for (const d of list) { const k = d.uid + "|" + (d.svc || d.t).toLowerCase(); const x = g[k]; if (!x) g[k] = [d, 1]; else { x[1]++; if (d._date > x[0]._date) x[0] = d; } }
    const byCat = {}; Object.values(g).forEach((x) => (byCat[x[0].cat] ||= []).push(x));
    html = Object.keys(byCat).sort((a, b) => byCat[b].length - byCat[a].length)
      .map((cat) => group(esc(cat), byCat[cat].sort((a, b) => b[0]._h - a[0]._h || b[1] - a[1] || b[0]._date - a[0]._date), "c:" + cat, (x) => row(x[0], x[1]))).join("");
  } else {
    html = group("Archived", list.sort((a, b) => b._date - a._date), "arch", (d) => row(d));
  }
  sec.querySelector(".cb-out").innerHTML = html || `<p class="empty">${POSTS.length ? "Nothing here." : "Crew posts are not published yet."}</p>`;
  counts();
}
function counts() {
  for (const t of ["live", "dir", "arch"]) {
    const b = $("tab-" + t); if (!b) continue;
    const n = POSTS.filter((d) => d._state === t && lensOk(d)).length;
    b.innerHTML = `${{ live: "Asks &amp; Offers", dir: "Evergreen", arch: "Archive" }[t]} <span class="n">${n.toLocaleString()}</span>`;
  }
}

// ---------- Stats band (each one opens its view) ----------
function stats() {
  const live = POSTS.filter((d) => d._state === "live");
  const items = [
    ["today", EVENTS_TODAY, "events today"],
    ["week", live.filter((d) => (today - d._date) / DAY <= 7).length, "posts this week"],
    ["asks", live.filter((d) => d.k === "ask").length, "open asks"],
    ["gifts", live.filter(isGift).length, "live gifts"],
  ];
  $("stats").innerHTML = `<div class="stats-in">${items.map(([k, n, l]) => `<button data-stat="${k}"><b>${n}</b> ${l}</button>`).join("")}<span class="synced">${SYNCED ? "Crew updated " + fmt(P(SYNCED), true) : ""}</span></div>`;
}
function go(stat) {
  if (!API) return;
  if (stat === "today") {
    API.state.cat = ""; API.state.org = ""; API.state.eq = "";
    API.setView("events");
    requestAnimationFrame(() => { const day = document.getElementById("d-" + T0); day ? day.scrollIntoView({ block: "start" }) : window.scrollTo({ top: 0 }); });
    return;
  }
  S.f = ""; S.q = ""; S.shown = {};
  S.kind = stat === "asks" ? "ask" : "";
  if (stat === "gifts") { S.lens = "gift"; store.set("crew-lens", "gift"); }
  if (stat === "asks" || stat === "week") { /* both lenses hold asks; keep the current one */ }
  API.setView("live");
  window.scrollTo({ top: 0 });
}

// ---------- Clicks inside crew rows and replies ----------
function copyText(val, el, label) {
  const ok = el.querySelector(".cb-ok"), txt = el.querySelector("textarea");
  const shown = () => { ok.textContent = label; ok.hidden = false; setTimeout(() => (ok.hidden = true), 5000); };
  (navigator.clipboard ? navigator.clipboard.writeText(val) : Promise.reject()).then(shown, () => { txt.focus(); txt.select(); });
}
document.addEventListener("click", (e) => {
  const st = e.target.closest("[data-stat]");
  if (st) return go(st.dataset.stat);
  const m = e.target.closest("[data-more]");
  if (m && m.closest(".cb-out")) { S.shown[m.dataset.more] = (S.shown[m.dataset.more] || 40) + 40; renderBoard(API.state.view); return; }
  const a = e.target.closest("[data-cb-act]");
  if (!a) return;
  const box = a.closest("[data-cb-post]"), d = POSTS.find((x) => String(x.id) === box.dataset.cbPost);
  if (a.dataset.cbAct === "find") { const ph = phrase(d); copyText(ph, box, "Copied “" + ph + "”"); }
  else copyText(box.querySelector("textarea").value, box, "Copied");
});
document.addEventListener("toggle", (e) => {
  const el = e.target;
  if (!el.matches?.("details.cb-item") || !el.open || el.querySelector(".cb-detail")) return;
  el.insertAdjacentHTML("beforeend", replyBox(POSTS.find((x) => String(x.id) === el.dataset.cbId), true));
}, true);

// ---------- Start ----------
function begin(crew) {
  POSTS = crew ? prep(crew.posts) : [];
  SYNCED = crew ? crew.synced : "";
  const setBar = () => document.documentElement.style.setProperty("--bar-h", document.querySelector(".bar").offsetHeight + "px");
  window.SE = {
    views: { live: () => renderBoard("live"), dir: () => renderBoard("dir"), arch: () => renderBoard("arch") },
    mergeEvents,
    rowTag: (e) => e._crew ? ` <span class="cb-tag">Crew</span>${isGift(e._crew) ? ` <span class="cb-tag gift">∞</span>` : ""}` : "",
    detailExtra: (e) => e._crew ? (e.source === "crew" ? "" : `<p class="item-meta">Also shared in the Crew by ${esc(e._crew.who)}.</p>`) + replyBox(e._crew, e.source === "crew") : "",
    ready: (api) => { API = api; stats(); counts(); setBar(); },
  };
  addEventListener("resize", setBar);
  import(new URL("../app.js?v=" + (document.querySelector('script[src*="crew.js"]')?.src.split("v=")[1] ?? ""), import.meta.url).href);
}
