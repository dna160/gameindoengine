/**
 * Continuous Pipeline Worker
 *
 * Runs the pipeline inside a Worker Thread.
 * worker.terminate() instantly kills it — no waiting for LLM calls to finish.
 */

import cron from 'node-cron';
import { Worker } from 'worker_threads';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const CRON_SCHEDULE = process.env.PIPELINE_CRON_SCHEDULE || '0 */2 * * *';

let worker: Worker | null = null;
let isRunning = false;
let currentRunId: string | null = null;

// Poll DB every 2s to track the active runId once the worker has created it
function startRunIdPoll(): NodeJS.Timeout {
  return setInterval(async () => {
    if (currentRunId) return;
    try {
      const run = await prisma.pipelineRun.findFirst({
        where: { status: 'RUNNING' },
        orderBy: { startedAt: 'desc' },
        select: { id: true },
      });
      if (run) currentRunId = run.id;
    } catch (_) {}
  }, 2000);
}

export async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[ContinuousPipeline] Already running — skipping.');
    return;
  }

  isRunning = true;
  currentRunId = null;

  const isDev = __filename.endsWith('.ts');
  const runnerExt = isDev ? '.ts' : '.js';
  const runnerPath = path.join(__dirname, `pipeline-runner${runnerExt}`);
  const execArgv = isDev
    ? ['--require', path.join(__dirname, '../node_modules/tsx/dist/cjs/index.cjs')]
    : [];
  console.log('[ContinuousPipeline] Starting pipeline worker thread...');

  worker = new Worker(runnerPath, { execArgv });

  const pollTimer = startRunIdPoll();

  // Release the lock exactly once. The worker thread often posts its completion
  // 'message' but never fires 'exit' — a dangling handle (e.g. an
  // undisconnected PrismaClient) keeps its event loop alive — so relying on
  // 'exit' alone leaves isRunning stuck true forever and every cron tick skips.
  // Release on WHICHEVER of message/exit/error/watchdog fires first, and
  // terminate the worker so it can't linger.
  let released = false;
  let watchdog: NodeJS.Timeout;
  const release = (reason: string): void => {
    if (released) return;
    released = true;
    clearInterval(pollTimer);
    clearTimeout(watchdog);
    isRunning = false;
    currentRunId = null;
    const w = worker;
    worker = null;
    if (w) { w.terminate().catch(() => {}); }
    console.log(`[ContinuousPipeline] Lock released (${reason}).`);
  };

  // Backstop: never let a hung run (one that neither messages nor exits) hold
  // the lock indefinitely. Force-release after PIPELINE_MAX_RUN_MS (default 2h).
  const MAX_RUN_MS = Number(process.env.PIPELINE_MAX_RUN_MS) || 2 * 60 * 60 * 1000;
  watchdog = setTimeout(() => {
    console.error(`[ContinuousPipeline] Watchdog: run exceeded ${MAX_RUN_MS}ms — force-releasing lock.`);
    release('watchdog timeout');
  }, MAX_RUN_MS);

  worker.on('message', (msg) => {
    if (msg.success) {
      console.log(`[ContinuousPipeline] Worker done. runId=${msg.runId} articles=${msg.articlesProcessed}`);
    } else {
      console.error('[ContinuousPipeline] Worker error:', msg.error);
    }
    release('worker message');
  });

  worker.on('exit', (code) => {
    console.log(`[ContinuousPipeline] Worker thread exited with code ${code}`);
    release(`worker exit ${code}`);
  });

  worker.on('error', (err) => {
    console.error('[ContinuousPipeline] Worker thread error:', err.message);
    release('worker error');
  });
}

/**
 * Abort: terminate the worker thread instantly, then update DB.
 */
export async function abortPipeline(): Promise<boolean> {
  if (!isRunning || !worker) return false;

  console.log('[ContinuousPipeline] Terminating pipeline worker thread...');

  // Capture references before nulling them
  const runId = currentRunId;
  const workerToKill = worker;

  // Flip flags immediately so UI sees Idle on next poll
  isRunning = false;
  worker = null;
  currentRunId = null;

  // Terminate the thread — instantly kills all pending LLM awaits inside it
  try {
    await workerToKill.terminate();
    console.log('[ContinuousPipeline] Worker thread terminated.');
  } catch (_) {}

  // Update DB
  if (runId) {
    try {
      await prisma.pipelineRun.update({
        where: { id: runId },
        data: { status: 'ABORTED', completedAt: new Date() },
      });
      console.log(`[ContinuousPipeline] Run ${runId} marked ABORTED.`);
    } catch (_) {}
  } else {
    try {
      await prisma.pipelineRun.updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'ABORTED', completedAt: new Date() },
      });
    } catch (_) {}
  }

  return true;
}

export function isPipelineRunning(): boolean {
  return isRunning;
}

async function startWorker(): Promise<void> {
  console.log(`[ContinuousPipeline] Cron schedule: "${CRON_SCHEDULE}"`);
  await runPipeline();
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log('[ContinuousPipeline] Cron trigger fired.');
    await runPipeline();
  });
  console.log('[ContinuousPipeline] Cron scheduled. Worker active.');
}

const isDirectRun =
  process.argv[1]?.endsWith('continuous-pipeline.ts') ||
  process.argv[1]?.endsWith('continuous-pipeline.js');

if (isDirectRun) {
  startWorker().catch((err) => {
    console.error('[ContinuousPipeline] Fatal:', err);
    process.exit(1);
  });
}

export { startWorker };
