import type {
  AuditEntriesResponse,
  AuditEntry,
  AuditEntryUpdatePayload,
  NewAuditEntryPayload,
  SimilarEntriesResponse,
} from '../types/audit';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Thrown by `request()` on a non-2xx response. `.message` (inherited from Error) keeps the full
// technical detail — method, path, status, raw body — exactly what's useful in a console.error
// log. `.userMessage` is just the parsed response body's `.error` field (or a generic fallback
// when the body isn't the expected JSON shape), safe to render directly in a UI error banner.
// Keeping both on one error object means callers don't have to re-derive either half themselves.
export class ApiError extends Error {
  readonly status: number;
  readonly userMessage: string;

  constructor(technicalMessage: string, status: number, userMessage: string) {
    super(technicalMessage);
    this.name = 'ApiError';
    this.status = status;
    this.userMessage = userMessage;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const method = options?.method ?? 'GET';
    const body = await response.text().catch(() => '');
    let userMessage = `Request failed (${response.status})`;
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
        userMessage = (parsed as { error: string }).error;
      }
    } catch {
      // Body wasn't JSON (or was empty) — keep the generic fallback above.
    }
    throw new ApiError(`${method} ${path} failed (${response.status}): ${body}`, response.status, userMessage);
  }

  return response.json() as Promise<T>;
}

// No `since` = full initial load. `since` = delta poll (only rows updated after it).
export function fetchAuditEntries(since?: string): Promise<AuditEntriesResponse> {
  const params = since ? `?${new URLSearchParams({ since }).toString()}` : '';
  return request<AuditEntriesResponse>(`/audit-entries${params}`);
}

export function createAuditEntry(payload: NewAuditEntryPayload): Promise<AuditEntry> {
  return request<AuditEntry>('/audit-entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAuditEntry(
  id: number,
  payload: AuditEntryUpdatePayload,
): Promise<AuditEntry> {
  return request<AuditEntry>(`/audit-entries/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function fetchSimilarEntries(id: number): Promise<SimilarEntriesResponse> {
  return request<SimilarEntriesResponse>(`/audit-entries/${id}/similar`);
}
