import { useEffect, useState } from 'react';
import { AnalysisResponse, SecurityIssue, Severity, SEVERITIES } from '@/types/security';
import { SEVERITY, VERDICT } from '@/utils/severity';

type Props = {
  results: AnalysisResponse | null;
  isAnalyzing: boolean;
  error: string | null;
  fileName: string;
};

/**
 * Step 3: the report — verdict, counts, distribution, then one card per issue.
 */
export default function AnalysisResults({ results, isAnalyzing, error, fileName }: Props) {
  if (isAnalyzing) return <Scanning />;
  if (error) return <ErrorPanel message={error} />;
  if (!results) return <EmptyState />;
  return <Report results={results} fileName={fileName} />;
}

function EmptyState() {
  return (
    <section className="card flex flex-1 flex-col items-center justify-center p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ShieldIcon className="h-7 w-7" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">Your security report will appear here</h2>
      <p className="mt-1 max-w-md text-sm text-muted">
        Add some Python on the left and press <strong>Scan</strong>. In about 30 seconds you get:
      </p>
      <ul className="mt-5 grid max-w-lg gap-3 text-left text-sm sm:grid-cols-3">
        {[
          ['Verdict', 'One line: is this safe to ship?'],
          ['Issues by severity', 'Critical → low, worst first'],
          ['Exact fixes', 'The bad line and the code to replace it'],
        ].map(([title, body]) => (
          <li key={title} className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="font-medium">{title}</p>
            <p className="mt-0.5 text-xs text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STAGES = [
  { at: 0, label: 'Sending code to the scanner' },
  { at: 3, label: 'Semgrep static analysis — matching known vulnerability patterns' },
  { at: 12, label: 'AI security review — looking for what rules miss' },
  { at: 25, label: 'Scoring each issue (CVSS) and writing fixes' },
];

function Scanning() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // ponytail: stages advance on a timer, not real backend progress; stream events if it matters
  const current = STAGES.filter((s) => seconds >= s.at).length - 1;

  return (
    <section className="card flex flex-1 flex-col justify-center p-8" aria-live="polite" aria-busy>
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Scanning your code…</h2>
          <span className="font-mono text-sm text-muted">{seconds}s</span>
        </div>
        <p className="mt-1 text-sm text-muted">Usually 20–40 seconds. The first scan after a restart can take longer.</p>
        <ol className="mt-6 space-y-3">
          {STAGES.map((stage, i) => (
            <li key={stage.label} className="flex items-start gap-3 text-sm">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  i < current
                    ? 'bg-primary text-white'
                    : i === current
                      ? 'animate-pulse bg-primary/20 text-primary ring-2 ring-primary'
                      : 'bg-surface-2 text-muted'
                }`}
              >
                {i < current ? '✓' : i + 1}
              </span>
              <span className={i > current ? 'text-muted' : ''}>{stage.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <section className="card flex flex-1 flex-col justify-center p-8">
      <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="font-semibold">The scan didn&rsquo;t finish</p>
        <p className="mt-1 whitespace-pre-line">{message}</p>
        <p className="mt-3 text-xs text-red-700">Press Scan again to retry — Semgrep sometimes times out on its first run.</p>
      </div>
    </section>
  );
}

function Report({ results, fileName }: { results: AnalysisResponse; fileName: string }) {
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const issues = results.issues;
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, issues.filter((i) => i.severity === s).length]),
  ) as Record<Severity, number>;
  const worst = SEVERITIES.find((s) => counts[s] > 0) ?? 'none';
  const verdict = VERDICT[worst];
  const topScore = issues.reduce((max, i) => Math.max(max, i.cvss_score), 0);
  const shown = filter === 'all' ? issues : issues.filter((i) => i.severity === filter);

  return (
    <div className="flex flex-col gap-5">
      {/* Verdict + headline numbers */}
      <section className={`rounded-2xl bg-gradient-to-br ${verdict.tone} p-5 text-white shadow-sm`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-white/80">Verdict · {fileName || 'your code'}</p>
            <h2 className="mt-1 text-2xl font-bold">{verdict.title}</h2>
            <p className="mt-1 text-sm text-white/90">{verdict.advice}</p>
          </div>
          <div className="flex gap-3">
            <Stat label="Issues" value={issues.length} />
            <Stat label="Top CVSS" value={topScore ? topScore.toFixed(1) : '—'} />
          </div>
        </div>
      </section>

      {/* Severity tiles double as filters */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(filter === s ? 'all' : s)}
            aria-pressed={filter === s}
            disabled={counts[s] === 0}
            className={`card p-4 text-left transition disabled:cursor-default disabled:opacity-50 ${
              filter === s ? 'ring-2 ring-primary' : 'enabled:hover:border-primary/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${SEVERITY[s].bar}`} />
              <span className="text-xs font-medium text-muted">{SEVERITY[s].label}</span>
            </div>
            <p className="mt-1 text-3xl font-bold tabular-nums">{counts[s]}</p>
            <p className="text-[11px] text-muted">CVSS {SEVERITY[s].range}</p>
          </button>
        ))}
      </section>

      {/* Distribution + summary */}
      <section className="card p-5">
        {issues.length > 0 && (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Issues by severity">
              {SEVERITIES.map((s) =>
                counts[s] ? (
                  <div key={s} className={SEVERITY[s].bar} style={{ width: `${(counts[s] / issues.length) * 100}%` }} title={`${SEVERITY[s].label}: ${counts[s]}`} />
                ) : null,
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {SEVERITIES.filter((s) => counts[s]).map((s) => (
                <span key={s}>
                  <span className="font-medium text-foreground">{counts[s]}</span> {SEVERITY[s].label.toLowerCase()}
                </span>
              ))}
            </div>
          </>
        )}
        <h3 className="mt-4 text-sm font-semibold">What the scanner found</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">{results.summary}</p>
      </section>

      {/* Issues */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {filter === 'all' ? 'All issues, worst first' : `${SEVERITY[filter].label} issues`}{' '}
            <span className="text-muted">({shown.length})</span>
          </h3>
          {filter !== 'all' && (
            <button type="button" className="btn-ghost" onClick={() => setFilter('all')}>
              Show all
            </button>
          )}
        </div>
        {shown.map((issue, i) => (
          <IssueCard key={`${filter}-${i}`} issue={issue} index={i} defaultOpen={i === 0} />
        ))}
        {issues.length === 0 && (
          <p className="card p-5 text-sm text-muted">Nothing to fix. Run another file when you&rsquo;re ready.</p>
        )}
      </section>

      <SeverityLegend />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-white/15 px-4 py-2 text-center backdrop-blur">
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-white/80">{label}</p>
    </div>
  );
}

function IssueCard({ issue, index, defaultOpen }: { issue: SecurityIssue; index: number; defaultOpen: boolean }) {
  const meta = SEVERITY[issue.severity];
  return (
    <details open={defaultOpen} className={`card group border-l-4 ${meta.ring}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="font-mono text-xs text-muted">#{index + 1}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${meta.badge}`}>{meta.label}</span>
        <span className="min-w-0 flex-1 font-medium">{issue.title}</span>
        <CvssMeter score={issue.cvss_score} bar={meta.bar} />
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" fill="currentColor" aria-hidden>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </summary>
      <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <h4 className="label">What&rsquo;s wrong</h4>
          <p className="mt-1 text-sm leading-relaxed">{issue.description}</p>
          <p className="mt-1 text-xs text-muted">{meta.meaning}</p>
        </div>
        <CodeBlock title="Vulnerable code" text={issue.code} tone="bad" />
        <CodeBlock title="How to fix it" text={issue.fix} tone="good" />
      </div>
    </details>
  );
}

function CvssMeter({ score, bar }: { score: number; bar: string }) {
  return (
    <span className="hidden items-center gap-2 sm:flex" title={`CVSS ${score} out of 10`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <span className={`block h-full ${bar}`} style={{ width: `${Math.min(score, 10) * 10}%` }} />
      </span>
      <span className="w-8 font-mono text-xs tabular-nums">{score.toFixed(1)}</span>
    </span>
  );
}

function CodeBlock({ title, text, tone }: { title: string; text: string; tone: 'bad' | 'good' }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between">
        <h4 className={`label ${tone === 'bad' ? 'text-red-700' : 'text-emerald-700'}`}>{title}</h4>
        <button
          type="button"
          className="text-xs text-muted hover:text-foreground"
          onClick={() =>
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }, () => {})
          }
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className={`mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 font-mono text-[12.5px] leading-relaxed ${
          tone === 'bad' ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

function SeverityLegend() {
  return (
    <details className="card p-4 text-sm">
      <summary className="cursor-pointer font-medium">What do the severity levels and CVSS scores mean?</summary>
      <p className="mt-2 text-muted">
        CVSS (Common Vulnerability Scoring System) rates how dangerous a flaw is from 0 to 10, based on how easy it is to
        exploit and how much damage it could do.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {SEVERITIES.map((s) => (
          <li key={s} className="flex gap-2">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY[s].bar}`} />
            <span>
              <strong>{SEVERITY[s].label}</strong> <span className="text-muted">({SEVERITY[s].range})</span> —{' '}
              {SEVERITY[s].meaning}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
