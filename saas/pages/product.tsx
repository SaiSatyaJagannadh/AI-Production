"use client"

import { useCallback, useEffect, useState, FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useAuth, Protect, PricingTable, UserButton } from '@clerk/nextjs';
import DatePicker from 'react-datepicker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {
  api,
  formatDate,
  patientEmailDraft,
  splitSections,
  type Consultation,
  type ConsultationSummary,
  type Stats,
} from '../lib/api';

const SAMPLE_NOTE = `55M, 3/7 productive cough, no fever. Ex-smoker, 20 pack years.
O/E chest clear, sats 97% RA, BP 148/92.
Rx amoxicillin 500mg tds 5/7. Repeat BP in 2/52, safety-net advice given.`;

/* ------------------------------------------------------------------ shared */

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
    <button type="button" onClick={copy} className="btn-ghost shrink-0">
      {copied ? 'Copied' : label}
    </button>
  );
}

function StatusBadge({ status }: { status: ConsultationSummary['status'] }) {
  const styles: Record<string, string> = {
    generating: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    draft: 'border-line bg-surface-2 text-muted',
    emailed: 'border-accent/40 bg-accent-soft text-accent',
  };
  const labels: Record<string, string> = {
    generating: 'Interrupted',
    draft: 'Draft',
    emailed: 'Emailed',
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status] ?? status}
    </span>
  );
}

