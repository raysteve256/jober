// src/lib/atsCheck.js
//
// A second, independent ATS-safety pass -- deliberately not just
// trusting the model's own selfCheck.atsSafe claim. Real ATS parsers
// choke on bullet characters, tables, exotic unicode, and unfilled
// template placeholders; this catches those mechanically, the same
// way trustScoring.js computes trust from real signals instead of
// taking a claim at face value.

const BULLET_CHARS = /[•▪●◦‣∙]/;
const PLACEHOLDER_BRACKETS = /\[[A-Za-z ]{2,40}\]/; // e.g. "[Company Name]"
const EXCESSIVE_WHITESPACE_COLUMNS = /\S {3,}\S.*\n\S {3,}\S/; // table-like column spacing across lines
const NON_STANDARD_UNICODE = /[^\x00-\x7F\u2013\u2014\u2018\u2019\u201C\u201D]/; // allow en/em dash + smart quotes only

export function checkAtsSafety(text) {
  if (!text) return { safe: true, warnings: [] };

  const warnings = [];

  if (BULLET_CHARS.test(text)) {
    warnings.push("Contains bullet characters, which some ATS parsers mangle into garbled text.");
  }
  if (PLACEHOLDER_BRACKETS.test(text)) {
    warnings.push("Contains an unfilled placeholder like [Company Name] -- looks templated.");
  }
  if (EXCESSIVE_WHITESPACE_COLUMNS.test(text)) {
    warnings.push("Column-like spacing detected -- may have come from a table, which ATS parsers often scramble.");
  }
  if (NON_STANDARD_UNICODE.test(text)) {
    warnings.push("Contains unusual characters that some ATS parsers render as garbage.");
  }
  if (text.length > 2200) {
    warnings.push("Quite long for an application note -- most ATS fields and recruiters skim, not read in full.");
  }

  return { safe: warnings.length === 0, warnings };
}
