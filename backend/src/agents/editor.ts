/**
 * Agent 4: Editor-in-Chief (The Guardrail)
 *
 * Responsibilities:
 * - HTTP HEAD pre-check on image URLs before calling the LLM
 * - Full editorial review: Indonesian headline, writing quality, UU ITE, image validity
 * - Output: PASS or FAIL with structured feedback
 * - Classify failures: WRITING_REVISION (rewrite) or INCOMPLETE_INFO (new images)
 * - Enforce 3-strike rule
 */

import { chat, parseJsonResponse } from '../services/llm';
import { marked } from 'marked';
import type { Pillar, DraftArticle, EditorResult } from '../shared/types';
import { PILLAR_LABELS } from '../shared/types';

/** Popshck category pages — used when auto-injecting a missing internal link */
const INTERNAL_CATEGORY_LINKS: Record<Pillar, string> = {
  esports:       'https://gameindo.com/category/esports/',
  videogame:     'https://gameindo.com/category/home/',
  entertainment: 'https://gameindo.com/category/entertainment/',
  tech:          'https://gameindo.com/category/tech/',
  streamer:      'https://gameindo.com/category/streamer/',
};

/**
 * HTTP HEAD pre-check for image URLs.
 * Returns false if any URL is broken or unreachable within 3 seconds.
 */
