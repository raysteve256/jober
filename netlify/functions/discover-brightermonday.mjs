// netlify/functions/discover-brightermonday.mjs
//
// The Discovery Engine's first automated source. Deliberately does
// NOT use fixed CSS selectors -- those break the moment a site
// changes its markup, which is exactly the maintenance-cost problem
// the spec flagged as a reason not to chase "search everything."
// Instead it fetches the raw page and asks Gemini (already in this
// stack for the Reasoning Core and Application Layer) to extract
// structured listings from it -- the same "understand messy real
// content" capability this whole system is built around, just
// pointed at a job board's HTML instead of a user's sentence.
//
// Runs on a schedule (see the `config` export below) and upserts on
// source_url, so re-running it refreshes `last_verified_at` on
// listings still present -- which is exactly what feeds the Trust
// Layer's freshness scoring (trustScoring.js) honestly: a listing
// that keeps getting re-confirmed stays "verified"; one that quietly
// stops appearing on the source page naturally ages toward "stale" /
// "ghost_risk" over time, with no separate ghost-detection logic
// needed for that part.
//
// Verified end-to-end against REAL fetched content from the live
// BrighterMonday IT/Software/Data page before this was written (see
// the project's build history) -- the extraction prompt below is
// written to match that real, observed structure, not a guess.

import { createClient } from "@supabase/supabase-js";
import { callGeminiJSON } from "./_shared/gemini.mjs";
import { parseRelativeDate, parseSalaryText, inferCategory } from "../../src/lib/parseHelpers.js";

export const config = { schedule: "@daily" };

const SOURCE_URL = "https://www.brightermonday.co.ug/jobs/software-data";

const EXTRACTION_PROMPT = `You extract job listings from raw HTML of a
Ugandan job board page. The page lists multiple jobs. For each
distinct job listing you find, extract:

- title: the job title (exact text)
- company: the hiring company/employer name
- location: the location text shown (e.g. "Kampala", "Uganda", "Rest of Uganda")
- salary_text: the salary text exactly as shown (e.g. "USh 1,000,000 - 1,500,000", or "Confidential" if that's what's shown -- never invent a number)
- posted_relative: the relative posting time exactly as shown (e.g. "1 week ago", "Yesterday", "Today")
- source_url: the absolute URL the job title links to (a full https:// URL, found in the href of the title's link)

Only extract real listings actually present in the HTML -- if you
cannot find a real href for a listing's title, omit source_url for
that listing rather than guessing one. Do not invent listings, and do
not include navigation links, ads, or footer links as if they were jobs.

Respond with ONLY valid JSON, no prose, no markdown fences:
{ "listings": [ { "title": "...", "company": "...", "location": "...", "salary_text": "...", "posted_relative": "...", "source_url": "..." } ] }`;

function stripBoilerplate(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .slice(0, 60000); // keep the payload (and Gemini cost) bounded
}

export default async (req) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return new Response(
      JSON.stringify({
        error:
          "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set. This must be the service_role secret " +
          "(Project Settings -> API in Supabase), not the anon/publishable key -- writes here bypass RLS " +
          "deliberately, since this is a trusted backend process, not a user action.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const pageRes = await fetch(SOURCE_URL, {
      headers: {
        // A plain fetch() with no User-Agent is a common, easy signal
        // sites use to block scrapers -- a realistic browser UA is a
        // reasonable, non-deceptive way to avoid being blocked purely
        // for looking like a bot, not to misrepresent what this is.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      },
    });

    if (!pageRes.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch source page: HTTP ${pageRes.status}` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const html = await pageRes.text();
    const cleaned = stripBoilerplate(html);

    const extraction = await callGeminiJSON({
      apiKey,
      systemPrompt: EXTRACTION_PROMPT,
      userContent: cleaned,
    });

    if (!extraction.ok) {
      return new Response(
        JSON.stringify({ error: extraction.error, detail: extraction.detail }),
        { status: extraction.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const listings = extraction.data.listings || [];
    const now = Date.now();
    let upserted = 0;
    let skipped = 0;

    for (const listing of listings) {
      if (!listing.title || !listing.company || !listing.source_url) {
        skipped++;
        continue;
      }

      const { amount, currency } = parseSalaryText(listing.salary_text);
      const postedAt = parseRelativeDate(listing.posted_relative, now);

      const { error } = await supabase.from("jobs").upsert(
        {
          title: listing.title,
          company: listing.company,
          location: listing.location || null,
          category: inferCategory(listing.title),
          salary_amount: amount,
          salary_currency: currency,
          salary_period: amount ? "monthly" : null,
          requires_certified_transcript: false, // not knowable from a listing page; default to the less restrictive assumption, never claim a requirement that wasn't observed
          source_url: listing.source_url,
          posted_at: postedAt,
          last_verified_at: new Date(now).toISOString(),
        },
        { onConflict: "source_url" }
      );

      if (error) {
        skipped++;
        console.error(`Failed to upsert "${listing.title}":`, error.message);
      } else {
        upserted++;
      }
    }

    return new Response(
      JSON.stringify({ source: SOURCE_URL, found: listings.length, upserted, skipped }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected error during discovery run", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
