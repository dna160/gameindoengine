/**
 * Orchestrator Tool: dispatch_agent
 *
 * Provides typed, logged dispatching of the Master Orchestrator's payloads
 * to the appropriate Specialized Agent.
 *
 * The Orchestrator calls dispatchAgent() at every routing decision point,
 * producing a structured log entry that makes its decisions visible in the
 * pipeline log stream and the Dashboard.
 */

import type { Pillar } from '../../shared/types';

// ── Agent registry ────────────────────────────────────────────────────────────

export type AgentHandle =
  | 'scout'
  | 'researcher'
  | 'copywriters/esports_gani'
  | 'copywriters/videogame_valentino'
  | 'copywriters/entertainment_kanata'
  | 'copywriters/tech_bunted'
  | 'copywriters/streamer_basudin'
  | 'editor'
  | 'publisher';

/** Maps each content pillar to its dedicated Copywriter agent handle. */
export const PILLAR_AGENT_MAP: Record<Pillar, AgentHandle> = {
  esports:       'copywriters/esports_gani',
  videogame:     'copywriters/videogame_valentino',
  entertainment: 'copywriters/entertainment_kanata',
  tech:          'copywriters/tech_bunted',
  streamer:      'copywriters/streamer_basudin',
};

/** Maps each Copywriter handle to the persona's display name. */
export const AGENT_PERSONA_MAP: Record<string, string> = {
  'copywriters/esports_gani':          'Gani',
  'copywriters/videogame_valentino':   'Valentino',
  'copywriters/entertainment_kanata':  'Kanata',
  'copywriters/tech_bunted':           'Bunted',
  'copywriters/streamer_basudin':      'Basudin',
};

// ── Dispatch record ───────────────────────────────────────────────────────────

export interface DispatchRecord {
  agent:     AgentHandle;
  persona?:  string;     // persona name for copywriter agents
  payload:   string;     // human-readable payload summary (topic/article title)
  timestamp: string;
}

/**
 * Create a DispatchRecord and emit a structured log message through the
 * provided log callback.
 *
 * Usage:
 *   const d = dispatchAgent('copywriters/videogame_valentino', topic.title, this.log);
 *   // log already emitted: "[Orchestrator] → dispatch(copywriters/videogame_valentino | Valentino): ..."
 */
export function dispatchAgent(
  agent:   AgentHandle,
  payload: string,
  log:     (msg: string) => void
): DispatchRecord {
  const persona = AGENT_PERSONA_MAP[agent];
  const label   = persona ? `${agent} | ${persona}` : agent;

  log(`[Orchestrator] → dispatch(${label}): "${payload}"`);

  return {
    agent,
    persona,
    payload,
    timestamp: new Date().toISOString(),
  };
}
