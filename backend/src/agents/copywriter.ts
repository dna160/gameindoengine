/**
 * Agent 3: Copywriting Agent (The Pillar Expert)
 *
 * Responsibilities:
 * - Write 300–400 word articles tailored to each pillar's tone
 * - Intelligently place 3 images for best context
 * - Format featured image for WordPress standards
 * - Incorporate facts from the Researcher
 */

import { chat, parseJsonResponse } from '../services/llm';
import type { Pillar, ResearchedItem, DraftArticle, ArticleImage } from '../shared/types';
import { PILLAR_LABELS } from '../shared/types';

const MIN_WORDS = 300;
const MAX_WORDS = 400;

/** Internal link to popshck.com category pages — used for Yoast internal link SEO */
const INTERNAL_CATEGORY_LINKS: Record<Pillar, string> = {
  anime:         'https://popshck.com/category/anime/',
  gaming:        'https://popshck.com/category/game/',
  infotainment:  'https://popshck.com/category/infotainment/',
  manga:         'https://popshck.com/category/comic/',
  toys:          'https://popshck.com/category/toys/',
};

export class Copywriter {
  private log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }


  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  }

  /** Strip trailing word-count lines the LLM sometimes appends despite instructions. */
  private stripWordCount(text: string): string {
    return text
      .replace(/\n+\*{0,2}\(?[Ww]ord\s*[Cc]ount:?\s*\d+\s*\w*\)?\*{0,2}\s*$/i, '')
      .replace(/\n+\*{0,2}\(?\d+\s+words?\)?\*{0,2}\s*$/i, '')
      .replace(/\n+---\s*\n[\s\S]*\d+\s*words?[\s\S]*$/i, '')
      .trimEnd();
  }

  /**
   * Write an article draft for a researched item.
   */
  async writeDraft(
    item: ResearchedItem,
    editorFeedback?: string
  ): Promise<DraftArticle> {
    this.log(`[Copywriter] Writing draft: "${item.title}" [${item.pillar}]`);

    const pillarLabel = PILLAR_LABELS[item.pillar];

    const factsBlock = item.facts.length > 0
      ? `\n[Extracted Facts]:\n${item.facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : '\n[Extracted Facts]: (No additional facts provided — base the article on the title and source only.)';

    const translationBlock = item.translationNotes
      ? `\n[Translation Notes]:\n${item.translationNotes}`
      : '';

    const imagesBlock = item.images.length > 0
      ? `\n[Images]:\n${item.images.map((img, i) => `Image ${i + 1}: ${img.url}\nDescription: ${img.alt}`).join('\n')}`
      : '';

    const internalLink  = INTERNAL_CATEGORY_LINKS[item.pillar];

    const feedbackBlock = editorFeedback
      ? `\n[Editor Notes]:\n${editorFeedback}`
      : '';

    const prompt = `You are the **Master Copywriter Agent** for a premium Japanese pop-culture news portal. Your job is to weave raw facts into engaging, high-quality news articles.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia).
