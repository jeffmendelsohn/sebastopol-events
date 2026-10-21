# Sebastopol Events

Every public event in Sebastopol, California (ZIP 95472) and the towns within about 22 km, the groups behind them, and a map. The site rebuilds itself every morning from public calendars, and anyone can add theirs.

Live at https://jeffmendelsohn.github.io/sebastopol-events/ (unlisted from search engines until `INDEX=1` is set in the deploy workflow).

## What it shows

Three views share one switch at the top: **Sebastopol** (the ZIP) or **Sebastopol + nearby** (Graton, Forestville, Occidental, Freestone, Bodega, Bodega Bay, the river towns, Cotati, Rohnert Park, Santa Rosa and Windsor).

- **Groups** is the directory: nonprofits, farms, venues, neighborhood groups, the city and the library, each with a line on how to take part.
- **Map** shows today, the next seven days, or the groups. ZIP 95472 is shaded amber with Graton cut out of it, and a dashed circle marks the nearby ring. Pins in Sebastopol are filled; pins outside it are hollow.
- **Events** is one list by day, with a strip of dates on top. Rows outside Sebastopol have an amber edge and an amber "Nearby · Town" label.

The page opens on Events. One slim bar at the top stays in view with the three views, the area switch and an Add button. The look follows [Green Valley Farm + Mill](https://gvfam.com/home): spaced capitals, Raleway, a white page and one amber.

## Adding a calendar, an event or a group

The Add button in the bar has four paths, and each view also has its own Add button below the list:

1. **One event.** A form for a one-off.
2. **A calendar.** Paste a link (Luma, Google Calendar, Meetup, Eventbrite organizer, Mobilize, Tockify, any .ics or webcal, RSS, a Squarespace or WordPress events page). It opens a short GitHub form with the link filled in.
3. **A group.** Name, website, one line on what it does, how to take part, and an address and calendar if it has them.
4. **No calendar yet.** Five-minute setup steps for a free Luma or Google calendar.

Each form opens an issue. The `Check a submission` workflow reads the link (or checks the date and the address) and replies on the issue with what it found. It changes nothing on the site. The full guide is in [docs/adding-a-source.md](docs/adding-a-source.md).

## Reviewing what people send

Nothing anyone sends goes on the site until you approve it. Every few days, open Terminal in this folder and type `npm run review`. It lists what is waiting, then shows each one in turn with what the check found: the event's date and place, how many events a calendar has coming up, or the group's line and website. Answer `y` to add it, `n` to turn it down (you can give a short reason, which is posted to the person), or `l` to leave it for later. For a group it also asks which kind and category it belongs in, and lets you rewrite its one line. After the last one it runs the same checks the daily rebuild runs, shows what changed, and asks once more before it publishes. On that yes it saves the additions, publishes them, and closes each request with a thank-you. `node scripts/review.mjs --list` only lists what is waiting.

By hand:

```bash
node scripts/intake.mjs --url https://luma.com/some-calendar --name "Some Group"
node scripts/intake.mjs --url https://luma.com/some-calendar --name "Some Group" --write
```

The first only reports; `--write` also adds it to `data/feeds.json`.

## Feeds out

Every morning's build publishes the listings for anyone to use:

| File | What |
| --- | --- |
| `events.ics` | Everything, Sebastopol and nearby |
| `events-sebastopol.ics` | Sebastopol only |
| `events-<category>.ics` | One per category (`food-farms`, `land-water` and the rest) |
| `events.rss` | RSS 2.0 |
| `feed.json` | JSON Feed 1.1, with the start, place, ring and town of each event under `_event` |
| `data/events.json` | The raw file the page reads |

## How the morning run works

`.github/workflows/deploy.yml` runs at about 6 AM Pacific and on every push to `main`:

1. `npm run gate`: the language gate, the data check and the tests.
2. `scripts/geocode-orgs.mjs` places new groups on the map.
3. `scripts/fetch-events.mjs` reads every group's feeds, the calendars in `data/feeds.json`, the events added by hand in `data/manual-events.json`, and the aggregators (Luma, Eventbrite, Meetup, the Bohemian and Press Democrat calendars, the Sonoma County Library, What's Happening in Sebastopol and others in `scripts/lib/aggregators.mjs`, notes in `docs/aggregators.md`). It keeps what falls inside the ring, marks each event `sebastopol` or `nearby`, merges duplicates, drops closure notices, and shows a repeating series only for its next six dates.
4. `scripts/needs-feed.mjs` lists the groups we cannot read yet in `docs/needs-a-feed.md`.
5. `scripts/build.mjs` writes `dist/` and Pages publishes it.

A source that fails one morning keeps its last good read for 14 days, so one bad night does not empty the calendar.

Eventbrite turns away GitHub's servers. `scripts/home-refresh.sh` runs the same fetch from a home connection and pushes the result; `scripts/install-home-refresh.sh` sets it up as a launch agent on a Mac.

## Where things are

| Path | What |
| --- | --- |
| `site/` | The page: `index.html`, `style.css`, `app.js` |
| `data/orgs.json` | The groups, their feeds and how to take part |
| `data/feeds.json` | Regional and community-added calendars, always filtered to the ring |
| `data/manual-events.json` | Single events added through the site |
| `data/domains.json` | The eight categories and their colors |
| `data/core-95472.json` | The ZIP outline from the Census Bureau, with Graton as a hole |
| `scripts/lib/geo.mjs` | The two rings, the town list and the text tests |
| `scripts/lib/detect.mjs` | Turns a pasted link into a feed |
| `scripts/intake.mjs` | Checks a submission and replies on the issue |
| `scripts/review.mjs` | `npm run review`: approve or turn down each submission, then publish |
| `.github/ISSUE_TEMPLATE/` | The three Add forms |

## Running it locally

```bash
npm run fetch
npm run dev
```

`npm run dev` builds and serves `dist/` on http://localhost:4322. Node 20 or newer; no dependencies to install.
