import Head from 'next/head';
import Link from 'next/link';
import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
          <path d="M4 13h3l2 5 4-12 2 7h5" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">MediNotes Pro</span>
    </Link>
  );
}

const features = [
  {
    title: 'Structured visit summary',
    body: 'Free-text notes become a clean record entry — history, findings, assessment — in the order a chart expects.',
    icon: (
      <path d="M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Zm1 5h6M9 13h6" />
    ),
  },
  {
    title: 'Next steps you can action',
    body: 'Follow-ups, referrals, labs and medication changes pulled out as a checklist, so nothing is left in the prose.',
    icon: <path d="M4 7h10M4 12h10M4 17h6m4.5 1.5 2 2 4-4.5" />,
  },
  {
    title: 'Patient-ready email draft',
    body: 'The same visit rewritten at a reading level patients actually use — copy it straight into your mail client.',
    icon: <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 .5 9 6 9-6" />,
  },
];

const steps = [
  { n: '01', title: 'Paste your notes', body: 'Shorthand, abbreviations, half sentences. Whatever you typed during the visit.' },
  { n: '02', title: 'Watch it stream', body: 'The three sections arrive live, token by token — no spinner, no waiting for a full response.' },
  { n: '03', title: 'Copy and move on', body: 'Each section copies on its own, so the chart entry and the patient email go where they belong.' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Head>
        <title>MediNotes Pro — AI consultation summaries</title>
      </Head>
      <header className="sticky top-0 z-30 border-b border-line bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#trust" className="transition-colors hover:text-foreground">Safeguards</a>
          </nav>
          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground">
                  Sign in
                </button>
              </SignInButton>
              <SignInButton mode="modal">
                <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong">
                  Get started
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <Link
                href="/product"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong"
              >
                Open app
              </Link>
              <UserButton />
            </SignedIn>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-12 md:pt-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
            <div className="rise">
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Built for post-visit documentation
              </span>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight md:text-[3.4rem]">
                Finish your notes
                <br />
                before the next patient.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                MediNotes Pro turns the shorthand you type during a consultation into a record
                summary, a follow-up checklist and a patient-friendly email — in one pass, streamed
                as it is written.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="rounded-xl bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong">
                      Start free trial
                    </button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <Link
                    href="/product"
                    className="rounded-xl bg-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong"
                  >
                    Open consultation assistant
                  </Link>
                </SignedIn>
                <a
                  href="#how"
                  className="rounded-xl border border-line bg-surface px-6 py-3.5 text-[15px] font-semibold transition-colors hover:bg-surface-2"
                >
                  See how it works
                </a>
              </div>
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-8">
                {[
                  ['~20s', 'per consultation'],
                  ['3', 'outputs per note'],
                  ['0', 'notes stored'],
                ].map(([stat, label]) => (
                  <div key={label}>
                    <dt className="text-2xl font-semibold tracking-tight">{stat}</dt>
                    <dd className="mt-1 text-sm text-muted">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Product preview */}
            <div className="rise rounded-2xl border border-line bg-surface p-2 shadow-xl shadow-black/5">
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="h-2.5 w-2.5 rounded-full bg-line" />
                <span className="ml-3 text-xs text-muted">Consultation · 14 Sep</span>
              </div>
              <div className="rounded-xl bg-surface-2 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Your notes</p>
                <p className="mt-2 font-mono text-[13px] leading-relaxed text-foreground/80">
                  55M, 3/7 cough, no fever. Ex-smoker. Chest clear, sats 97%. BP 148/92 — repeat
                  in 2/52. Rx amox 500 tds 5/7. Safety-net advice given.
                </p>
                <div className="my-4 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />
                  generated
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div className="space-y-2.5">
                  {[
                    ['Summary of visit', 'Three-day productive cough in a 55-year-old ex-smoker. Chest clear on auscultation…'],
                    ['Next steps', 'Repeat BP in two weeks · Review if symptoms persist beyond five days'],
                    ['Email to patient', 'Thanks for coming in today. Your chest sounded clear, and the antibiotics…'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-lg border border-line bg-surface p-3">
                      <p className="text-[13px] font-semibold">{title}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
            One paste in. Three finished pieces of work out.
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 transition-shadow hover:shadow-lg hover:shadow-black/5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                    strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                    {f.icon}
                  </svg>
                </span>
                <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n}>
                  <span className="font-mono text-sm text-accent">{s.n}</span>
                  <h3 className="mt-3 text-[17px] font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Safeguards */}
        <section id="trust" className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 rounded-2xl border border-line bg-surface p-8 md:grid-cols-2 md:p-12">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Safeguards</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">
                A summary is a draft, not a decision. Every output is written for a clinician to
                read, edit and sign off before it reaches a chart or a patient.
              </p>
            </div>
            <ul className="space-y-4">
              {[
                'Every request is authenticated — notes never reach the model without a valid session.',
                'Notes are processed in the request and are not written to any database by this app.',
                'Output is always clinician-reviewed: nothing is sent to a patient automatically.',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-muted">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                    className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="rounded-2xl bg-accent px-8 py-14 text-center text-white md:px-16">
            <h2 className="text-3xl font-semibold tracking-tight">Clear your documentation backlog</h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
              Set up takes a minute. Bring one real consultation note and see what comes back.
            </p>
            <div className="mt-8">
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold text-accent-strong transition-transform hover:scale-[1.02]">
                    Start free trial
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/product"
                  className="inline-block rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold text-accent-strong transition-transform hover:scale-[1.02]"
                >
                  Open consultation assistant
                </Link>
              </SignedIn>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <Logo />
          <p>A course demonstration project — not a medical device, and not for clinical use.</p>
        </div>
      </footer>
    </div>
  );
}
