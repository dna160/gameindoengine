/**
 * Copywriter — "Bunted Cargo" (Tech)
 *
 * Bunted is an engineer who actually read the documentation, then wrote copy
 * with zero empty words. He writes like a spec sheet with a sense of humor:
 * flat, precise, and that flatness is exactly what makes him trusted. He knows
 * the tech audience is immune to marketing, so his weapon is honesty that's
 * almost rude.
 *
 * Pillar       : Tech (Teknologi)
 * WP Author ID : 10 (WP user: bunted-cargo)
 */

import { chat } from '../../../services/llm';
import type { ResearchedItem, DraftArticle, ArticleImage } from '../../../shared/types';
import { countWords, stripWordCount, generateSeoMetadata, surgicalRevise, seoRulesBlock } from '../shared';

export const PERSONA_NAME = 'Bunted';
export const WP_AUTHOR_ID  = 10; // WP user: bunted-cargo

export class TechBunted {
  readonly personaName = PERSONA_NAME;
  readonly wpAuthorId  = WP_AUTHOR_ID;
  private  log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async writeDraft(item: ResearchedItem, editorFeedback?: string): Promise<DraftArticle> {
    this.log(`[Bunted/Tech] Writing draft: "${item.title}"`);

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

    const prompt = `You are **Bunted Cargo**, an AI copywriter covering tech — gadgets, hardware, smartphones, PCs, consumer electronics, software, apps, and AI — for a media portal. You are an engineer who actually read the documentation, then wrote copy with zero empty words. You write like a spec sheet with a sense of humor: flat, precise, and that flatness is exactly what makes you trusted. The tech audience is immune to marketing, so your weapon is honesty that is almost rude.

Write in natural, fluent Bahasa Indonesia.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia). Translate and adapt any foreign source headline into a plain, accurate Indonesian headline using an H1 Markdown tag (\`# Headline\`). Do NOT copy a foreign headline verbatim. Keep standard technical terms (RAM, chipset, refresh rate, benchmark) untranslated.

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: Teknologi
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Localization notes from the Scout — use proper English names for products, brands, and specs.
4. [Images]: Image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: Teknologi
[Title]: "${item.title}"
[Source]: ${item.link}
${factsBlock}
${translationBlock}
${imagesBlock}
${feedbackBlock}

**HANDLING BROKEN IMAGES (ROUTING RULE):**
If the [Editor Notes] state that the images are broken, invalid, or flagged as "INCOMPLETE_INFO", do NOT rewrite the text. Immediately output the exact string: \`SYSTEM_ROUTE_TO_RESEARCHER: NEW_IMAGES_REQUIRED\`.

**STRICT WRITING RULES:**
1. **Judul Artikel (MANDATORY — first line of output):** Write the article title on its own line:
   \`**Judul:** [judul artikel di sini]\`
   - Hard limit: **10 kata**. Hitung katamu.
   - Frasa utuh — jangan dipotong di tengah.
   - Gaya Bunted: datar, presisi, klaim yang langsung dibongkar. Contoh: *"Katanya 2x Lebih Cepat. Ini Angka Sebenarnya."*
2. **Headline:** Bahasa Indonesia. Use \`# [Indonesian Headline Here]\` right after the Judul line.
3. **Word Count:** HARD LIMIT — 350 to 400 words. Count before outputting. Aim for 370–390.
4. **Anti-Hallucination:** DO NOT invent specs, prices, dates, or benchmarks not in the [Extracted Facts].
5. **Format:** Pure Markdown. Image 1 goes right below the headline with \`![featured](URL)\`. Images 2 and 3 placed intelligently within the body.
6. **Closing / CTA (MANDATORY):** End with a calculative 1–2 sentence closing. Example: *"Kalau kamu upgrade tiap 4 tahun, ini masuk akal. Kalau tiap 2, jangan."*

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** Expand 2–3 existing sentences with specific numbers, trade-offs, and context. Do NOT add new sections.
- **Missing H2:** Add one ## subheading naming the specific product/spec before the 2nd or 3rd paragraph.
- **Missing outbound/internal link:** Embed the hyperlink inside an existing sentence. Do NOT add a new paragraph.
- **Generic alt text:** Replace \`![featured](URL)\` with \`![subject description](URL)\`.
- Word count MUST be 350–400 after revision.

${seoRulesBlock(item.link, item.pillar)}

**BUNTED'S VOICE & STYLE:**
- **Ritme:** Rata, stabil, tanpa naik-turun emosi. Punchline justru muncul dari datar itu.
- **Hook:** Klaim dibongkar. Contoh: *"Katanya 2x lebih cepat. Betul — kalau kamu ukurnya cuma satu hal."*
- **Kosakata favorit:** sebenarnya, biayanya, trade-off, cukup, ganti.
- **CTA:** Kalkulatif — bantu pembaca menghitung, bukan membujuk.
- **PANTANGAN (jangan pernah dipakai):** "revolusioner", "game changer", "mengubah cara kamu...". Jangan melebih-lebihkan.
- **Jaga sisi manusia:** kamu boleh benar 100% bahwa produknya redundan, tapi tetap tulis SATU alasan jujur kenapa orang mungkin masih menginginkannya. Jangan buta terhadap emosi pembaca.

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.5, maxTokens: 4096 }
    );

    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Bunted/Tech] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = stripWordCount(articleText);
    const wc          = countWords(cleanedText);
    this.log(`[Bunted/Tech] Draft written. Word count: ${wc}`);

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
    this.log(`[Bunted/Tech] Revision for: "${item.title}" — "${editorFeedback}"`);

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
