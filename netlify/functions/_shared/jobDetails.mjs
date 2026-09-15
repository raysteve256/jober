// netlify/functions/_shared/jobDetails.mjs
//
// Fetches a job's own detail page (not the listing card already in
// the jobs table) and extracts the full requirements text plus how to
// actually apply. Built from three real patterns confirmed by fetching
// live BrighterMonday pages directly rather than assumed:
//   1. "Easy apply" -- BrighterMonday's own in-platform CV upload flow,
//      confirmed as the dominant pattern (every listing on a fetched
//      category page showed this).
//   2. An explicit email address -- confirmed real on an aggregated
//      NGO listing ("Application Procedure ... submitted by email to
//      ugandaprocurement@heks-eper.org").
//   3. An external site's own application form -- confirmed real on
//      an aggregated listing ("Click the APPLY button... complete
//      your application" on the employer's own site).
//
// Only case 2 is safe to build a mailto: shortcut for. Cases 1 and 3
// require an account, file upload, or a JS-rendered multi-step form --
// not something a backend fetch can fill out or submit, so those are
// deliberately treated as "go apply yourself" rather than attempted.

import { callGeminiJSON } from "./gemini.mjs";

function stripBoilerplate(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .slice(0, 60000);
}

const EXTRACTION_PROMPT = `You read the detail page of a single job
listing and extract two things:

1. full_requirements: the actual requirements/responsibilities/
   qualifications text as written on the page, in your own concise
   summary (a few sentences, not a full copy of the page). If the page
   doesn't clearly show this listing's own content (e.g. it redirected
   to a generic category/search page instead of a specific job), set
   this to null rather than summarizing unrelated content.

2. application_method and application_email: read any "How to Apply"
   / "Application Procedure" section. If it explicitly gives an email
   address to send the application to, set application_method to
   "email" and application_email to that exact address. If it says to
   apply via the platform itself (e.g. "Easy apply", an upload-CV
   button, an account-based flow), or points to an external site's own
   application form/portal, set application_method to
   "platform_or_external" and leave application_email null. Never
   guess or invent an email address that isn't explicitly shown.

Respond with ONLY valid JSON, no prose, no markdown fences:
{ "full_requirements": "string or null", "application_method": "email" | "platform_or_external", "application_email": "string or null" }`;

export async function fetchApplicationInfo(sourceUrl) {
  if (!sourceUrl) {
    return { ok: true, data: { full_requirements: null, application_method: "platform_or_external", application_email: null } };
  }

  try {
    const pageRes = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
      },
      redirect: "follow",
    });

    if (!pageRes.ok) {
      // Couldn't reach the page at all -- proceed without extra
      // detail rather than failing the whole drafting flow over it.
      return { ok: true, data: { full_requirements: null, application_method: "platform_or_external", application_email: null } };
    }

    // A listing that has expired often redirects to a generic category
    // or search page rather than 404ing -- worth surfacing honestly
    // rather than silently summarizing whatever unrelated page loaded.
    const finalUrl = pageRes.url;
    const redirectedAway = finalUrl && sourceUrl && !finalUrl.startsWith(sourceUrl.split("?")[0]);

    const html = await pageRes.text();
    const cleaned = stripBoilerplate(html);

    const extraction = await callGeminiJSON({
      apiKey: process.env.GEMINI_API_KEY,
      systemPrompt: EXTRACTION_PROMPT,
      userContent: cleaned,
    });

    if (!extraction.ok) {
      return { ok: true, data: { full_requirements: null, application_method: "platform_or_external", application_email: null } };
    }

    return {
      ok: true,
      data: { ...extraction.data, possibly_stale_link: redirectedAway },
    };
  } catch {
    return { ok: true, data: { full_requirements: null, application_method: "platform_or_external", application_email: null } };
  }
}
