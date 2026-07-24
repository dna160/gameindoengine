# Synthetic Newsroom POC — Implementation Guide

A fully autonomous newsroom pipeline that ingests RSS feeds, researches visual context, drafts articles, and enforces editorial guardrails with a revision loop. Built with Node.js + React + Prisma + Grok-4.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Dashboard (React)               │
│  • Newsroom Floor (pipeline status, per-pillar metrics)    │
│  • Review Room (color-coded articles: GREEN/YELLOW/RED)    │
│  • Live logs streaming from pipeline                       │
└─────────────────────────────────────────────────────────────┘
                              ↕ (HTTP REST API)
┌─────────────────────────────────────────────────────────────┐
│                  Backend Server (Express.js)                │
│  • /api/articles (list, get, publish, discard)            │
│  • /api/pipeline/trigger (manual run)                      │
│  • /api/pipeline/abort (kill running pipeline)            │
│  • /api/pipeline/status (polling endpoint)                │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│              Pipeline Worker (Node Worker Thread)           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent 1: Scout (RSS Feeder & Triage)             │   │
│  │  • Scrapes 10 RSS feeds (2 per pillar)            │   │
│  │  • Returns raw topics for Researcher review       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent 2: Researcher (Investigation & Images)      │   │
│  │  • Deep-evaluates topics vs 5 pillars             │   │
│  │  • SERPER Google Image Search                     │   │
│  │  • Grok vision to validate 3 images per article   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent 3: Copywriter (Draft Writer)               │   │
│  │  • Writes 300–400 word articles                   │   │
│  │  • Pillar-specific tone (esports, videogame, etc.)│   │
│  │  • Intelligent image placement in markdown       │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent 4: Editor-in-Chief (Revision Loop)         │   │
│  │  • Full editorial review (writing, tone, facts)    │   │
│  │  • Auto-fix minor grammatical issues             │   │
│  │  • Push back for major rewrites                  │   │
│  │  • Request image replacement on context failure  │   │
│  │  • Max 3 revision loops → FAILED if exhausted     │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  • WordPress REST API (auto-publish GREEN articles)        │
│  • Prisma + SQLite (persistent state)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Core Technologies

| Component | Tech | Purpose |
|-----------|------|---------|
| **Backend** | Node.js + TypeScript + Express | REST API, pipeline orchestration |
| **Frontend** | React + TypeScript + Vite + Tailwind | Dashboard, real-time status |
| **Database** | Prisma + SQLite | Article state, pipeline runs, logs |
| **LLM Engine** | Grok-4.1-fast-reasoning (xAI) | All agent reasoning (text + vision) |
| **Image Search** | SERPER Google Search API | Find contextual images |
| **CMS** | WordPress REST API | Auto-publish GREEN articles |
| **Concurrency** | Node.js Worker Threads | Pipeline runs in isolated thread |

---

## 3. The 5 Content Pillars

The entire pipeline is strictly organized around these five content verticals:

1. **Esports** (`esports`) — competitive gaming, tournaments, pro players, MOBA/FPS scene
2. **Video Game** (`videogame`) — video game news, releases, reviews, single-player/AAA/indie
3. **Entertainment** (`entertainment`) — movies, music, celebrities, TV, pop culture
4. **Teknologi** (`tech`) — gadgets, hardware, software, consumer tech, AI
5. **Streamer** (`streamer`) — live streaming, content creators, Twitch/YouTube/TikTok live

Every article is tagged with one pillar. Scout must find exactly **2 articles per pillar (10 total)** in each run.

---

## 4. The 4-Agent Pipeline

### Agent 1: Scout (RSS Feeder & Triage)
**File:** `backend/src/agents/scout.ts`

- Scrapes 10 RSS feeds (2 per pillar)
- Extracts: title, link, raw HTML/summary
- Quotas: strict enforcement (exactly 2/pillar)
- **Feedback Loop:** If Researcher rejects a topic, Scout keeps searching until quota is met

