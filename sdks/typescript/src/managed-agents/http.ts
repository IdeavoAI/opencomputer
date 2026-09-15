// The HTTP layer of the management client: the API key header, JSON both
// ways, the error envelope, `Idempotency-Key`, and nothing else. Web
// standards only (fetch, URL, Headers), so the same code runs on Node,
// Workers, Deno and browsers-with-a-proxy. No retries: the API's idempotency
// keys make a caller's retry safe, and the caller knows which calls to
// repeat; a client that retried on its own would hide that decision.
//
// No redirects either. The key is sent to the configured origin and nowhere
// else: fetch runs with `redirect: "manual"`, and a 3xx answer is an error
// with code `redirected`, because following it would carry the key to
// whatever origin the response names.

import { errorFromResponse, OpenComputerError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://app.opencomputer.dev/api/managed-agents";

export interface HttpOptions {
  /** Base URL of the management API. Default `https://app.opencomputer.dev/api/managed-agents`. */
  baseUrl?: string;
  /** The fetch to use. Default: the global. */
  fetch?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** A response with its status kept, for callers that branch on 200 versus 201. */
export interface Answer<T> {
  status: number;
  body: T;
  headers: Headers;
}

export class Http {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly doFetch: typeof fetch;

  constructor(apiKey: string, options: HttpOptions = {}) {
    if (!apiKey) throw new Error("An OpenComputer API key is required.");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const f = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);
    if (!f) throw new Error("No global fetch is available; pass { fetch } to the client.");
    this.doFetch = f;
  }

  url(path: string, query?: Query): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Sends a request and returns the parsed body with the status; throws `OpenComputerError` on a failed status. */
  async send<T>(method: string, path: string, options: RequestOptions = {}): Promise<Answer<T>> {
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      accept: "application/json",
      ...options.headers,
    };
    const init: RequestInit = { method, headers, signal: options.signal, redirect: "manual" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await this.doFetch(this.url(path, options.query), init);
    if (isRedirect(response)) {
      throw new OpenComputerError(
        response.status,
        "redirected",
        `${method} ${path} was answered with a redirect (${String(response.status)}); ` +
          "the client does not follow redirects with the API key. Check baseUrl.",
      );
    }
    const body = await readJson(response);
    if (!response.ok) throw errorFromResponse(response.status, body, response.headers);
    return { status: response.status, body: body as T, headers: response.headers };
  }

  /** `send` for callers that need only the body. */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.send<T>(method, path, options)).body;
  }
}

/**
 * A redirect as fetch reports it under `redirect: "manual"`: the 3xx answer
 * itself, or on browsers an opaque response of type `opaqueredirect` whose
 * status reads 0.
 */
function isRedirect(response: Response): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

/** URL-encodes one path segment. */
export const segment = (value: string): string => encodeURIComponent(value);
