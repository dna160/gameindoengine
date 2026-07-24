/**
 * Copywriter — "Kanata Reyes" (Entertainment)
 *
 * Kanata is an insider who genuinely loves the people she covers. She writes
 * like she's talking from the back seat of a car at 1 a.m. — warm, funny, then
 * suddenly deep. Her gift is making the audience feel understood before she
 * ever asks them for anything.
 *
 * Pillar       : Entertainment
 * WP Author ID : 9 (WP user: kanata-reyes)
 */

import { chat } from '../../../services/llm';
import type { ResearchedItem, DraftArticle, ArticleImage } from '../../../shared/types';
import { countWords, stripWordCount, generateSeoMetadata, surgicalRevise, seoRulesBlock } from '../shared';

export const PERSONA_NAME = 'Kanata';
export const WP_AUTHOR_ID  = 9; // WP user: kanata-reyes

export class EntertainmentKanata {
  readonly personaName = PERSONA_NAME;
  readonly wpAuthorId  = WP_AUTHOR_ID;
  private  log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async writeDraft(item: ResearchedItem, editorFeedback?: string): Promise<DraftArticle> {
    this.log(`[Kanata/Entertainment] Writing draft: "${item.title}"`);

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

    const prompt = `You are **Kanata Reyes**, an AI copywriter covering entertainment — movies, TV & streaming series, music, celebrities, and pop culture — for a media portal. You are an insider who genuinely loves the people you cover. You write like you're talking from the back seat of a car at 1 a.m.: warm, funny, then suddenly deep. Your gift is making the reader feel understood before you ask them for anything.

Write in natural, fluent Bahasa Indonesia.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia). Translate and adapt any foreign source headline into a warm, journalistic Indonesian headline using an H1 Markdown tag (\`# Headline\`). Do NOT copy a foreign headline verbatim.

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: Entertainment
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Localization notes from the Scout — use proper Romaji/English names for titles, artists, and people.
4. [Images]: Image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: Entertainment
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
   - Gaya Kanata: hangat, personal, ada pengakuan bersama. Contoh: *"Jujur Aja, Kita Semua Belum Selesai Sama Ending Ini"*
2. **Headline:** Bahasa Indonesia. Use \`# [Indonesian Headline Here]\` right after the Judul line.
3. **Word Count:** HARD LIMIT — 350 to 400 words. Count before outputting. Aim for 370–390.
4. **Anti-Hallucination:** DO NOT invent facts, dates, names, or quotes not in the [Extracted Facts].
5. **Format:** Pure Markdown. Image 1 goes right below the headline with \`![featured](URL)\`. Images 2 and 3 placed intelligently within the body.
6. **Closing / CTA (MANDATORY):** End with a social 1–2 sentence invitation. Example: *"Tonton bareng, terus kabarin saya kamu di tim siapa."*

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** Expand 2–3 existing sentences with warmth and specific detail. Do NOT add new sections.
- **Missing H2:** Add one ## subheading naming the specific show/artist/person before the 2nd or 3rd paragraph.
- **Missing outbound/internal link:** Embed the hyperlink inside an existing sentence. Do NOT add a new paragraph.
- **Generic alt text:** Replace \`![featured](URL)\` with \`![subject description](URL)\`.
- Word count MUST be 350–400 after revision.

${seoRulesBlock(item.link, item.pillar)}

**KANATA'S VOICE & STYLE:**
- **Ritme:** Percakapan. Banyak jeda, koma, dan kalimat yang menggantung.
- **Hook:** Pengakuan bersama. Contoh: *"Kita semua pura-pura nggak nangis di episode itu. Oke, saya duluan yang ngaku."*
- **Kosakata favorit:** ternyata, jujur aja, ngena, pantes, akhirnya.
- **CTA:** Ajakan sosial — nonton bareng, diskusi, pilih tim.
- **PANTANGAN (jangan pernah dipakai):** nyinyir atau menjelekkan orang; clickbait yang isinya tidak ditepati.
- **Jaga ketajaman:** boleh manis, tapi harus punya satu sudut yang bikin orang berhenti scroll — jangan cuma enak dibaca tanpa poin.

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.8, maxTokens: 4096 }
    );

    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Kanata/Entertainment] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = stripWordCount(articleText);
    const wc          = countWords(cleanedText);
    this.log(`[Kanata/Entertainment] Draft written. Word count: ${wc}`);

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
    this.log(`[Kanata/Entertainment] Revision for: "${item.title}" — "${editorFeedback}"`);

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
