import Parser from 'rss-parser';
import type { Pillar } from '../shared/types';

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; GameindoEngine/1.0; +https://github.com/dna160/gameindoengine)',
  },
});

export interface RssItem {
  title: string;
  link: string;
  summary: string;
  pubDate?: string;
  pillar: Pillar;
  sourceFeed: string; // hostname of the feed URL this item came from
}

/**
 * A feed entry with explicit pillar affinity tags, confidence rating, and
 * optional fallback URL.
 *
 * Tags reflect the pillars this feed PREDOMINANTLY covers based on actual
 * historical output (feed-memory.json), not just the publication's stated
 * coverage. If a feed claims to cover infotainment but FeedMemory shows zero
 * infotainment items in 30+ samples, the infotainment tag is removed.
 *
 * Confidence levels:
 *   • 'high'       — proven feed: ≥30 historical items, consistently produces
 *                    items for its tagged pillars. Underquota Protocol drains
 *                    these first.
 *   • 'medium'     — proven feed: 5–29 historical items, lower volume but
 *                    reliable.
 *   • 'low'        — proven but rare-yield: <5 historical items.
 *   • 'unverified' — configured but never recorded items in FeedMemory.
 *                    Either the URL is broken, the LLM rejects all items, or
 *                    items get attributed to a Mastodon proxy. Drained LAST
 *                    so verified sources are exhausted first.
 */
export interface FeedConfig {
  url:        string;
  tags:       Pillar[];
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  fallback?:  string;
}

/**
 * ── Tier 2: Preferred — General Feeds (Round 1 / Broad Scrape) ───────────────
 *
 * Fetched on every Round 1 dispatch. Mixed-topic, high-volume feeds. The
 * Scout's LLM triage categorises each item into the correct pillar
 * (esports | videogame | entertainment | tech | streamer).
 *
 * ── Tier 1: Priority — Subpillar-Specific Feeds (Underquota Protocol) ─────────
 *
 * Entries with a single specific tag (e.g. tags: ['esports']) are subpillar
 * branches. The Underquota Protocol filters this list by tag to build a
 * targeted pool for exactly the deficit pillar(s).
 *
 * Fresh gameindo.com sources (live-verified at supply time). Confidence is a
 * best-effort SEED based on observed per-fetch volume/reliability — FeedMemory
 * recalibrates it from real output over time.
 */
export const PRIORITY_FEEDS: FeedConfig[] = [
  // ── Esports / Video Game ────────────────────────────────────────────────────
  // 4Gamer — Japanese gaming, highest volume (~100 items/fetch).
  { url: 'https://www.4gamer.net/rss/index.xml',      tags: ['videogame', 'esports'],                             confidence: 'high' },
  // Dexerto — esports, streamers/influencers, gaming & pop-culture. Workhorse
  // for the thin streamer/entertainment pillars (broad tag → LLM triage sorts).
  { url: 'https://www.dexerto.com/feed/',             tags: ['esports', 'streamer', 'videogame', 'entertainment'], confidence: 'high' },
  // Dot Esports — esports news + game guides.
  { url: 'https://dotesports.com/feed',               tags: ['esports', 'videogame', 'streamer'],                 confidence: 'medium' },
  // ESTNN — dedicated esports news.
  { url: 'https://estnn.com/feed/',                   tags: ['esports'],                                          confidence: 'medium' },
  // Ruliweb (news) — Korean gaming community news.
  { url: 'https://bbs.ruliweb.com/news/rss',          tags: ['videogame', 'esports'],                             confidence: 'medium' },
  // DenFamiNiCoGamer — Japanese gaming, diverse (games + pop culture).
  { url: 'https://news.denfaminicogamer.jp/feed',     tags: ['videogame', 'entertainment'],                       confidence: 'high' },

  // ── Tech ────────────────────────────────────────────────────────────────────
  { url: 'https://techcrunch.com/feed/',              tags: ['tech'],                                             confidence: 'high' },
  { url: 'https://www.wired.com/feed/rss',            tags: ['tech'],                                             confidence: 'high' },
  { url: 'https://www.theverge.com/rss/index.xml',    tags: ['tech'],                                             confidence: 'medium' },

  // ── Mastodon native feeds — TEMPLATES ONLY (add a concrete handle/tag) ───────
  // Append @<username>.rss to a profile, or /tags/<tag>.rss to a hashtag:
  // { url: 'https://chaosphere.hostdon.jp/@<username>.rss',       tags: ['videogame'], confidence: 'unverified' },
  // { url: 'https://rss-mstdn.studiofreesia.com/@<username>.rss', tags: ['videogame'], confidence: 'unverified' },

  // ── Excluded — unreachable at supply time (re-add if the source is fixed) ────
  //   • ONE Esports  https://www.oneesports.gg/feed/  → redirects to HTML, no RSS
  //   • GGWP.ID      https://ggwp.id/feed/            → 404
  //   • Famitsu      https://rsshub.app/famitsu/...   → 403 (public RSSHub blocked)
];

