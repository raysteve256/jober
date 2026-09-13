// src/lib/parseHelpers.js (also used by the scraper function via a
// relative import -- see netlify/functions/discover-brightermonday.mjs)
//
// Relative-date and salary-text parsing are done deterministically
// here rather than trusted from the model's own arithmetic -- same
// principle as trustScoring.js and atsCheck.js not taking a claim at
// face value when it can be computed directly instead.

const DAY = 1000 * 60 * 60 * 24;

// Parses BrighterMonday-style relative dates ("Today", "Yesterday",
// "3 days ago", "1 week ago", "2 weeks ago", "1 month ago") into an
// ISO timestamp. Returns null for anything unrecognized rather than
// guessing -- an unparsed date should fall back to "unknown", not a
// silently wrong one.
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

// Parses "USh 1,000,000 - 1,500,000", "UGX 500,000", "Confidential",
// or similar into a single representative monthly amount. Takes the
// midpoint of a range (a reasonable single number for scoring/display,
// not a precise claim). Returns null for anything non-numeric
// ("Confidential" etc.) rather than fabricating a figure.
export function parseSalaryText(text) {
  if (!text) return { amount: null, currency: null };

  const hasCurrency = /ugx|ush/i.test(text);
  const numbers = text.match(/[\d,]{4,}/g);
  if (!numbers || numbers.length === 0) return { amount: null, currency: null };

  const parsed = numbers.map((n) => Number(n.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
  if (parsed.length === 0) return { amount: null, currency: null };

  const amount =
    parsed.length >= 2 ? Math.round((parsed[0] + parsed[1]) / 2) : parsed[0];

  return { amount, currency: hasCurrency ? "UGX" : null };
}

// Maps a free-text job title/description into this app's fixed
// category set. Simple keyword-based, deliberately not another model
// call -- categorization from an already-known title is cheap and
// reliable enough to do directly.
export function inferCategory(title) {
  const t = (title || "").toLowerCase();
  if (/\bqa\b|quality assurance|test(er|ing)?\b/.test(t)) return "qa";
  if (/network|infrastructure|systems? admin|data center/.test(t)) return "networking";
  if (/support|helpdesk|help desk|technical support|it officer/.test(t)) return "support";
  if (/developer|engineer|software|data (engineer|analyst|scientist)|sap|programmer/.test(t)) return "development";
  return "other";
}
