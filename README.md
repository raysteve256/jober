# Job Discovery Engine — Reasoning Core prototype

This is the first module from the build order: the **Reasoning Core**.
It takes a messy natural-language job query, extracts structured facts,
classifies each one as clear / missing / imprecise / branching, and
decides whether to ask a clarifying question, segment results, or
search — before any real job data is involved.

Job listings in this prototype are **mock data** (`src/lib/mockJobs.js`),
standing in for the Discovery Engine, which is a later build step.
This lets the reasoning logic be tested and refined on its own first,
per the recommended build order.

## Stack
- React + Vite (PWA-ready)
- Tailwind CSS v4
- Supabase (Postgres + RLS) — Job DNA, message history, jobs, and
  crowdsourced application outcomes. A real project (`job-discovery-engine`)
  has already been created and migrated; credentials are pre-filled
  in `.env.example`.
- Dexie (IndexedDB) — local offline cache, syncs to Supabase in the
  background; the app still works with no signal
- Netlify Function — proxies the Gemini API so the key never
  reaches the browser (same pattern as SEMAI)

## Database schema (already applied to the live project)

- `job_dna` — one resolved-facts profile per user, RLS-scoped to `auth.uid()`
- `messages` — conversation log per user, same RLS scoping
- `jobs` — shared listings with trust fields (`trust_status`,
  `days_unchanged`, etc.); publicly readable, writes reserved for the
  future Discovery Engine backend. Seeded with 4 sample rows matching
  the scenarios walked through in the spec. Note: `trust_status` in
  the DB is now only an explicit override for `closed` -- everything
  else (verified/probably_active/stale/ghost_risk/unverified) is
  computed live from `last_verified_at`/`posted_at`/`days_unchanged`
  by `src/lib/trustScoring.js`, not typed in by hand. See the Trust
  & Verification Layer section below.
- `application_outcomes` — per-user logged outcomes (replied / ghosted
  / etc.), privately RLS-scoped
- `employer_responsiveness` — a `SECURITY DEFINER` view aggregating
  `application_outcomes` across all users into anonymous counts/rates
  per employer. This is deliberate (it must read across users to
  aggregate) and is restricted to `authenticated` requests only —
  see the comment on the view in the migration for the full reasoning.

Auth uses **anonymous sign-in** (`supabase.auth.signInAnonymously()`):
every device gets a real `auth.uid()` for RLS with no signup flow
required yet. Upgrading to a real account later
(`supabase.auth.updateUser`) keeps the same user id and history.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set your real GEMINI_API_KEY
# (the Supabase URL and anon key are already filled in -- that
# project is live and migrated)

