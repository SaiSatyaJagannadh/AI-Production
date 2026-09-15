"use client"

import { useState, FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useAuth, Protect, PricingTable, UserButton } from '@clerk/nextjs';
import DatePicker from 'react-datepicker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { fetchEventSource } from '@microsoft/fetch-event-source';

const SAMPLE_NOTE = `55M, 3/7 productive cough, no fever. Ex-smoker, 20 pack years.
O/E chest clear, sats 97% RA, BP 148/92.
Rx amoxicillin 500mg tds 5/7. Repeat BP in 2/52, safety-net advice given.`;

/**
 * The backend prompt guarantees exactly three "### " headings. Split on them so each
 * section can be copied on its own; anything before the first heading (or a stream that
 * has not reached a heading yet) is rendered as a single untitled block.
 */
function splitSections(markdown: string): { title: string; body: string }[] {
  if (!markdown.trimStart().startsWith('###')) {
    return [{ title: '', body: markdown }];
  }
  return markdown
    .split(/^###\s+/m)
    .filter((part) => part.trim())
    .map((part) => {
      const breakAt = part.indexOf('\n');
      return breakAt === -1
        ? { title: part.trim(), body: '' }
        : { title: part.slice(0, breakAt).trim(), body: part.slice(breakAt + 1) };
    });
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
          <path d="M4 13h3l2 5 4-12 2 7h5" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-semibold tracking-tight">MediNotes Pro</span>
    </Link>
  );
}

function ConsultationForm() {
  const { getToken } = useAuth();

  const [patientName, setPatientName] = useState('');
  const [visitDate, setVisitDate] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState('');

  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setOutput('');
    setError('');
    setLoading(true);

    const jwt = await getToken();
    if (!jwt) {
      setError('Your session has expired — please sign in again.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let buffer = '';

    await fetchEventSource('/api', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        patient_name: patientName,
        date_of_visit: visitDate?.toISOString().slice(0, 10),
        notes,
      }),
      onmessage(ev) {
        buffer += ev.data;
        setOutput(buffer);
      },
      onclose() {
        setLoading(false);
      },
      onerror(err) {
        console.error('SSE error:', err);
        controller.abort();
        setError('The summary could not be generated. Please try again.');
        setLoading(false);
      },
    });
  }

  const sections = output ? splitSections(output) : [];

  return (
    <div className="mx-auto max-w-7xl px-5 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Consultation notes</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Paste the notes from a visit. You get a record summary, follow-up steps and a patient email.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-sm lg:sticky lg:top-24"
        >
          <div className="space-y-1.5">
            <label htmlFor="patient" className="block text-sm font-medium">
              Patient name
            </label>
            <input
              id="patient"
              type="text"
              required
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              className="field"
              placeholder="e.g. Jordan Ellis"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="date" className="block text-sm font-medium">
              Date of visit
            </label>
            <DatePicker
              id="date"
              selected={visitDate}
              onChange={(d: Date | null) => setVisitDate(d)}
              dateFormat="yyyy-MM-dd"
              placeholderText="Select date"
              required
              className="field"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="notes" className="block text-sm font-medium">
                Consultation notes
              </label>
              <button
                type="button"
                onClick={() => setNotes(SAMPLE_NOTE)}
                className="text-xs font-medium text-accent hover:underline"
              >
                Use a sample note
              </button>
            </div>
            <textarea
              id="notes"
              required
              rows={12}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field resize-y font-mono text-[13px]"
              placeholder="Shorthand is fine — presenting complaint, examination, plan…"
            />
            <p className="text-right text-xs text-muted">{notes.length} characters</p>
          </div>

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Generating…' : 'Generate summary'}
          </button>

          <p className="text-center text-xs leading-relaxed text-muted">
            Drafts are for clinician review. Nothing is sent to a patient automatically.
          </p>
        </form>

        {/* Output */}
        <section aria-live="polite" className="min-h-[24rem]">
          {!output && !loading && (
            <div className="flex h-full min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/60 px-8 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                  strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
                  <path d="M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Zm1 5h6M9 13h6" />
                </svg>
              </span>
              <p className="mt-4 font-medium">No summary yet</p>
              <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-muted">
                Fill in the visit details and the three sections will stream in here as they are written.
              </p>
            </div>
          )}

          {loading && !output && (
            <div className="space-y-4 rounded-2xl border border-line bg-surface p-6">
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Reading the notes…
              </p>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          )}

          {sections.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted">
                  {loading ? (
                    <>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                      Streaming…
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 rounded-full bg-accent" />
                      Draft ready for review
                    </>
                  )}
                </p>
                <CopyButton text={output} label="Copy all" />
              </div>

              {sections.map((section, i) => (
                <article key={i} className="rise overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                  {section.title && (
                    <header className="flex items-start justify-between gap-3 border-b border-line bg-surface-2 px-5 py-3">
                      <h2 className="text-sm font-semibold tracking-tight">{section.title}</h2>
                      <CopyButton text={`${section.title}\n\n${section.body}`.trim()} />
                    </header>
                  )}
                  <div className="markdown-content px-5 py-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {section.body}
                    </ReactMarkdown>
                    {loading && i === sections.length - 1 && <span className="stream-caret" />}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function Product() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Head>
        <title>Consultation notes · MediNotes Pro</title>
      </Head>
      <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
          <Logo />
          <UserButton showName={true} />
        </div>
      </header>

      <Protect
        plan="premium_subscription"
        fallback={
          <div className="mx-auto max-w-5xl px-5 py-16">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                Subscription required
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight">Healthcare professional plan</h1>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
                Unlimited consultation summaries, follow-up checklists and patient email drafts.
                Cancel any time.
              </p>
            </div>
            <div className="mt-12">
              <PricingTable />
            </div>
          </div>
        }
      >
        <ConsultationForm />
      </Protect>
    </div>
  );
}