**RSS Feeds:** (feed sources are being cleared and replaced for the new taxonomy — TBD)
```
Esports:
  - TBD

Video Game:
  - TBD

Entertainment:
  - TBD

Teknologi:
  - TBD

Streamer:
  - TBD
```

---

### Agent 2: Researcher (Investigation & Images)
**File:** `backend/src/agents/researcher.ts`

**Step 1: Topic Evaluation**
- Uses Grok to deep-check relevance to declared pillar
- Rejects off-topic articles → Scout feedback loop
- Accepts → passes to fact extraction

**Step 2: Fact Extraction**
- Grok extracts 5–8 key facts from title/summary
- Passed to Copywriter for accurate writing

**Step 3: Image Sourcing (3 rounds)**
- SERPER Google Image Search (multiple query variants)
- For each image: uses **Grok vision** to validate relevance
- Loop: find 3 approved images, or exhaust 5 search rounds
- **Warning:** If <3 images found, article still proceeds (with fewer images)

---

### Agent 3: Copywriter (Draft Writer)
**File:** `backend/src/agents/copywriter.ts`

- **Input:** topic, facts, 3 images
- **Output:** markdown article (300–400 words)
- **Tone:** tailored per pillar (e.g., esports = sharp/tactical, entertainment = warm/conversational)
- **Image Placement:** intelligently embeds 3 images where they provide context
- **Format:** markdown with `[featured]` label on first image for WordPress

**Pillar Tone Guides:** (persona per pillar)
```typescript
esports:       "Gani Fighter (Gani) — sharp, tactical, competitive-scene energy"
videogame:     "Valentino Poppins (Valentino) — curator, warm, tasteful recommendations"
entertainment: "Kanata Reyes (Kanata) — warm, conversational entertainment insider"
tech:          "Bunted Cargo (Bunted) — precise, deadpan, honest tech"
streamer:      "Basudin KT (Basudin) — chaotic, community-native streamer voice"
```

---

### Agent 4: Editor-in-Chief (Revision Loop)
**File:** `backend/src/agents/editor.ts`

**Review Checklist:**
- ✓ Writing quality (grammar, clarity, flow)
- ✓ Tone match (pillar-specific)
- ✓ Hallucination check (facts align with source)
- ✓ Image context placement (do images make sense where placed?)
- ✓ Word count (300–400 words)

**Outcomes:**

| Issue Type | Action | Max Attempts |
|-----------|--------|--------------|
| **PASS** | Auto-publish (GREEN) or wait for human (YELLOW) | — |
| **MINOR** (typo, formatting) | Editor auto-fixes, approves | — |
| **MAJOR** (tone, hallucination, structure) | Push back to Copywriter for rewrite | 3 |
| **IMAGE** (context, relevance) | Request new images from Researcher | 3 |
| **EXHAUSTED** (3 failures) | Mark RED, human intervention needed | — |

---

## 5. Article State Machine

```
        Scout         Researcher      Copywriter       Editor
         ↓                ↓                ↓              ↓
    [PROCESSING] ──── [PROCESSING] ──── [PROCESSING] ──── [PROCESSING]
         ↓                ↓                ↓              ↓
       REJECT          REJECT           REVIEW        REVISION LOOP
         ↓                ↓                ↓              ↓
      (feedback)     (feedback)    ┌─────┴──────┬───────┴────┐
                                   ↓            ↓            ↓
                                 PASS        FAIL:        FAIL:
                                           MAJOR       IMAGES
                                   (rewrite)    (new images)
                                   ↓            ↓
                    ┌──────────────┴────────────┘
                    ↓
            TRY AGAIN (Max 3)
                    ↓
         ┌──────────┴──────────┐
         ↓                     ↓
      SUCCESS              FAILED (3 strikes)
         ↓                     ↓
      [FINAL STATUS]      [RED]
         ↓
    ┌────┴──────┐
    ↓           ↓
  GREEN      YELLOW
    ↓           ↓
  AUTO-      HUMAN
 PUBLISH     REVIEW

Legend:
  GREEN:  Passed on first try (or auto-fix only) → auto-published to WordPress
  YELLOW: Passed after 1–3 revisions → dashboard review, human publish
  RED:    Failed all 3 revision attempts → dashboard review, human fix/discard
  FAILED: Rejected by Researcher or exhausted quota → skipped this run
```