/**
 * ── Tier 1: Priority — Subpillar Branch Feeds (Underquota Protocol) ──────────
 *
 * Activated ONLY when the Master Orchestrator detects a quota deficit after
 * Round 1. The Scout switches from the broad net to a "sniper" approach,
 * fetching exclusively from hyper-specific feeds that match the missing pillars.
 *
 * Rules:
 *   - Only feeds for the missing_pillars are fetched; others are ignored.
 *   - LLM triage strictly filters results to the target pillar(s) only.
 *   - Pool size: 50 items (RETRY_POOL_SIZE) per dispatch.
 *
 * Tier 3 (fallback_protocol) re-uses these same feeds but sweeps ALL pillars,
 * sorted by FeedMemory score, when both Round 1 and Underquota have failed.
 *
 * Per-pillar targeted lists for the Underquota Protocol. Only feeds likely to
 * yield the deficit pillar are listed; the Scout's LLM triage still filters
 * each item strictly to the target pillar.
 */
export const RSS_FEEDS: Record<Pillar, string[]> = {
  esports: [
    'https://dotesports.com/feed',               // Dot Esports — esports news
    'https://estnn.com/feed/',                   // ESTNN — dedicated esports
    'https://www.dexerto.com/feed/',             // Dexerto — esports + scene
    'https://www.4gamer.net/rss/index.xml',      // 4Gamer — JP competitive/gaming
    'https://bbs.ruliweb.com/news/rss',          // Ruliweb — KR gaming/esports
  ],
  videogame: [
    'https://www.4gamer.net/rss/index.xml',      // 4Gamer — JP gaming (high volume)
    'https://news.denfaminicogamer.jp/feed',     // DenFami — JP gaming, diverse
    'https://bbs.ruliweb.com/news/rss',          // Ruliweb — KR gaming
    'https://dotesports.com/feed',               // Dot Esports — game news/guides
    'https://www.dexerto.com/feed/',             // Dexerto — gaming
  ],
  entertainment: [
    'https://www.dexerto.com/feed/',             // Dexerto — pop-culture/entertainment vertical
    'https://news.denfaminicogamer.jp/feed',     // DenFami — JP pop culture crossovers
  ],
  tech: [
    'https://techcrunch.com/feed/',              // TechCrunch — tech/startups
    'https://www.wired.com/feed/rss',            // WIRED — tech/culture
    'https://www.theverge.com/rss/index.xml',    // The Verge — consumer tech/gadgets
  ],
  streamer: [
    'https://www.dexerto.com/feed/',             // Dexerto — streamer/influencer news (primary)
    'https://dotesports.com/feed',               // Dot Esports — creator/streamer coverage
  ],
};

/**
 * Lookup map: primary feed URL → fallback URL.
 * Built automatically from PRIORITY_FEEDS so callers don't have to scan the array.
 */
export const FEED_FALLBACK_MAP: ReadonlyMap<string, string> = new Map(
  PRIORITY_FEEDS
    .filter((f): f is FeedConfig & { fallback: string } => Boolean(f.fallback))
    .map((f) => [f.url, f.fallback])
);

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function isMastodonUrl(url: string): boolean {
  return url.includes('hostdon.jp') || url.includes('mastodon') || url.includes('studiofreesia.com');
}

/**
 * For Mastodon-proxy feeds (e.g. Natalie via chaosphere.hostdon.jp or
 * rss-mstdn.studiofreesia.com), items have no <title>. Extract a title and
 * the real article URL from the HTML description instead.
 */
