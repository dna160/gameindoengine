/**
 * Shared utilities for all specialized Copywriter agents.
 *
 * Centralises:
 *   - SEO metadata generation (Yoast focus keyphrase + meta description)
 *   - Surgical revision — shows the copywriter its own draft and gives it
 *     a targeted, issue-specific fix instruction so it doesn't rewrite things
 *     that were already correct
 *   - Internal category links (used in both first-draft SEO rules and surgical fix)
 *   - Word count / strip helpers
 */

import { chat, parseJsonResponse } from '../../services/llm';
import type { Pillar, ResearchedItem } from '../../shared/types';
import { PILLAR_LABELS } from '../../shared/types';

// ── Internal category links ───────────────────────────────────────────────────
export const INTERNAL_CATEGORY_LINKS: Record<Pillar, string> = {
  esports:       'https://gameindo.com/category/esports/',
  videogame:     'https://gameindo.com/category/home/',
  entertainment: 'https://gameindo.com/category/entertainment/',
  tech:          'https://gameindo.com/category/tech/',
  streamer:      'https://gameindo.com/category/streamer/',
};

// ── Text utilities ────────────────────────────────────────────────────────────
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

export function stripWordCount(text: string): string {
  return text
    .replace(/\n+\*{0,2}\(?[Ww]ord\s*[Cc]ount:?\s*\d+\s*\w*\)?\*{0,2}\s*$/i, '')
    .replace(/\n+\*{0,2}\(?\d+\s+words?\)?\*{0,2}\s*$/i, '')
    .replace(/\n+---\s*\n[\s\S]*\d+\s*words?[\s\S]*$/i, '')
    .trimEnd();
}

// ── SEO metadata generation ───────────────────────────────────────────────────
/**
 * After an article is written, generate a Yoast-ready focus keyphrase and
 * meta description with a single small LLM call.  Never throws — falls back
 * to title-derived values so the publish flow is never blocked.
 */
export async function generateSeoMetadata(
  articleContent: string,
  title:          string,
  pillar:         Pillar,
  log:            (msg: string) => void
): Promise<{ keyphrase: string; metaDescription: string }> {
  const prompt = `You are an SEO specialist for a pop-culture, gaming & tech news portal publishing in Bahasa Indonesia.

Generate:
1. A focus keyphrase: 2–4 words in Bahasa Indonesia that best represent THIS article's specific topic (e.g. "final MPL Indonesia", "review RTX 5070 Ti", "update Valorant terbaru"). Must be SPECIFIC — never generic like "berita game".
2. A meta description: exactly 150–160 characters in Bahasa Indonesia that naturally includes the focus keyphrase and entices clicks.

Article title: "${title}"
Pillar: "${PILLAR_LABELS[pillar]}"
Article excerpt:
---
${articleContent.slice(0, 800)}
---

Respond with valid JSON only (no markdown fences):
{
  "keyphrase": "2-4 word Indonesian keyphrase",
  "metaDescription": "150-160 char Indonesian meta description"
}`;

  try {
    const raw    = await chat([{ role: 'user', content: prompt }], { temperature: 0.3, maxTokens: 256 });
    const result = parseJsonResponse<{ keyphrase: string; metaDescription: string }>(raw);
    if (result.keyphrase && result.metaDescription) {
      return {
        keyphrase:       result.keyphrase.trim().slice(0, 60),
        metaDescription: result.metaDescription.trim().slice(0, 160),
      };
    }
  } catch (err) {
    log(`[Copywriter] SEO metadata generation failed: ${(err as Error).message}`);
  }

  const words = title.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 4).join(' ');
  return {
    keyphrase:       words.toLowerCase(),
    metaDescription: title.slice(0, 155),
  };
}

// ── Surgical revision ─────────────────────────────────────────────────────────
/**
 * Show the copywriter its own draft and give it a single, precise fix
 * instruction.  Returns the corrected markdown text only — callers are
 * responsible for wrapping it in a DraftArticle and calling generateSeoMetadata.
 *
 * Key principle: the LLM is told to change NOTHING except what the editor flagged.
 * This prevents the "fix one thing, break another" pattern that happens when
 * the copywriter rewrites from raw facts on every revision.
 */
