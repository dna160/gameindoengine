import dotenv from 'dotenv';
import type { ArticleImage, Pillar } from '../shared/types';

dotenv.config();

const WP_BASE_URL = (process.env.WP_BASE_URL || process.env.WP_URL)?.replace(/\/$/, '');
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

export interface WpPostPayload {
  title: string;
  content: string;       // HTML content
  status: 'publish' | 'draft' | 'pending';
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  author?: number;
  meta?: Record<string, unknown>;
}

export interface WpPostResponse {
  id: number;
  link: string;
  status: string;
  title: { rendered: string };
}

export interface WpMediaResponse {
  id: number;
  source_url: string;
}

// gameindo.com WordPress category IDs (fetched from /wp-json/wp/v2/categories).
const wpCategoryMap: Record<Pillar, number> = {
  esports:       3, // Esports        (slug: esports)
  videogame:     2, // Video Game     (slug: home)
  entertainment: 6, // Entertainment  (slug: entertainment)
  tech:          5, // Tech           (slug: tech)
  streamer:      4, // Streamer       (slug: streamer)
};

/**
 * Pillar → WordPress Author ID mapping (gameindo.com).
 * Must stay in sync with AUTHOR_IDS in publisher/tools/wp_api_client.ts.
 *
 *   esports       → 7   (Gani      — WP user: gani-fighter)
 *   videogame     → 8   (Valentino — WP user: valentino-poppins)
 *   entertainment → 9   (Kanata    — WP user: kanata-reyes)
 *   tech          → 10  (Bunted    — WP user: bunted-cargo)
 *   streamer      → 11  (Basudin   — WP user: basudin-kt)
 */
const wpAuthorMap: Record<Pillar, number> = {
  esports:       7,  // gani-fighter
  videogame:     8,  // valentino-poppins
  entertainment: 9,  // kanata-reyes
  tech:          10, // bunted-cargo
  streamer:      11, // basudin-kt
};

function getAuthHeader(): string {
  if (!WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error('WordPress credentials (WP_USERNAME, WP_APP_PASSWORD) are required');
  }
  const credentials = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
  return `Basic ${credentials}`;
}

function getApiBase(): string {
  if (!WP_BASE_URL) {
    throw new Error('WP_BASE_URL environment variable is required');
  }
  return `${WP_BASE_URL}/wp-json/wp/v2`;
}

