import { useEffect, useRef, useState } from "react";
import { getJobDNA, mergeJobDNA, logMessage, getHistory } from "./lib/jobDNA";
import { searchJobs, logApplicationOutcome } from "./lib/jobsRepo";
import { getCurrentUserId } from "./lib/supabaseClient";

// --- Small icon components, all grounded in the field-journal / -----
// --- expedition metaphor: a compass for orientation, a wax-seal ------
// --- stamp for verification, a rejection stamp for ghost risk. -------

function CompassRose({ className = "", spinning = false }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="20" stroke="var(--ink)" strokeWidth="1.2" />
      <circle cx="24" cy="24" r="15.5" stroke="var(--brass-line)" strokeWidth="0.8" />
      {[0, 90, 180, 270].map((deg) => (
        <line
          key={deg}
          x1="24"
          y1="4"
          x2="24"
          y2="8"
          stroke="var(--ink)"
          strokeWidth="1"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <g className={spinning ? "needle-scan" : ""}>
        <path d="M24 10 L28 24 L24 38 L20 24 Z" fill="var(--brass)" />
        <path d="M24 10 L28 24 L24 24 Z" fill="var(--ink)" />
        <path d="M24 38 L20 24 L24 24 Z" fill="var(--ink)" />
      </g>
      <circle cx="24" cy="24" r="2" fill="var(--ink)" />
    </svg>
  );
}

function VerifiedSeal({ label = "Verified" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium -rotate-2"
      style={{
        borderColor: "var(--seal-verified)",
        color: "var(--seal-verified)",
        background: "var(--seal-verified-bg)",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 5.2 L4 8 L9 1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
      {label}
    </span>
  );
}

function GhostStamp({ label = "Ghost risk" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm border-2 px-2 py-0.5 text-xs font-semibold rotate-2 tracking-wide"
      style={{
        borderColor: "var(--stamp-ghost)",
        color: "var(--stamp-ghost)",
        background: "var(--stamp-ghost-bg)",
      }}
    >
      {label}
    </span>
  );
}

function UnverifiedTag({ label = "Unverified" }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--ink-soft)", color: "var(--ink-soft)" }}
    >
      {label}
    </span>
  );
}

function TrustMark({ trust }) {
  if (trust.status === "verified") return <VerifiedSeal label="Verified" />;
  if (trust.status === "probably_active") return <VerifiedSeal label="Likely active" />;
  if (trust.status === "ghost_risk") return <GhostStamp label="Ghost risk" />;
  if (trust.status === "closed") return <GhostStamp label="Closed" />;
  if (trust.status === "stale") return <UnverifiedTag label="Stale" />;
  return <UnverifiedTag label="Unverified" />;
}

// A small dial gauge for responsiveness, instead of a generic badge --
// this is meant to read like an instrument reading, since the whole
// point of the Trust Layer is "treat this like real telemetry."
function ResponsivenessDial({ responsiveness }) {
  const pct = responsiveness.responseRatePct;
  if (!responsiveness.totalLogged || pct == null) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-soft)" }}>
        <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
          <path d="M1 11 A9 9 0 0 1 19 11" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        <span>no signal yet</span>
      </div>
    );
  }

  const angle = (pct / 100) * 180;
  const rad = (Math.PI / 180) * (180 - angle);
  const x = 10 + 9 * Math.cos(rad);
  const y = 11 - 9 * Math.sin(rad);
  const color = pct >= 60 ? "var(--seal-verified)" : pct >= 30 ? "var(--brass)" : "var(--stamp-ghost)";

  return (
    <div className="flex items-center gap-1.5 font-data text-xs" style={{ color }}>
      <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
        <path d="M1 11 A9 9 0 0 1 19 11" fill="none" stroke="var(--paper-deep)" strokeWidth="2" />
        <path
          d={`M1 11 A9 9 0 0 1 ${x} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>{pct}% reply{responsiveness.avgResponseDays ? ` · ~${Math.round(responsiveness.avgResponseDays)}d` : ""}</span>
    </div>
  );
}

function FitBadge({ fit }) {
  if (fit == null) return null;
  const color = fit >= 80 ? "var(--seal-verified)" : fit >= 55 ? "var(--brass)" : "var(--stamp-ghost)";
  return (
    <span
      className="font-data whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: color, color }}
    >
      {fit} fit
    </span>
  );
}

function OutcomeLogger({ job }) {
  const [logged, setLogged] = useState(null); // 'replied' | 'ghosted' | 'interviewed' | null
  const [busy, setBusy] = useState(false);

  async function log(outcome) {
    if (busy || logged) return;
    setBusy(true);
    try {
      const userId = await getCurrentUserId();
      await logApplicationOutcome({ userId, jobId: job.id, employerName: job.company, outcome });
      setLogged(outcome);
    } catch (err) {
      console.warn("Could not log outcome:", err.message);
    } finally {
      setBusy(false);
    }
  }

  if (logged) {
    return (
      <p className="mt-2.5 text-xs italic" style={{ color: "var(--ink-soft)" }}>
        Logged as {logged} — thanks, this helps future search results for everyone.
      </p>
    );
  }

  return (
    <div className="mt-2.5 flex items-center gap-3 border-t pt-2" style={{ borderColor: "var(--brass-line)" }}>
      <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>Applied? Log what happened:</span>
      <button onClick={() => log("replied")} disabled={busy} className="text-xs underline" style={{ color: "var(--seal-verified)" }}>
        Replied
      </button>
      <button onClick={() => log("interviewed")} disabled={busy} className="text-xs underline" style={{ color: "var(--seal-verified)" }}>
        Interview
      </button>
      <button onClick={() => log("ghosted")} disabled={busy} className="text-xs underline" style={{ color: "var(--stamp-ghost)" }}>
        Ghosted
      </button>
    </div>
  );
}

function FieldCard({ job }) {
  const [showWhy, setShowWhy] = useState(false);
  const hasReasons = (job.fitPositives?.length || 0) + (job.fitNegatives?.length || 0) > 0;

  return (
    <div
      className="rounded-sm border p-3.5 shadow-sm"
      style={{ borderColor: "var(--brass-line)", background: "var(--paper-deep)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-[15px] leading-snug" style={{ color: "var(--ink)" }}>
            {job.title}
          </p>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {job.company} — {job.location}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TrustMark trust={job.trust} />
          <FitBadge fit={job.fit} />
        </div>
      </div>

      {job.trust.reason && (
        <p className="mt-1 text-[11px] italic" style={{ color: "var(--ink-soft)" }}>
          {job.trust.reason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ResponsivenessDial responsiveness={job.responsiveness} />
        {job.requiresCertifiedTranscript && (
          <span className="text-xs" style={{ color: "var(--brass)" }}>
            ✎ certified transcript required
          </span>
        )}
      </div>

      <p className="font-data mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>
        UGX {job.salaryUGXPerMonth.toLocaleString()}/mo
        {job.meetsSalaryFloor === true && "  ·  meets your floor"}
        {job.meetsSalaryFloor === false && "  ·  below your stated floor"}
      </p>

      {hasReasons && (
        <div className="mt-2">
          <button
            onClick={() => setShowWhy((v) => !v)}
            className="text-xs underline"
            style={{ color: "var(--ink-soft)" }}
          >
            {showWhy ? "Hide" : "Why this fit?"}
          </button>
          {showWhy && (
            <div className="mt-1.5 space-y-1">
              {job.fitPositives?.map((p, i) => (
                <p key={"p" + i} className="text-xs" style={{ color: "var(--seal-verified)" }}>
                  + {p}
                </p>
              ))}
              {job.fitNegatives?.map((n, i) => (
                <p key={"n" + i} className="text-xs" style={{ color: "var(--stamp-ghost)" }}>
                  − {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <OutcomeLogger job={job} />
    </div>
  );
}

export default function App() {
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [jobDNA, setJobDNA] = useState({});
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    getJobDNA().then(setJobDNA);
    getHistory().then((rows) => {
      setChat(rows.map((r) => ({ role: r.role, text: r.content })));
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  const [retryTarget, setRetryTarget] = useState(null); // { message, retriable }

  async function sendMessage(message, { appendUserBubble = true } = {}) {
    if (!message || loading) return;

    setError(null);
    setRetryTarget(null);
    if (appendUserBubble) {
      setChat((c) => [...c, { role: "user", text: message }]);
      logMessage("user", message);
    }
    setLoading(true);

    try {
      const res = await fetch("/.netlify/functions/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, jobDNA }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = body.detail ? ` — ${body.detail}` : "";
        const err = new Error((body.error || `Request failed (${res.status})`) + detail);
        err.retriable = !!body.retriable;
        throw err;
      }

      const result = await res.json();
      const merged = await mergeJobDNA(result.facts || {});
      setJobDNA(merged);

      if (result.action === "ask") {
        setChat((c) => [...c, { role: "assistant", text: result.clarifying_question }]);
        logMessage("assistant", result.clarifying_question);
      } else if (result.action === "segment") {
        const jobs = await searchJobs(result.resolved_query || merged);
        setChat((c) => [
          ...c,
          { role: "results", segments: result.segments, jobs, note: result.notes_for_user },
        ]);
      } else {
        const jobs = await searchJobs(result.resolved_query || merged);
        setChat((c) => [
          ...c,
          { role: "results", segments: null, jobs, note: result.notes_for_user },
        ]);
      }
    } catch (err) {
      setError(err.message);
      if (err.retriable) setRetryTarget({ message });
    } finally {
      setLoading(false);
    }
  }

  function send() {
    const message = input.trim();
    if (!message) return;
    setInput("");
    sendMessage(message, { appendUserBubble: true });
  }

  function retry() {
    if (retryTarget) sendMessage(retryTarget.message, { appendUserBubble: false });
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col paper-grain">
      <header
        className="border-b-2 px-4 pb-3 pt-4"
        style={{ borderColor: "var(--ink)", background: "var(--paper-deep)" }}
      >
        <div className="flex items-center gap-2.5">
          <CompassRose className="h-8 w-8 shrink-0" />
          <div>
            <h1 className="font-display text-lg leading-none" style={{ color: "var(--ink)" }}>
              Field Notes
            </h1>
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-soft)" }}>
              your job discovery log
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        {chat.length === 0 && (
          <div
            className="mt-6 rounded-sm border border-dashed p-4 text-center"
            style={{ borderColor: "var(--brass-line)" }}
          >
            <p className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>
              A blank page. Describe the work you're looking for, however messy —
            </p>
            <p className="font-display italic text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
              "IT job, min shs 2,000,000, just finished my CS degree"
            </p>
          </div>
        )}

        {chat.map((entry, i) => {
          if (entry.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div
                  className="max-w-[85%] -rotate-1 rounded-sm border px-3 py-2 text-sm shadow-sm"
                  style={{ borderColor: "var(--brass-line)", background: "#fbf8ef", color: "var(--ink)" }}
                >
                  {entry.text}
                </div>
              </div>
            );
          }
          if (entry.role === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <div
                  className="max-w-[85%] border-l-2 pl-3 py-1 font-display italic text-[15px]"
                  style={{ borderColor: "var(--brass)", color: "var(--ink)" }}
                >
                  {entry.text}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="space-y-2.5">
              {entry.note && (
                <p
                  className="border-l-2 pl-3 py-1 text-xs italic"
                  style={{ borderColor: "var(--stamp-ghost)", color: "var(--ink-soft)" }}
                >
                  {entry.note}
                </p>
              )}
              {entry.segments ? (
                entry.segments.map((seg) => {
                  const segJobs = entry.jobs.filter((j) => j.category === seg.toLowerCase());
                  if (segJobs.length === 0) return null;
                  return (
                    <div key={seg}>
                      <p
                        className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
                        style={{ color: "var(--brass)" }}
                      >
                        <span className="h-px flex-1" style={{ background: "var(--brass-line)" }} />
                        {seg}
                        <span className="h-px flex-1" style={{ background: "var(--brass-line)" }} />
                      </p>
                      <div className="space-y-2">
                        {segJobs.map((j) => (
                          <FieldCard key={j.id} job={j} />
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="space-y-2">
                  {entry.jobs.map((j) => (
                    <FieldCard key={j.id} job={j} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2 pl-1">
            <CompassRose className="h-6 w-6" spinning />
            <span className="font-display italic text-sm" style={{ color: "var(--ink-soft)" }}>
              charting the search…
            </span>
          </div>
        )}

        {error && (
          <div
            className="border-l-2 pl-3 py-1.5 text-xs"
            style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}
          >
            <p>{error}</p>
            {retryTarget && (
              <button
                onClick={retry}
                className="mt-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{ borderColor: "var(--stamp-ghost)", color: "var(--stamp-ghost)" }}
              >
                Try again
              </button>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer
        className="border-t-2 p-3"
        style={{ borderColor: "var(--ink)", background: "var(--paper-deep)" }}
      >
        <div className="flex items-end gap-2">
          <input
            className="flex-1 border-b bg-transparent px-1 pb-1.5 font-display italic text-sm outline-none placeholder:not-italic"
            style={{ borderColor: "var(--ink-soft)", color: "var(--ink)" }}
            placeholder="Describe the job you're looking for…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={loading}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-40"
            style={{ borderColor: "var(--ink)", color: "var(--ink)" }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 14 L14 8 L2 2 L2 7 L9 8 L2 9 Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
