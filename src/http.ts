const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  method?: string;
  body?: string;
}

async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const { headers = {}, timeoutMs = 30_000, retries = 1, method = "GET", body } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} für ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export async function fetchText(url: string, options?: FetchOptions): Promise<string> {
  const response = await request(url, options);
  return response.text();
}

export async function fetchArrayBuffer(url: string, options?: FetchOptions): Promise<ArrayBuffer> {
  const response = await request(url, options);
  return response.arrayBuffer();
}

export async function fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { Accept: "application/json", ...options?.headers },
  });
  return response.json() as Promise<T>;
}

/** POST application/x-www-form-urlencoded, gibt den Response-Body als Text zurück. */
export async function postForm(
  url: string,
  fields: Iterable<[string, string]>,
  options?: FetchOptions,
): Promise<string> {
  const body = new URLSearchParams([...fields]).toString();
  return fetchText(url, {
    ...options,
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...options?.headers },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Führt `fn` für alle Elemente mit begrenzter Parallelität aus. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
