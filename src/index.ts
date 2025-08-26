/*
  gatus-snitcher GitHub Action (TypeScript)
  - Authors in TypeScript, compiled to dist/index.js
  - No external runtime dependencies
*/

import * as core from '@actions/core';

type Inputs = {
  mode: 'start' | 'report';
  timerId?: string;
  baseUrl: string;
  group: string;
  name: string;
  token: string;
  status: 'success' | 'error';
  duration?: string;
  errorMessage?: string;
  authHeader: string;
  authScheme?: string | null;
  endpointPath: string;
  endpointSuffix: string;
  timeoutMs: number;
  dryRun: boolean;
  extraHeadersRaw?: string;
};

function parseBoolean(s: string | undefined, def = false): boolean {
  if (s === undefined || s === '') {
    return def;
  }
  const v = String(s).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
}

function joinUrl(base: string, path?: string): string {
  if (!path) {
    return base;
  }
  const b = base.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

function parseExtraHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) {
    return headers;
  }
  // Try JSON first
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v === undefined || v === null) {
          continue;
        }
        headers[k] = String(v);
      }
      return headers;
    }
  } catch {
    // fallthrough to line parsing
  }
  // Parse newline-delimited Key: Value
  for (const line of trimmed.split(/\r?\n/)) {
    const ln = line.trim();
    if (!ln) {
      continue;
    }
    const idx = ln.indexOf(':');
    if (idx <= 0) {
      throw new Error(`Invalid header line: "${line}". Expected "Key: Value" or provide JSON object.`);
    }
    const key = ln.slice(0, idx).trim();
    const value = ln.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    headers[key] = value;
  }
  return headers;
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    redacted[k] = v ? 'REDACTED' : '';
  }
  return redacted;
}

function toKeySegment(s: string): string {
  // Replace spaces, '/', '_', ',', '.', '#' with '-'
  return s.replace(/[ \/_.,#]/g, '-');
}

async function main(): Promise<void> {
  const modeIn = (core.getInput('mode') || 'report').toLowerCase();
  const mode = (modeIn === 'start' ? 'start' : 'report') as Inputs['mode'];
  const baseUrl = core.getInput('base-url', { required: mode === 'report' });
  const group = core.getInput('group', { required: true });
  const name = core.getInput('name', { required: true });
  const token = core.getInput('token', { required: mode === 'report' });
  const statusRaw = (core.getInput('status') || 'success').toLowerCase();
  // Relaxed: treat only 'success' as success; anything else -> error (accepts failure/cancelled/skipped)
  const status = (statusRaw === 'success' ? 'success' : 'error') as Inputs['status'];

  const durationStr = core.getInput('duration') || undefined;
  const errorMessage = core.getInput('error-message') || undefined;
  const authHeader = core.getInput('auth-header') || 'Authorization';
  const authSchemeIn = core.getInput('auth-scheme'); // may be empty string
  const authScheme = authSchemeIn === '' ? null : authSchemeIn || 'Bearer';
  const endpointPath = core.getInput('endpoint-path') || '/api/v1/endpoints';
  const endpointSuffix = core.getInput('endpoint-suffix') || '/external';
  const timeoutMs = Number(core.getInput('timeout-ms') || '15000');
  const dryRun = parseBoolean(core.getInput('dry-run'));
  const extraHeadersRaw = core.getInput('extra-headers') || '';
  const timerIdInput = core.getInput('timer-id') || '';

  let extraHeaders: Record<string, string> = {};
  if (extraHeadersRaw) {
    try {
      extraHeaders = parseExtraHeaders(extraHeadersRaw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      core.setFailed(`Invalid extra-headers: ${msg}`);
      return;
    }
  }

  // Compute key as <GROUP>_<NAME> with replacements per Gatus docs
  const key = `${toKeySegment(group)}_${toKeySegment(name)}`;
  // Determine timer ID and associated env var name
  const timerId = timerIdInput || key;
  const timerVar = `GATUS_SNITCHER_START_${toKeySegment(timerId).replace(/-/g, '_').toUpperCase()}`;

  // If in start mode, record start time into job-scoped env and exit
  if (mode === 'start') {
    const now = Date.now();
    core.exportVariable(timerVar, String(now));
    core.setOutput('status', 'success');
    core.setOutput('endpoint', '');
    core.setOutput('http-status', 0);
    core.notice(`Timer started (${timerVar}) at ${now}`);
    return;
  }

  const endpoint = joinUrl(joinUrl(baseUrl, endpointPath), `${encodeURIComponent(key)}${endpointSuffix}`);

  // Build query parameters
  const url = new URL(endpoint);
  const successBool = status === 'success';
  url.searchParams.set('success', successBool ? 'true' : 'false');
  if (!successBool && errorMessage) {
    url.searchParams.set('error', errorMessage);
  }
  // Prefer explicit duration; otherwise compute from stored timer if available
  let finalDuration = durationStr;
  if (!finalDuration) {
    const startFromEnv = process.env[timerVar];
    if (startFromEnv) {
      const startMs = Number(startFromEnv);
      if (!Number.isNaN(startMs) && startMs > 0) {
        const ms = Date.now() - startMs;
        if (ms >= 0) {
          finalDuration = `${ms}ms`;
        }
      }
    }
  }
  if (finalDuration) {
    url.searchParams.set('duration', finalDuration);
  }

  const headers: Record<string, string> = {};
  headers[authHeader] = authScheme ? `${authScheme} ${token}` : token;
  // Merge extra headers (may override existing if explicitly provided)
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers[k] = v;
  }

  core.notice(`Reporting ${status} to ${url.toString()}`);
  if (dryRun) {
    console.log('Dry run enabled. Would send:');
    console.log('Headers (redacted):', redactHeaders(headers));
    console.log('Body:', '(empty)');
    core.setOutput('status', status);
    core.setOutput('endpoint', url.toString());
    core.setOutput('http-status', 0);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: '',
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(`Request failed: ${message}`);
    return;
  }
  clearTimeout(timer);

  const httpStatus = (res as Response).status;
  let text = '';
  try {
    text = await (res as Response).text();
  } catch {
    /* noop */
  }

  if (!(res as Response).ok) {
    if (text) {
      core.error(text);
    }
    core.setFailed(`Gatus responded with HTTP ${httpStatus}`);
    return;
  }

  core.setOutput('status', status);
  core.setOutput('endpoint', url.toString());
  core.setOutput('http-status', httpStatus);
  core.info('Report sent successfully.');
}

// Run
main().catch((e) => core.setFailed(`Unhandled error: ${e instanceof Error ? e.message : String(e)}`));
