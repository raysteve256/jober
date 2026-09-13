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

## Application Layer (AI drafts, human sends -- no auto-apply)

Per the spec, this is deliberately NOT an auto-submit tool -- employers
are now adding friction specifically to filter out AI-generated,
high-volume applications, so auto-apply is a liability, not a feature.

Tap "Draft an application note" on any result card:

1. First time only, it asks for a short bio (saved to Job DNA, never
   asked again) so drafts can reference something real about the
   candidate.
2. `netlify/functions/draft-application.mjs` (Gemini, same resilient
   retry/backoff as the Reasoning Core -- factored into
   `netlify/functions/_shared/gemini.mjs` and reused by both
   functions) drafts a short, specific note -- explicitly instructed
   to reference a concrete detail from the bio AND the job, and to
   avoid generic-AI phrases ("I am excited to apply...", etc.).
3. **Two independent checks**, not just the model's own opinion:
   - The model self-reports `soundsHuman`/`atsSafe` with a reason.
   - `src/lib/atsCheck.js` is a separate, deterministic check (bullet
     characters, unfilled `[placeholders]`, table-like spacing,
     non-standard unicode) -- verified it flags a deliberately bad
     draft and passes a clean one, so a real problem doesn't depend on
     the model accurately grading its own work.
4. The draft is editable, and there's a **Copy** button -- nothing is
   ever sent anywhere by the app itself.

**Verified the shared-helper bundling actually works in production**,
not just in theory: built the functions locally with the real Netlify
CLI (`netlify functions:build`) and confirmed the retry/backoff code
from `_shared/gemini.mjs` is physically inlined into both function
bundles, with no separate `_shared` function artifact created. This
matters because sharing code between Netlify Functions has a known
history of silently breaking in production with the legacy bundler --
confirmed here that the `esbuild` bundler (already set in
`netlify.toml`) handles it correctly.

## Discovery Engine (real automated source, now built)

`netlify/functions/discover-brightermonday.mjs` runs on a schedule
(`@daily`) and pulls real listings from BrighterMonday's IT/Software/
Data category page. It deliberately does NOT use fixed CSS selectors
-- those break the moment a site's markup changes, which is exactly
the maintenance-cost problem the spec flagged. Instead it fetches the
raw page and asks Gemini to extract structured listings from it, the
same "understand messy real content" capability the Reasoning Core
already does for user queries, just pointed at HTML instead of a
sentence.

**How this was verified before shipping** (continuing the pattern of
not shipping unverified guesses): fetched the live page directly to
confirm the real listing URL pattern
(`brightermonday.co.ug/listings/<slug>`) and real field structure
(title, company, location, salary-or-"Confidential", relative posted
date like "1 week ago") actually exist as described -- this isn't a
guess at site structure, it's built from real observed data. Then ran
the full pipeline against that real data with the network calls mocked
(page fetch, Gemini extraction, Supabase upsert all intercepted) and
confirmed: correct salary midpoint parsing (`"USh 1,000,000 -
1,500,000"` -> 1,250,000), correct relative-date-to-ISO conversion,
correct category inference from real titles ("Android QA Engineer" ->
qa, "Network Engineer" -> networking), and correct skip-on-missing-url
behavior (a listing extracted without a real href is dropped, never
given a fabricated URL). Also verified the actual Netlify function
bundle with the real Netlify CLI: the `src/lib/parseHelpers.js`
cross-directory import is physically inlined into the bundle (no
dangling import), and `@supabase/supabase-js` is correctly included as
a real `node_modules` dependency.

**What's still unverified**: the actual live network round-trip (real
fetch of the real page + real Gemini extraction + real Supabase write)
has not run, since this sandbox can't reach any of those three
services. This needs one real scheduled run on Netlify to confirm end
to end -- check Netlify's function logs after the first `@daily` run,
or invoke it manually with
`netlify functions:invoke discover-brightermonday` once deployed.

**Setup required**: add `SUPABASE_SERVICE_ROLE_KEY` to Netlify's
environment variables (Project Settings -> API -> `service_role` in
the Supabase dashboard -- NOT the anon key already there). This
bypasses RLS deliberately, since the scraper is a trusted backend
process rather than a user action -- see the comment in the function
itself for why.

**Deterministic parsing, not model arithmetic**:
`src/lib/parseHelpers.js` handles relative-date and salary parsing
directly rather than trusting Gemini's own math -- same principle as
`trustScoring.js` and `atsCheck.js` not taking a claim at face value
when it can be computed directly. Gemini's only job is extraction
(find the listings and their real text/URLs); everything else is
deterministic code.

**Trust Layer connection**: upserting on `source_url` means a listing
still present on a re-scrape gets its `last_verified_at` refreshed,
keeping it `verified` in `trustScoring.js`. A listing that quietly
disappears from the source page stops being refreshed and naturally
ages toward `stale`/`ghost_risk` -- real ghost-job signal, not a
separate detection system layered on top.

**Next real step**: add more sources (Fuzu, company career pages) by
writing a similar function per source, or generalizing this one to
accept a list of source URLs -- the extraction/parsing pipeline
already built here doesn't change per source, only the fetch target
does.

## User-submitted listings (a second Discovery Engine source)

Alongside the automated scraper above: exactly the informal-channel
coverage from the spec (a link from BrighterMonday, a WhatsApp group,
a company page nobody scrapes). Tap "+ Add a listing you found" to
submit one. It always lands as `trust_status: unverified` regardless
of what the submitter claims -- enforced by the DB column default, and
the client never sends trust_status on insert. A submission is not
self-certifying; only the Trust Layer's own computation (or the
scraper re-confirming it later) can upgrade it to verified.

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
