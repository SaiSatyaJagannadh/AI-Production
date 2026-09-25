import { Briefcase, Code, Globe, Mail, MapPin } from 'lucide-react';
import Twin from '@/components/twin';

const NAME = 'DJ';
const FULL_NAME = 'Sai Satya Jagannadh Doddipatla';
const ROLE = 'Tech Engineer @ UBS — AI & Data Engineering';
const LOCATION = 'United States';

const SPECIALTIES = [
  'LLMs & RAG',
  'Data pipelines',
  'Azure',
  'Databricks',
  'PySpark',
  'MLflow',
  'Site reliability',
];

const LINKS = [
  { label: 'LinkedIn', href: 'https://linkedin.com/in/saijagannadh', icon: Briefcase },
  { label: 'GitHub', href: 'https://github.com/SaiSatyaJagannadh', icon: Code },
  {
    label: 'Portfolio',
    href: 'https://saisatyajagannadh.github.io/PersonalPortfolio/',
    icon: Globe,
  },
  { label: 'Email', href: 'mailto:saijagannadh99@gmail.com', icon: Mail },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:py-12">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
        {/* Who you are talking to */}
        <aside className="lg:sticky lg:top-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Open to SRE &amp; AI/data roles
          </span>

          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
            {FULL_NAME.split(' ').slice(0, 2).join(' ')}
            <br />
            {FULL_NAME.split(' ').slice(2).join(' ')}
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-muted">{ROLE}</p>

          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
            <MapPin className="h-3.5 w-3.5" />
            {LOCATION}
          </p>

          <p className="mt-5 text-[15px] leading-relaxed text-muted">
            Data &amp; AI engineer with 4+ years building production data pipelines and
            LLM-powered applications. The chat here is an AI twin trained on {NAME}&rsquo;s
            profile — ask it what you&rsquo;d ask him.
          </p>

          <ul className="mt-6 flex flex-wrap gap-1.5">
            {SPECIALTIES.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-muted"
              >
                {item}
              </li>
            ))}
          </ul>

          <ul className="mt-6 flex flex-wrap gap-2">
            {LINKS.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-accent hover:text-accent"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        {/* The twin */}
        <div className="h-[min(76vh,720px)] min-h-[520px]">
          <Twin name={NAME} />
        </div>
      </div>

      <footer className="mt-10 border-t border-line pt-6 text-center text-xs text-muted">
        Built with Next.js and FastAPI · replies come from an AI model and may be inaccurate
      </footer>
    </main>
  );
}
