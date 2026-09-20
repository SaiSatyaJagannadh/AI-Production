/**
 * Typed client for the FastAPI backend. Every call carries the Clerk JWT —
 * the server scopes all rows by the user id inside it, so there is never a
 * user id in a request body.
 */

export type ConsultationSummary = {
  id: number;
  patient_name: string;
  patient_email: string | null;
  date_of_visit: string;
  status: 'generating' | 'draft' | 'emailed';
  emailed_at: string | null;
  created_at: string;
  notes_preview: string;
};

export type AuditEntry = {
  action: string;
  detail: string | null;
  created_at: string;
};

export type Consultation = ConsultationSummary & {
  notes: string;
  summary: string;
  updated_at: string;
  audit: AuditEntry[];
};

export type Stats = {
  total: number;
  emailed: number;
  last_7_days: number;
  email_configured: boolean;
  /** Which SMTP settings the server is still waiting for, e.g. ["SMTP_PASSWORD"]. */
  email_missing?: string[];
};

type GetToken = () => Promise<string | null>;

async function request<T>(
  getToken: GetToken,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const jwt = await getToken();
  if (!jwt) throw new Error('Your session has expired — please sign in again.');

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || `Request failed (${response.status})`);
  }
  return response.json();
}

export const api = {
  list: (getToken: GetToken, query = '') =>
    request<{ consultations: ConsultationSummary[] }>(
      getToken,
      `/api/consultations?q=${encodeURIComponent(query)}`,
    ).then((r) => r.consultations),

  get: (getToken: GetToken, id: number) =>
    request<Consultation>(getToken, `/api/consultations/${id}`),

  save: (
    getToken: GetToken,
    id: number,
    body: { summary?: string; patient_email?: string; sent_externally?: boolean },
  ) =>
    request<{ status: string }>(getToken, `/api/consultations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (getToken: GetToken, id: number) =>
    request<{ status: string }>(getToken, `/api/consultations/${id}`, { method: 'DELETE' }),

  sendEmail: (
    getToken: GetToken,
    id: number,
    body: { to: string; subject?: string; body?: string },
  ) =>
    request<{ status: string; to: string; subject: string }>(
      getToken,
      `/api/consultations/${id}/email`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  stats: (getToken: GetToken) => request<Stats>(getToken, '/api/stats'),
};

/** The backend emits "### " headings; split them so each renders as its own card. */
export function splitSections(markdown: string): { title: string; body: string }[] {
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

/** The patient-facing section, used to prefill the email composer. */
export function patientEmailDraft(markdown: string): string {
  const section = splitSections(markdown).find((s) => s.title.toLowerCase().includes('email'));
  return section?.body.trim() ?? '';
}

/**
 * mailto: / Gmail links for sending from the clinician's own mail client —
 * the fallback when the server has no SMTP relay configured.
 */
export function composeLinks(to: string, subject: string, body: string) {
  const query = (sep: string) =>
    `${sep}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    mailto: `mailto:${encodeURIComponent(to)}?${query('').slice(1)}`,
    gmail:
      `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}` +
      `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
