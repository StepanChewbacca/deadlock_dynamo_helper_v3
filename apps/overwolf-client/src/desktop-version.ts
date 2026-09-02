import {
  centerWindowOnDisplay,
  OverwolfDisplay,
  selectPreferredDesktopDisplay,
} from './overwolf/secondary-monitor';
import { isSuccessfulOverwolfResult } from './overwolf/window-result';

const APP_VERSION = '0.1.15';
const APP_BUILD = '024';
const ow = (window as any).overwolf;

function updateBuildStatus(): void {
  const localWindow = window as any;
  const mainWindow = typeof ow?.windows?.getMainWindow === 'function'
    ? ow.windows.getMainWindow() as any
    : localWindow;
  const snapshot = (
    localWindow.__deadlockLiveRecommendationSnapshot
      ?? mainWindow?.latestLiveBuildRecommendation
  ) as
    | {
        state?: string;
        matchId?: string;
        recommendation?: { recommendationModel?: string };
      }
    | undefined;
  const matchId = String(
    localWindow.__deadlockLiveMatchId
      ?? mainWindow?.__deadlockLiveMatchId
      ?? snapshot?.matchId
      ?? '',
  ).trim();
  const runtimeState = matchId
    ? normalizeRuntimeState(snapshot?.recommendation ? 'READY' : snapshot?.state)
    : 'NO MATCH ID';
  const matchLabel = matchId ? `MATCH ${matchId}` : '';
  const recommendationSource = snapshot?.recommendation
    ? snapshot.recommendation.recommendationModel === 'RECOMMENDATION_VALUE_V6'
      ? 'MODEL V6'
      : snapshot.recommendation.recommendationModel === 'PRO_BUILD_CANDIDATE_GENERATOR'
        ? 'PRO FALLBACK'
        : 'BASELINE'
    : '';
  const label = [
    `BUILD ${APP_BUILD}`,
    `v${APP_VERSION}`,
    matchLabel,
    recommendationSource,
    runtimeState,
  ].filter(Boolean).join(' · ');

  const tags = Array.from(
    document.querySelectorAll<HTMLElement>('[data-app-version], .version-tag'),
  );
  if (tags.length === 0 && document.body) {
    tags.push(createRuntimeBuildTag());
  }

  tags.forEach((tag) => {
    tag.textContent = label;
    tag.title = `Deadlock Live Probe ${label}`;
  });
}

function createRuntimeBuildTag(): HTMLElement {
  const tag = document.createElement('div');
  tag.dataset.appVersion = 'true';
  Object.assign(tag.style, {
    position: 'fixed',
    right: '8px',
    bottom: '6px',
    zIndex: '2147483647',
    maxWidth: 'calc(100vw - 16px)',
    padding: '3px 6px',
    border: '1px solid rgba(255, 107, 74, 0.55)',
    borderRadius: '4px',
    background: 'rgba(12, 12, 16, 0.9)',
    color: '#ff9a82',
    fontFamily: '\'JetBrains Mono\', monospace',
    fontSize: '9px',
    fontWeight: '700',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
  });
  document.body.appendChild(tag);
  return tag;
}

function normalizeRuntimeState(value: string | undefined): string {
  switch (value) {
    case 'READY':
      return 'READY';
    case 'REFRESHING':
      return 'REFRESHING';
    case 'WAITING_FOR_LOCAL_PLAYER':
      return 'WAITING PLAYER';
    case 'WAITING_FOR_HERO':
      return 'WAITING HERO';
    case 'WAITING_FOR_BACKEND':
      return 'WAITING API';
    case 'ERROR':
      return 'API ERROR';
    default:
      return 'WAITING API';
  }
}

export function showDesktopBuildWindow(preferSecondary = true): void {
  if (
    typeof ow?.windows?.getCurrentWindow !== 'function' ||
    typeof ow?.windows?.changePosition !== 'function' ||
    typeof ow?.windows?.restore !== 'function' ||
    typeof ow?.utils?.getMonitorsList !== 'function'
  ) {
    return;
  }

  ow.windows.getCurrentWindow((windowResult: any) => {
    if (
      !isSuccessfulOverwolfResult(windowResult) ||
      windowResult.window?.name !== 'desktop' ||
      !windowResult.window?.id
    ) {
      return;
    }

    const desktopWindow = windowResult.window;
    ow.utils.getMonitorsList((monitorsResult: any) => {
      if (
        !isSuccessfulOverwolfResult(monitorsResult) ||
        !Array.isArray(monitorsResult.displays)
      ) {
        console.warn('Failed to get the monitor list for desktop positioning.');
        restoreDesktopWindow(desktopWindow.id);
        return;
      }

      const targetDisplay = selectPreferredDesktopDisplay(
        monitorsResult.displays as OverwolfDisplay[],
        preferSecondary,
      );
      if (!targetDisplay) {
        console.warn('No usable monitor detected for desktop positioning.');
        restoreDesktopWindow(desktopWindow.id);
        return;
      }

      const position = centerWindowOnDisplay(
        targetDisplay,
        desktopWindow.width,
        desktopWindow.height,
      );

      ow.windows.changePosition(
        desktopWindow.id,
        position.x,
        position.y,
        (moveResult: any) => {
          if (!isSuccessfulOverwolfResult(moveResult)) {
            console.warn('Failed to move the desktop build window.');
          }

          restoreDesktopWindow(desktopWindow.id);
        },
      );
    });
  });
}

function restoreDesktopWindow(windowId: string): void {
  ow.windows.restore(windowId, (restoreResult: any) => {
    if (!isSuccessfulOverwolfResult(restoreResult)) {
      console.warn('Failed to restore the desktop build window.');
      return;
    }

    if (typeof ow.windows.bringToFront === 'function') {
      ow.windows.bringToFront(windowId);
    }
  });
}

(window as any).showDesktopBuildWindow = showDesktopBuildWindow;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateBuildStatus, { once: true });
} else {
  updateBuildStatus();
}

setInterval(updateBuildStatus, 1000);
setTimeout(() => showDesktopBuildWindow(true), 250);
