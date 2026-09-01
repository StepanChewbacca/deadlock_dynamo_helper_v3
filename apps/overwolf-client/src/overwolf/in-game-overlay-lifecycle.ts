export class InGameOverlayLifecycle {
  private activeMatchId = '';

  constructor(private readonly restoreOverlay: () => void) {}

  sync(matchId: string): void {
    const normalizedMatchId = matchId.trim();

    if (!normalizedMatchId) {
      this.activeMatchId = '';
      return;
    }

    if (this.activeMatchId === normalizedMatchId) {
      return;
    }

    this.activeMatchId = normalizedMatchId;
    this.restoreOverlay();
  }
}
