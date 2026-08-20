import { acknowledgeLiveBuildRecommendationExposure } from './live-build-exposure-ack';
import { LiveBuildRecommendationSnapshot } from './live-build-recommendation-poller';

const PANEL_ID = 'live-build-recommendation-panel';

interface RenderedRecommendationPanel {
  style: { display: string };
  querySelector(selector: string): unknown;
}

interface RenderDocument {
  getElementById(id: string): RenderedRecommendationPanel | null;
}

export function hasRenderedLiveBuildRecommendation(
  snapshot: LiveBuildRecommendationSnapshot,
  renderDocument: RenderDocument,
): boolean {
  if (
    snapshot.state !== 'READY' ||
    !snapshot.decisionId ||
    !snapshot.steamId ||
    !snapshot.recommendation
  ) {
    return false;
  }

  const panel = renderDocument.getElementById(PANEL_ID);
  return Boolean(
    panel &&
      panel.style.display !== 'none' &&
      panel.querySelector('.live-build-primary'),
  );
}

export function installLiveBuildExposureAcknowledgement(): void {
  const ow = (window as any).overwolf;
  if (!ow?.windows) {
    return;
  }

  ow.windows.getCurrentWindow((windowResult: any) => {
    if (windowResult?.window?.name !== 'in_game') {
      return;
    }

    const mainWindow = ow.windows.getMainWindow() as any;
    const originalUpdate = mainWindow.inGameLiveBuildRecommendationUpdate;
    if (typeof originalUpdate !== 'function') {
      return;
    }

    mainWindow.inGameLiveBuildRecommendationUpdate = (
      snapshot: LiveBuildRecommendationSnapshot,
    ) => {
      originalUpdate(snapshot);
      if (hasRenderedLiveBuildRecommendation(snapshot, document)) {
        void acknowledgeLiveBuildRecommendationExposure(snapshot);
      }
    };

    const initialSnapshot = mainWindow.latestLiveBuildRecommendation as
      | LiveBuildRecommendationSnapshot
      | undefined;
    if (
      initialSnapshot &&
      hasRenderedLiveBuildRecommendation(initialSnapshot, document)
    ) {
      void acknowledgeLiveBuildRecommendationExposure(initialSnapshot);
    }
  });
}

installLiveBuildExposureAcknowledgement();
