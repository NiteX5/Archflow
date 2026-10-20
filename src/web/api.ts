import type { ApiError, AppState } from '../core/api.js';

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError & Record<string, unknown>,
  ) {
    super(body.message);
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new RequestError(res.status, { error: 'invalid-response', message: `Unexpected response (${res.status})` });
  }
  if (!res.ok) throw new RequestError(res.status, data as ApiError);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  state: () => request<AppState>('GET', '/api/state'),
  openRepo: (path: string) => request<AppState>('POST', '/api/repo', { path }),
};

/** Subscribes to state pushes. Reconnects automatically (EventSource behaviour). */
export function subscribeState(onState: (s: AppState) => void, onConnection: (ok: boolean) => void): () => void {
  const source = new EventSource('/api/events');
  source.addEventListener('state', (e) => onState(JSON.parse((e as MessageEvent<string>).data) as AppState));
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);
  return () => source.close();
}

/** Triggers a browser download of in-memory content. */
export function download(fileName: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
