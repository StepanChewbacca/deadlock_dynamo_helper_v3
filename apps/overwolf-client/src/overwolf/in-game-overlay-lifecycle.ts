type RestoreOverlay = (onComplete: (success: boolean) => void) => void;

export class InGameOverlayLifecycle {
  private activeMatchId = '';
  private pendingMatchId = '';

  constructor(private readonly restoreOverlay: RestoreOverlay) {}

  sync(matchId: string): void {
    const normalizedMatchId = matchId.trim();

    if (!normalizedMatchId) {
      this.activeMatchId = '';
      this.pendingMatchId = '';
      return;
    }

    if (
      this.activeMatchId === normalizedMatchId
      || this.pendingMatchId === normalizedMatchId
    ) {
      return;
    }

    this.pendingMatchId = normalizedMatchId;
    this.restoreOverlay((success) => {
      if (this.pendingMatchId !== normalizedMatchId) {
        return;
      }

      this.pendingMatchId = '';
      if (success) {
        this.activeMatchId = normalizedMatchId;
      }
    });
  }
}