/**
 * Upload a remote image to WordPress media library by URL.
 * Step 1: POST the binary to /media (sets the file).
 * Step 2: PATCH /media/{id} to set alt_text and title (WP REST API
 *         does not accept these fields during binary upload).
 * Returns the WordPress media ID and URL.
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  altText: string
): Promise<WpMediaResponse> {
  const apiBase = getApiBase();
  const auth = getAuthHeader();

  // ── Step 1: download the source image (two-stage fallback) ──────────────
  const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer':    (() => { try { return new URL(imageUrl).origin + '/'; } catch { return ''; } })(),
  };

  const isImageContentType = (ct: string | null) =>
    !!ct && (ct.startsWith('image/') || ct.includes('octet-stream'));

  let imageBuffer: Buffer;
  let mimeType: string;

  const directRes = await fetch(imageUrl, { headers: BROWSER_HEADERS }).catch(() => null);
  const directCt  = directRes?.headers.get('content-type') ?? null;
  const directBuf = directRes?.ok && isImageContentType(directCt)
    ? Buffer.from(await directRes.arrayBuffer())
    : null;

  if (directBuf && directBuf.length > 0) {
    imageBuffer = directBuf;
    mimeType    = directCt!;
  } else {
    const stripped = imageUrl.replace(/^https?:\/\//, '');
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg&q=85`;
    const proxyRes = await fetch(proxyUrl).catch(() => null);
    const proxyBuf = proxyRes?.ok ? Buffer.from(await proxyRes.arrayBuffer()) : null;

    if (!proxyBuf || proxyBuf.length === 0) {
      throw new Error(`Image not downloadable (direct + proxy both failed): ${imageUrl}`);
    }
    imageBuffer = proxyBuf;
    mimeType    = 'image/jpeg';
    console.log(`[WordPress] Image via weserv.nl proxy: ${imageUrl}`);
  }

  mimeType = mimeType.split(';')[0].trim();
  const ext = mimeType.includes('png') ? 'png' :
               mimeType.includes('gif') ? 'gif' :
               mimeType.includes('webp') ? 'webp' : 'jpg';
  const filename = `article-image-${Date.now()}.${ext}`;

  console.log(`[WordPress] Uploading ${filename} (${imageBuffer.length} bytes, ${mimeType})`);

  // ── Step 2: upload binary to WP media library ────────────────────────────
  const uploadResponse = await fetch(`${apiBase}/media`, {
    method: 'POST',
    headers: {
      Authorization:         auth,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type':        mimeType,
    },
    body: imageBuffer,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`WordPress media upload failed: ${uploadResponse.status} - ${text}`);
  }

  const media = (await uploadResponse.json()) as WpMediaResponse;
  console.log(`[WordPress] Upload OK → media.id=${media.id}`);

  // ── Step 3: PATCH to set alt_text and title (binary upload ignores these) ─
  try {
    const patchResponse = await fetch(`${apiBase}/media/${media.id}`, {
      method: 'POST', // WP REST API uses POST (not PATCH) for updates
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        alt_text: altText,
        title: altText,
      }),
    });
    if (!patchResponse.ok) {
      console.warn(`[WordPress] Could not set alt_text for media ${media.id}: ${patchResponse.status}`);
    }
  } catch (err) {
    console.warn(`[WordPress] alt_text patch failed for media ${media.id}:`, (err as Error).message);
  }

  return media;
}

/**
 * Create a WordPress post.
 */
export async function createPost(payload: WpPostPayload): Promise<WpPostResponse> {
  const apiBase = getApiBase();
  const auth = getAuthHeader();

  const response = await fetch(`${apiBase}/posts`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WordPress post creation failed: ${response.status} - ${text}`);
  }

  return (await response.json()) as WpPostResponse;
}

/**
 * Publish an article to WordPress.
 * Handles image uploads and sets featured image.
 * Returns the WP post ID and URL.
 */
export async function publishArticle(
  title: string,
  contentHtml: string,
  images: ArticleImage[],
  pillar?: Pillar
): Promise<{ wpPostId: number; wpPostUrl: string }> {
  if (!WP_BASE_URL) {
    throw new Error('WP_BASE_URL is not configured');
  }

  let featuredMediaId: number | undefined;

  // Upload ONLY the featured image (first image flagged isFeatured, or index 0).
  // WordPress generates 6 size variants per upload; uploading all 3 article images
  // creates 18 files per article and fills disk rapidly. Non-featured images stay
  // as external URLs in the HTML — they load fine from the reader's browser.
  const featuredImg = images.find((img) => img.isFeatured) ?? images[0];
  if (featuredImg) {
    try {
      const media = await uploadImageFromUrl(featuredImg.url, featuredImg.alt);
      featuredMediaId = media.id;
      console.log(`[WordPress] Featured image uploaded → media.id=${media.id}`);
    } catch (err) {
      console.warn(`[WordPress] Failed to upload featured image ${featuredImg.url}:`, (err as Error).message);
    }
  }

  // HTML content keeps external image URLs as-is (no URL replacement needed).
  const finalHtml = contentHtml;

  const categoryId = pillar ? wpCategoryMap[pillar] : undefined;
  const authorId   = pillar ? wpAuthorMap[pillar]   : undefined;

  const post = await createPost({
    title,
    content: finalHtml,
    status: 'publish',
    featured_media: featuredMediaId,
    ...(categoryId !== undefined ? { categories: [categoryId] } : {}),
    ...(authorId   !== undefined ? { author: authorId }         : {}),
  });

  return {
    wpPostId: post.id,
    wpPostUrl: post.link,
  };
}
