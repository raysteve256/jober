// netlify/functions/discover-brightermonday.mjs
//
// Now points at BrighterMonday's general /jobs page (995+ listings
// across all sectors) instead of the earlier IT-only /jobs/software-data
// category page -- confirmed via direct fetch that the general page
// covers everything from Business Development to HVAC Technician to
// Accountant, spanning BrighterMonday's own real 26-category "Job
// Function" taxonomy, not just tech roles.
//
// See _shared/discovery.mjs for the actual pipeline (fetch -> Gemini
// extraction -> deterministic parsing -> upsert), which this file
// just configures.

import { runDiscoverySource } from "./_shared/discovery.mjs";

export const config = { schedule: "@daily" };

export default async () => {
  const result = await runDiscoverySource({
    name: "brightermonday",
    url: "https://www.brightermonday.co.ug/jobs",
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};
