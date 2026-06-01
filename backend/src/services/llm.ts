import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY environment variable is required');
}

const DEEPSEEK_API_KEY  = process.env.DEEPSEEK_API_KEY!;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

export const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface DeepSeekChoice {
  message: {
    content: string | null;
  };
  finish_reason: 'stop' | 'length' | 'content_filter' | string | null;
}

interface DeepSeekResponse {
  choices: DeepSeekChoice[];
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// DeepSeek Flash supports 2500 concurrent requests — match it so the pipeline
// runs at full speed instead of being artificially throttled.

class RateLimiter {
  private queue: Array<() => void> = [];
  private timestamps: number[] = [];
  private readonly maxPerMinute: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.process();
    });
  }

  private process(): void {
    if (this.queue.length === 0) return;

    const now = Date.now();
    const windowStart = now - 60_000;
    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length < this.maxPerMinute) {
      const resolve = this.queue.shift()!;
      this.timestamps.push(Date.now());
      resolve();
      if (this.queue.length > 0) {
        setImmediate(() => this.process());
      }
    } else {
      const waitMs = this.timestamps[0] - windowStart + 1;
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.process();
        }, waitMs);
      }
    }
  }
}

const rateLimiter = new RateLimiter(2500);

// ── Timeout helper ────────────────────────────────────────────────────────────

const CHAT_TIMEOUT_MS = 120_000; // 2 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DeepSeek request timed out after ${ms}ms (${label})`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Core HTTP client ──────────────────────────────────────────────────────────

/**
 * Low-level HTTP call to DeepSeek's chat completions endpoint.
 * Use chat() for all standard calls — it adds rate limiting, retry, and
 * automatic token-doubling on truncation.
 */
export async function createCompletion(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}): Promise<DeepSeekResponse> {
  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model:       params.model,
      messages:    params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens:  params.max_tokens  ?? 4096,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<DeepSeekResponse>;
}

// ── High-level chat helper ────────────────────────────────────────────────────

const MAX_TOKENS_CAP   = 8192; // never exceed DeepSeek Flash's output limit
const MAX_ATTEMPTS     = 4;    // up to 3 token-doubling retries + 1 empty retry

/**
 * Send a chat completion request to DeepSeek V4 Flash and return the text content.
 *
 * Automatic retry strategy:
 *   - finish_reason=length (truncated): doubles max_tokens and retries (up to MAX_TOKENS_CAP)
 *   - empty content: retries up to 3 times with the same token budget
 *   - timeout / API error: propagates immediately (caller's try/catch handles it)
 */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  let maxTokens = opts.maxTokens ?? 4096;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await rateLimiter.acquire();

    let response: DeepSeekResponse;
    try {
      response = await withTimeout(
        createCompletion({
          model:       MODEL,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens:  maxTokens,
        }),
        CHAT_TIMEOUT_MS,
        `chat attempt ${attempt}`
      );
    } catch (err) {
      // Timeout or network error — propagate immediately, don't retry
      throw err;
    }

    const choice       = response.choices[0];
    const content      = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    // Truncated response — double the token budget and retry
    if (finishReason === 'length') {
      const next = Math.min(maxTokens * 2, MAX_TOKENS_CAP);
      console.warn(
        `[llm] Response truncated (finish_reason=length, tokens=${maxTokens}) — ` +
        `retrying with ${next} tokens (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      if (next === maxTokens) {
        // Already at cap — nothing more we can do
        throw new Error(
          `DeepSeek response still truncated at max token cap (${MAX_TOKENS_CAP}). ` +
          `Consider shortening the prompt.`
        );
      }
      maxTokens = next;
      continue;
    }

    // Empty content — retry with the same settings
    if (!content) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[llm] Empty response from DeepSeek (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying…`);
        continue;
      }
      throw new Error(`DeepSeek returned empty response after ${attempt} attempt(s)`);
    }

    return content.trim();
  }

  throw new Error('DeepSeek chat: exhausted all retry attempts');
}

// ── Image availability check ──────────────────────────────────────────────────

/**
 * Check whether an image URL is accessible (HTTP 2xx).
 * DeepSeek V4 Flash does not support vision — relevance is evaluated
 * downstream by the Editor's alt-text review.
 */
export async function evaluateImageRelevance(
  imageUrl: string,
  _topic:   string,
  _pillar:  string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(imageUrl, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

// ── JSON parsing helper ───────────────────────────────────────────────────────

/**
 * Parse a JSON response from DeepSeek, stripping markdown code fences if present.
 */
export function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
