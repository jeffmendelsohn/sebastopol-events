#!/usr/bin/env node
// Review what people sent through the site's Add forms, one at a time.
//
//   npm run review                  go through each open submission and decide
//   node scripts/review.mjs --list  only list what is waiting
//
// Each submission is a GitHub issue labeled add-event, add-source or
// add-group. For each one this shows what was sent and what the check found,
// then asks: add it, turn it down, or leave it for later. Nothing reaches the
// site without a yes here. After the last one, it runs the gate and the
// build, and on one more yes commits the additions, pushes them (the push
// publishes the site) and closes the approved issues.
//
// The issue text is untrusted. It goes to git and gh only as separate
// arguments, never through a shell, and control characters are stripped
// before it is printed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { formFields, field, checkSource, sourceReport, checkEvent, checkGroup, groupReport, addFeed, addEvent, addGroup } from "./intake.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILES = ["data/feeds.json", "data/manual-events.json", "data/orgs.json", "data/geocache.json"];
const LABELS = { "add-event": "Event", "add-source": "Calendar", "add-group": "Group" };

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const clean = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const indent = (s) => clean(s).split("\n").map((l) => "   " + l.replace(/\*\*/g, "")).join("\n");

// The repo is whatever `origin` points at, so this works on a fork too.
function repoName() {
  const url = run("git", ["remote", "get-url", "origin"]);
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)(\.git)?$/);
  if (!m) throw new Error(`origin is not a GitHub repo: ${url}`);
  return m[1];
}

function openIssues(repo) {
  const all = new Map();
  for (const label of Object.keys(LABELS)) {
    const out = run("gh", ["issue", "list", "-R", repo, "--state", "open", "--label", label, "--limit", "100", "--json", "number,title,body,labels,url,author,createdAt"]);
    for (const i of JSON.parse(out || "[]")) all.set(i.number, { ...i, kind: label });
  }
  return [...all.values()].sort((a, b) => a.number - b.number);
}

const ago = (iso) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

// Answers are read line by line from a queue, so typed and piped answers
// behave the same. Closing the input (Ctrl-D) stops the review.
function asker() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on("line", (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on("close", () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
  });
  const question = (q) => {
    process.stdout.write(q);
    const next = lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve(null) : new Promise((r) => waiting.push(r));
    return next.then((a) => {
      if (a == null) throw new Error("\nStopped. Nothing more was changed.");
      if (!process.stdin.isTTY) process.stdout.write(a + "\n");
      return a;
    });
  };
  return { question, close: () => rl.close() };
}

async function choose(rl, question, options, fallback) {
  const keys = options.map((o) => o[0]);
  for (;;) {
    const a = (await rl.question(`${question} ${dim("[" + options.join(" / ") + "]")} `)).trim().toLowerCase();
    if (!a && fallback) return fallback;
    if (keys.includes(a[0])) return a[0];
  }
}

async function pick(rl, title, items, current) {
  console.log(`   ${title}:`);
  items.forEach((it, i) => console.log(`     ${i + 1}. ${it.label}${it.id === current ? dim("  (suggested)") : ""}`));
  const a = (await rl.question(`   Number, or Enter for the suggested one: `)).trim();
  const n = Number(a);
  return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1].id : current;
}

const KINDS = [
  { id: "nonprofit", label: "Nonprofit" },
  { id: "farm", label: "Farm or garden" },
  { id: "informal", label: "Neighborhood or volunteer group" },
  { id: "civic", label: "Civic group or club" },
  { id: "venue", label: "Venue or place" },
  { id: "market", label: "Market" },
  { id: "business", label: "Local business" },
  { id: "faith", label: "Faith community" },
  { id: "government", label: "City, county or library" },
  { id: "school", label: "School" },
  { id: "media", label: "Local news" },
];