**DO NOT** copy the original Japanese headline verbatim. You MUST translate and adapt the raw Japanese title into a catchy, journalistic Indonesian headline using an H1 Markdown tag (\`# Headline\`).

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: The category of the article (Anime / Gaming / Infotainment / Manga / Toys).
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Crucial localization notes provided by the Scout. Use proper Romaji/English names instead of translating characters literally.
4. [Images]: Three (3) image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: ${pillarLabel}
[Title]: "${item.title}"
[Source]: ${item.link}
${factsBlock}
${translationBlock}
${imagesBlock}
${feedbackBlock}

**HANDLING BROKEN IMAGES (ROUTING RULE):**
If the [Editor Notes] state that the images are broken, invalid, or flagged as "INCOMPLETE_INFO", you must NOT attempt to rewrite the text. Instead, you must immediately output the exact string: \`SYSTEM_ROUTE_TO_RESEARCHER: NEW_IMAGES_REQUIRED\`. This will instruct the backend to ping the Researcher for new image links.

**STRICT WRITING RULES:**
1. **Headline:** Must be Bahasa Indonesia. (e.g., \`# [Indonesian Headline Here]\`).
2. **Word Count:** HARD LIMIT — 300 to 400 words. Count your words before outputting. If you are over 400, cut sentences. If you are under 300, expand an existing section. Do NOT exceed 400 words under any circumstances.
3. **Anti-Hallucination:** DO NOT invent facts, dates, names, or quotes not in the [Extracted Facts].
4. **Format:** Pure Markdown. Image 1 must be placed right below the headline with the alt-text \`![featured](URL)\`. Images 2 and 3 should be placed intelligently within the body.
5. **Closing / Call-to-Action (MANDATORY):** Every article MUST end with a punchy 1–2 sentence closing that matches the pillar's context. Use informal, conversational Bahasa Indonesia. Examples:
   - Toys / pre-order available: *"Ayo tunggu apa lagi — kamu bisa pre-order sekarang di [link sumber]!"*
   - Toys / no pre-order yet: *"Pantau terus info resminya ya, jangan sampai kehabisan!"*
   - Anime: *"Siap-siap nonton! Tandai tanggalnya sekarang biar nggak kelewatan."*
   - Gaming: *"Udah nggak sabar main? Drop komentar di bawah dan ajak teman-teman kamu!"*
   - Manga: *"Sudah baca chapter terbarunya? Kasih tau kita pendapat kamu!"*
   - Infotainment: *"Ikuti terus perkembangannya — ini baru permulaan."*

**SEO RULES (MANDATORY — Yoast compliance):**
6. **Focus Keyphrase in Introduction:** The very first paragraph MUST naturally contain the main subject (2–4 key words) of this article. Do not bury the topic — state it clearly in the opening sentence.
7. **Keyphrase in Subheading:** At least one H2 (\`##\`) subheading MUST contain the article's main subject or a clear synonym. Do not write vague subheadings like "Informasi Terbaru" — make them specific to the topic.
8. **Keyphrase in Image Alt Text:** For every image tag, write a descriptive alt text that includes the article subject. Format: \`![subject - context](URL)\`. Example: \`![Genshin Impact update 4.5 - Sigewinne character](URL)\`.
9. **Outbound Link:** In the article body, include at least one hyperlink to the original source using natural anchor text. Example: \`[baca selengkapnya di sumber resmi](${item.link})\`.
10. **Internal Link:** Include one internal hyperlink to the Popshck category page using natural anchor text. Example: \`[berita ${pillarLabel} lainnya](${internalLink})\`. Place it naturally within a sentence, not as a standalone line.

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** RESTRUCTURE and REWRITE existing sentences to be richer. Do NOT add new off-topic paragraphs. Word count must be 300–400 after revision.
- **Missing H2 subheading:** Add one ## subheading that names the specific topic (e.g. ## Genshin Impact 4.5 Hadirkan Sigewinne). Place it before the second or third paragraph.
- **Missing outbound link:** Embed a hyperlink to the source inside an existing sentence, e.g. *[baca selengkapnya di sini](SOURCE_URL)*.
- **Missing internal link:** Embed a hyperlink to the Popshck category page inside an existing sentence, e.g. *[berita anime lainnya](https://popshck.com/category/anime/)*.
- **Generic image alt text:** Replace \`![featured](URL)\` with \`![TOPIC - context](URL)\` where TOPIC is the specific article subject.
- For link and alt-text fixes: you are NOT rewriting the article — you are inserting or updating specific markup only.

**TONE GUIDELINES BASED ON [Content Pillar]:**
- **Japanese Anime:** Enthusiastic and hype-focused. Celebrate the creators/studios. Use casual, welcoming greetings typical of Indonesian anime communities.
- **Japanese Gaming:** Casual, fun, and accessible. Highlight gameplay features, community updates, or release news using familiar Indonesian gamer terminology.
- **Japanese Infotainment:** Journalistic, factual, straightforward, and professional. Best for cultural news, trends, or serious topics.
- **Japanese Manga:** Slightly literary and analytical. Focus on storytelling appreciation, art quality, and publishing industry news.
- **Japanese Toys/Collectibles:** Collector-focused. Highly detailed regarding specifications, craftsmanship, exclusivity, and pricing. Always include pre-order or purchase links in the CTA if the source URL is a product/order page.

If no image errors are present, write the article matching the tone of the [Content Pillar].

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.75, maxTokens: 4096 }
    );

    // Detect routing signal — Copywriter is telling pipeline to fetch new images
    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Copywriter] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = this.stripWordCount(articleText);
    const wordCount = this.countWords(cleanedText);
    this.log(`[Copywriter] Draft written. Word count: ${wordCount}`);

    // Generate Yoast SEO metadata (keyphrase + meta description) in parallel with
    // no blocking — failure here should never block article publication.
    const { keyphrase, metaDescription } = await this.generateSeoMetadata(
      cleanedText,
      item.title,
      item.pillar
    );
    this.log(`[Copywriter] SEO keyphrase: "${keyphrase}"`);

    return {
      title: item.title,
      pillar: item.pillar,
      sourceUrl: item.link,
      content: cleanedText,
      images: item.images,
      wordCount,
      keyphrase,
      metaDescription,
    };
  }

  /**
   * Generate SEO metadata (focus keyphrase + meta description) from a finished article.
   * Runs as a fast, cheap LLM call after the article is written — keeps the article
   * output format clean (pure markdown) while still extracting Yoast-ready fields.
   */
  private async generateSeoMetadata(
    articleContent: string,
    title:          string,
    pillar:         Pillar
  ): Promise<{ keyphrase: string; metaDescription: string }> {
    const prompt = `You are an SEO specialist for a Japanese pop-culture news portal that publishes in Bahasa Indonesia.

Based on the article below, generate:
1. A focus keyphrase: 2–4 words in Bahasa Indonesia that best represent this article's specific topic (e.g. "update Genshin Impact", "chapter terbaru One Piece", "figma Naruto baru"). Must be SPECIFIC — never generic like "berita anime".
2. A meta description: exactly 150–160 characters in Bahasa Indonesia that naturally includes the focus keyphrase and entices readers to click.

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
      this.log(`[Copywriter] SEO metadata generation failed: ${(err as Error).message}`);
    }

    // Fallback: derive from title
    const words = title.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 4).join(' ');
    return {
      keyphrase:       words.toLowerCase(),
      metaDescription: title.slice(0, 155),
    };
  }

  /**
   * Surgically revise an existing draft based on specific editor feedback.
   *
   * This is intentionally NOT a rewrite-from-scratch — it shows the copywriter
   * the article it already wrote and instructs it to make the minimum change
   * needed to fix the reported issue.  Writing from scratch on every revision
   * caused the copywriter to "fix" one thing while silently breaking another.
   *
   * Falls back to writeDraft (full rewrite) only when:
   *   - No current draft content is available (e.g. image-routing cycle reset)
   *   - New replacement images are provided (image layout needs rethinking)
   */
  async rewrite(
    item:           ResearchedItem,
    editorFeedback: string,
    newImages?:     ArticleImage[],
    currentContent?: string          // ← current draft the editor just reviewed
  ): Promise<DraftArticle> {
    this.log(`[Copywriter] Revision requested for: "${item.title}" — "${editorFeedback}"`);

    // If new images were provided, or there is no current content to work from,
    // fall back to a full rewrite so image placement can be reconsidered.
    if (newImages || !currentContent) {
      const updatedItem: ResearchedItem = {
        ...item,
        images: newImages || item.images,
      };
      return this.writeDraft(updatedItem, editorFeedback);
    }

    // ── Surgical revision prompt ──────────────────────────────────────────────
    // The copywriter sees its own article and a precise, issue-specific
    // instruction.  It must return the FULL article with ONLY the fix applied.

    const currentWordCount = currentContent.trim().split(/\s+/).filter((w) => w.length > 0).length;

    const prompt = `You are making a TARGETED REVISION to an existing Bahasa Indonesia article. Your job is to apply EXACTLY ONE specific fix and return the complete corrected article.

*** DO NOT REWRITE THE ARTICLE. DO NOT CHANGE ANYTHING THAT IS NOT BROKEN. ***

[SPECIFIC ISSUE TO FIX]:
${editorFeedback}

[CURRENT ARTICLE — current word count: ${currentWordCount}]:
---
${currentContent}
---

[AVAILABLE FACTS if expansion is needed]:
${item.facts.slice(0, 5).map((f, i) => `${i + 1}. ${f}`).join('\n')}

[REVISION INSTRUCTIONS BY ISSUE TYPE]:

If the issue is about WORD COUNT (below 300 words):
  → Expand 2–3 existing sentences by adding specific detail from the facts above.
  → Do NOT add new paragraphs or new H2 sections.
  → Target: 300–350 words after the fix.

If the issue is about a MISSING H2 SUBHEADING:
  → Insert exactly one ## subheading before the second or third paragraph.
  → The heading must name the specific subject of the article (not "Informasi Terbaru").
  → Example: ## Genshin Impact 4.5 Hadirkan Karakter Sigewinne

If the issue is about a MISSING OUTBOUND LINK:
  → Find the most relevant sentence in the body and append or embed a hyperlink.
  → Use: [baca selengkapnya di sini](${item.link})
  → Do not add a new paragraph — weave it into existing text.

If the issue is about a MISSING INTERNAL LINK:
  → Find the most relevant sentence and embed a link to the Popshck category page.
  → Example: [berita ${PILLAR_LABELS[item.pillar]} lainnya](${INTERNAL_CATEGORY_LINKS[item.pillar]})
  → Do not add a new paragraph — weave it into existing text.

If the issue is about IMAGE ALT TEXT:
  → Replace any \`![featured](URL)\` or blank alt text with \`![article subject](URL)\`.
  → The alt text must describe the specific image subject, not just the article title.

[STRICT OUTPUT RULES]:
1. Output ONLY the corrected article in Markdown. No commentary, no word count note.
2. Keep ALL existing content that the editor did not flag.
3. Word count must be 300–400 after your fix.
4. The \`**Judul:**\` line and H1 headline must remain unchanged.
5. All existing images, links, and formatting must remain intact unless you are fixing them.`;

    const revised = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.4, maxTokens: 4096 }
    );

    const cleanedText  = this.stripWordCount(revised);
    const wordCount    = this.countWords(cleanedText);
    this.log(`[Copywriter] Revision complete. Word count: ${wordCount}`);

    // Regenerate SEO metadata from the revised content
    const { keyphrase, metaDescription } = await this.generateSeoMetadata(
      cleanedText, item.title, item.pillar
    );

    return {
      title:       item.title,
      pillar:      item.pillar,
      sourceUrl:   item.link,
      content:     cleanedText,
      images:      item.images,
      wordCount,
      keyphrase,
      metaDescription,
    };
  }
}
