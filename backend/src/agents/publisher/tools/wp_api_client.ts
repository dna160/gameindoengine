/**
 * WordPress REST API Client (Publisher Agent Tool)
 *
 * Handles all WordPress REST API operations for the Publisher Agent:
 * - Image upload (binary POST + metadata PATCH for alt_text)
 * - Post creation with author ID and category assignment
 *
 * Author–WP User ID mapping (matches persona names from specialized copywriters):
 *   Satoshi → 10 (Anime)        WP user: Harry Kaguya
 *   Hikari  → 7  (Gaming)       WP user: MRYAKUZA Pantheon
 *   Kenji   → 9  (Infotainment) WP user: Lisa Kagawa
 *   Rina    → 11 (Manga)        WP user: Steven Nelson
 *   Taro    → 8  (Toys/Collectibles) WP user: FINALHERO Pantheon
 */

import type { ArticleImage, Pillar } from '../../../shared/types';

// ── Author ID mapping ─────────────────────────────────────────────────────────
export const AUTHOR_IDS: Record<string, number> = {
  Satoshi: 10, // WP user: Harry Kaguya
  Hikari:   7, // WP user: MRYAKUZA Pantheon
  Kenji:    9, // WP user: Lisa Kagawa
  Rina:    11, // WP user: Steven Nelson
  Taro:     8, // WP user: FINALHERO Pantheon
};

// ── Category ID mapping ───────────────────────────────────────────────────────
export const CATEGORY_IDS: Record<Pillar, number> = {
  anime:         11,
  gaming:        13,
  infotainment:  10,
  manga:         14,
  toys:          12,
};

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface WpPostPayload {
  title:           string;
  content:         string;
  status:          'publish' | 'draft' | 'pending';
  categories?:     number[];
  featured_media?: number;
  author?:         number;
  slug?:           string;
  meta?:           {
    _yoast_wpseo_focuskw?:  string;   // Yoast focus keyphrase
    _yoast_wpseo_metadesc?: string;   // Yoast meta description
  };
}

export interface WpPostResponse {
  id:             number;
  link:           string;
  status:         string;
  title:          { rendered: string };
  featured_media: number;   // 0 = not set, >0 = WP media ID
}

