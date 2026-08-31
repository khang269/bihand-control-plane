export interface FleetAgentInstance {
  id: string;
  reportsTo?: string | null;
  agentType?: string;
  role?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

/** Picks the default agent to show on the chat landing: the root of the org chart
 * (no reportsTo), falling back to the first instance if the roster has no clear
 * root (e.g. malformed/cyclic reportsTo data) or multiple roots. */
export function pickDefaultAgent<T extends FleetAgentInstance>(instances: T[] | null | undefined): T | null {
  if (!instances || instances.length === 0) return null;
  const root = instances.find((inst) => !inst.reportsTo);
  return root || instances[0];
}

/** Only claudecode and codex runtimes have a persisted interactive chat today. */
export function isChatCapable(agentType: string | null | undefined): boolean {
  return agentType === 'claudecode' || agentType === 'codex';
}
