import { useEffect, useRef, useState } from "react";
import { getJobDNA, mergeJobDNA, logMessage, getHistory } from "./lib/jobDNA";
import { searchJobs } from "./lib/jobsRepo";

// Each chat entry is one of:
//  { role: "user", text }
//  { role: "assistant", text }               -- a clarifying question or note
//  { role: "results", segments, jobs }        -- structured job results

function timeAgo(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function TrustBadge({ trust }) {
  if (trust.status === "verified" || trust.status === "probably_active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
        Verified {timeAgo(trust.lastVerifiedAt)}
      </span>
    );
  }
  if (trust.status === "ghost_risk" || trust.status === "closed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
        Ghost risk{trust.daysUnchanged ? ` · ${trust.daysUnchanged}d unchanged` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
      Unverified / stale
    </span>
  );
}

function ResponsivenessBadge({ responsiveness }) {
  if (!responsiveness.totalLogged) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
        No replies logged yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
      {responsiveness.responseRatePct}% reply rate
      {responsiveness.avgResponseDays ? ` · ~${Math.round(responsiveness.avgResponseDays)}d` : ""}
    </span>
  );
}

function JobCard({ job }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{job.title}</p>
          <p className="text-xs text-gray-500">
            {job.company} · {job.location}
          </p>
        </div>
        {job.fit != null && (
          <span
            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
              job.fit >= 85
                ? "bg-emerald-100 text-emerald-800"
                : job.fit >= 70
                ? "bg-amber-100 text-amber-800"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {job.fit} fit
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <TrustBadge trust={job.trust} />
        <ResponsivenessBadge responsiveness={job.responsiveness} />
        {job.requiresCertifiedTranscript && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Needs certified transcript
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        UGX {job.salaryUGXPerMonth.toLocaleString()}/mo
        {job.meetsSalaryFloor === true && " · meets your floor"}
        {job.meetsSalaryFloor === false && " · below your stated floor"}
      </p>
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

  async function send() {
    const message = input.trim();
    if (!message || loading) return;

    setInput("");
    setError(null);
    setChat((c) => [...c, { role: "user", text: message }]);
    logMessage("user", message);
    setLoading(true);

    try {
      const res = await fetch("/.netlify/functions/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, jobDNA }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-sm font-medium text-gray-900">Job discovery</h1>
        <p className="text-xs text-gray-500">Reasoning Core prototype</p>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chat.length === 0 && (
          <p className="mt-8 text-center text-sm text-gray-400">
            Try: "I need an IT job paying min shs 2,000,000, just finished my CS degree"
          </p>
        )}

        {chat.map((entry, i) => {
          if (entry.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white">
                  {entry.text}
                </div>
              </div>
            );
          }
          if (entry.role === "assistant") {
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900">
                  {entry.text}
                </div>
              </div>
            );
          }
          // results
          return (
            <div key={i} className="space-y-2">
              {entry.note && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {entry.note}
                </p>
              )}
              {entry.segments ? (
                entry.segments.map((seg) => (
                  <div key={seg}>
                    <p className="mb-1 text-xs font-medium text-gray-500">{seg}</p>
                    <div className="space-y-2">
                      {entry.jobs
                        .filter((j) => j.category === seg.toLowerCase())
                        .map((j) => (
                          <JobCard key={j.id} job={j} />
                        ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="space-y-2">
                  {entry.jobs.map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400">
              Thinking…
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-gray-200 bg-white p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Describe the job you're looking for..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            disabled={loading}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
