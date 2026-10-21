// The Add forms on the site open GitHub issues; these check that the intake
// script reads what those forms send. No network: Ives Park is a landmark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formFields, field, parseWhen, checkEvent, checkGroup } from "../scripts/intake.mjs";
import { toPacificIso, pacificDayKey } from "../scripts/lib/time.mjs";

// A date a month out, so the "already passed" and "more than a year away"
// checks never trip on the test itself.
const DATE = pacificDayKey(Date.now() + 30 * 86400000);

// The body GitHub writes for .github/ISSUE_TEMPLATE/add-event.yml
const body = [
  "### Event name", "", "Apple Blossom Seed Swap", "",
  "### Date (yyyy-mm-dd)", "", DATE, "",
  "### Start time", "", "10:30", "",
  "### End time", "", "_No response_", "",
  "### Place and street address", "", "Ives Park, 7400 Willow St, Sebastopol", "",
  "### Link for details or tickets", "", "https://example.org/swap", "",
  "### Who is hosting it", "", "Sebastopol Garden Club", "",
  "### One or two sentences about it", "", "Bring seeds, take seeds.",
].join("\n");

test("issue form fields are read by their labels", () => {
  const f = formFields(body);
  assert.equal(field(f, "event name"), "Apple Blossom Seed Swap");
  assert.equal(field(f, "end time"), "");
  assert.equal(field(f, "place and street address"), "Ives Park, 7400 Willow St, Sebastopol");
});

test("times read the way people type them", () => {
  const at = (t) => toPacificIso(parseWhen(DATE, t).ms).slice(11, 16);
  assert.equal(at("10:30"), "10:30");
  assert.equal(at("18:30"), "18:30");
  assert.equal(at("6:30 pm"), "18:30");
  assert.equal(at("7"), "19:00");
  assert.equal(at("9"), "09:00");
  assert.equal(at("07:30"), "07:30");
  assert.equal(at("12:15"), "12:15");
  assert.equal(at("12 am"), "00:00");
  assert.equal(parseWhen(DATE, "").allDay, true);
  assert.equal(parseWhen("April 12", "10:00"), null);
});

test("a complete event in Sebastopol passes", async () => {
  const r = await checkEvent(formFields(body), 1);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.area, "sebastopol");
  assert.equal(r.event.start.slice(0, 16), `${DATE}T10:30`);
  assert.equal(r.event.org, "Sebastopol Garden Club");
});

test("a past date and a missing place are both reported", async () => {
  const bad = body.replace(DATE, "2020-01-01").replace("Ives Park, 7400 Willow St, Sebastopol", "_No response_");
  const r = await checkEvent(formFields(bad), 1);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
});

// The body GitHub writes for .github/ISSUE_TEMPLATE/add-group.yml, with a
// pasted dash in it.
const DASH = String.fromCharCode(0x2014);
const groupBody = [
  "### Group name", "", "Example Trail Crew", "",
  "### Website", "", "https://example.org/example-trail-crew", "",
  "### What the group does, in one line", "", "Volunteers who keep up the trails in Ragle Ranch Park " + DASH + " every month.", "",
  "### How someone can take part", "", "Come to a Saturday work day.", "",
  "### Street address (if it has one)", "", "_No response_", "",
  "### Calendar or events page (if it has one)", "", "_No response_", "",
  "### Instagram (if it has one)", "", "_No response_",
].join("\n");

test("a group with a name, a line and a website passes, and loses its em dash", async () => {
  const r = await checkGroup(formFields(groupBody));
  assert.equal(r.ok, true);
  assert.equal(r.group.id, "example-trail-crew");
  assert.equal(r.group.url, "https://example.org/example-trail-crew");
  assert.equal(r.group.area, "sebastopol");
  assert.ok(!r.group.what.includes(DASH));
});

test("a group with no line about it is reported", async () => {
  const r = await checkGroup(formFields(groupBody.replace(/Volunteers who[^\n]*/, "_No response_")));
  assert.equal(r.ok, false);
});
