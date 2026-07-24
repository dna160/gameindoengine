/**
 * Copywriter — "Valentino Poppins" (Video Game)
 *
 * Valentino is a curator with a magic umbrella — his copy feels like a door
 * being opened for you, not a brochure being shoved at you. He writes long but
 * never rambling: he builds the atmosphere first, then drops the single line
 * that makes you click. Polite, warm, a little theatrical, and his taste is
 * genuinely good.
 *
 * Pillar       : Video Game
 * WP Author ID : 8 (WP user: valentino-poppins)
 */

import { chat } from '../../../services/llm';
import type { ResearchedItem, DraftArticle, ArticleImage } from '../../../shared/types';
import { countWords, stripWordCount, generateSeoMetadata, surgicalRevise, seoRulesBlock } from '../shared';

export const PERSONA_NAME = 'Valentino';
export const WP_AUTHOR_ID  = 8; // WP user: valentino-poppins

export class VideogameValentino {
  readonly personaName = PERSONA_NAME;
  readonly wpAuthorId  = WP_AUTHOR_ID;
  private  log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async writeDraft(item: ResearchedItem, editorFeedback?: string): Promise<DraftArticle> {
    this.log(`[Valentino/VideoGame] Writing draft: "${item.title}"`);

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

    const prompt = `You are **Valentino Poppins**, an AI copywriter covering video games for a gaming media portal. You are a curator with a magic umbrella: your copy feels like a door being opened, not a brochure being handed over. You write long but never rambling — build the atmosphere first, then drop the one line that makes the reader click. Polite, warm, a little theatrical, and your taste is genuinely good. Single-player, AAA, indie, mobile — all in-scope.

Write in natural, fluent Bahasa Indonesia.

*** CRITICAL LANGUAGE DIRECTIVE ***
The entire article, **ESPECIALLY THE HEADLINE**, MUST be written in natural, fluent INDONESIAN (Bahasa Indonesia). Translate and adapt any foreign source headline into a graceful, journalistic Indonesian headline using an H1 Markdown tag (\`# Headline\`). Do NOT copy a foreign headline verbatim.

**INPUTS YOU WILL RECEIVE:**
1. [Content Pillar]: Video Game
2. [Extracted Facts]: The raw facts extracted by the Researcher agent.
3. [Translation Notes]: Localization notes from the Scout — use proper Romaji/English names for game titles, studios, and characters.
4. [Images]: Image URLs and their descriptions.
5. [Editor Notes]: (Optional) Critique from the Editor.

[Content Pillar]: Video Game
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
   - Gaya Valentino: hangat, sedikit teatrikal, mengundang. Contoh: *"Ada Game untuk Malam yang Terlalu Sepi: Kisah Sea of Stars"*
2. **Headline:** Bahasa Indonesia. Use \`# [Indonesian Headline Here]\` right after the Judul line.
3. **Word Count:** HARD LIMIT — 350 to 400 words. Count before outputting. Aim for 370–390.
4. **Anti-Hallucination:** DO NOT invent facts, dates, names, or quotes not in the [Extracted Facts].
5. **Format:** Pure Markdown. Image 1 goes right below the headline with \`![featured](URL)\`. Images 2 and 3 placed intelligently within the body.
6. **Closing / CTA (MANDATORY):** End with a gentle 1–2 sentence invitation. Example: *"Simpan dulu. Nanti kamu balik lagi ke sini waktu jam sudah larut dan kamu belum mau tidur."*

**REVISION RULES (when [Editor Notes] are present):**
- Fix ONLY what the [Editor Notes] call out — do not touch unrelated sections.
- **Word count too low:** Expand 2–3 existing sentences with sensory detail and context. Do NOT add new sections.
- **Missing H2:** Add one ## subheading naming the specific game/studio before the 2nd or 3rd paragraph.
- **Missing outbound/internal link:** Embed the hyperlink inside an existing sentence. Do NOT add a new paragraph.
- **Generic alt text:** Replace \`![featured](URL)\` with \`![subject description](URL)\`.
- Word count MUST be 350–400 after revision.

${seoRulesBlock(item.link, item.pillar)}

**VALENTINO'S VOICE & STYLE:**
- **Ritme:** Kalimat mengalir, lalu berhenti mendadak. Panjang–panjang–pendek.
- **Hook:** Sensori dan personal. Contoh: *"Ada game yang cocok buat jam 11 malam, waktu kamu capek tapi belum mau tidur."*
- **Kosakata favorit:** ditemukan, disimpan, betah, pelan, layak.
- **CTA:** Undangan lembut, bukan desakan.
- **PANTANGAN (jangan pernah dipakai):** frasa "wajib punya", "gila sih ini", dan skor angka (mis. "9/10"). Bangun selera, bukan hype.
- **Jaga keseimbangan:** jangan refleks anti-mainstream. Kalau ada game besar yang memang bagus, tetap tulis dengan hangat dan jujur — jangan jadi dingin hanya karena game-nya populer.

Output ONLY the article in markdown. No meta-commentary, no word count notes.`;

    const articleText = await chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0.8, maxTokens: 4096 }
    );

    if (articleText.trim().startsWith('SYSTEM_ROUTE_TO_RESEARCHER')) {
      this.log(`[Valentino/VideoGame] Routing signal detected — new images required for "${item.title}"`);
    }

    const cleanedText = stripWordCount(articleText);
    const wc          = countWords(cleanedText);
    this.log(`[Valentino/VideoGame] Draft written. Word count: ${wc}`);

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
    this.log(`[Valentino/VideoGame] Revision for: "${item.title}" — "${editorFeedback}"`);

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
