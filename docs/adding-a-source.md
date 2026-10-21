# Adding a calendar or an event

For groups that want their events on the site, and for whoever reviews the requests.

## For a group

The best thing to give us is a calendar link. We read it every morning, so each new event appears on its own and a cancelled one disappears.

### Links that work as they are

| You have | Paste |
| --- | --- |
| A Luma calendar | The calendar's page, like `luma.com/your-group` (not a single event) |
| A public Google Calendar | Its "Public address in iCal format", or the embed link from your website |
| A Meetup group | The group's page, like `meetup.com/your-group` |
| Eventbrite | Your organizer page (it has `/o/` in the address) |
| Mobilize or Tockify | The organization's or calendar's page |
| Any calendar app | A `.ics` or `webcal://` subscription link |
| A blog or site with an events feed | The RSS link |
| A Squarespace events page | The events page itself |
| WordPress with The Events Calendar | The events page itself |

The checker also looks inside an ordinary web page for a linked calendar, an embedded Google or Luma calendar, an RSS feed, or schema.org event markup.

Facebook and Instagram cannot be read automatically. Neither can a page that lists events as plain text or as images of flyers.

### No calendar yet: Luma

Luma is free and the fastest way to get every future event listed here.

1. Sign up at https://luma.com.
2. Create a calendar for the group.
3. Add your events to that calendar.
4. Paste the calendar's page link in the Add dialog on the site.

### No calendar yet: Google Calendar

1. In Google Calendar, create a new calendar just for the group's public events.
2. Open its settings. Under "Access permissions for events", tick "Make available to public".
3. Under "Integrate calendar", copy "Public address in iCal format".
4. Paste it in the Add dialog on the site.

Only make a calendar public if everything on it is meant to be public. A personal calendar should stay private.

### One event

For a one-off, use "One event" in the Add dialog. The date, the place and its street address are required. Anything that repeats belongs on a calendar instead.

### What happens next

"Send it" opens a short form on GitHub, which needs a free GitHub account. Within a couple of minutes a bot replies on it:

- For a calendar, it says what kind it found, how many events are coming up, and how many of those are in Sebastopol and nearby, with the first few listed.
- For an event, it checks the date and finds the address on the map. If something is off, it says what to fix; editing the request runs the check again.

Then it is reviewed by hand, usually within a few days. Once it is approved, an event or a group is on the site within a few minutes, and a calendar is read from the next morning on.

## For a maintainer

Each request becomes an issue labelled `add-source`, `add-event` or `add-group`. The bot only replies; it never changes a file. Run `npm run review` on your own computer to go through them. For each one it runs the same check again and asks yes, no or later. A yes writes one file:

- `data/feeds.json` for a calendar. Every calendar here is filtered to the ring, so a county-wide calendar adds only what happens in Sebastopol and nearby.
- `data/manual-events.json` for one event. Past events drop out of this file the next time an event is added.
- `data/orgs.json` for a group, with the kind and category you pick. A group's calendar link, when it reads, becomes its feed.

Before saying yes, open the link and check that it is what it says and that the group is real and local. After the last one the review runs the gate and the build, and on a final yes commits, pushes (which publishes the site) and closes the approved issues. A no closes the issue with your reason.

A calendar that belongs to a group in the directory is better as a feed on that group in `data/orgs.json`, so its events link back to the group. Move it there by hand when that applies, with `"scope": "local"` if the group's own events can be trusted to be local even when they list no address.

### The bot's permissions

The `Check a submission` workflow reads the repo and writes issue comments, nothing else.

The issue text is untrusted. `scripts/intake.mjs` reads it from the event payload in Node and passes values to `gh` as arguments, never through a shell. `scripts/review.mjs` does the same with `git` and `gh`. Keep it that way.

### By hand

```bash
node scripts/intake.mjs --url <link> --name "Group name"
node scripts/intake.mjs --url <link> --name "Group name" --write
```

The first reports what the link is and what it would add. `--write` adds it to `data/feeds.json`.