function extractFromMastodonDescription(
  html: string,
  fallbackLink: string
): { title: string; link: string } {
  // Strip HTML tags
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Remove leading 【 #tag #tag 】 section
  const cleaned = text.replace(/^【[^】]*】\s*/, '').trim();
  // Find the first real article URL embedded in an <a href> (exclude proxy domains)
  const urlMatch = html.match(/href="(https?:\/\/(?!chaosphere)(?!rss-mstdn)[^"]+)"/);
  const articleLink = urlMatch ? urlMatch[1] : fallbackLink;
  // Title is everything before the URL at the end of the cleaned text
  const title = cleaned.replace(/https?:\/\/\S+/g, '').trim() || cleaned.slice(0, 120);
  return { title, link: articleLink };
}

/**
 * Attempt to parse a single URL. Returns items on success, throws on failure.
 */
async function parseUrl(url: string, pillar: Pillar): Promise<RssItem[]> {
  let sourceFeed = url;
  try { sourceFeed = new URL(url).hostname; } catch { /* keep raw url */ }

  const feed = await parser.parseURL(url);
  const isMastodon = isMastodonUrl(url);

  return (feed.items || [])
    .filter((item) => item.link || item.guid)
    .map((item) => {
      const rawLink = (item.link || item.guid || '').trim();

      // Mastodon-proxy items lack <title> — extract from description HTML
      if (isMastodon && !item.title) {
        const html = item.content || item.summary || item['content:encoded'] || '';
        const { title, link } = extractFromMastodonDescription(html, rawLink);
        return { title, link, summary: title, pubDate: item.pubDate, pillar, sourceFeed };
      }

      if (!item.title) return null;
      return {
        title: item.title.trim(),
        link: rawLink,
        summary: item.contentSnippet || item.summary || item.content || '',
        pubDate: item.pubDate,
        pillar,
        sourceFeed,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.title.length > 0 && item.link.length > 0) as RssItem[];
}

/**
 * Fetch and parse a single RSS feed URL.
 * If the primary URL fails and a fallback is provided, the fallback is tried.
 * Returns array of RssItems (may be empty if both fail).
 */
export async function fetchFeed(url: string, pillar: Pillar, fallback?: string): Promise<RssItem[]> {
  try {
    return await parseUrl(url, pillar);
  } catch (err) {
    console.warn(`[RSS] Failed to fetch ${url}:`, (err as Error).message);

    if (fallback) {
      console.info(`[RSS] Trying fallback for ${url} → ${fallback}`);
      try {
        return await parseUrl(fallback, pillar);
      } catch (fbErr) {
        console.warn(`[RSS] Fallback also failed for ${fallback}:`, (fbErr as Error).message);
      }
    }

    return [];
  }
}

/**
 * Fetch the Tier 1 (Priority / Subpillar) feeds for a given pillar.
 * Uses RSS_FEEDS[pillar] — the hyper-specific subpillar branches, NOT the
 * general PRIORITY_FEEDS (Tier 2). Called during Underquota Protocol.
 */
export async function fetchPillarFeeds(pillar: Pillar): Promise<RssItem[]> {
  const feedUrls = RSS_FEEDS[pillar] ?? [];
  const results  = await Promise.allSettled(
    feedUrls.map((url) => fetchFeed(url, pillar))
  );

  const allItems: RssItem[] = [];
  const seenLinks = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        if (!seenLinks.has(item.link)) {
          seenLinks.add(item.link);
          allItems.push(item);
        }
      }
    }
  }

  return allItems;
}

/**
 * Fetch all feeds for all pillars in parallel.
 */
export async function fetchAllFeeds(): Promise<Record<Pillar, RssItem[]>> {
  const pillars: Pillar[] = ['esports', 'videogame', 'entertainment', 'tech', 'streamer'];

  const results = await Promise.allSettled(
    pillars.map((p) => fetchPillarFeeds(p).then((items) => ({ pillar: p, items })))
  );

  const output: Partial<Record<Pillar, RssItem[]>> = {};

  for (const result of results) {
    if (result.status === 'fulfilled') {
      output[result.value.pillar] = result.value.items;
    } else {
      // Fill with empty on failure — scout will handle quota
      console.warn('[RSS] Failed to fetch pillar feeds:', result.reason);
    }
  }

  // Ensure all pillars present
  for (const pillar of pillars) {
    if (!output[pillar]) {
      output[pillar] = [];
    }
  }

  return output as Record<Pillar, RssItem[]>;
}
