# PRD: Migrate LLM Provider — Grok (xAI) → DeepSeek V4 Flash

**Document type:** Product Requirements Document  
**Author:** Engineering  
**Date:** 2026-06-01  
**Status:** ✅ IMPLEMENTED  
**Priority:** High  
**Repo:** https://github.com/dna160/popshckv3  

---

## 1. Executive Summary

The Popshck synthetic newsroom backend previously used xAI's Grok (`grok-4-1-fast-reasoning` + `grok-4-fast-non-reasoning` for vision) via the xAI API (`https://api.x.ai/v1`) and the `openai` npm SDK.

Cost overruns from Grok pricing triggered an immediate provider migration to **DeepSeek V4 Flash** (`deepseek-v4-flash`).

**Key constraint:** No OpenAI SDK or any OpenAI-branded package is permitted. The LLM layer is now implemented using **native Node.js `fetch`** against DeepSeek's HTTP API directly — zero external AI SDK dependency.

---

## 2. What Changed

### 2.1 Dependency removal

| Before | After |
|---|---|
| `openai: ^4.28.0` in `package.json` | **Deleted** — package fully uninstalled |
| 22 transitive packages from `openai` | **Removed** from `node_modules` and `package-lock.json` |

### 2.2 Provider & model

| Before | After |
|---|---|
| `baseURL: https://api.x.ai/v1` | `https://api.deepseek.com` |
| `MODEL = 'grok-4-1-fast-reasoning'` | `MODEL = 'deepseek-v4-flash'` |
| `VISION_MODEL = 'grok-4-fast-non-reasoning'` | `VISION_MODEL = 'deepseek-v4-flash'` |
| `XAI_API_KEY` env var | `DEEPSEEK_API_KEY` env var |

### 2.3 Architecture change

The `llmClient` (an `OpenAI` class instance) is **gone**. It is replaced by:
- `createCompletion(params)` — a plain async function that calls DeepSeek's HTTP API with native `fetch`, returns a typed `DeepSeekResponse`
- `chat()` / `evaluateImageRelevance()` — unchanged high-level helpers, now backed by `createCompletion()`

All three agents that previously called `llmClient.chat.completions.create()` directly (`hook_copywriter`, `adversarial_editor`, `frame_generator`) now call `createCompletion()` instead.

---

## 3. Files Changed

### `backend/src/services/llm.ts` — **Full rewrite**
- Removed: `import OpenAI from 'openai'`
- Removed: `export const llmClient = new OpenAI({...})`
- Removed: all `OpenAI.*` type references
- Added: `DEEPSEEK_API_KEY` env var guard
- Added: `DEEPSEEK_BASE_URL = 'https://api.deepseek.com'`
- Added: `MODEL = 'deepseek-v4-flash'`
- Added: own `ContentPart`, `ChatMessage`, `DeepSeekResponse` types
- Added: `export async function createCompletion(...)` — native fetch HTTP client
- Updated: rate limiter from 900 → 60 req/min (conservative DeepSeek start)
- Updated: all JSDoc comments (removed "Grok" / "xAI API")

### `backend/src/agents/social_media/hook_copywriter/index.ts`
- `import { llmClient, MODEL }` → `import { createCompletion, MODEL }`
- `llmClient.chat.completions.create({...})` → `createCompletion({...})`

### `backend/src/agents/social_media/adversarial_editor/index.ts`
- `import { llmClient }` → `import { createCompletion }`
- `VISION_MODEL = 'grok-4-fast-non-reasoning'` → `'deepseek-v4-flash'`
- `llmClient.chat.completions.create({...})` → `createCompletion({...})`
- Updated JSDoc: "Grok Vision" → "DeepSeek Vision"

### `backend/src/agents/social_media/frame_generator/index.ts`
- `import { llmClient }` → `import { createCompletion }`
- `VISION_MODEL = 'grok-4-fast-non-reasoning'` → `'deepseek-v4-flash'`
- `llmClient.chat.completions.create({...})` → `createCompletion({...})`
- Updated comments: "Grok Vision" → "DeepSeek Vision"

### `backend/src/agents/social_media/frame_generator/prompt.ts`
- Updated JSDoc: "Grok Vision" → "DeepSeek Vision"

