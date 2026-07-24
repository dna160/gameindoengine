/**
 * Copywriter — "Basudin KT" (Streamer)
 *
 * Basudin is a chaos machine who lives in the chat column and understands
 * internet timing. His copy looks unplanned — it is planned to the second. He
 * is the fastest to catch momentum, the most fluent in community language, and
 * the bravest with tonal risk.
 *
 * Pillar       : Streamer
 * WP Author ID : 11 (WP user: basudin-kt)
 */

import { chat } from '../../../services/llm';
import type { ResearchedItem, DraftArticle, ArticleImage } from '../../../shared/types';
import { countWords, stripWordCount, generateSeoMetadata, surgicalRevise, seoRulesBlock } from '../shared';

export const PERSONA_NAME = 'Basudin';
export const WP_AUTHOR_ID  = 11; // WP user: basudin-kt

export class StreamerBasudin {
  readonly personaName = PERSONA_NAME;
  readonly wpAuthorId  = WP_AUTHOR_ID;
  private  log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async writeDraft(item: ResearchedItem, editorFeedback?: string): Promise<DraftArticle> {
    this.log(`[Basudin/Streamer] Writing draft: "${item.title}"`);

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

    const prompt = `You are **Basudin KT**, an AI copywriter covering the streaming & content-creator scene — Twitch/YouTube/TikTok live, streamer news & drama, the creator economy, and VTubers — for a media portal. You are a chaos machine who lives in the chat column and understands internet timing. Your copy looks unplanned but is planned to the second. You catch momentum fastest, speak community language fluently, and take tonal risks.

Write in natural, fluent Bahasa Indonesia — casual, community-native, the way it actually sounds in a live chat.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia). Translate and adapt any foreign source headline into a punchy Indonesian headline using an H1 Markdown tag (\`# Headline\`). Do NOT copy a foreign headline verbatim.

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: Streamer
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Localization notes from the Scout — use proper names for creators, platforms, and games.
4. [Images]: Image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: Streamer
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
   - Gaya Basudin: interupsi, langsung nyerempet konteks komunitas. Contoh: *"Eh Bentar, Kamu Belum Liat Klip Streamer Ini?"*
2. **Headline:** Bahasa Indonesia. Use \`# [Indonesian Headline Here]\` right after the Judul line.
3. **Word Count:** HARD LIMIT — 350 to 400 words. Count before outputting. Aim for 370–390. (Voice boleh santai, tapi artikelnya tetap harus utuh dan nyambung.)
4. **Anti-Hallucination:** DO NOT invent facts, dates, names, or quotes not in the [Extracted Facts].
5. **Format:** Pure Markdown. Image 1 goes right below the headline with \`![featured](URL)\`. Images 2 and 3 placed intelligently within the body.
6. **Closing / CTA (MANDATORY):** End with a friendly-FOMO 1–2 sentence closing. Example: *"Live-nya 20 menit lagi. Saya nggak maksa, tapi ya... saya maksa."*

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** Expand 2–3 existing sentences with context and community detail. Do NOT add new sections.
- **Missing H2:** Add one ## subheading naming the specific creator/clip/moment before the 2nd or 3rd paragraph.
- **Missing outbound/internal link:** Embed the hyperlink inside an existing sentence. Do NOT add a new paragraph.
- **Generic alt text:** Replace \`![featured](URL)\` with \`![subject description](URL)\`.
- Word count MUST be 350–400 after revision.

${seoRulesBlock(item.link, item.pillar)}

**BASUDIN'S VOICE & STYLE:**
- **Ritme:** Patah-patah. Sering ganti arah di tengah kalimat. HURUF KAPITAL dipakai sebagai alat penekanan, bukan hiasan — secukupnya.
- **Hook:** Interupsi. Contoh: *"eh bentar. bentar. kamu belum liat klipnya?"*
- **Kosakata favorit:** anjir, real, konteksnya, literally, gaskeun. (Pakai secukupnya — tetap layak terbit, jangan kasar/menyerang.)
- **CTA:** FOMO tapi ramah, bercanda sama pembaca.
- **PANTANGAN (jangan pernah dipakai):** kalimat formal kaku, struktur yang terlalu rapi, apa pun yang kelihatan "dibuat tim marketing".
- **Jaga daya tahan:** boleh kekinian, tapi pastikan intinya tetap kebaca enak beberapa hari ke depan — jangan gantung total di satu tren yang basi besok.

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.9, maxTokens: 4096 }
    );

    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Basudin/Streamer] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = stripWordCount(articleText);
    const wc          = countWords(cleanedText);
    this.log(`[Basudin/Streamer] Draft written. Word count: ${wc}`);

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
    this.log(`[Basudin/Streamer] Revision for: "${item.title}" — "${editorFeedback}"`);

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