---

## 6. Database Schema

**Prisma:**
```prisma
model Article {
  id              String   @id @default(cuid())
  title           String
  pillar          String   // esports | videogame | entertainment | tech | streamer
  sourceUrl       String
  status          String   // PROCESSING | GREEN | YELLOW | RED | FAILED | PUBLISHED
  revisionCount   Int      @default(0)
  content         String?  // markdown
  contentHtml     String?  // HTML for WordPress
  images          Json?    // [{url, alt, isFeatured}, ...]
  editorNotes     String?  // feedback from Editor
  wpPostId        Int?
  wpPostUrl       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ProcessedUrl {
  id        String   @id @default(cuid())
  url       String   @unique
  createdAt DateTime @default(now())
}

model PipelineRun {
  id              String   @id @default(cuid())
  status          String   // RUNNING | COMPLETED | FAILED | ABORTED
  articlesProcessed Int @default(0)
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  logs            String?  // JSON stringified [{ timestamp, level, message, agent }, ...]
}
```

---

## 7. REST API Endpoints

### Articles

```
GET /api/articles
  Returns: Article[]
  Polls every 5s in dashboard

GET /api/articles/:id
  Returns: Article (full content)

POST /api/articles/:id/publish
  Body: {} (empty)
  Action: Push YELLOW/RED article to WordPress
  Returns: { wpPostId, wpPostUrl }

DELETE /api/articles/:id
  Action: Discard RED article
```

### Pipeline

```
POST /api/pipeline/trigger
  Action: Start a new pipeline run
  Returns: { message: "Pipeline triggered successfully" }
  Error: 409 if already running

POST /api/pipeline/abort
  Action: Kill the running pipeline worker thread instantly
  Returns: { aborted: true }
  Marks run as ABORTED in DB
  Error: 409 if not running

GET /api/pipeline/status
  Returns: {
    isRunning: boolean,
    currentRun: { id, status, articlesProcessed, logs: [...] } | null,
    lastRun: { id, status, articlesProcessed, logs: [...] } | null
  }

GET /api/pipeline/logs
  Legacy endpoint (deprecated, use /status instead)
```

### Dashboard

```
GET /api/dashboard/stats
  Returns: {
    total: number,
    byStatus: { GREEN, YELLOW, RED, FAILED },
    byPillar: { esports, videogame, entertainment, tech, streamer }
  }
```

---

## 8. Frontend Features

### Newsroom Floor (Left Panel)
- **Status Pill:** Running / Idle indicator
- **Article Counts:** Per-pillar breakdown in real-time
- **Metrics:** Total processed, passing, failing
- **Live Logs:** Scrollable log viewer (updates every 5s)
- **Manual Trigger:** "Run Pipeline Now" button (disabled while running)
- **Abort Button:** Red "Abort" button (only visible while running, asks confirmation)

### Review Room (Right Panel)
- **Tabs:** All (5) | Pending (0) | Failed (0) | Auto-Pass (1) | Published (1) | Processing (1) | 3-Strike (2)
- **Search:** Filter by title, URL, pillar
- **Sort:** Latest, oldest, by pillar
- **Color-Coded Cards:**
  - 🟢 **GREEN:** Auto-published, ready-only, "View on WordPress" link
  - 🟡 **YELLOW:** Blue "Publish to WP" button, shows revision count
  - 🔴 **RED:** Red "Discard" button, shows editor notes (why it failed)
- **Article Details:** Title, pillar badge, revision count, source URL, thumbnail image

