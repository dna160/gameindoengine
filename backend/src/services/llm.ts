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
}

interface DeepSeekResponse {
  choices: DeepSeekChoice[];
}

// ── Rate limiter: 60 requests per minute (sliding window) ─────────────────────

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
      // Wait until the oldest timestamp exits the 60s window
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

const rateLimiter = new RateLimiter(60);

// ── Timeout helper ────────────────────────────────────────────────────────────

const CHAT_TIMEOUT_MS = 90_000; // 90 seconds — kills hanging API calls

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
 * Send a chat completion request to DeepSeek V4 Flash.
 * Supports both text-only and multimodal (vision) messages.
 * Returns the raw API response so callers can inspect choices directly.
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
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<DeepSeekResponse>;
}

// ── High-level helpers ────────────────────────────────────────────────────────

/**
 * Send a chat completion request to DeepSeek V4 Flash and return the text content.
 */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  await rateLimiter.acquire();
  const response = await withTimeout(
    createCompletion({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    CHAT_TIMEOUT_MS,
    'chat'
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek returned empty response');
  }
  return content.trim();
}

/**
 * Ask DeepSeek to evaluate an image URL for relevance to a topic.
 * Returns true (relevant) or false (irrelevant / failed).
 */
export async function evaluateImageRelevance(
  imageUrl: string,
  topic: string,
  pillar: string
): Promise<boolean> {
  try {
    await rateLimiter.acquire();
    const response = await withTimeout(
      createCompletion({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are evaluating whether an image is relevant to an article about "${topic}" in the "${pillar}" content pillar.\n\nRespond with ONLY "YES" if the image is clearly relevant and high quality, or "NO" if it is irrelevant, low quality, or inappropriate.\n\nImage URL: ${imageUrl}`,
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
      CHAT_TIMEOUT_MS,
      'vision'
    );

    const answer = response.choices[0]?.message?.content?.trim().toUpperCase();
    return answer === 'YES';
  } catch (err) {
    // If vision evaluation fails (e.g., image inaccessible), default to false
    console.warn(`Vision evaluation failed for ${imageUrl}:`, err);
    return false;
  }
}

/**
 * Parse a JSON response from DeepSeek, stripping markdown code blocks if present.
 */
export function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