async function checkImageUrls(urls: string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export class Editor {
  private log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  /**
   * Perform a full editorial review of a draft article.
   * Runs an HTTP HEAD pre-check on images first; if any are broken,
   * bypasses the LLM and immediately returns an INCOMPLETE_INFO failure.
   */
  async review(draft: DraftArticle, revisionCount: number): Promise<EditorResult> {
    this.log(`[Editor] Reviewing draft: "${draft.title}" (revision ${revisionCount})`);

    // ── Image pre-check ─────────────────────────────────────────────────────
    const imageUrls = draft.images.map((img) => img.url);
    if (imageUrls.length > 0) {
      const imagesValid = await checkImageUrls(imageUrls);
      if (!imagesValid) {
        this.log(`[Editor] Image pre-check FAILED for "${draft.title}" — broken URL(s) detected.`);
        return {
          passed: false,
          autoFixed: false,
          feedback: 'INCOMPLETE_INFO: Backend detected 404/broken image URLs. Routing back to Researcher for replacement.',
          issueType: 'IMAGE',
          hallucinations: [],
        };
      }
    }

    // ── SEO checks: FAIL → Copywriter (requires content work) ──────────────────
    // Word count and H2 subheadings require the Copywriter to expand/restructure.
    // The editor cannot safely add these without rewriting — route back.

    const rawWordCount = draft.content.trim().split(/\s+/).filter((w) => w.length > 0).length;

    if (rawWordCount < 300) {
      this.log(`[Editor] SEO FAIL → Copywriter: word count ${rawWordCount} < 300`);
      return {
        passed: false, autoFixed: false,
        feedback: `WRITING_REVISION: Article is only ${rawWordCount} words. Expand to 300–400 words by adding more detail, context, or explanation to existing sections. Do NOT add new topics or sections.`,
        issueType: 'MINOR', hallucinations: [],
      };
    }

    if (!/^## .+/m.test(draft.content)) {
      this.log(`[Editor] SEO FAIL → Copywriter: no H2 (##) subheading`);
      return {
        passed: false, autoFixed: false,
        feedback: `WRITING_REVISION: No H2 subheading (##) found. Add at least one ## subheading that names the article's specific subject (e.g. ## Genshin Impact Update 4.5 Rilis). Do NOT use generic labels like "Informasi Terbaru".`,
        issueType: 'MINOR', hallucinations: [],
      };
    }

    // ── SEO auto-fixes (editor handles these, no Copywriter round-trip needed) ──
    // Outbound link, internal link, and image alt text can be safely injected
    // without altering the article's prose or structure.

    let workingContent = draft.content;
    const seoFixes: string[] = [];
    const pillarLabel = PILLAR_LABELS[draft.pillar];

    // Auto-fix 1: Outbound link — append a "read more" line to the source article
    if (!/\[.+?\]\(https?:\/\/(?!(?:www\.)?popshck\.com).+?\)/i.test(workingContent)) {
      workingContent += `\n\n*Sumber: [baca artikel selengkapnya di sini](${draft.sourceUrl})*`;
      seoFixes.push('outbound link');
    }

    // Auto-fix 2: Internal link — append a category discovery line
    if (!/\[.+?\]\(https?:\/\/(?:www\.)?popshck\.com.+?\)/i.test(workingContent)) {
      const internalUrl = INTERNAL_CATEGORY_LINKS[draft.pillar];
      workingContent += `\n\n*Temukan lebih banyak [berita ${pillarLabel} terkini](${internalUrl}) hanya di Popshck.*`;
      seoFixes.push('internal link');
    }

    // Auto-fix 3: Generic image alt text — replace "featured"/blank alts with title
    const imgAlts = [...workingContent.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)];
    const hasGenericAlts = imgAlts.some(
      (m) => !m[1] || m[1].trim().toLowerCase() === 'featured' || m[1].trim().length < 5
    );
    if (hasGenericAlts) {
      let imgIdx = 0;
      workingContent = workingContent.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        if (!alt || alt.trim().toLowerCase() === 'featured' || alt.trim().length < 5) {
          imgIdx++;
          const newAlt = imgIdx === 1 ? draft.title : `${draft.title} ${imgIdx}`;
          return `![${newAlt}](${url})`;
        }
        return match;
      });
      seoFixes.push('image alt text');
    }

    if (seoFixes.length > 0) {
      this.log(`[Editor] SEO auto-fixed: ${seoFixes.join(', ')} — no Copywriter round-trip needed`);
    }

    // ── LLM editorial review (reviews the auto-fixed content) ────────────────
    const wordCount     = workingContent.trim().split(/\s+/).filter((w) => w.length > 0).length;
    const attemptNumber = revisionCount + 1; // 1-indexed for the LLM

    const imageList = draft.images
      .map((img, i) => `${i + 1}. ${img.isFeatured ? '[FEATURED] ' : ''}${img.alt}: ${img.url}`)
      .join('\n');

    const prompt = `You are the **Editor-in-Chief Agent** (Pantheon) for a pop-culture, gaming & tech newsroom. Your job is to review drafted articles and their embedded images before they are published.

**INPUTS:**

[Article Draft]:
Title: "${draft.title}"
Pillar: "${pillarLabel}"
Word Count: ${wordCount} (acceptable range: 300–400)

[Attempt Number]: ${attemptNumber} of 5

Content:
---
${workingContent}
---

[Images] (${draft.images.length} total):
${imageList}

**DEVELOPER/ORIGIN POLICY:**
Content from developers/publishers of ANY region is in-scope (global AAA, indie, mobile, and gacha titles).
This includes Riot, Valve, Nintendo, PlayStation, Xbox, HoYoverse, NEXON, Netmarble, Krafton, NetEase, and any esports/gaming title.
Do NOT fail an article purely because of the developer's country of origin.

**REVIEW CRITERIA:**
1. **Judul Check:** The article MUST begin with a \`**Judul:**\` line before the H1. Check two things:
   a. The line exists — if missing, FAIL with "judul line missing".
   b. The title is 10 words or fewer — count the words after \`**Judul:**\`. If over 10, FAIL with "article title over 10 words". A title that ends mid-phrase (cut off) also fails — it must be a complete, meaningful phrase.
2. **Headline Check (FATAL):** The headline MUST be written entirely in Latin script — Indonesian sentence structure AND all proper nouns (game titles, anime titles, character names, studio names). The Scout Agent provides Translation Notes specifically so the Copywriter can write proper romanised names (e.g. "Demon Slayer" or "Kimetsu no Yaiba") instead of raw Kanji/Kana. If ANY Japanese Kanji or Kana characters appear anywhere in the headline, FAIL the review — it means the Copywriter ignored the Translation Notes.
3. **Writing & Tone:** Ensure the text is fluent Indonesian, hallucination-free, and fits the required brand safety standards (No inflammatory content, passes UU ITE).
4. **Image Metadata Review:** Vision is not available — evaluate images from their URL and alt text alone.
   a. **Alt text relevance:** Does the alt text description plausibly match the article subject? A clear mismatch (e.g. alt says "Nendoroid chibi figure" but article is about a scale statue) → FAIL.
   b. **URL plausibility:** Does the image URL domain/path look like a legitimate media source? Generic stock-photo URLs (e.g. picsum, lorempixel, placeholder) or obviously off-topic paths → FAIL.
   c. **Image validity:** The HTTP pre-check above already caught broken URLs — trust that images which reached this step are accessible.
   If alt text clearly contradicts the article subject, route back with error_category "INCOMPLETE_INFO".
5. **Word Count:** Must be between 300 and 400 words.
6. **Structure:** Clear intro, body sections with headers, forward-looking conclusion.

**OUTPUT FORMAT AND ROUTING RULES:**

IMPORTANT: Keep all "reason" values to 4–5 words maximum. Be blunt and specific (e.g. "headline still in Japanese", "word count too low", "broken featured image", "intro section missing").

If the article passes all checks:
{
  "status": "PASS",
  "error_category": "NONE",
  "reason": "All standards met."
}

If the article fails AND [Attempt Number] is 1, 2, 3, or 4, send it back for revision:
{
  "status": "FAIL",
  "error_category": "WRITING_REVISION",
  "reason": "4–5 word fix instruction"
}

For image failures on attempts 1–4:
{
  "status": "FAIL",
  "error_category": "INCOMPLETE_INFO",
  "reason": "Broken image URL detected."
}

**[CRITICAL] FATAL TOPIC REJECTION — if [Attempt Number] is 5 and the article still fails:**
You must declare the topic unsalvageable. Do NOT send it back to the Copywriter.
{
  "status": "UNSALVAGEABLE",
  "error_category": "MAX_REVISIONS_REACHED",
  "reason": "4–5 word failure summary"
}`;

    try {
      const raw = await chat(
        [{ role: 'user', content: prompt }],
        { temperature: 0.2, maxTokens: 1024 }
      );

      const result = parseJsonResponse<{
        status: string;
        error_category: string;
        reason: string;
      }>(raw);

      const passed = result.status === 'PASS';
      const issueType: EditorResult['issueType'] =
        result.status === 'UNSALVAGEABLE'           ? 'UNSALVAGEABLE' :
        result.error_category === 'INCOMPLETE_INFO'  ? 'IMAGE' :
        result.error_category === 'WRITING_REVISION' ? 'MAJOR' :
        null;

      if (!passed) {
        this.log(
          `[Editor] Review FAIL for "${draft.title}"` +
          (issueType ? ` [${issueType}]` : '') +
          (result.reason ? ` — ${result.reason}` : '')
        );
      }

      return {
        passed,
        autoFixed:    seoFixes.length > 0,
        fixedContent: seoFixes.length > 0 ? workingContent : undefined,
        feedback:     result.reason || '',
        issueType,
        hallucinations: [],
      };
    } catch (err) {
      this.log(`[Editor] Review parsing failed: ${(err as Error).message}`);
      return {
        passed:       true,
        autoFixed:    seoFixes.length > 0,
        fixedContent: seoFixes.length > 0 ? workingContent : undefined,
        feedback:     'Editorial review encountered a parsing error. Passing with caution.',
        issueType:    null,
        hallucinations: [],
      };
    }
  }

  /**
   * Apply auto-fixes to the content.
   */
  async applyAutoFix(draft: DraftArticle, fixedContent: string): Promise<DraftArticle> {
    await marked.parse(fixedContent);
    return {
      ...draft,
      content: fixedContent,
    };
  }

  /**
   * Determine the final article status based on revision count and pass/fail.
   * Returns: 'GREEN' | 'YELLOW' | 'RED' | 'FAILED'
   */
  determineStatus(
    passed: boolean,
    autoFixed: boolean,
    revisionCount: number
  ): 'GREEN' | 'YELLOW' | 'RED' | 'FAILED' {
    if (revisionCount >= 5 && !passed) {
      return 'FAILED';
    }

    if (passed) {
      if (revisionCount === 0 || (revisionCount === 0 && autoFixed)) {
        return 'GREEN';
      }
      return 'YELLOW';
    }

    return 'RED';
  }
}