export async function surgicalRevise(
  currentContent: string,
  editorFeedback: string,
  item:           ResearchedItem,
  log:            (msg: string) => void
): Promise<string> {
  const currentWordCount = countWords(currentContent);
  const pillarLabel      = PILLAR_LABELS[item.pillar];
  const internalLink     = INTERNAL_CATEGORY_LINKS[item.pillar];

  const prompt = `You are making a TARGETED REVISION to an existing Bahasa Indonesia article. Your job is to apply EXACTLY ONE specific fix and return the complete corrected article.

*** DO NOT REWRITE THE ARTICLE. DO NOT CHANGE ANYTHING THAT IS NOT BROKEN. ***

[SPECIFIC ISSUE TO FIX]:
${editorFeedback}

[CURRENT ARTICLE — current word count: ${currentWordCount} words]:
---
${currentContent}
---

[AVAILABLE FACTS if expansion is needed]:
${item.facts.slice(0, 5).map((f, i) => `${i + 1}. ${f}`).join('\n')}

[REVISION INSTRUCTIONS BY ISSUE TYPE]:

If the issue mentions WORD COUNT (below 300 words):
  → You MUST reach at least 330 words in the revised article — aim for 340–380. Count before you output.
  → Expand existing sentences: add specific names, numbers, context, or consequences from the facts listed above.
  → Spread additions across 2–4 different paragraphs — do NOT dump everything into one place.
  → Do NOT add new ## headings or standalone new paragraphs — embed the additions inside existing sentences.
  → Count your words after revising. If still below 330, keep expanding until you hit 330+.

If the issue mentions a MISSING H2 SUBHEADING:
  → Insert exactly one ## subheading before the second or third paragraph.
  → The heading MUST name the specific subject of the article.
  → Example: ## Final Fantasy VII Revelation: Wawancara Naoki Hamaguchi

If the issue mentions a MISSING OUTBOUND LINK:
  → Embed a hyperlink inside the most relevant sentence in the body.
  → Use: [baca selengkapnya di sini](${item.link})
  → Do not add a standalone paragraph — weave it into existing text.

If the issue mentions a MISSING INTERNAL LINK:
  → Embed a link to the Gameindo category page inside an existing sentence.
  → Use: [berita ${pillarLabel} lainnya](${internalLink})
  → Do not add a standalone paragraph — weave it into existing text.

If the issue mentions IMAGE ALT TEXT:
  → Replace any \`![featured](URL)\` or blank alt with \`![subject description](URL)\`.
  → The alt text must describe the specific subject in the image, not just the title.

[STRICT OUTPUT RULES]:
1. Output ONLY the corrected article in Markdown. No commentary, no word count note.
2. Keep ALL existing content that the editor did not flag — every sentence, every link.
3. Word count must be 300–400 after your fix.
4. The \`**Judul:**\` line and H1 headline must remain UNCHANGED.
5. All existing images and links must remain intact unless you are fixing them.`;

  const revised = await chat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.4, maxTokens: 4096 }
  );

  const cleaned = stripWordCount(revised);
  log(`[Copywriter] Surgical revision complete. Word count: ${countWords(cleaned)}`);
  return cleaned;
}

// ── SEO writing rules block (injected into every first-draft prompt) ──────────
/**
 * Returns the SEO rules block to embed in each specialized copywriter's
 * writeDraft prompt.  Ensures first-draft articles already satisfy Yoast
 * requirements, reducing editor revision round-trips.
 */
export function seoRulesBlock(sourceUrl: string, pillar: Pillar): string {
  const internalLink = INTERNAL_CATEGORY_LINKS[pillar];
  const pillarLabel  = PILLAR_LABELS[pillar];
  return `
**SEO RULES (MANDATORY — Yoast compliance):**
7. **Keyphrase in Introduction:** The very first paragraph MUST name the article's main subject (specific title/character/product). State it clearly in the opening sentence.
8. **H2 Subheading:** At least one ## subheading MUST name the article's specific subject. No generic headings like "Informasi Terbaru".
9. **Image Alt Text:** Every image MUST have descriptive alt text including the subject. Format: \`![Subject - context](URL)\`. Never use \`![featured](URL)\`.
10. **Outbound Link:** Include at least one hyperlink to the original source inside the body text. Use natural anchor text, e.g. \`[baca selengkapnya di sini](${sourceUrl})\`.
11. **Internal Link:** Include one hyperlink to the Gameindo category page inside the body text. Use natural anchor text, e.g. \`[berita ${pillarLabel} lainnya](${internalLink})\`.`;
}
