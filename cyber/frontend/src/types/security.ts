/**
 * Type definitions for security analysis components
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

// Mirrors SecurityIssue / SecurityReport in backend/server.py
export interface SecurityIssue {
  title: string;
  description: string;
  code: string;
  fix: string;
  cvss_score: number;
  severity: Severity;
}

export interface AnalysisResponse {
  summary: string;
  issues: SecurityIssue[];
}

export type ScannerStatus = 'checking' | 'online' | 'wrong-server' | 'offline';
