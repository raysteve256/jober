// src/lib/parseHelpers.js
//
// Deterministic parsing helpers for scraped data -- kept separate
// from the LLM extraction so date/salary/category math isn't left to
// the model, same pattern as trustScoring.js and atsCheck.js not
// taking a claim at face value when it can be computed directly.

const DAY = 1000 * 60 * 60 * 24;

// Parses relative dates ("Today", "Yesterday", "3 days ago",
// "1 week ago", "2 weeks ago", "1 month ago") into an ISO timestamp.
// Returns null for anything unrecognized rather than guessing -- an
// unparsed date should fall back to "unknown", not a silently wrong
// one.
export function parseRelativeDate(text, now = Date.now()) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  if (t === "today") return new Date(now).toISOString();
  if (t === "yesterday") return new Date(now - DAY).toISOString();

  const daysMatch = t.match(/^(\d+)\s*days?\s*ago$/);
  if (daysMatch) return new Date(now - Number(daysMatch[1]) * DAY).toISOString();

  const weeksMatch = t.match(/^(\d+)\s*weeks?\s*ago$/);
  if (weeksMatch) return new Date(now - Number(weeksMatch[1]) * 7 * DAY).toISOString();

  const monthsMatch = t.match(/^(\d+)\s*months?\s*ago$/);
  if (monthsMatch) return new Date(now - Number(monthsMatch[1]) * 30 * DAY).toISOString();

  return null;
}

// Parses "USh 1,000,000 - 1,500,000", "UGX 500,000", "USD 750 - 1000",
// "Confidential", or missing text into a single representative
// monthly amount. Takes the midpoint of a range. Returns null for
// anything non-numeric rather than fabricating a figure -- many
// sources (Fuzu in particular) simply don't show a salary at all,
// which is different from "confirmed confidential" and both are
// different from a real number.
export function parseSalaryText(text) {
  if (!text) return { amount: null, currency: null };

  const isUGX = /ugx|ush\b/i.test(text);
  const isUSD = /\busd\b|\$/i.test(text);
  const numbers = text.match(/[\d,]{3,}/g);
  if (!numbers || numbers.length === 0) return { amount: null, currency: null };

  const parsed = numbers.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  if (parsed.length === 0) return { amount: null, currency: null };

  const amount = parsed.length >= 2 ? Math.round((parsed[0] + parsed[1]) / 2) : parsed[0];
  const currency = isUGX ? "UGX" : isUSD ? "USD" : null;

  return { amount, currency };
}

// The app's own general category taxonomy -- built from BrighterMonday
// Uganda's real, live "Job Function" filter sidebar (26 categories
// with real listing counts, fetched directly rather than guessed),
// which is a far more authoritative source for "what does the real
// job market actually look like" than assuming it's mostly IT roles.
export const CATEGORIES = [
  "it-software",
  "engineering",
  "quality-control",
  "sales",
  "marketing-communications",
  "finance-accounting",
  "admin-office",
  "customer-service",
  "human-resources",
  "project-management",
  "management-business",
  "operations",
  "supply-chain-logistics",
  "manufacturing-warehousing",
  "healthcare",
  "education-training",
  "legal",
  "creative-design",
  "hospitality-food",
  "agriculture",
  "trades-services",
  "driver-transport",
  "ngo-social",
  "other",
];

// Maps a source's own raw category label (BrighterMonday's "IT,
// Software & Data", Fuzu's "Information technology, software
// development, data", or anything else) into the shared taxonomy
// above. Matched by keyword rather than exact string, since every
// source phrases its own categories differently -- confirmed by
// comparing BrighterMonday's and Fuzu's real category lists directly,
// which don't share a single identical label between them despite
// covering the same job market.
//
// Order matters: this is most-specific-first, deliberately, after
// testing against real labels from both sites surfaced two ordering
// bugs -- "Product & Project Management" was matching the generic
// "management" pattern before reaching the specific "project" one,
// and "Transportation, logistics, driving" was matching "logistics"
// before reaching the driver-specific pattern. Broad catch-all terms
// (management-business, operations) are deliberately last so a
// specific match always wins first.
const CATEGORY_KEYWORDS = [
  ["quality-control", /quality control|quality assurance|\bqa\b/i],
  ["project-management", /project|program(me)? management/i],
  ["it-software", /\bit\b|software|computers?\b|data\b|telecoms?|programm/i],
  ["engineering", /engineer|architecture|technical\b|mechanical/i],
  ["sales", /\bsales\b/i],
  ["marketing-communications", /marketing|communications?|advertising|promotion/i],
  ["finance-accounting", /account|finance|banking|insurance/i],
  ["admin-office", /admin|office\b/i],
  ["customer-service", /customer service|support\b/i],
  ["human-resources", /human resources?|\bhr\b/i],
  ["driver-transport", /driver|transport|driving/i],
  ["supply-chain-logistics", /supply chain|procurement|logistics/i],
  ["manufacturing-warehousing", /manufactur|warehous/i],
  ["healthcare", /medical|pharma|health\b|nurse|clinical/i],
  ["education-training", /teach|train|education|academic|lectur/i],
  ["legal", /legal|law\b|compliance/i],
  ["creative-design", /creative|design\b/i],
  ["hospitality-food", /hospitality|hotel|catering|food services|leisure|tourism/i],
  ["agriculture", /farming|agricultur/i],
  ["trades-services", /trades?\b|hvac|electrical|plumb/i],
  ["ngo-social", /ngo|community|social services|charity|development sector/i],
  ["management-business", /management|business development|strategic|strategy|consulting/i],
  ["operations", /operations?\b/i],
];

// Normalizes a source's own raw category text into the shared
// taxonomy. Falls back to a title-keyword pass if the raw label is
// missing or doesn't match anything known, then to "other" -- never
// silently drops a listing for lacking a clean category.
export function normalizeCategory(rawLabel, title = "") {
  const combined = `${rawLabel || ""} ${title || ""}`;
  for (const [slug, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(combined)) return slug;
  }
  return "other";
}
