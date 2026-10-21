#!/usr/bin/env node
// Checks a submitted calendar or event and proposes it.
//
// Runs in GitHub Actions on an issue opened from the site's "Add" forms
// (.github/ISSUE_TEMPLATE/add-source.yml, add-event.yml and add-group.yml),
// and by hand:
//   node scripts/intake.mjs --url <link> [--name "Group name"]   (report only)
//
// For a calendar: detect what the link is (scripts/lib/detect.mjs), read it
// once, and count upcoming events in Sebastopol and nearby. For one event:
// check the date and place the address. For a group: check the links and
// place the address. In Actions it only answers on the issue. Nothing goes
// into data/ until scripts/review.mjs, run by hand, approves it and calls
// addFeed, addEvent or addGroup.
//
// The issue text is untrusted. It is read from the event payload in Node,
// never interpolated into a shell command.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { detectSource } from "./lib/detect.mjs";
import { readFeed } from "./lib/read-feed.mjs";
import { areaFor, areaByText, townFor } from "./lib/geo.mjs";
import { openGeocoder } from "./lib/geocode.mjs";
import { zonedToUtc, toPacificIso } from "./lib/time.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEEDS = join(ROOT, "data/feeds.json");
const MANUAL = join(ROOT, "data/manual-events.json");
const ORGS = join(ROOT, "data/orgs.json");
const geo = openGeocoder(join(ROOT, "data/geocache.json"));
const HORIZON_DAYS = 60;

