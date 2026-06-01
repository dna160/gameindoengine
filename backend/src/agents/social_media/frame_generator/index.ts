/**
 * Agent 2: Frame Generator (The Art Director)
 *
 * Responsibilities:
 *   1. Vision Analysis — uses DeepSeek Vision to identify the Contextual Focal Point
 *      of the featured article image (x/y as percentages).
 *   2. Programmatic Execution — passes focal point coordinates + pillar to the
 *      image_processor tool, which crops, overlays the branded frame, and
 *      renders the image_copy text.
 *
 * Returns two rendered Buffers: Post (1:1) and Story (9:16).
 */

import { processImage } from './tools/image_processor';

interface FocalPoint {
  focal_x_pct:  number;
  focal_y_pct:  number;
  description:  string;
}

export class FrameGenerator {
  private log: (msg: string) => void;

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async generate(params: {
    featuredImageUrl: string;
    imageCopy:        string;
    pillar:           string;
    feedback?:        string; // from adversarial editor on retry
  }): Promise<{ postBuffer: Buffer; storyBuffer: Buffer }> {
    const { featuredImageUrl, imageCopy, pillar, feedback } = params;

    this.log(`[FrameGenerator] Analysing focal point for pillar: ${pillar}`);

    // ── Step 1: DeepSeek Vision — identify focal point ───────────────────────
    const focalPoint = await this.analyseFocalPoint(featuredImageUrl, feedback);
    this.log(
      `[FrameGenerator] Focal point → x:${focalPoint.focal_x_pct.toFixed(2)} ` +
      `y:${focalPoint.focal_y_pct.toFixed(2)} — "${focalPoint.description}"`
    );

    // ── Step 2: Programmatic execution — crop + frame + text ─────────────────
    this.log(`[FrameGenerator] Rendering post and story images…`);
    const { postBuffer, storyBuffer } = await processImage({
      imageUrl:  featuredImageUrl,
      imageCopy,
      pillar,
      focalXPct: focalPoint.focal_x_pct,
      focalYPct: focalPoint.focal_y_pct,
    });

    this.log(`[FrameGenerator] ✓ Post: ${postBuffer.length} bytes, Story: ${storyBuffer.length} bytes`);
    return { postBuffer, storyBuffer };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async analyseFocalPoint(imageUrl: string, feedback?: string): Promise<FocalPoint> {
    // DeepSeek V4 Flash does not support multimodal/vision inputs.
    // Fall back to a sensible centre-weighted default focal point.
    // This matches the --skip-vision behaviour used in test scripts.
    this.log('[FrameGenerator] Vision not supported by current model — using centre focal point (0.5, 0.4)');
    void imageUrl; // suppress unused-variable warning
    void feedback;
    return { focal_x_pct: 0.5, focal_y_pct: 0.4, description: 'centre (vision unavailable)' };
  }
}
