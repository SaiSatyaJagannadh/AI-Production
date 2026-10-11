'use client'

import { useEffect, useState } from 'react';
import { AnalysisResponse, ScannerStatus } from '@/types/security';
import { normalizeSeverity } from '@/utils/severity';
import CodeInput from '@/components/CodeInput';
import AnalysisResults, { ShieldIcon } from '@/components/AnalysisResults';

// Force relative URLs in production builds
// Only use localhost when explicitly running in development mode
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.location?.hostname === 'localhost'
    ? 'http://localhost:8000'
    : '');

// What backend/server.py's /health returns — lets us tell this API apart from
// another app (twin, saas) that happens to be listening on the same port.
const HEALTH_MESSAGE = 'Cybersecurity Analyzer API';

const WRONG_SERVER =
  'Something answered on port 8000, but it isn’t the Cybersecurity Analyzer — another project ' +
  '(twin or saas) is probably running there. Stop it, then start this one with:\n  cd cyber/backend && uv run server.py';
const OFFLINE =
  'Can’t reach the scanner backend. Start it with:\n  cd cyber/backend && uv run server.py';

/**
 * Main application page for cybersecurity code analysis
 */
export default function Home() {
  const [code, setCode] = useState('');
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<AnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerStatus>('checking');

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body) => setStatus(body?.message === HEALTH_MESSAGE ? 'online' : 'wrong-server'))
      .catch(() => setStatus('offline'));
  }, []);

  function handleCodeChange(next: string, name: string) {
    setCode(next);
    setFileName(next ? name : '');
    setResults(null);
    setError(null);
  }

  async function handleAnalyze() {
    if (!code.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        if (response.status === 404) throw new Error(WRONG_SERVER);
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `The scanner returned an error (${response.status}).`);
      }

      const report: AnalysisResponse = await response.json();
      setStatus('online');
      setResults({
        ...report,
        issues: report.issues
          .map((issue) => ({ ...issue, severity: normalizeSeverity(issue.severity, issue.cvss_score) }))
          .sort((a, b) => b.cvss_score - a.cvss_score),
      });
    } catch (err) {
      const offline = err instanceof TypeError; // fetch's network failure
      if (offline) setStatus('offline');
      setError(offline ? OFFLINE : err instanceof Error ? err.message : 'Something went wrong during the scan.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  const step = results ? 3 : isAnalyzing ? 2 : 1;

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
              <ShieldIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold leading-tight">Python Security Scanner</h1>
              <p className="text-xs text-slate-300">Find vulnerabilities in your code, and learn how to fix them</p>
            </div>
          </div>
          <StatusPill status={status} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Steps step={step} />

        {status === 'wrong-server' || status === 'offline' ? (
          <p className="mb-5 whitespace-pre-line rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {status === 'offline' ? OFFLINE : WRONG_SERVER}
          </p>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="lg:sticky lg:top-6">
            <CodeInput
              code={code}
              fileName={fileName}
              isAnalyzing={isAnalyzing}
              onCodeChange={handleCodeChange}
              onAnalyze={handleAnalyze}
            />
          </div>
          <div className="flex min-h-[32rem] flex-col">
            <AnalysisResults results={results} isAnalyzing={isAnalyzing} error={error} fileName={fileName} />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          Powered by Semgrep static analysis plus an AI security reviewer. Results are a starting point, not a full audit.
        </p>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: ScannerStatus }) {
  const map: Record<ScannerStatus, [string, string]> = {
    checking: ['bg-slate-400', 'Checking scanner…'],
    online: ['bg-emerald-400', 'Scanner online'],
    'wrong-server': ['bg-amber-400', 'Wrong server on :8000'],
    offline: ['bg-red-400', 'Scanner offline'],
  };
  const [dot, label] = map[status];
  return (
    <span className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Steps({ step }: { step: number }) {
  const steps = [
    ['Add code', 'Upload, paste or use the sample'],
    ['Scan', 'Semgrep + AI review, ~30 s'],
    ['Fix', 'Work from the top of the report down'],
  ];
  return (
    <ol className="mb-6 grid gap-3 sm:grid-cols-3">
      {steps.map(([title, body], i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'todo';
        return (
          <li
            key={title}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              state === 'current' ? 'border-primary bg-primary/5' : 'border-border bg-surface'
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                state === 'todo' ? 'bg-surface-2 text-muted' : 'bg-primary text-white'
              }`}
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-muted">{body}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
