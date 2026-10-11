import { useRef, useState } from 'react';
import { SAMPLE_CODE, SAMPLE_NAME } from '@/utils/sample';

type Props = {
  code: string;
  fileName: string;
  isAnalyzing: boolean;
  onCodeChange: (code: string, fileName: string) => void;
  onAnalyze: () => void;
};

const MAX_BYTES = 200_000; // the agent reads the whole file; huge inputs just time out

/**
 * Step 1: get Python in — drop a file, pick one, paste, or load the sample.
 */
export default function CodeInput({ code, fileName, isAnalyzing, onCodeChange, onAnalyze }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  function readFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.py')) {
      setNotice(`"${file.name}" isn't a Python file. Choose a file ending in .py.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setNotice(`"${file.name}" is ${(file.size / 1000).toFixed(0)} KB — keep it under 200 KB.`);
      return;
    }
    setNotice('');
    file.text().then((text) => onCodeChange(text, file.name));
  }

  const lines = code ? code.split('\n').length : 0;
  const ready = code.trim().length > 0;

  return (
    <section className="card flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">1 · Add your Python code</h2>
          <p className="text-xs text-muted">Drop a .py file, choose one, or paste below.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice('');
            onCodeChange(SAMPLE_CODE, SAMPLE_NAME);
          }}
          className="btn-ghost shrink-0"
        >
          Try a sample
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            readFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload a Python file"
          className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-surface-2'
          }`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0 text-sm">
            {fileName ? (
              <>
                <p className="truncate font-medium">{fileName}</p>
                <p className="text-xs text-muted">Click or drop to replace</p>
              </>
            ) : (
              <>
                <p className="font-medium">Drop a .py file here, or click to browse</p>
                <p className="text-xs text-muted">Up to 200 KB</p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".py"
            className="hidden"
            onChange={(e) => {
              readFile(e.target.files?.[0]);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
        </div>

        {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{notice}</p>}

        <label htmlFor="code-input" className="sr-only">
          Python code
        </label>
        <textarea
          id="code-input"
          value={code}
          onChange={(e) => onCodeChange(e.target.value, fileName || 'pasted_code.py')}
          spellCheck={false}
          placeholder={'# …or paste Python here\nimport os\nos.system(input())'}
          className="min-h-64 flex-1 resize-none rounded-xl border border-border bg-code p-4 font-mono text-[13px] leading-relaxed text-code-fg outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-primary/50"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {ready ? `${lines} lines · ${code.length.toLocaleString()} characters` : 'No code yet'}
          </span>
          <div className="flex gap-2">
            {ready && (
              <button type="button" className="btn-ghost" onClick={() => onCodeChange('', '')} disabled={isAnalyzing}>
                Clear
              </button>
            )}
            <button type="button" className="btn-primary" onClick={onAnalyze} disabled={!ready || isAnalyzing}>
              {isAnalyzing ? 'Scanning…' : '2 · Scan for vulnerabilities'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
