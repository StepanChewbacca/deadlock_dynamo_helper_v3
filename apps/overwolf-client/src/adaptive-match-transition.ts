export function didAdaptiveMatchChange(
  currentMatchId: string,
  incomingMatchId: string,
): boolean {
  const current = currentMatchId.trim();
  const incoming = incomingMatchId.trim();
  return current.length > 0 && incoming.length > 0 && current !== incoming;
}