# Netlify CLI runs both the Vite dev server and the function together:
npm install -g netlify-cli   # if you don't have it
netlify dev
```

**Verify the Supabase wiring actually works:** open the app, send a
query, then check the Supabase dashboard (Table Editor → `job_dna`)
for a new row with a real `user_id`. That confirms anonymous auth,
the RLS policy, and the write path all at once. This couldn't be
tested from inside the sandbox that built this (its network egress
doesn't reach supabase.co), so it's worth this one manual check
before building further on top of it.

Open the URL Netlify CLI prints (usually http://localhost:8888).

If you'd rather not install the Netlify CLI, `npm run dev` will start
the Vite dev server alone, but the `/.netlify/functions/reason` call
will fail — the function needs `netlify dev` (or Netlify's own
hosting) to run.

## Deploying

Push this to a GitHub repo and connect it in Netlify, or run:

```bash
netlify deploy --prod
```

Set `GEMINI_API_KEY` in Site settings -> Environment variables on
Netlify -- the same pattern you already use for SEMAI.

## Try it

Type any of the test scenarios from the spec, e.g.:

> I need an IT job paying min shs 2,000,000, just finished my CS degree

It should ask a clarifying question (currency + period), then return
segmented, trust-tagged mock results once you answer.

> I'm looking for an internship, second year CS, CGPA 3.6

It should recognize the missing location as load-bearing and ask,
rather than guessing.

## Evaluating the Reasoning Core

`eval/scenarios.json` has 15 hand-written real-world queries with the
ideal ask/segment/search behavior for each, covering every ambiguity
type from the spec (missing, imprecise, branching) plus cases that
should NOT ask (already resolved in Job DNA, fully clear queries) and
a case that contradicts a previously resolved fact.

Run it against the live Reasoning Core:

```bash
export GEMINI_API_KEY=sk-ant-your-key
node eval/run.mjs
```

It grades the action choice (ask/segment/search) automatically and
prints the actual question/segments for a human to judge wording
quality. Re-run this every time the system prompt in `reason.mjs`
changes, before shipping the change.

## Offline / installable

The app is a real PWA now (`vite-plugin-pwa`): the shell precaches so
it opens with no signal, and it's installable to a home screen. The
one exception is the `/reason` call itself, which is deliberately
`NetworkOnly` — a stale cached AI response would be worse than a
clear "you're offline" state. Icons in `public/pwa-*.png` are
placeholders; swap them for real branding before shipping.

## Discovery Engine (first real source: user submissions)

Real scraping of BrighterMonday/Fuzu/company pages needs a raw-HTML
fetch + parser running in a real server environment -- verified via
live search/fetch that BrighterMonday has real, current listings
(e.g. an "Android QA Engineer" role, CIM Innovations, UGX 1,000,000-
1,500,000/mo), but there was no way to extract the actual DOM/CSS
selectors a production scraper needs, or to verify a scraper against
them, from the environment that built this. Shipping a guessed
scraper would break the "verify before shipping" pattern the rest of
this build has followed, so it's deliberately not here yet.

What IS built and real: **user-submitted listings** -- exactly the
informal-channel coverage from the spec (a link from BrighterMonday, a
WhatsApp group, a company page nobody scrapes). Tap "+ Add a listing
you found" to submit one. It always lands as `trust_status:
unverified` regardless of what the submitter claims -- enforced by
the DB column default, and the client never sends trust_status on
insert. A submission is not self-certifying; only the Trust Layer's
own computation (or a real crawl later) can upgrade it to verified.

**Next real step for this module**: either build a proper scraper
against a real dev environment where the actual DOM can be inspected
and the parser tested against it, or investigate whether any target
site exposes a public JSON API (common on modern job boards) that
would be far more robust than HTML scraping.

## Trust & Verification Layer (ghost-job scoring, now computed)

`src/lib/trustScoring.js` derives a job's trust status from real
timestamps instead of a value someone typed in:

- `verified` -- re-checked within the last 24h
- `probably_active` ("Likely active") -- re-checked within the last week
- `stale` -- either verified once but not recently, or never verified
  and posted 30+ days ago
- `ghost_risk` -- never verified and unchanged 45+ days
- `closed` -- only ever comes from an explicit source signal, never
  inferred from silence alone (silence and confirmed-closed are
  different claims, and conflating them is exactly the overconfident
  behavior the spec's honesty principle warns against)

Verified this against the 4 seed rows plus a new case not in the seed
data (a listing posted 35 days ago, never verified) and it correctly
classified it as `stale` rather than falling through to a generic
default. Every result card shows the actual reason
("Unchanged for 61 days with no confirmation it's still open") as
visible text, not a hover tooltip -- this needs to work on mobile,
where there's no hover.

**What this still can't do**: real ghost-job detection's strongest
signal -- cross-referencing whether the same role exists on the
company's own careers page -- requires the Discovery Engine, which
isn't built. This is freshness-based scoring, a real but partial
signal, not the full Trust Layer from the spec.

## Matching & Scoring (now real, not a placeholder)

`src/lib/scoring.js` computes an honest 0-100 fit score across four
dimensions (location, salary vs. stated floor, credential/document
requirements, category match) and returns separated positive and
negative reasons -- never a bare number, per the spec's honesty
principle. Verified it correctly penalizes a transcript-required role
for a transcript-pending candidate while still surfacing it (not
hiding it), which is the exact scenario this whole project started
from.

Tap "Why this fit?" on any result card to see the reasoning.

## Learning Loop (outcome logging)

Each result card now has a "Replied / Interview / Ghosted" logger.
Every logged outcome writes to `application_outcomes` and immediately
feeds the `employer_responsiveness` view for all users -- this is the
only way the crowdsourced Responsiveness Score ever gets real data,
so it's worth using once you're testing with real applications.

## What's deliberately NOT built yet (see the spec's build order)

- Real Discovery Engine (BrighterMonday/Fuzu/company-page scraping)
- Real Trust & Verification Layer (currently mock trust/responsiveness
  data on each job)
- Application Layer (drafting + human review)
- Any backend persistence beyond the local Dexie store (no Supabase
  wired up yet -- Job DNA is currently per-device only)

## Suggested next step

Before adding real job sources, build out an eval set: 15-20 more
messy real queries like the two above, with the ideal
ask/segment/search behavior written out by hand, and run them through
`reason.mjs` to see where the classification logic gets it wrong.
That's cheaper to iterate on now than after real job data is wired in.