### Dashboard Header
- Logo + title
- Status pill (Running/Idle) with pulse animation
- **Abort button** (red, appears only during pipeline run)
- Refresh indicator + poll interval display (5s)

---

## 9. The Abort Mechanism

**Architecture:** Pipeline runs in a **Node.js Worker Thread**.

**Why Worker Threads?**
- Each Worker is a separate thread with its own event loop
- `worker.terminate()` immediately stops execution — no waiting for `await` to complete
- LLM calls blocking inside the thread are forcibly interrupted
- Parent process remains responsive (can accept new API requests)

**Flow:**

```typescript
// Parent (Express server)
export async function abortPipeline(): Promise<boolean> {
  if (!worker) return false;

  // 1. Flip UI flag immediately
  isRunning = false;

  // 2. Mark DB as ABORTED right away
  await prisma.pipelineRun.update({
    where: { id: currentRunId },
    data: { status: 'ABORTED', completedAt: new Date() }
  });

  // 3. Hard-kill the worker thread
  await worker.terminate();

  // 4. Reset state
  worker = null;
  currentRunId = null;

  return true;
}
```

**UI Response Time:** Instant. On the next poll (max 5s), dashboard shows:
- Status pill: "Idle"
- Abort button: disappears
- Last run: shows status "ABORTED" with full logs of what ran before termination

---

## 10. Setup & Running

### Prerequisites
```bash
Node.js 18+
npm/yarn
SQLite3 (included with Prisma)
```

### Environment Setup

**`backend/.env`**
```
# xAI Grok API
XAI_API_KEY=your_xai_api_key_here
XAI_BASE_URL=https://api.x.ai/v1
XAI_MODEL=grok-4.1-fast-reasoning

# Image Search
SERPER_API_KEY=your_serper_api_key_here

# WordPress (optional for auto-publish)
WP_URL=https://your-wordpress-site.com
WP_USERNAME=your_username
WP_APP_PASSWORD=your_app_password

# Database
DATABASE_URL="file:./dev.db"

# Server
PORT=3003
```

### Install & Run

```bash
# 1. Root setup
npm run setup          # Installs deps + migrates DB

# 2. Development
npm run dev            # Starts backend (3003) + frontend (5173) concurrently

# 3. Production (manual)
cd backend && npm run dev:backend &
cd frontend && npm run dev:frontend &
```

### Directory Structure

```
/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── scout.ts
│   │   │   ├── researcher.ts
│   │   │   ├── copywriter.ts
│   │   │   └── editor.ts
│   │   ├── services/
│   │   │   ├── llm.ts              # Grok client
│   │   │   ├── rss.ts              # Feed fetching
│   │   │   ├── serper.ts           # Image search
│   │   │   └── wordpress.ts        # WP REST API
│   │   ├── pipeline.ts             # 4-agent orchestrator
│   │   ├── pipeline-runner.ts      # Worker thread entry point
│   │   ├── continuous-pipeline.ts  # Cron + Worker management
│   │   └── server.ts               # Express API
│   ├── prisma/
│   │   └── schema.prisma
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── NewsroomFloor.tsx
│   │   │   ├── ReviewRoom.tsx
│   │   │   └── ArticleCard.tsx
│   │   ├── pages/
│   │   │   └── Dashboard.tsx
│   │   ├── api.ts                  # HTTP client
│   │   └── types.ts
│   └── vite.config.ts
├── shared/
│   └── types.ts                    # Shared TS types
├── README.md
└── IMPLEMENTATION.md               # This file
```

---

## 11. Syntax Index & Command Reference

### Running Commands

```bash
# Start full stack
npm run dev

# Start backend only
cd backend && npm run dev

# Start frontend only
cd frontend && npm run dev

# Database
cd backend && npx prisma studio          # GUI DB browser
cd backend && npx prisma db push         # Migrate schema
cd backend && npx prisma generate        # Generate Prisma Client

# Lint/Format
npm run lint
npm run format

# Build for production
npm run build
```

