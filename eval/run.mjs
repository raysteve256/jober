// eval/run.mjs
//
// Runs every scenario in scenarios.json through the Reasoning Core
// (netlify/functions/reason.mjs, imported directly -- no server needed)
// and grades it on two things:
//   1. Did it choose the expected action (ask / segment / search)?
//   2. If it asked, did the question actually cover the topics a human
//      reviewer decided were load-bearing for that scenario?
//
// This is a cheap, repeatable check to run every time the system
// prompt in reason.mjs changes -- catch regressions before they reach
// real users, per the spec's "eval-driven tuning" recommendation.
//
// Usage:
//   GEMINI_API_KEY=sk-ant-... node eval/run.mjs

import { readFile } from "node:fs/promises";

const handlerModule = await import("../netlify/functions/reason.mjs");
const handler = handlerModule.default;

const scenarios = JSON.parse(
  await readFile(new URL("./scenarios.json", import.meta.url), "utf-8")
);

function coversExpectedTopics(question, expectedTopics) {
  if (!question || !expectedTopics) return null;
  const lower = question.toLowerCase();
  const hits = expectedTopics.filter((t) => lower.includes(t.toLowerCase()));
  return { hits, total: expectedTopics.length };
}

async function runScenario(scenario) {
  const req = new Request("http://local/reason", {
    method: "POST",
    body: JSON.stringify({ message: scenario.message, jobDNA: scenario.jobDNA || {} }),
  });

  let result;
  try {
    const res = await handler(req, {});
    result = await res.json();
    if (!res.ok) {
      return { id: scenario.id, error: result.error || `HTTP ${res.status}` };
    }
  } catch (err) {
    return { id: scenario.id, error: String(err) };
  }

  const expected = scenario.expected_action;
  const actual = result.action;
  const actionOk =
    expected === "ask_or_search" ? actual === "ask" || actual === "search" : actual === expected;

  let coverage = null;
  if (actual === "ask" && scenario.expected_question_covers) {
    coverage = coversExpectedTopics(result.clarifying_question, scenario.expected_question_covers);
  }
  if (actual === "segment" && scenario.expected_segments_include) {
    const segLower = (result.segments || []).join(" ").toLowerCase();
    const hits = scenario.expected_segments_include.filter((s) => segLower.includes(s));
    coverage = { hits, total: scenario.expected_segments_include.length, kind: "segments" };
  }

  return {
    id: scenario.id,
    expected,
    actual,
    actionOk,
    coverage,
    question: result.clarifying_question,
    segments: result.segments,
    why: scenario.why,
  };
}

const results = [];
for (const scenario of scenarios) {
  // Run sequentially to keep API usage predictable and easy to read in order.
  const r = await runScenario(scenario);
  results.push(r);
  const status = r.error ? "ERROR" : r.actionOk ? "PASS" : "FAIL";
  console.log(`\n[${status}] ${r.id}`);
  if (r.error) {
    console.log(`  error: ${r.error}`);
    continue;
  }
  console.log(`  expected: ${r.expected}  actual: ${r.actual}`);
  if (r.question) console.log(`  question: ${r.question}`);
  if (r.segments) console.log(`  segments: ${r.segments.join(", ")}`);
  if (r.coverage) {
    console.log(
      `  coverage: ${r.coverage.hits.length}/${r.coverage.total} expected topics mentioned (${r.coverage.hits.join(", ") || "none"})`
    );
  }
  console.log(`  why this matters: ${r.why}`);
}

const passed = results.filter((r) => r.actionOk).length;
const errored = results.filter((r) => r.error).length;
console.log(`\n---\n${passed}/${results.length} passed on action choice, ${errored} errored.`);
console.log(
  "Note: action-choice pass/fail is graded automatically; question WORDING quality still needs a human read-through of the printed output above."
);
