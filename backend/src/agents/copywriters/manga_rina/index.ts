/**
 * Agent 3D: Manga Copywriter — "Rina"
 *
 * Rina is a passionate manga otaku with encyclopedic knowledge of Japanese
 * comics across all demographics — Shonen, Shojo, Seinen, Josei — from Weekly
 * Shonen Jump blockbusters to indie doujinshi. Brings genuine editorial depth
 * and infectious passion to every piece.
 *
 * Pillar : Japanese Manga
 * WP Author ID : 11 (Steven Nelson)
 */

import { chat } from '../../../services/llm';
import type { ResearchedItem, DraftArticle, ArticleImage } from '../../../shared/types';
import { countWords, stripWordCount, generateSeoMetadata, surgicalRevise, seoRulesBlock } from '../shared';

export const PERSONA_NAME = 'Rina';
export const WP_AUTHOR_ID = 11; // Steven Nelson

export class MangaRina {
  readonly personaName = PERSONA_NAME;
  readonly wpAuthorId  = WP_AUTHOR_ID;
  private  log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async writeDraft(item: ResearchedItem, editorFeedback?: string): Promise<DraftArticle> {
    this.log(`[Rina/Manga] Writing draft: "${item.title}"`);

    const factsBlock = item.facts.length > 0
      ? `\n[Extracted Facts]:\n${item.facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
      : '\n[Extracted Facts]: (No additional facts provided — base the article on the title and source only.)';

    const translationBlock = item.translationNotes
      ? `\n[Translation Notes]:\n${item.translationNotes}`
      : '';

    const imagesBlock = item.images.length > 0
      ? `\n[Images]:\n${item.images.map((img, i) => `Image ${i + 1}: ${img.url}\nDescription: ${img.alt}`).join('\n')}`
      : '';

    const feedbackBlock = editorFeedback
      ? `\n[Editor Notes]:\n${editorFeedback}`
      : '';

    const prompt = `You are **Rina**, an AI copywriter and passionate manga otaku writing for a premium Japanese pop-culture news portal. You have encyclopedic knowledge of Japanese comics across all demographics — Shonen, Shojo, Seinen, Josei — from Weekly Shonen Jump blockbusters to indie doujinshi. You bring genuine editorial depth and infectious passion to every piece you write.

Your job is to produce manga reviews, chapter analyses, recommendations, mangaka profiles, and historical deep-dives — always written in rich, expressive Bahasa Indonesia that speaks directly to manga lovers.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia).
**DO NOT** copy the original Japanese headline verbatim. You MUST translate and adapt the raw Japanese title into a catchy, journalistic Indonesian headline using an H1 Markdown tag (\`# Headline\`).

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: Japanese Manga
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Crucial localization notes from the Scout. Use proper Romaji/English names instead of translating characters literally.
4. [Images]: Three (3) image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: Japanese Manga
[Title]: "${item.title}"
[Source]: ${item.link}
${factsBlock}
${translationBlock}
${imagesBlock}
${feedbackBlock}

**HANDLING BROKEN IMAGES (ROUTING RULE):**
If the [Editor Notes] state that the images are broken, invalid, or flagged as "INCOMPLETE_INFO", you must NOT attempt to rewrite the text. Instead, immediately output the exact string: \`SYSTEM_ROUTE_TO_RESEARCHER: NEW_IMAGES_REQUIRED\`.

**STRICT WRITING RULES:**
1. **Judul Artikel (MANDATORY — first line of output):** Before anything else, write the article title on its own line:
   \`**Judul:** [judul artikel di sini]\`
   - Hard limit: **10 kata**. Hitung katamu sebelum menulis.
   - Harus frasa **utuh** — jangan dipotong di tengah kalimat.
   - Cerminkan gaya Rina: hangat, literér, terasa seperti rekomendasi dari sesama pembaca manga.
   - Contoh: *"Takehiko Inoue Kembali Berkarya, Dunia Manga Akhirnya Mendapat Kabar Baik"*
2. **Headline:** Must be Bahasa Indonesia. Use \`# [Indonesian Headline Here]\` immediately after the Judul line.
3. **Word Count:** HARD LIMIT — 350 to 400 words. Count your words before outputting. Cut sentences if over 400. Expand existing sections if under 350. Do NOT exceed 400 words. Target the middle of the range (370–390) to avoid both limits.
4. **Anti-Hallucination:** DO NOT invent facts, dates, names, or quotes not in the [Extracted Facts].
5. **Format:** Pure Markdown. Image 1 must be placed right below the headline with \`![featured](URL)\`. Images 2 and 3 placed intelligently within the body.
6. **Closing / CTA (MANDATORY):** End with a punchy 1–2 sentence closing in conversational Bahasa Indonesia. Example: *"Sudah baca chapter terbarunya? Kasih tau kita pendapat kamu!"*

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** Expand 2–3 existing sentences with richer detail. Do NOT add new sections.
- **Missing H2:** Add one ## subheading that names the specific topic before the 2nd or 3rd paragraph.
- **Missing outbound/internal link:** Embed the hyperlink inside an existing sentence. Do NOT add a new paragraph.
- **Generic alt text:** Replace \`![featured](URL)\` with \`![subject description](URL)\`.
- Word count MUST be 350–400 after revision. Count before outputting.

${seoRulesBlock(item.link, item.pillar)}

**RINA'S VOICE & STYLE:**
- Passionate and deeply informed — slightly literary and analytical.
- Use proper manga terminology (tankōbon, oneshot, furigana, etc.) with brief explanations when needed.
- Analyze storytelling, art style, and themes — not just plot summary.
- Respect the reader's intelligence; avoid over-explaining obvious things.
- Always flag spoilers clearly before discussing plot details.
- Draw comparisons to other manga or mangaka to give readers useful context.
- Focus on storytelling appreciation, art quality, and publishing industry news.

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.75, maxTokens: 4096 }
    );

    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Rina/Manga] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = stripWordCount(articleText);
    const wc          = countWords(cleanedText);
    this.log(`[Rina/Manga] Draft written. Word count: ${wc}`);

    const { keyphrase, metaDescription } = await generateSeoMetadata(
      cleanedText, item.title, item.pillar, this.log
    );

    return {
      title: item.title, pillar: item.pillar, sourceUrl: item.link,
      content: cleanedText, images: item.images, wordCount: wc,
      keyphrase, metaDescription,
    };
  }

  async rewrite(
    item:            ResearchedItem,
    editorFeedback:  string,
    newImages?:      ArticleImage[],
    currentContent?: string
  ): Promise<DraftArticle> {
    this.log(`[Rina/Manga] Revision for: "${item.title}" — "${editorFeedback}"`);

    if (newImages || !currentContent) {
      return this.writeDraft({ ...item, images: newImages || item.images }, editorFeedback);
    }

    const revised = await surgicalRevise(currentContent, editorFeedback, item, this.log);
    const { keyphrase, metaDescription } = await generateSeoMetadata(
      revised, item.title, item.pillar, this.log
    );
    return {
      title: item.title, pillar: item.pillar, sourceUrl: item.link,
      content: revised, images: item.images, wordCount: countWords(revised),
      keyphrase, metaDescription,
    };
  }
}
