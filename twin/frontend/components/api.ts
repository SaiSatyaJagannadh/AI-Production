/**
 * Client for the twin FastAPI backend.
 *
 * The base URL is NEXT_PUBLIC_API_URL, read at build time — it was previously
 * hardcoded to localhost:8000, which works in development and breaks the moment
 * the frontend is deployed anywhere.
 *
 * Kept in components/ rather than lib/ on purpose: the repo's root .gitignore
 * has a Python `lib/` rule that would swallow the file.
 */

/**
 * Set NEXT_PUBLIC_API_URL to the API Gateway *base* (the "Invoke URL"), e.g.
 *   https://abc123xyz.execute-api.us-east-1.amazonaws.com
 * The /chat and /conversation paths are appended below. Pasting a URL that
 * already ends in /chat is tolerated, because that is the form week2/day2.md
 * shows and it would otherwise silently request /chat/chat.
 *
 * This is inlined at BUILD time, not read at runtime — after changing it you
 * must `npm run build` again and re-upload, or the old URL stays baked in.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat$/, '');

export type Role = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
};

type ChatResponse = { response: string; session_id: string };
type HistoryResponse = {
  session_id: string;
  messages: { role: Role; content: string; timestamp: string }[];
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail || `The twin returned ${response.status}.`);
  }
  return response.json();
}

export function sendChat(message: string, sessionId?: string) {
  return json<ChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId || undefined }),
  });
}

export function fetchHistory(sessionId: string) {
  return json<HistoryResponse>(`/conversation/${encodeURIComponent(sessionId)}`);
}

export function checkHealth() {
  return json<{ status: string }>('/health');
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