### API Calls

```bash
# Trigger pipeline
curl -X POST http://localhost:3003/api/pipeline/trigger

# Abort pipeline
curl -X POST http://localhost:3003/api/pipeline/abort

# Get status
curl http://localhost:3003/api/pipeline/status

# List articles
curl http://localhost:3003/api/articles

# Publish article to WordPress
curl -X POST http://localhost:3003/api/articles/{id}/publish

# Discard article
curl -X DELETE http://localhost:3003/api/articles/{id}
```

### Environment Variables

| Var | Example | Notes |
|-----|---------|-------|
| `XAI_API_KEY` | `xai-...` | Get from platform.x.ai |
| `SERPER_API_KEY` | `serper-...` | Get from serper.dev |
| `WP_URL` | `https://site.com` | WordPress site root |
| `WP_USERNAME` | `admin` | WordPress user |
| `WP_APP_PASSWORD` | `xxxx xxxx xxxx xxxx` | 16-char app password |
| `DATABASE_URL` | `file:./dev.db` | SQLite path |
| `PORT` | `3003` | Backend port |

### Git Workflow

```bash
# Start new feature
git checkout -b feature/my-feature

# Commit changes
git commit -m "Add feature X"

# Push to remote
git push origin feature/my-feature

# Create PR
gh pr create --title "Add feature X" --body "Description..."
```

---

## 12. Key Implementation Details

### Grok Vision Integration

```typescript
// Text completion
const response = await client.messages.create({
  model: "grok-4.1-fast-reasoning",
  max_tokens: 1000,
  messages: [{ role: "user", content: prompt }]
});

// Vision (image relevance eval)
const visionResponse = await client.messages.create({
  model: "grok-4.1-fast-reasoning",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Is this image relevant to X?" },
      { type: "image", source: { type: "url", url: imageUrl } }
    ]
  }]
});
```

### Markdown → HTML Conversion

```typescript
import { marked } from 'marked';

const htmlContent = await marked.parse(markdownContent);
// Upload to WordPress as `content` (HTML field)
```

### WordPress REST API Auth

```typescript
const credentials = Buffer.from(`${username}:${appPassword}`).toString('base64');
const response = await fetch(`${wpBaseUrl}/wp-json/wp/v2/posts`, {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: article.title,
    content: htmlContent,
    featured_media: imageId,
    status: 'publish'
  })
});
```

### Processing URL Deduplication

```typescript
// Check if URL was processed before
const existing = await prisma.processedUrl.findUnique({
  where: { url: sourceUrl }
});

if (!existing) {
  // New URL — process it
  await prisma.processedUrl.create({
    data: { url: sourceUrl }
  });
}
```

---

## 13. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Pipeline never starts | `isRunning` flag stuck true | Restart backend |
| SERPER 403 errors | Invalid/missing API key | Check `.env` XAI_API_KEY |
| Images not found | SERPER rate limit or down | Wait 5min, try again |
| WordPress 401 | Bad credentials | Re-check WP_USERNAME, WP_APP_PASSWORD |
| Database locked | Concurrent writes | Restart backend |
| Abort doesn't work | Worker not initialized | Ensure pipeline actually running (check logs) |
| High latency | Grok overloaded | Inherent LLM latency — normal |

---

## 14. Next Steps & Extensions

- [ ] **Scheduling:** Replace cron with proper job queue (BullMQ, etc.)
- [ ] **Multi-tenant:** Support multiple WordPress sites
- [ ] **Analytics:** Track success rates, avg revision count, pillar performance
- [ ] **Webhooks:** Notify external systems on article state changes
- [ ] **Rollback:** Ability to unpublish articles from WordPress
- [ ] **Bulk operations:** Publish/discard multiple articles at once
- [ ] **A/B testing:** Compare article performance across variants
- [ ] **Custom prompts:** Allow users to write/upload custom agent prompts

---

## 15. License & Credits