function Alert({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
      : 'border-accent/40 bg-accent-soft text-accent';
  return <p className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</p>;
}

/** The generated markdown, one card per "### " heading, each separately copyable. */
function SectionCards({ markdown, streaming }: { markdown: string; streaming?: boolean }) {
  const sections = splitSections(markdown);
  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const isRedFlags = /red flag|safety net/i.test(section.title);
        return (
          <article
            key={i}
            className={`rise overflow-hidden rounded-2xl border bg-surface shadow-sm ${
              isRedFlags ? 'border-amber-300 dark:border-amber-900/70' : 'border-line'
            }`}
          >
            {section.title && (
              <header
                className={`flex items-start justify-between gap-3 border-b px-5 py-3 ${
                  isRedFlags
                    ? 'border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/30'
                    : 'border-line bg-surface-2'
                }`}
              >
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  {isRedFlags && <span aria-hidden="true">⚠️</span>}
                  {section.title}
                </h3>
                <CopyButton text={`${section.title}\n\n${section.body}`.trim()} />
              </header>
            )}
            <div className="markdown-content px-5 py-4">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{section.body}</ReactMarkdown>
              {streaming && i === sections.length - 1 && <span className="stream-caret" />}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- email composer */

function EmailComposer({
  consultationId,
  summary,
  defaultTo,
  dateOfVisit,
  emailConfigured,
  onSent,
}: {
  consultationId: number;
  summary: string;
  defaultTo: string;
  dateOfVisit: string;
  emailConfigured: boolean;
  onSent: () => void;
}) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`Your visit summary — ${dateOfVisit}`);
  const [body, setBody] = useState(() => patientEmailDraft(summary));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  // Re-prefill when the clinician edits the draft behind this panel (the
  // documented "adjust state during render" pattern, not an effect).
  const [syncedFrom, setSyncedFrom] = useState(summary);
  if (summary !== syncedFrom) {
    setSyncedFrom(summary);
    setBody(patientEmailDraft(summary));
  }

  async function send() {
    setSending(true);
    setError('');
    try {
      const result = await api.sendEmail(getToken, consultationId, { to, subject, body });
      setSent(result.to);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The email could not be sent.');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-accent/40 bg-accent-soft p-5">
        <p className="flex items-center gap-2 font-medium text-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
            <path d="m5 13 4 4L19 7" />
          </svg>
          Email sent to {sent}
        </p>
        <p className="mt-1.5 text-sm text-muted">
          The consultation is marked as emailed and the send is recorded in its audit trail.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 .5 9 6 9-6" />
        </svg>
        Email this to the patient
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold tracking-tight">Send to patient</h3>
          <p className="mt-1 text-sm text-muted">
            Read it through — this goes to the patient as soon as you press send.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Cancel
        </button>
      </div>

      {!emailConfigured && (
        <Alert kind="error">
          SMTP is not configured on the server, so sending will fail. Set SMTP_HOST, SMTP_FROM and
          credentials in the environment.
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`to-${consultationId}`} className="block text-sm font-medium">
          Patient email
        </label>
        <input
          id={`to-${consultationId}`}
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="field"
          placeholder="patient@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`subject-${consultationId}`} className="block text-sm font-medium">
          Subject
        </label>
        <input
          id={`subject-${consultationId}`}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="field"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`body-${consultationId}`} className="block text-sm font-medium">
          Message
        </label>
        <textarea
          id={`body-${consultationId}`}
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="field resize-y text-[13px]"
        />
        <p className="text-xs text-muted">
          A signature and a &ldquo;contact the practice if symptoms worsen&rdquo; footer are added
          automatically.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <button
        type="button"
        onClick={send}
        disabled={sending || !to.trim() || !body.trim()}
        className="btn-primary w-full justify-center"
      >
        {sending ? 'Sending…' : 'Send email now'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ draft actions */

function DraftActions({
  consultationId,
  summary,
  onSummaryChange,
  patientEmail,
  dateOfVisit,
  emailConfigured,
  onChanged,
}: {
  consultationId: number;
  summary: string;
  onSummaryChange: (value: string) => void;
  patientEmail: string;
  dateOfVisit: string;
  emailConfigured: boolean;
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.save(getToken, consultationId, { summary: draft });
      onSummaryChange(draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your edits.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="button" onClick={save} disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(summary);
                setEditing(false);
              }}
              className="btn-ghost"
            >
              Discard
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(summary);
                setEditing(true);
              }}
              className="btn-ghost"
            >
              Edit draft
            </button>
            <CopyButton text={summary} label="Copy all" />
            {saved && <span className="text-sm text-accent">Saved</span>}
          </>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={24}
          className="field resize-y font-mono text-[13px]"
          aria-label="Edit the generated draft"
        />
      ) : (
        <SectionCards markdown={summary} />
      )}

      {!editing && (
        <EmailComposer
          consultationId={consultationId}
          summary={summary}
          defaultTo={patientEmail}
          dateOfVisit={dateOfVisit}
          emailConfigured={emailConfigured}
          onSent={onChanged}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- new visit */

function NewConsultation({
  emailConfigured,
  onSaved,
}: {
  emailConfigured: boolean;
  onSaved: () => void;
}) {
  const { getToken } = useAuth();

  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [visitDate, setVisitDate] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState('');

  const [output, setOutput] = useState('');
  const [consultationId, setConsultationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const dateString = visitDate?.toISOString().slice(0, 10) ?? '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setOutput('');
    setConsultationId(null);
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

    await fetchEventSource('/api/consultation', {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        patient_name: patientName,
        patient_email: patientEmail || null,
        date_of_visit: dateString,
        notes,
      }),
      onmessage(ev) {
        // "meta"/"done" carry the saved row id; only default events are markdown.
        if (ev.event === 'meta' || ev.event === 'done') {
          try {
            setConsultationId(JSON.parse(ev.data).id);
          } catch {
            /* ignore a malformed control frame */
          }
          return;
        }
        buffer += ev.data;
        setOutput(buffer);
      },
      onclose() {
        setLoading(false);
        onSaved();
      },
      onerror(err) {
        console.error('SSE error:', err);
        controller.abort();
        setError('The summary could not be generated. Please try again.');
        setLoading(false);
      },
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start">
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

        <div className="grid gap-4 sm:grid-cols-2">
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
            <label htmlFor="email" className="block text-sm font-medium">
              Patient email <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="email"
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              className="field"
              placeholder="patient@example.com"
            />
          </div>
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

        {error && <Alert kind="error">{error}</Alert>}

        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
          {loading ? 'Generating…' : 'Generate summary'}
        </button>

        <p className="text-center text-xs leading-relaxed text-muted">
          Drafts are saved to your history for review. Nothing is sent to a patient until you press
          send.
        </p>
      </form>

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
              Fill in the visit details and the sections will stream in here as they are written.
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
              <div key={i} className="h-3 animate-pulse rounded bg-surface-2"
                style={{ width: `${90 - i * 12}%` }} />
            ))}
          </div>
        )}

        {output && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className={`h-2 w-2 rounded-full bg-accent ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Streaming…' : 'Draft ready for review'}
            </p>

            {loading || consultationId === null ? (
              <SectionCards markdown={output} streaming={loading} />
            ) : (
              <DraftActions
                consultationId={consultationId}
                summary={output}
                onSummaryChange={setOutput}
                patientEmail={patientEmail}
                dateOfVisit={dateString}
                emailConfigured={emailConfigured}
                onChanged={onSaved}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ history */

function ConsultationDetail({
  id,
  emailConfigured,
  onBack,
  onChanged,
}: {
  id: number;
  emailConfigured: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const [record, setRecord] = useState<Consultation | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .get(getToken, id)
      .then((result) => {
        if (!cancelled) {
          setRecord(result);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load this consultation.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, id, version]);

  async function remove() {
    try {
      await api.remove(getToken, id);
      onChanged();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this consultation.');
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!record) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="btn-ghost">
          ← Back to history
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-muted">Delete permanently?</span>
            <button type="button" onClick={remove}
              className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40">
              Yes, delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost">
            Delete
          </button>
        )}
      </div>

      <header className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{record.patient_name}</h2>
            <p className="mt-1 text-sm text-muted">
              Visit {record.date_of_visit} · created {formatDate(record.created_at)}
              {record.patient_email ? ` · ${record.patient_email}` : ''}
            </p>
          </div>
          <StatusBadge status={record.status} />
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-accent">
            Original notes
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-4 font-mono text-[13px] leading-relaxed">
            {record.notes}
          </pre>
        </details>
      </header>

      {record.summary ? (
        <DraftActions
          consultationId={record.id}
          summary={record.summary}
          onSummaryChange={(summary) => setRecord({ ...record, summary })}
          patientEmail={record.patient_email ?? ''}
          dateOfVisit={record.date_of_visit}
          emailConfigured={emailConfigured}
          onChanged={() => {
            reload();
            onChanged();
          }}
        />
      ) : (
        <Alert kind="error">
          This consultation has no saved draft — the generation was interrupted before it finished.
        </Alert>
      )}

      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h3 className="text-sm font-semibold tracking-tight">Audit trail</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          {record.audit.map((entry, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium text-foreground">{entry.action.replace('_', ' ')}</span>
              {entry.detail && <span>· {entry.detail}</span>}
              <span>· {new Date(entry.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function History({
  emailConfigured,
  refreshKey,
  onChanged,
}: {
  emailConfigured: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<ConsultationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rows = await api.list(getToken, query);
        if (!cancelled) {
          setItems(rows);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [getToken, query, refreshKey]);

  if (selected !== null) {
    return (
      <ConsultationDetail
        id={selected}
        emailConfigured={emailConfigured}
        onBack={() => setSelected(null)}
        onChanged={onChanged}
      />
    );
  }

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="field max-w-sm"
        placeholder="Search by patient name…"
        aria-label="Search consultations by patient name"
      />

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/60 px-8 py-16 text-center">
          <p className="font-medium">{query ? 'No matching consultations' : 'No consultations yet'}</p>
          <p className="mt-1.5 text-[15px] text-muted">
            {query
              ? 'Try a different patient name.'
              : 'Generate a summary and it will be saved here automatically.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--border)] overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item.id)}
                className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.patient_name}</p>
                  <p className="mt-0.5 truncate text-sm text-muted">{item.notes_preview}</p>
                  <p className="mt-1 text-xs text-muted">
                    Visit {item.date_of_visit} · saved {formatDate(item.created_at)}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- workspace */

function Workspace() {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    api.stats(getToken).then(setStats).catch(() => setStats(null));
  }, [getToken, refreshKey]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Consultation notes</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Paste the notes from a visit. You get a record summary, follow-up steps, red flags and a
            patient email — saved to your history.
          </p>
        </div>
        {stats && (
          <dl className="flex gap-6">
            {[
              ['Consultations', stats.total],
              ['Last 7 days', stats.last_7_days],
              ['Emailed', stats.emailed],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-xl font-semibold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="mb-6 flex gap-1 rounded-xl border border-line bg-surface p-1 sm:w-fit">
        {(['new', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${
              tab === value ? 'bg-accent text-white shadow-sm' : 'text-muted hover:text-foreground'
            }`}
          >
            {value === 'new' ? 'New consultation' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'new' ? (
        <NewConsultation
          emailConfigured={stats?.email_configured ?? false}
          onSaved={refresh}
        />
      ) : (
        <History
          emailConfigured={stats?.email_configured ?? false}
          refreshKey={refreshKey}
          onChanged={refresh}
        />
      )}
    </div>
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
                Unlimited consultation summaries, follow-up checklists, red-flag review and patient
                email drafts. Cancel any time.
              </p>
            </div>
            <div className="mt-12">
              <PricingTable />
            </div>
          </div>
        }
      >
        <Workspace />
      </Protect>
    </div>
  );
}