// ---- Inputs ---------------------------------------------------------------
// GitHub issue forms render as "### Label\n\nvalue" blocks.
function formFields(body) {
  const out = {};
  const parts = String(body ?? "").split(/^###\s+/m).slice(1);
  for (const p of parts) {
    const [label, ...rest] = p.split("\n");
    const value = rest.join("\n").trim();
    out[label.trim().toLowerCase()] = value === "_No response_" ? "" : value;
  }
  return out;
}
const field = (f, ...names) => names.map((n) => f[n.toLowerCase()]).find((v) => v) ?? "";
const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

// ---- Calendars ------------------------------------------------------------
async function checkSource(url, name) {
  const src = await detectSource(url);
  const now = Date.now();
  const window = { from: now - 6 * 3600000, to: now + HORIZON_DAYS * 86400000 };
  let read;
  try {
    read = await readFeed(src, window);
  } catch (err) {
    if (src.format !== "eventbrite") throw err;
    return { src, name: name || null, upcoming: null, core: 0, nearby: 0, unplaced: 0, samples: [] };
  }
  const instances = read.filter((i) => i.title && i.startMs >= window.from && i.startMs <= window.to);
  let core = 0;
  let nearby = 0;
  let unplaced = 0;
  const samples = [];
  for (const i of instances.slice(0, 80)) {
    let area = Number.isFinite(i.lat) ? areaFor(i.lat, i.lng) : null;
    if (!area && i.location) {
      area = areaByText(i.location) || null;
      if (!area) {
        const g = await geo.geocode(i.location, { budget: 25 });
        if (g) area = areaFor(g.lat, g.lng);
      }
    }
    if (area === "sebastopol") core++;
    else if (area === "nearby") nearby++;
    else if (!i.location) unplaced++;
    if (samples.length < 5) samples.push(`${toPacificIso(i.startMs).slice(0, 16).replace("T", " ")}  ${i.title}${i.location ? ` (${i.location.slice(0, 60)})` : ""}`);
  }
  return { src, name: name || null, upcoming: instances.length, core, nearby, unplaced, samples };
}

function addFeed({ src, name }, issue) {
  const feeds = existsSync(FEEDS) ? JSON.parse(readFileSync(FEEDS, "utf8")) : [];
  if (feeds.some((f) => f.url === src.url)) return { added: false, why: "This calendar is already on the list." };
  const id = slug(name || new URL(src.url).hostname) || "feed";
  feeds.push({
    id: feeds.some((f) => f.id === id) ? `${id}-${feeds.length + 1}` : id,
    name: name || new URL(src.url).hostname.replace(/^www\./, ""),
    format: src.format,
    url: src.url,
    kind: src.kind,
    ...(issue ? { addedIn: `issue #${issue}` } : {}),
  });
  writeFileSync(FEEDS, JSON.stringify(feeds, null, 2) + "\n");
  return { added: true };
}

function sourceReport(r) {
  if (r.upcoming == null)
    return `**${r.src.kind}** found: \`${r.src.url}\`\n\nEventbrite does not let GitHub's servers read its pages, so this one could not be counted here. It is read on mornings when the refresh runs from a home connection.`;
  const lines = [
    `**${r.src.kind}** found: \`${r.src.url}\``,
    "",
    `- ${r.upcoming} events in the next ${HORIZON_DAYS} days`,
    `- ${r.core} in Sebastopol, ${r.nearby} nearby${r.unplaced ? `, ${r.unplaced} with no place listed` : ""}`,
  ];
  if (r.samples.length) lines.push("", "First few:", "", ...r.samples.map((s) => `- ${s}`));
  if (!r.upcoming) lines.push("", "The calendar has nothing upcoming right now. It still gets added and is read every morning, so new events will appear as they are posted.");
  return lines.join("\n");
}

// ---- One event ------------------------------------------------------------
function parseWhen(date, time) {
  const d = String(date).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return null;
  const t = String(time ?? "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!t) return { allDay: true, ms: zonedToUtc(+d[1], +d[2], +d[3], 12, 0, 0) };
  const n = +t[1];
  if (n > 23 || +(t[2] ?? 0) > 59) return { allDay: true, ms: zonedToUtc(+d[1], +d[2], +d[3], 12, 0, 0) };
  let h = n;
  if (t[3]) h = (n % 12) + (t[3] === "pm" ? 12 : 0);
  // With no am or pm: a time picker sends 24-hour "07:30" or "18:30" and
  // those read as written. A typed "7" or "6:30" with no leading zero reads
  // as evening for 1 to 7, and as morning for 8 to 11.
  else if (n >= 1 && n <= 7 && !/^0/.test(t[1])) h = n + 12;
  return { allDay: false, ms: zonedToUtc(+d[1], +d[2], +d[3], h, +(t[2] ?? 0), 0) };
}

async function checkEvent(f, issue) {
  const title = field(f, "event name", "title");
  const date = field(f, "date (yyyy-mm-dd)", "date");
  const start = parseWhen(date, field(f, "start time", "time"));
  const end = parseWhen(date, field(f, "end time"));
  const place = field(f, "place and street address", "address", "place");
  const link = field(f, "link for details or tickets", "link");
  const host = field(f, "who is hosting it", "host");
  const about = field(f, "one or two sentences about it", "description");
  const problems = [];
  if (!title) problems.push("The event needs a name.");
  if (!start) problems.push("The date needs to be written like 2026-11-14.");
  else if (start.ms < Date.now() - 86400000) problems.push("That date has already passed.");
  else if (start.ms > Date.now() + 366 * 86400000) problems.push("That date is more than a year away.");
  if (link && !/^https?:\/\//i.test(link)) problems.push("The link needs to start with https://.");
  let lat = null;
  let lng = null;
  let area = areaByText(place) || null;
  if (place) {
    const g = await geo.geocode(place, { budget: 5 });
    if (g) {
      ({ lat, lng } = g);
      area = areaFor(lat, lng);
    }
  } else problems.push("The event needs a place and street address.");
  if (place && !area) problems.push("That place is outside Sebastopol and the towns around it, or we could not find it on the map. Add the street address and town.");
  if (problems.length) return { ok: false, problems };
  const event = {
    id: createHash("sha1").update(`${title}|${start.ms}|${place}`).digest("hex").slice(0, 12),
    title,
    start: toPacificIso(start.ms),
    end: end && !end.allDay && end.ms > start.ms ? toPacificIso(end.ms) : null,
    allDay: start.allDay,
    venue: place.split(",")[0].trim(),
    address: place,
    lat,
    lng,
    url: link || null,
    org: host || null,
    description: about ? about.slice(0, 400) : null,
    ...(issue ? { addedIn: `issue #${issue}` } : {}),
  };
  return { ok: true, event, area, town: townFor(lat, lng) };
}

function addEvent(event) {
  const list = existsSync(MANUAL) ? JSON.parse(readFileSync(MANUAL, "utf8")) : [];
  if (list.some((e) => e.id === event.id)) return false;
  // Past events drop out here, so the file stays short.
  const keep = list.filter((e) => Date.parse(e.end ?? e.start) > Date.now() - 86400000);
  keep.push(event);
  keep.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  writeFileSync(MANUAL, JSON.stringify(keep, null, 2) + "\n");
  return true;
}

// ---- A group ----------------------------------------------------------------
const httpOrNull = (u) => (/^https?:\/\/\S+$/i.test(String(u ?? "").trim()) ? String(u).trim() : null);
// The page copy rules (AGENTS.md) ban em dashes; a pasted one becomes a comma.
const plain = (s) => String(s ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim();

async function checkGroup(f) {
  const name = plain(field(f, "group name", "name"));
  const website = field(f, "website");
  const what = plain(field(f, "what the group does, in one line", "what"));
  const plugIn = plain(field(f, "how someone can take part", "plugin"));
  const address = plain(field(f, "street address (if it has one)", "address"));
  const calendar = field(f, "calendar or events page (if it has one)", "calendar");
  const instagram = field(f, "instagram (if it has one)", "instagram");
  const problems = [];
  const notes = [];
  if (!name) problems.push("The group needs a name.");
  if (!what) problems.push("Say in one line what the group does.");
  else if (what.length > 260) problems.push("The one line about the group is longer than 260 characters.");
  if (website && !httpOrNull(website)) problems.push("The website needs to start with https://.");
  if (instagram && !httpOrNull(instagram)) problems.push("The Instagram link needs to start with https://.");
  if (existsSync(ORGS)) {
    const orgs = JSON.parse(readFileSync(ORGS, "utf8"));
    const twin = orgs.find((o) => o.name.toLowerCase() === name.toLowerCase() || (httpOrNull(website) && o.url === httpOrNull(website)));
    if (twin) problems.push(`"${twin.name}" is already on the site.`);
  }
  let lat = null;
  let lng = null;
  let area = null;
  let town = null;
  if (address) {
    const g = await geo.geocode(address, { budget: 5 });
    if (g) {
      lat = Math.round(g.lat * 1e5) / 1e5;
      lng = Math.round(g.lng * 1e5) / 1e5;
      area = areaFor(lat, lng);
      town = area ? townFor(lat, lng) : null;
    } else area = areaByText(address) || null;
    if (!area) problems.push("That address is outside Sebastopol and the towns around it, or we could not find it on the map.");
  } else {
    area = "sebastopol";
    notes.push("No street address, so it is listed under Sebastopol with no pin on the map.");
  }
  let feed = null;
  if (calendar) {
    try {
      const r = await checkSource(calendar, name);
      feed = { format: r.src.format, url: r.src.url };
      notes.push(sourceReport(r));
    } catch (err) {
      notes.push(`The calendar link could not be read automatically (${err.message}). It is kept as the group's events page.`);
    }
  }
  if (problems.length) return { ok: false, problems, notes };
  const group = {
    id: slug(name) || "group",
    name,
    url: httpOrNull(website) ?? httpOrNull(calendar) ?? httpOrNull(instagram),
    what,
    plugIn: plugIn || null,
    kind: "informal",
    domains: ["neighbors"],
    area,
    town: town ?? (area === "sebastopol" ? "Sebastopol" : null),
    address: address || null,
    eventsPage: httpOrNull(calendar),
    instagram: httpOrNull(instagram),
    feeds: feed ? [feed] : [],
    evidence: null,
    ...(lat != null ? { lat, lng } : {}),
  };
  if (!group.url) return { ok: false, problems: ["The group needs a website, a calendar link or an Instagram link."], notes };
  return { ok: true, group, notes };
}

function addGroup(group, issue) {
  const orgs = JSON.parse(readFileSync(ORGS, "utf8"));
  if (orgs.some((o) => o.id === group.id || o.name.toLowerCase() === group.name.toLowerCase())) return false;
  orgs.push({ ...group, ...(issue ? { evidence: `issue #${issue}` } : {}) });
  orgs.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(ORGS, JSON.stringify(orgs, null, 2) + "\n");
  return true;
}

function groupReport(r) {
  const g = r.group;
  const lines = g
    ? [`**${g.name}**${g.area === "nearby" ? ` (nearby, ${g.town ?? "outside Sebastopol"})` : " (Sebastopol)"}`, "", `- ${g.what}`, ...(g.plugIn ? [`- Take part: ${g.plugIn}`] : []), ...(g.url ? [`- ${g.url}`] : [])]
    : [];
  if (r.notes?.length) lines.push("", ...r.notes);
  return lines.join("\n");
}

// ---- GitHub plumbing --------------------------------------------------------
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts }).trim();
function comment(issue, body) {
  sh("gh", ["issue", "comment", String(issue), "--body", body]);
}

export { formFields, field, parseWhen, checkEvent, checkSource, sourceReport, checkGroup, groupReport, addFeed, addEvent, addGroup };

// ---- Main -------------------------------------------------------------------
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const args = main ? process.argv.slice(2) : [];
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};

if (!main) {
  // Imported by the tests: nothing to run.
} else if (flag("url")) {
  // By hand: report only, unless --write
  try {
    const r = await checkSource(flag("url"), flag("name"));
    console.log(sourceReport(r));
    if (args.includes("--write")) console.log(addFeed(r).added ? "\nAdded to data/feeds.json." : "\nAlready listed.");
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
  geo.save();
} else if (process.env.GITHUB_EVENT_PATH) {
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const issue = payload.issue;
  const labels = (issue?.labels ?? []).map((l) => l.name);
  const f = formFields(issue?.body);
  try {
    const later = "Thanks. It goes on the site once it is reviewed, usually within a few days.";
    if (labels.includes("add-source")) {
      const r = await checkSource(field(f, "calendar or feed link", "link", "url"), field(f, "group or calendar name", "name"));
      const feeds = existsSync(FEEDS) ? JSON.parse(readFileSync(FEEDS, "utf8")) : [];
      if (feeds.some((x) => x.url === r.src.url)) comment(issue.number, `This calendar is already on the list.\n\n${sourceReport(r)}`);
      else comment(issue.number, `This calendar works.\n\n${sourceReport(r)}\n\n${later} After that it is read every morning.`);
    } else if (labels.includes("add-event")) {
      const r = await checkEvent(f, issue.number);
      if (!r.ok) comment(issue.number, `Almost. Please edit the request to fix this:\n\n${r.problems.map((p) => `- ${p}`).join("\n")}\n\nEditing the request runs this check again.`);
      else {
        const summary = `**${r.event.title}**, ${r.event.start.slice(0, 16).replace("T", " ")}, ${r.event.address} (${r.area === "sebastopol" ? "Sebastopol" : `nearby, ${r.town}`})`;
        comment(issue.number, `${summary}\n\n${later} For a group with more than one event, a calendar link saves you posting each one: see the "Add a calendar" option.`);
      }
    } else if (labels.includes("add-group")) {
      const r = await checkGroup(f);
      if (!r.ok) comment(issue.number, `Almost. Please edit the request to fix this:\n\n${r.problems.map((p) => `- ${p}`).join("\n")}${r.notes.length ? `\n\n${r.notes.join("\n\n")}` : ""}\n\nEditing the request runs this check again.`);
      else comment(issue.number, `${groupReport(r)}\n\n${later}`);
    }
  } catch (err) {
    comment(issue.number, `We could not use that yet: ${err.message}\n\nEdit the request to try another link, or reply here and a person will help.`);
  }
} else {
  console.log('Usage: node scripts/intake.mjs --url <calendar link> [--name "Group"] [--write]');
}
