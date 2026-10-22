# Running Sebastopol Events from the Mac mini

Instructions for Claude Code on Jeff's Mac mini at home. Read `AGENTS.md`, `HANDOFF.md` and this file before changing anything. Jeff is not technical: do the work, explain in plain words, and ask before anything that publishes or deletes.

## What runs where

| Job | Where | When | What it does |
| --- | --- | --- | --- |
| Hosting | GitHub Pages | always | Serves https://jeffmendelsohn.github.io/sebastopol-events/ from the `jeffmendelsohn/sebastopol-events` repo. Free, no server to keep up. |
| Morning build | GitHub Actions (`.github/workflows/deploy.yml`) | 13:23 UTC daily (6:23 AM in summer, 5:23 AM in winter), and on every push to `main` | Runs the gate, reads every feed, builds the site, adds the crew data, publishes. Commits the day's listings to `data/`. |
| Submission check | GitHub Actions (`.github/workflows/intake.yml`) | when someone uses Add on the site | Replies on the issue. Changes nothing. |
| Home refresh | **Mac mini** (`scripts/home-refresh.sh`, launch agent `com.sebastopol-events.refresh`) | 5:40 AM daily | Reads every feed from the home connection and pushes `data/events.json`. Eventbrite and a few group sites refuse GitHub's servers, so their events only appear through this job. The push starts the deploy. |
| Crew board | **Mac mini** (private repo `jeffmendelsohn/soulnoma-crew-board`, launch agent `com.jeff.soulnoma-crew`) | 6:30 AM daily | Builds the encrypted data file for the password-locked `/crew/` page and uploads it to the `crew-data` release. Its own setup is in that repo's `MAC-MINI.md`. |
| Review | **Mac mini**, by hand | twice a week | `npm run review`: Jeff approves or turns down what people sent. Nothing reaches the site without it. |

The site stays on GitHub Pages. The Mac mini runs the jobs that need a home connection or Jeff's own accounts, and pushes to GitHub, which publishes.

## One rule for this Mac

Keep every project and every script a launch agent runs **outside** `~/Documents`, `~/Desktop` and `~/Downloads`. macOS privacy blocks background jobs from reading those folders, and the job fails with "can't open input file". That is why the crew job never ran on the laptop. Use `~/sebastopol-events`, `~/soulnoma-crew-board` and `~/signal-mcp`.

## Setup, in order

### 1. Tools

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node gh
node -v
```

Node needs to be 20 or newer. The project has no npm dependencies.

### 2. GitHub sign-in

```bash
gh auth login -h github.com -s workflow
gh auth setup-git
gh auth status
```

`gh auth status` must list the scopes `repo` and `workflow`. Without `workflow`, a push that touches `.github/workflows/` is refused. `gh auth setup-git` lets the background jobs push with the same sign-in. Jeff approves the sign-in in his browser; never type his password.

### 3. The working copy

```bash
git clone https://github.com/jeffmendelsohn/sebastopol-events.git ~/sebastopol-events
cd ~/sebastopol-events
git remote add upstream https://github.com/benvonwong-byte/sebastopol-events.git
git remote set-url --push upstream DISABLED
npm run gate
npm run dev
```

`upstream` is Ben's original. Pushes to it stay off. `npm run dev` builds the site and serves it on http://localhost:4322; stop it with Ctrl-C.

### 4. The home refresh

```bash
cd ~/sebastopol-events
zsh scripts/install-home-refresh.sh
launchctl kickstart gui/$(id -u)/com.sebastopol-events.refresh
tail -f ~/Library/Logs/sebastopol-refresh.log
```

The installer copies the script to `~/.sebastopol-refresh/` and keeps its own clone there, so it never touches the working copy. The first run takes a few minutes and ends with "pushed" or "nothing changed". Then check the Actions tab on GitHub for a "Refresh listings and deploy" run, and the site footer under "Sources this morning" for an Eventbrite line with a count.

### 5. Keep the Mac awake for it

The jobs run at 5:40 and 6:30. A Mac that was asleep runs a missed job when it wakes, but a Mac that stays asleep all day runs nothing.

- System Settings, Energy: turn on "Prevent automatic sleeping when the display is off" and "Start up automatically after a power failure".
- Or wake it each morning: `sudo pmset repeat wakeorpoweron MTWRFSU 05:30:00` (Jeff types his password).

### 6. The crew board

Follow `MAC-MINI.md` in the private repo `jeffmendelsohn/soulnoma-crew-board`. It needs Signal Desktop linked to Jeff's phone, the Claude Code command line signed in, and the crew password, which Jeff gives you. Never write the password into a file in either repo.

### 7. Turn the laptop's jobs off

Once both jobs have run once on the Mac mini, remove them from the laptop so two machines do not push the same morning:

```bash
launchctl bootout gui/$(id -u)/com.jeff.soulnoma-crew
launchctl bootout gui/$(id -u)/com.sebastopol-events.refresh
```

The second one only exists if it was ever installed there. An error saying it is not loaded is fine.

## Every few days

- **Review submissions:** `cd ~/sebastopol-events && npm run review`. `node scripts/review.mjs --list` only lists what is waiting. The README has a paragraph on how it works.
- **Look at the logs:** `tail -50 ~/Library/Logs/sebastopol-refresh.log` and `tail -50 ~/Library/Logs/soulnoma-crew.log`.
- **Look at the site footer:** "Sources this morning" lists each source and its count. A source in red has fallen back to its last good read, which lasts 14 days.

## When something breaks

| What you see | What it means | What to do |
| --- | --- | --- |
| "can't open input file" in a log | The script is inside a folder macOS protects | Move the project out of Documents, Desktop or Downloads and reinstall the launch agent |
| "command not found: node" or "gh" | The launch agent cannot find a tool | `brew install node gh`. The refresh script looks in Homebrew, `~/.local/bin` and nvm |
| Push refused, "without `workflow` scope" | The GitHub sign-in is missing a permission | `gh auth refresh -h github.com -s workflow`, then Jeff approves in the browser |
| Push refused, "fetch first" | GitHub's own run pushed in between | The refresh retries once by itself. If it keeps failing, run it again with `launchctl kickstart` |
| The deploy fails at "Language gate" | Some text breaks the house voice rules | `npm run gate` prints the line. Fix the wording, commit, push |
| A source shows "did not load this morning" | That site changed or blocked the reader | Check it by hand with `node scripts/intake.mjs --url <its link>`. Notes on each aggregator are in `docs/aggregators.md` |
| The site still shows yesterday | The browser has the old page | Reload. GitHub Pages can serve the old copy for about 10 minutes after a deploy |

## If the Mac mini should host the site too

GitHub Pages is free and does not depend on the house's power or internet, so the plan is to keep it. If Jeff later wants the Mac mini to serve the site itself, the pieces are: build with `node scripts/build.mjs`, serve `dist/` with any static web server, reach it from outside through a tunnel (Cloudflare Tunnel needs no router changes), and set `SITE_URL` to the new address before building. Ask Jeff before starting on that, and keep GitHub Pages running until the new address works.