Built as a POC (Proof of Concept) demonstrating autonomous newsroom automation.

**Technologies:** OpenAI-compatible Grok API, Prisma, React, Node.js
**Data:** RSS feeds from ANN, Crunchyroll, Siliconera, Tokyo Reporter, SoraNews24, CBR, and others
**Styling:** Tailwind CSS

---

**Last Updated:** April 3, 2026
**Version:** 1.1.0

---

## Changelog — Session 2 (2026-04-03)

### Scout & Master Orchestrator — Strict Handover Protocol

**Files:** `backend/src/agents/scout.ts`, `backend/src/orchestrator/index.ts`

The Scout was refactored from a self-managing agent into a pure stateless dispatcher. All quota logic moved exclusively to the Master Orchestrator.

- Introduced `ScoutPayload` interface with three dispatch modes: `round_1`, `underquota_protocol`, `fallback_protocol`
- Removed internal quota tracking from Scout — Master owns `ARTICLES_PER_PILLAR = 10`, `TARGET_CANDIDATES_PER_PILLAR = 10`, `MAX_SCOUT_ROUNDS = 10`, `MAX_SCOUT_EMPTY_ROUNDS = 3`
- Added `triageAll()` — returns ALL approved items with no quota cap; Master caps via `processHandover()`
- Added `orchestrateScoutingPhase()` to Orchestrator — full Master quota loop implementing the 3-tier dispatch sequence
- Per-run Scout state (`triagedUrls`, `FeedMemory`) resets only on `round_1` dispatch

---

### 3-Tier Feed Hierarchy

**Files:** `backend/src/services/rss.ts`, `backend/src/agents/scout.ts`

| Tier | Label | Feeds | Scout Mode |
|------|-------|-------|------------|
| Tier 2 | Preferred — General | `PRIORITY_FEEDS` | `round_1` |
| Tier 1 | Priority — Subpillar | `RSS_FEEDS` | `underquota_protocol` |
| Tier 3 | Fallback — Broadest Net | All `RSS_FEEDS` scored by FeedMemory | `fallback_protocol` |

- All feeds tagged with niche labels: `[esports]`, `[videogame]`, `[entertainment]`, `[tech]`, `[streamer]`
- Added **Tokyohive** and **Oricon** (4 sections: general, music, movie, lifestyle) to both Tier 2 and Tier 1
- Populated previously empty `RSS_FEEDS.esports` and `RSS_FEEDS.entertainment`

---

### Fix — Underquota Pool Returns 0 Items

**File:** `backend/src/agents/scout.ts`

**Problem:** Round 1 and underquota shared a single `triagedUrls` set. Round 1 loaded ~100 URLs into it; when `underquota_protocol` ran, `buildPool()` filtered against the same set and found nothing new.

**Fix:** Split into two independent sets — `round1TriagedUrls` and `underquotaTriagedUrls`. The two tiers never cross-contaminate, so Tier 1 feeds always get a clean pool.

---

### Fix — Protocol Escalation (Results-Driven, Not Round-Count-Driven)

**File:** `backend/src/orchestrator/index.ts`

**Problem:** Escalation from `underquota_protocol` to `fallback_protocol` was triggered by `scoutRound <= 4` — an arbitrary number — causing fallback to activate prematurely.

**Fix:** Escalation is now driven by empty-round counts:
1. All deficit rounds → `underquota_protocol`
2. After `MAX_SCOUT_EMPTY_ROUNDS` consecutive empty underquota rounds → escalate once to `fallback_protocol`
3. After `MAX_SCOUT_EMPTY_ROUNDS` consecutive empty fallback rounds → proceed with partial quota

---

### Fix — Scout Pool Cap Not Respected

**File:** `backend/src/agents/scout.ts`

**Problem:** `buildPool()` returned `[...shuffle(topFresh), ...rest]`, appending all items beyond the cap. A 100-item cap produced 210-item pools.

