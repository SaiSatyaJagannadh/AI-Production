'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, Copy, RefreshCw, User, WifiOff } from 'lucide-react';
import {
  checkHealth,
  fetchHistory,
  formatTime,
  sendChat,
  type ChatMessage,
} from './api';

const SESSION_KEY = 'twin.session-id';

const STARTERS = [
  'What are you working on right now?',
  'Walk me through your experience with LLMs and RAG.',
  'What kind of role are you looking for?',
  'What is your background in data engineering?',
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy this reply'}
      className="rounded-md p-1.5 text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function Twin({ name = 'DJ' }: { name?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [restoring, setRestoring] = useState(true);

  const threadRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pinnedToBottom = useRef(true);

  // Restore the previous conversation, and find out whether the API is up at all.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      let saved = '';
      try {
        saved = localStorage.getItem(SESSION_KEY) ?? '';
      } catch {
        /* private mode — carry on without persistence */
      }

      try {
        await checkHealth();
        if (!cancelled) setOffline(false);
      } catch {
        if (!cancelled) {
          setOffline(true);
          setRestoring(false);
        }
        return;
      }

      if (saved) {
        setSessionId(saved);
        try {
          const history = await fetchHistory(saved);
          if (!cancelled) {
            setMessages(
              history.messages.map((message, index) => ({
                id: `${saved}-${index}`,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
              })),
            );
          }
        } catch {
          /* the session expired or the memory file is gone — start fresh */
        }
      }
      if (!cancelled) setRestoring(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Only auto-scroll when the reader is already at the bottom, so scrolling back
  // through the conversation is not yanked away by a new message.
  useEffect(() => {
    if (pinnedToBottom.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, isLoading]);

  function onThreadScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    const distance = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    pinnedToBottom.current = distance < 80;
  }

  function growTextarea() {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError('');
      setInput('');
      requestAnimationFrame(growTextarea);
      pinnedToBottom.current = true;

      const outgoing: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      setMessages((current) => [...current, outgoing]);
      setIsLoading(true);

      try {
        const result = await sendChat(trimmed, sessionId);
        setOffline(false);

        if (!sessionId) {
          setSessionId(result.session_id);
          try {
            localStorage.setItem(SESSION_KEY, result.session_id);
          } catch {
            /* nothing to do — the chat still works for this page view */
          }
        }

        setMessages((current) => [
          ...current,
          {
            id: `reply-${Date.now()}`,
            role: 'assistant',
            content: result.response,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        // Keep the user's message in the thread and offer a retry, rather than
        // faking a reply from the twin saying something went wrong.
        setError(
          err instanceof Error
            ? err.message
            : 'Could not reach the twin. Check that the backend is running.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, sessionId],
  );

  function startOver() {
    setMessages([]);
    setSessionId('');
    setError('');
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    textareaRef.current?.focus();
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white">
            <Bot className="h-4.5 w-4.5" />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
                offline ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{name}&rsquo;s digital twin</h2>
            <p className="text-xs text-muted">
              {offline ? 'Backend unreachable' : 'Ask about experience, projects or availability'}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={startOver}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            New chat
          </button>
        )}
      </header>

      {offline && (
        <p className="flex items-start gap-2 border-b border-line bg-amber-50 px-5 py-2.5 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The twin&rsquo;s API isn&rsquo;t responding. Start it with{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10">
              uv run uvicorn server:app --reload
            </code>{' '}
            in <code className="text-xs">twin/backend</code>.
          </span>
        </p>
      )}

      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="thread flex-1 space-y-5 overflow-y-auto px-5 py-6"
        aria-live="polite"
        aria-busy={isLoading}
      >
        {restoring ? (
          <p className="text-center text-sm text-muted">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="mx-auto max-w-md py-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Bot className="h-6 w-6" />
            </span>
            <p className="mt-4 text-[15px] font-medium">Hi — I&rsquo;m {name}&rsquo;s digital twin.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              I can talk through {name}&rsquo;s background, projects and the kind of work
              he&rsquo;s looking for. Ask me anything.
            </p>
            <div className="mt-6 grid gap-2 text-left">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => send(starter)}
                  disabled={offline}
                  className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.role === 'user';
            return (
              <div
                key={message.id}
                className={`rise group flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    mine ? 'bg-surface-2 text-muted' : 'bg-accent text-white'
                  }`}
                >
                  {mine ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </span>

                <div className={`flex max-w-[78%] flex-col gap-1 ${mine ? 'items-end' : ''}`}>
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                      mine
                        ? 'rounded-tr-sm bg-accent text-white'
                        : 'rounded-tl-sm border border-line bg-surface-2'
                    }`}
                  >
                    {message.content}
                  </div>
                  <div className="flex items-center gap-1 px-1">
                    <span className="text-[11px] text-muted">{formatTime(message.timestamp)}</span>
                    {!mine && <CopyButton text={message.content} />}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-line bg-surface-2 px-4 py-3.5">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <p>{error}</p>
            {lastUserMessage && (
              <button
                type="button"
                onClick={() => send(lastUserMessage.content)}
                className="mt-2 font-medium underline underline-offset-2"
              >
                Try again
              </button>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 p-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-[color:var(--ring)]"
        >
          <label htmlFor="twin-input" className="sr-only">
            Message the digital twin
          </label>
          <textarea
            id="twin-input"
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              growTextarea();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={offline ? 'Start the backend to chat…' : `Message ${name}'s twin…`}
            disabled={isLoading || offline}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || offline}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-2 px-1 text-center text-[11px] text-muted">
          An AI twin — it can get things wrong. Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}
