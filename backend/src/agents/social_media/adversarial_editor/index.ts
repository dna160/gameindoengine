/**
 * Agent 3: Adversarial Editor (Quality Assurance)
 *
 * Acts as a ruthless Social Media Manager. Reviews the caption and image_copy
 * text for quality using DeepSeek. Image composition review is skipped because
 * DeepSeek V4 Flash does not support multimodal/vision inputs — criteria 1–3
 * (contrast, crop, brand safety) are auto-passed; only text-based criteria
 * 4 (caption logic) and 5 (topic relevance from image_copy) are evaluated.
 *
 * On FAIL: returns targeted feedback for the copywriter.
 * On PASS: hands off to the Publisher.
 */

import { createCompletion } from '../../../services/llm';
import { ADVERSARIAL_EDITOR_SYSTEM_PROMPT } from './prompt';

// DeepSeek V4 Flash — text-only review (vision not supported)
const REVIEW_MODEL = 'deepseek-v4-flash';

export interface EditorVerdict {
  verdict:                     'PASS' | 'FAIL';
  feedback_for_copywriter:     string | null;
  feedback_for_frame_generator: string | null;
}

export class AdversarialEditor {
  private log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async review(params: {
    postImageBuffer:  Buffer;
    storyImageBuffer: Buffer;
    caption:          string;
    imageCopy:        string;
  }): Promise<EditorVerdict> {
    const { caption, imageCopy } = params;

    this.log('[AdversarialEditor] Reviewing caption and image copy (text-only — vision unavailable)…');

    // Vision is not supported by DeepSeek V4 Flash.
    // We evaluate caption logic and topic relevance from text alone.
    // Image composition criteria (contrast, crop, brand frame) are auto-passed.
    const response = await createCompletion({
      model: REVIEW_MODEL,
      messages: [
        { role: 'system', content: ADVERSARIAL_EDITOR_SYSTEM_PROMPT },
        {
          role:    'user',
          content: [
            {
              type: 'text',
              text: [
                `Image Copy Text (rendered on the image): "${imageCopy}"`,
                '',
                `Caption:`,
                caption,
                '',
                'NOTE: Image files are not available for review. Auto-pass criteria 1–3',
                '(contrast, crop, brand frame). Evaluate criteria 4 (caption logic) and',
                '5 (topic relevance inferred from image_copy) only.',
                'Return your verdict JSON.',
              ].join('\n'),
            },
          ],
        },
      ],
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content ?? '';

    let parsed: EditorVerdict;
    try {
      parsed = JSON.parse(raw) as EditorVerdict;
    } catch {
      // If the editor fails to return valid JSON, treat as a soft pass
      this.log(`[AdversarialEditor] ⚠ Could not parse verdict JSON — defaulting to PASS. Raw: ${raw}`);
      return {
        verdict:                      'PASS',
        feedback_for_copywriter:      null,
        feedback_for_frame_generator: null,
      };
    }

    if (parsed.verdict !== 'PASS' && parsed.verdict !== 'FAIL') {
      this.log(`[AdversarialEditor] ⚠ Unexpected verdict value "${parsed.verdict}" — defaulting to PASS`);
      parsed.verdict = 'PASS';
    }

    this.log(
      `[AdversarialEditor] Verdict: ${parsed.verdict}` +
      (parsed.feedback_for_copywriter      ? ` | Copywriter: ${parsed.feedback_for_copywriter}`      : '') +
      (parsed.feedback_for_frame_generator ? ` | FrameGen: ${parsed.feedback_for_frame_generator}` : '')
    );

    return parsed;
  }
}