export interface WpMediaResponse {
  id:         number;
  source_url: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getConfig(): { apiBase: string; auth: string } {
  const baseUrl = (process.env.WP_BASE_URL || process.env.WP_URL)?.replace(/\/$/, '');
  const username = process.env.WP_USERNAME;
  const password = process.env.WP_APP_PASSWORD;

  if (!baseUrl)    throw new Error('WP_BASE_URL environment variable is required');
  if (!username || !password) throw new Error('WordPress credentials (WP_USERNAME, WP_APP_PASSWORD) are required');

  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return {
    apiBase: `${baseUrl}/wp-json/wp/v2`,
    auth:    `Basic ${credentials}`,
  };
}

/**
 * Upload a remote image to the WordPress media library.
 * Step 1: POST binary to /media.
 * Step 2: POST /media/{id} to set alt_text (WP REST API ignores it during binary upload).
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  altText:  string
): Promise<WpMediaResponse> {
  const { apiBase, auth } = getConfig();

  // Download source image with two-stage fallback.
  // Stage 1: direct fetch with browser headers.
  // Stage 2: weserv.nl proxy — handles CDNs that block non-browser GETs.
  // After each stage: validate content-type is image/* AND buffer is non-empty.
  // Node.js fetch requires a Buffer (Uint8Array), not a raw ArrayBuffer, as the
  // upload body — ArrayBuffer can be silently dropped by undici in some versions.

  const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':     'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Referer':    (() => { try { return new URL(imageUrl).origin + '/'; } catch { return ''; } })(),
  };

  const isImageContentType = (ct: string | null) =>
    !!ct && (ct.startsWith('image/') || ct.includes('octet-stream'));

  let imageBuffer: Buffer;
  let contentType: string;

  // ── Stage 1: direct ─────────────────────────────────────────────────────────
  const directRes = await fetch(imageUrl, { headers: BROWSER_HEADERS }).catch(() => null);
  const directCt  = directRes?.headers.get('content-type') ?? null;
  const directBuf = directRes?.ok && isImageContentType(directCt)
    ? Buffer.from(await directRes.arrayBuffer())
    : null;

  if (directBuf && directBuf.length > 0) {
    imageBuffer = directBuf;
    contentType = directCt!;
  } else {
    // ── Stage 2: weserv.nl proxy ───────────────────────────────────────────────
    const stripped = imageUrl.replace(/^https?:\/\//, '');
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg&q=85`;
    const proxyRes = await fetch(proxyUrl).catch(() => null);
    const proxyBuf = proxyRes?.ok ? Buffer.from(await proxyRes.arrayBuffer()) : null;

    if (!proxyBuf || proxyBuf.length === 0) {
      throw new Error(`Image not downloadable (direct + proxy both failed): ${imageUrl}`);
    }
    imageBuffer = proxyBuf;
    contentType = 'image/jpeg';
    console.log(`[WpApiClient] Image via weserv.nl proxy: ${imageUrl}`);
  }
  const ext      = contentType.includes('png')  ? 'png'  :
                   contentType.includes('gif')  ? 'gif'  :
                   contentType.includes('webp') ? 'webp' : 'jpg';
  const filename = `article-image-${Date.now()}.${ext}`;

  const mimeType = contentType.split(';')[0].trim();
  console.log(`[WpApiClient] Uploading ${filename} (${imageBuffer.length} bytes, ${mimeType})`);

  const uploadResponse = await fetch(`${apiBase}/media`, {
    method:  'POST',
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
  console.log(`[WpApiClient] Upload OK → media.id=${media.id}`);

  // Set alt_text via PATCH (POST in WP REST convention)
  try {
    const patchResponse = await fetch(`${apiBase}/media/${media.id}`, {
      method:  'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ alt_text: altText, title: altText }),
    });
    if (!patchResponse.ok) {
      console.warn(`[WpApiClient] Could not set alt_text for media ${media.id}: ${patchResponse.status}`);
    }
  } catch (err) {
    console.warn(`[WpApiClient] alt_text patch failed for media ${media.id}:`, (err as Error).message);
  }

  return media;
}

/**
 * Upload a locally rendered image Buffer to the WordPress media library.
 * Used by the Social Media Orchestrator to persist rendered social images.
 *
 * @param imageBuffer  Raw image data (e.g. PNG rendered by sharp)
 * @param filename     Desired filename (e.g. "social-post-abc123.png")
 * @param altText      Alt text / title for the media item
 * @param mimeType     MIME type (default: "image/png")
 */
export async function uploadImageBuffer(
  imageBuffer: Buffer,
  filename:    string,
  altText:     string,
  mimeType:    string = 'image/png'
): Promise<WpMediaResponse> {
  const { apiBase, auth } = getConfig();

  const form = new FormData();
  form.append('file', new Blob([imageBuffer], { type: mimeType }), filename);

  const uploadResponse = await fetch(`${apiBase}/media`, {
    method:  'POST',
    headers: {
      Authorization: auth,
    },
    body: form,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`WordPress media upload failed: ${uploadResponse.status} - ${text}`);
  }

  const media = (await uploadResponse.json()) as WpMediaResponse;

  // Set alt_text + title
  try {
    await fetch(`${apiBase}/media/${media.id}`, {
      method:  'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ alt_text: altText, title: altText }),
    });
  } catch {
    // Non-fatal — media is uploaded, metadata update is best-effort
  }

  return media;
}

/**
 * Create a WordPress post.
 */
export async function createPost(payload: WpPostPayload): Promise<WpPostResponse> {
  const { apiBase, auth } = getConfig();

  const response = await fetch(`${apiBase}/posts`, {
    method:  'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WordPress post creation failed: ${response.status} - ${text}`);
  }

  return (await response.json()) as WpPostResponse;
}

/**
 * Full publish flow: upload images, replace URLs in HTML, create post.
 * Returns WP post ID and live URL.
 */
/** Convert a keyphrase to a URL-safe WordPress slug */
function keyphraseToSlug(keyphrase: string): string {
  return keyphrase
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-ASCII (Indonesian chars, symbols)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || undefined as unknown as string;
}

export async function publishToWordPress(params: {
  title:           string;
  contentHtml:     string;
  images:          ArticleImage[];
  pillar:          Pillar;
  authorName?:     string;   // persona name → mapped to WP user ID
  keyphrase?:      string;   // Yoast focus keyphrase
  metaDescription?: string;  // Yoast meta description
}): Promise<{ wpPostId: number; wpPostUrl: string }> {
  const { title, images, pillar, authorName, keyphrase, metaDescription } = params;

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
      console.log(`[WpApiClient] Featured image uploaded → media.id=${media.id}`);
    } catch (err) {
      console.warn(`[WpApiClient] Failed to upload featured image ${featuredImg.url}:`, (err as Error).message);
    }
  }

