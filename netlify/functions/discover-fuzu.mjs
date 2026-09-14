// netlify/functions/discover-fuzu.mjs
//
// Second Discovery Engine source, added the same way the first one
// was: fetched the real live page directly first to confirm actual
// structure before writing anything (real listing URL pattern
// fuzu.com/uganda/jobs/<slug>-<id>, real per-job category tags like
// "Manufacturing", "Banking, microfinance, insurance" -- genuinely
// different label wording than BrighterMonday's, which is exactly why
// normalizeCategory() maps by keyword rather than assuming one
// source's vocabulary). Note: Fuzu's listing cards often don't show a
// salary at all -- parseSalaryText() already returns null for missing
// text rather than fabricating a number, so this needed no special
// handling.

import { runDiscoverySource } from "./_shared/discovery.mjs";

export const config = { schedule: "@daily" };

export default async () => {
  const result = await runDiscoverySource({
    name: "fuzu",
    url: "https://www.fuzu.com/uganda",
    extractionPromptExtra:
      "Note: this specific page often shows job listings without a salary figure at all -- omit salary_text for those rather than guessing or writing 'Confidential'.",
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};