### `backend/src/agents/social_media/test-sandbox.ts`
- Updated 4 references: "Grok Vision" → "DeepSeek Vision", `XAI_API_KEY` → `DEEPSEEK_API_KEY`

### `backend/src/agents/social_media/test-live-post.ts`
- Updated 2 references: "Grok Vision" → "DeepSeek Vision"

### `backend/src/agents/researcher.ts`
- Updated 2 JSDoc references: "Grok vision" → "DeepSeek vision"

### `backend/.env.example`
- `XAI_API_KEY=your_xai_api_key` → `DEEPSEEK_API_KEY=your_deepseek_api_key` (with platform URL hint)

### `backend/.env` *(live secrets — gitignored)*
- Replaced `XAI_API_KEY`, `XAI_BASE_URL`, `XAI_MODEL` with `DEEPSEEK_API_KEY` placeholder
- **ACTION REQUIRED:** Replace `your_deepseek_api_key_here` with real key from https://platform.deepseek.com

### `backend/dist/` *(build artifacts)*
- **Deleted entirely** — contained stale compiled JS/d.ts files with old Grok/OpenAI references. Will be regenerated on next `npm run build`.

### `backend/package.json`
- Removed `"openai": "^4.28.0"` from `dependencies`

### `backend/package-lock.json`
- `openai` and its 22 transitive packages removed (via `npm uninstall openai`)

---

## 4. What Was NOT Changed

- `backend/data/topic-bank.json` — contains the word "Grok" inside a Japanese article title (`『魔法使いの夜』コラボ、Grok翻訳で...`). This is **content data**, not code — intentionally left untouched.
- All agent prompts, business logic, and pipeline orchestration — zero functional changes.
- All other services (`serper.ts`, `rss.ts`, `crawler.ts`, `wordpress.ts`, etc.) — do not reference OpenAI or Grok.
- Frontend — no LLM references.

---

## 5. DeepSeek API Notes

### 5.1 Authentication
Standard Bearer token: `Authorization: Bearer <DEEPSEEK_API_KEY>`  
Obtain keys at: https://platform.deepseek.com

### 5.2 Vision (multimodal)
DeepSeek V4 Flash supports multimodal inputs. The existing `data:image/jpeg;base64,...` inline image format used by `adversarial_editor` and `frame_generator` is fully supported. The `resizeForReview()` helper (downsizes to 540px before encoding) is kept as-is.

### 5.3 Response format
Identical to OpenAI's Chat Completions spec:
```json
{ "choices": [{ "message": { "content": "..." } }] }
```
All existing `response.choices[0]?.message?.content` access patterns work unchanged.

### 5.4 Rate limits
Rate limiter set to **60 req/min** as a safe starting point. Increase the `RateLimiter(60)` constructor argument in `llm.ts` once your DeepSeek account tier is confirmed.

---

## 6. Remaining Action Items (Operator)

- [ ] **Add real DeepSeek API key** to `backend/.env` — replace `your_deepseek_api_key_here`
- [ ] **Update Railway environment variables** — add `DEEPSEEK_API_KEY`, remove `XAI_API_KEY` / `XAI_BASE_URL` / `XAI_MODEL`
- [ ] **Run smoke test** — `npm run social:test:fast` (skip-vision) then `npm run social:test` (full vision)
- [ ] **Tune rate limiter** — update `RateLimiter(60)` in `llm.ts` to match your DeepSeek tier's actual limit
- [ ] **Revoke xAI key** — delete `xai-SlCs...` from xAI dashboard once migration is validated

---

## 7. Verification Checklist

- [x] `grep -ri "openai|xai|grok|XAI_API_KEY" backend/src` → **zero results**
- [x] `openai` removed from `package.json` dependencies
- [x] `npm uninstall openai` completed — 22 packages removed
- [x] `backend/dist/` deleted — no stale compiled artifacts
- [x] `backend/.env.example` updated to `DEEPSEEK_API_KEY`
- [ ] `DEEPSEEK_API_KEY` set in live `.env` and Railway
- [ ] `npm run social:test` passes end-to-end

---

*End of PRD*