async function main() {
  const listOnly = process.argv.includes("--list");
  const repo = repoName();
  try {
    run("gh", ["auth", "status"]);
  } catch {
    console.error("GitHub is not signed in on this computer. Run: gh auth login");
    process.exit(1);
  }
  const dirty = run("git", ["status", "--porcelain", "--", ...DATA_FILES]);
  if (dirty && !listOnly) {
    console.error(`These data files have changes that are not saved in git yet:\n${dirty}\nSave or undo them first, so the review starts clean.`);
    process.exit(1);
  }

  const issues = openIssues(repo);
  if (!issues.length) {
    console.log("Nothing is waiting for review.");
    return;
  }
  console.log(bold(`${issues.length} waiting for review on ${repo}:`));
  for (const i of issues) console.log(`  #${i.number}  ${LABELS[i.kind].padEnd(8)} ${clean(i.title)}  ${dim(`from ${i.author?.login ?? "someone"}, ${ago(i.createdAt)}`)}`);
  if (listOnly) return;

  // The morning run commits fresh listings, so start from the latest copy.
  console.log(dim("\nGetting the latest copy from GitHub..."));
  run("git", ["pull", "--rebase", "--quiet", "origin", "main"]);

  const rl = asker();
  const approved = [];
  const declined = [];
  try {
    for (const [n, i] of issues.entries()) {
      const f = formFields(i.body);
      console.log(`\n${bold(`${n + 1} of ${issues.length}  ·  ${LABELS[i.kind]}  ·  #${i.number}`)}  ${dim(i.url)}`);
      console.log(indent(clean(i.title)));
      console.log(dim("   Checking..."));

      let ok = false;
      let report = "";
      let problems = [];
      let apply = null;
      try {
        if (i.kind === "add-source") {
          const r = await checkSource(field(f, "calendar or feed link", "link", "url"), field(f, "group or calendar name", "name"));
          ok = true;
          report = sourceReport(r);
          apply = () => addFeed(r, i.number).added;
        } else if (i.kind === "add-event") {
          const r = await checkEvent(f, i.number);
          ok = r.ok;
          problems = r.problems ?? [];
          if (ok) {
            const e = r.event;
            report = [`${e.title}`, `${e.start.slice(0, 16).replace("T", " at ")}${e.end ? ` to ${e.end.slice(11, 16)}` : ""}`, `${e.address} (${r.area === "sebastopol" ? "Sebastopol" : `nearby, ${r.town}`})`, e.org ? `Host: ${e.org}` : "", e.url ?? "", e.description ?? ""].filter(Boolean).join("\n");
            apply = () => addEvent(e);
          }
        } else {
          const r = await checkGroup(f);
          ok = r.ok;
          problems = r.problems ?? [];
          report = groupReport(r);
          if (ok) {
            apply = async () => {
              const g = r.group;
              g.kind = await pick(rl, "What kind of group", KINDS, g.kind);
              const domains = JSON.parse(readFileSync(join(ROOT, "data/domains.json"), "utf8"));
              g.domains = [await pick(rl, "Which category", domains, g.domains[0])];
              const what = (await rl.question(`   One line about it (Enter keeps it as sent):\n   ${dim(g.what)}\n   > `)).trim();
              if (what) g.what = what.slice(0, 260);
              return addGroup(g, i.number);
            };
          }
        }
      } catch (err) {
        problems = [err.message];
      }

      if (report) console.log(indent(report));
      if (!ok) {
        console.log(`   ${bold("It does not pass the check:")}\n${problems.map((p) => "   - " + clean(p)).join("\n")}`);
        const a = await choose(rl, "   Turn it down, or leave it for later?", ["no, turn it down", "later"], "l");
        if (a === "n") declined.push({ i, why: problems.join(" ") });
        continue;
      }
      const a = await choose(rl, "   Add it to the site?", ["yes", "no", "later"]);
      if (a === "l") continue;
      if (a === "n") {
        const why = (await rl.question("   A short reason to send them (Enter to skip): ")).trim();
        declined.push({ i, why });
        continue;
      }
      if (await apply()) approved.push(i);
      else {
        console.log("   It is already on the site. Closing it as a duplicate.");
        declined.push({ i, why: "It is already on the site." });
      }
    }

    if (approved.length) {
      console.log(dim("\nChecking the additions (language, data and tests) and building the site..."));
      try {
        run("node", ["scripts/geocode-orgs.mjs"]);
        run("npm", ["run", "gate"]);
        run("node", ["scripts/build.mjs"]);
      } catch (err) {
        console.error(`\nThe check failed, so nothing was added:\n${clean(err.stderr || err.stdout || err.message).slice(-1500)}`);
        run("git", ["checkout", "--", ...DATA_FILES]);
        process.exitCode = 1;
        return;
      }
      console.log(run("git", ["diff", "--stat", "--", ...DATA_FILES]));
      const go = await choose(rl, bold(`Publish ${approved.length} addition${approved.length === 1 ? "" : "s"} to the live site now?`), ["yes", "no"]);
      if (go !== "y") {
        run("git", ["checkout", "--", ...DATA_FILES]);
        console.log("Nothing published. They stay waiting for the next review.");
        approved.length = 0;
      } else {
        const titles = approved.map((i) => `#${i.number}`).join(", ");
        run("git", ["add", "--", ...DATA_FILES]);
        run("git", ["commit", "-m", `Add from review: ${titles}`]);
        run("git", ["push", "--quiet", "origin", "main"]);
        for (const i of approved) {
          const when = i.kind === "add-source" ? "Its events show up after the next morning's read, and it is read every morning after that." : "It shows up on the site in a few minutes.";
          run("gh", ["issue", "close", String(i.number), "-R", repo, "--reason", "completed", "--comment", `Approved and added. ${when} Thank you.`]);
        }
        console.log(bold(`\nPublished. The site updates in a few minutes.`));
      }
    }

    for (const { i, why } of declined) {
      run("gh", ["issue", "close", String(i.number), "-R", repo, "--reason", "not planned", "--comment", `Thanks for sending this. It was not added${why ? `: ${why}` : "."}`]);
    }
    const left = issues.length - approved.length - declined.length;
    console.log(`\nAdded ${approved.length}, turned down ${declined.length}, left ${left} for later.`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(clean(err.stderr || err.message));
  process.exit(1);
});
