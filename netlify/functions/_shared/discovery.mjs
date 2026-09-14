// netlify/functions/_shared/discovery.mjs
//
// Shared Discovery Engine pipeline: fetch a source's raw page, ask
// Gemini to extract structured listings from it, parse deterministically,
// upsert. Factored out after building the BrighterMonday scraper so a
// second source (Fuzu) doesn't duplicate the whole pipeline -- only
// the source URL, extraction prompt, and category-hint field differ
// per source now.

import { createClient } from "@supabase/supabase-js";
import { callGeminiJSON } from "./gemini.mjs";
import { parseRelativeDate, parseSalaryText, normalizeCategory } from "../../../src/lib/parseHelpers.js";

function stripBoilerplate(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .slice(0, 60000); // keep the payload (and Gemini cost) bounded
}

const BASE_EXTRACTION_INSTRUCTIONS = `You extract job listings from raw HTML of a
Ugandan job board page. The page lists multiple jobs across many
different sectors -- not just IT/tech. For each distinct job listing
you find, extract:

- title: the job title (exact text)
- company: the hiring company/employer name
- location: the location text shown
- category_raw: the job's own category/sector label as shown on the
  page (e.g. "Sales", "Manufacturing", "Banking, microfinance,
  insurance") -- use whatever label the SITE ITSELF displays for that
  listing, do not invent one
- salary_text: the salary text exactly as shown, or omit this field
  entirely if no salary is shown at all -- never invent a number, and
  never assume "Confidential" if the page simply doesn't mention salary
- posted_relative: the relative posting time exactly as shown (e.g.
  "1 week ago", "Yesterday", "Today")
- source_url: the absolute URL the job title links to (a full https://
  URL, found in the href of the title's link)

Only extract real listings actually present in the HTML -- if you
cannot find a real href for a listing's title, omit source_url for
that listing rather than guessing one. Do not invent listings, and do
not include navigation links, ads, or footer links as if they were jobs.

Respond with ONLY valid JSON, no prose, no markdown fences:
{ "listings": [ { "title": "...", "company": "...", "location": "...", "category_raw": "...", "salary_text": "...", "posted_relative": "...", "source_url": "..." } ] }`;

// Runs one source end-to-end. `source` is:
//   { name, url, fetchHeaders?, extractionPromptExtra? }
export async function runDiscoverySource(source) {
  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return {
      status: 500,
      body: {
        error:
          "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set. This must be the service_role secret " +
          "(Project Settings -> API in Supabase), not the anon/publishable key -- writes here bypass RLS " +
          "deliberately, since this is a trusted backend process, not a user action.",
      },
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const pageRes = await fetch(source.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        ...(source.fetchHeaders || {}),
      },
    });

    if (!pageRes.ok) {
      return { status: 502, body: { error: `Failed to fetch source page: HTTP ${pageRes.status}` } };
    }

    const html = await pageRes.text();
    const cleaned = stripBoilerplate(html);

    const prompt = source.extractionPromptExtra
      ? `${BASE_EXTRACTION_INSTRUCTIONS}\n\n${source.extractionPromptExtra}`
      : BASE_EXTRACTION_INSTRUCTIONS;

    const extraction = await callGeminiJSON({ apiKey, systemPrompt: prompt, userContent: cleaned });

    if (!extraction.ok) {
      return { status: extraction.status, body: { error: extraction.error, detail: extraction.detail } };
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
      const category = normalizeCategory(listing.category_raw, listing.title);

      const { error } = await supabase.from("jobs").upsert(
        {
          title: listing.title,
          company: listing.company,
          location: listing.location || null,
          category,
          salary_amount: amount,
          salary_currency: currency,
          salary_period: amount ? "monthly" : null,
          requires_certified_transcript: false, // not knowable from a listing page -- default to the less restrictive assumption
          source_url: listing.source_url,
          posted_at: postedAt,
          last_verified_at: new Date(now).toISOString(),
        },
        { onConflict: "source_url" }
      );

      if (error) {
        skipped++;
        console.error(`[${source.name}] Failed to upsert "${listing.title}":`, error.message);
      } else {
        upserted++;
      }
    }

    return { status: 200, body: { source: source.name, url: source.url, found: listings.length, upserted, skipped } };
  } catch (err) {
    return { status: 500, body: { error: "Unexpected error during discovery run", detail: String(err) } };
  }
}
