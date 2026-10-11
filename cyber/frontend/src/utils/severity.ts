import { Severity, SEVERITIES } from '@/types/security';

type Meta = {
  label: string;
  range: string; // CVSS band
  meaning: string;
  badge: string; // pill classes
  bar: string; // solid fill
  ring: string; // card accent border
};

export const SEVERITY: Record<Severity, Meta> = {
  critical: {
    label: 'Critical',
    range: '9.0–10',
    meaning: 'Easy to exploit, serious damage. Fix before shipping.',
    badge: 'bg-red-100 text-red-800 ring-red-200',
    bar: 'bg-red-600',
    ring: 'border-l-red-600',
  },
  high: {
    label: 'High',
    range: '7.0–8.9',
    meaning: 'Likely exploitable. Fix before deploying.',
    badge: 'bg-orange-100 text-orange-800 ring-orange-200',
    bar: 'bg-orange-500',
    ring: 'border-l-orange-500',
  },
  medium: {
    label: 'Medium',
    range: '4.0–6.9',
    meaning: 'Needs specific conditions. Plan a fix soon.',
    badge: 'bg-amber-100 text-amber-800 ring-amber-200',
    bar: 'bg-amber-400',
    ring: 'border-l-amber-400',
  },
  low: {
    label: 'Low',
    range: '0.1–3.9',
    meaning: 'Hardening advice, little direct risk.',
    badge: 'bg-sky-100 text-sky-800 ring-sky-200',
    bar: 'bg-sky-500',
    ring: 'border-l-sky-500',
  },
};

// The model's label and its CVSS score sometimes disagree (e.g. "high" at 9.0), and
// it occasionally answers "High" or "moderate". The score wins, using the standard
// CVSS bands shown on the tiles; the label is only a fallback when there is no score.
export function normalizeSeverity(value: string, cvss: number): Severity {
  if (!(cvss > 0)) {
    const v = value?.toLowerCase().trim();
    if ((SEVERITIES as readonly string[]).includes(v)) return v as Severity;
    return v === 'moderate' ? 'medium' : 'low';
  }
  if (cvss >= 9) return 'critical';
  if (cvss >= 7) return 'high';
  if (cvss >= 4) return 'medium';
  return 'low';
}

export const VERDICT: Record<Severity | 'none', { title: string; advice: string; tone: string }> = {
  critical: {
    title: 'Critical risk',
    advice: 'Do not ship this code until the critical issues are fixed.',
    tone: 'from-red-600 to-red-700',
  },
  high: {
    title: 'High risk',
    advice: 'Fix the high-severity issues before deploying.',
    tone: 'from-orange-500 to-orange-600',
  },
  medium: {
    title: 'Moderate risk',
    advice: 'No emergencies, but these are worth fixing soon.',
    tone: 'from-amber-500 to-amber-600',
  },
  low: {
    title: 'Low risk',
    advice: 'Only minor hardening suggestions.',
    tone: 'from-sky-500 to-sky-600',
  },
  none: {
    title: 'No issues found',
    advice: 'Neither Semgrep nor the AI reviewer flagged anything.',
    tone: 'from-emerald-500 to-emerald-600',
  },
};