  // HTML content keeps external image URLs as-is (no URL replacement needed).
  const finalHtml = params.contentHtml;

  const categoryId = CATEGORY_IDS[pillar];
  const authorId   = authorName ? AUTHOR_IDS[authorName] : undefined;

  // Derive slug from the focus keyphrase (URL-safe, max 60 chars).
  // If keyphrase is absent, WordPress auto-generates the slug from the title.
  const slug = keyphrase ? keyphraseToSlug(keyphrase) : undefined;

  // Build Yoast SEO meta block — only included when fields are present.
  const yoastMeta = (keyphrase || metaDescription) ? {
    ...(keyphrase      ? { _yoast_wpseo_focuskw:  keyphrase }      : {}),
    ...(metaDescription ? { _yoast_wpseo_metadesc: metaDescription } : {}),
  } : undefined;

  // featured_media is placed BEFORE content intentionally.
  // content can be 20–50 KB of HTML; WAFs that parse request bodies up to a
  // size limit will drop everything after the large content field.
  // Putting featured_media first ensures it is always received.
  const post = await createPost({
    title,
    featured_media:  featuredMediaId,
    categories:      [categoryId],
    ...(authorId    !== undefined ? { author: authorId } : {}),
    ...(slug        !== undefined ? { slug }             : {}),
    ...(yoastMeta   !== undefined ? { meta: yoastMeta }  : {}),
    status:          'publish',
    content:         finalHtml,
  });

  console.log(
    `[WpApiClient] Post ${post.id} created — WP returned featured_media=${post.featured_media}` +
    (keyphrase ? ` | keyphrase="${keyphrase}"` : '')
  );

  // ── Yoast SEO meta PATCH ───────────────────────────────────────────────────
  // WordPress only writes custom meta keys that are registered with
  // show_in_rest:true.  Yoast SEO registers its keys, but some Hostinger
  // configurations silently drop unrecognised meta on the main POST.
  // We send a dedicated lightweight PATCH containing only the Yoast fields
  // so they are always written, mirroring the same pattern used for featured_media.
  if (keyphrase || metaDescription) {
    const { apiBase: yapiBase, auth: yauth } = getConfig();
    try {
      const yoastPatch = await fetch(`${yapiBase}/posts/${post.id}`, {
        method:  'POST',
        headers: { Authorization: yauth, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          meta: {
            ...(keyphrase       ? { _yoast_wpseo_focuskw:  keyphrase }       : {}),
            ...(metaDescription ? { _yoast_wpseo_metadesc: metaDescription } : {}),
          },
        }),
      });
      if (yoastPatch.ok) {
        console.log(`[WpApiClient] Yoast meta PATCH OK — focuskw="${keyphrase}"`);
      } else {
        const errText = await yoastPatch.text().catch(() => '');
        console.warn(`[WpApiClient] Yoast meta PATCH failed: ${yoastPatch.status} — ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[WpApiClient] Yoast meta PATCH threw:`, (err as Error).message);
    }
  }

  // Belt-and-suspenders: if WordPress still shows featured_media=0 after
  // creation (WAF stripped the field), PATCH it explicitly with a tiny payload.
  if (featuredMediaId !== undefined && post.featured_media !== featuredMediaId) {
    console.warn(`[WpApiClient] featured_media mismatch (sent ${featuredMediaId}, got ${post.featured_media}) — sending PATCH`);
    const { apiBase, auth } = getConfig();
    try {
      const patchRes = await fetch(`${apiBase}/posts/${post.id}`, {
        method:  'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ featured_media: featuredMediaId }),
      });
      if (patchRes.ok) {
        const patched = await patchRes.json() as WpPostResponse;
        console.log(`[WpApiClient] PATCH result — featured_media=${patched.featured_media}`);
      } else {
        console.warn(`[WpApiClient] PATCH failed: ${patchRes.status}`);
      }
    } catch (err) {
      console.warn(`[WpApiClient] PATCH threw:`, (err as Error).message);
    }
  }

  return { wpPostId: post.id, wpPostUrl: post.link };
}