**Fix:** `return shuffle(topFresh)` — hard stop at `maxItems`. `FRESH_POOL_SIZE = 100`, `RETRY_POOL_SIZE = 50`.

---

### Fix — Headline Duplication in Published Articles

**File:** `backend/src/orchestrator/index.ts`

**Problem:** Copywriters write `# Indonesian Headline` as H1 in the markdown body. The orchestrator stored the full content including the H1, causing the headline to render twice.

**Fix:** Added `stripH1()` applied to `bodyContent` before DB storage and HTML conversion. Editor still receives the full draft with H1 intact for its headline validation check.

---

### Fix — LLM Request Timeout (Pipeline Freeze Prevention)

**File:** `backend/src/services/llm.ts`

**Problem:** A Grok API call hung indefinitely — pipeline froze for 7+ hours with no recovery.

**Fix:** Added `withTimeout()` wrapper with a 90-second hard deadline on all `llmClient.chat.completions.create()` calls. Timeout throws an error caught by the calling agent, allowing the pipeline to continue.

```
CHAT_TIMEOUT_MS = 90_000
```

---

### Fix — LLM Word Count Annotations in Article Content

**Files:** `backend/src/agents/copywriter.ts` + all 5 persona files

**Problem:** Despite prompt instructions, the LLM appended trailing word-count lines (`**Word count: 350 words**`, `*(350 words)*`, etc.) to article content, which appeared verbatim in published articles.

**Fix:** Added `stripWordCount()` to all 6 copywriter classes. Applied to `articleText` before storage and word-count validation. Handles all common annotation formats including `---` separator variants.

---

### Topic Bank — Overflow Reserve & Cross-Run Recall

**Files:** `backend/src/services/topic-bank.ts`, `backend/src/orchestrator/index.ts`

Implements the "Brain reserve pool": Scout-approved articles that don't fit the current run's quota are persisted and recalled in future runs or as mid-run fallback when a pillar queue is exhausted.

**`TopicBank` service (`topic-bank.ts`):**
- Persists pre-triaged `ScoutItem`s to `data/topic-bank.json` (FIFO, oldest-first recall)
- Items older than `MAX_AGE_DAYS = 14` are pruned on load
- `pruneProcessed(processedSet)` removes items whose source URLs are already in `ProcessedUrl` DB
- `recall(pillar, n)` pops up to `n` items for a given pillar
- `add(items)` banks overflow items, deduplicating by URL

**Orchestrator integration:**
- `orchestrateScoutingPhase()` loads the bank at start; pre-fills pillar buckets from banked topics before dispatching Scout — Scout only fetches remaining slots
- `processHandover()` banks all bucket-overflow topics (LLM-approved but pillar already full) instead of silently dropping them
- `runPillarQueue()` recalls banked topics as backup when the main candidate pool is exhausted mid-pillar before the article target is reached
- Banked topics never reached during the run are re-banked for the next run

**Workflow:**
```
Scout triage → esports bucket full → topic banked
Next run     → esports bank recalled → Scout fills only remaining slots
Mid-run      → 3 editor strikes → banked topic recalled → Researcher → Copywriter
```

---

### Editor — Judul Line Validation

**File:** `backend/src/agents/editor.ts`

Added a new first-pass check: the article must begin with a `**Judul:**` metadata line before the H1.

- `**Judul:**` line missing → FAIL "judul line missing"
- Title after `**Judul:**` exceeds 15 words → FAIL "article title over 15 words"
- Truncated or incomplete titles also fail

---

### Pending

- **WordPress `rest_invalid_author` 400** — Publisher fails with invalid author IDs; WP_AUTHOR_IDs in copywriter persona files don't match actual WP instance users. Non-blocking.
- **Editor false-failing Indonesian headlines** — Editor rejects with "headline still in Japanese" even when copywriter wrote a correct Indonesian H1. Suspected cause: Editor checking `draft.title` (Japanese source title) instead of H1 in `draft.content`.
