import { OverwolfLiveEventDto } from '@deadlock-live-probe/shared';
import { DiagnosticCapture } from '../diagnostics/diagnostic-capture';
import { parseJsonSafely } from './parse-json-safely';

export type EventCallback = (event: OverwolfLiveEventDto) => void;

let diagnosticCapture: DiagnosticCapture | undefined;

function matchIdFromValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function listenOverwolfEvents(onEvent: EventCallback): void {
  if (typeof overwolf === 'undefined' || !overwolf.games || !overwolf.games.events) {
    console.warn('Overwolf API is not available; events listener registration skipped.');
    return;
  }

  diagnosticCapture ??= new DiagnosticCapture(`capture-${Math.random().toString(36).slice(2, 10)}`);
  const capture = diagnosticCapture;
  capture.initialize(overwolf);

  let currentMatchId: string | undefined;
  overwolf.games.events.getInfo?.((infoResult: any) => {
    currentMatchId =
      matchIdFromValue(infoResult?.res?.match_info?.match_id) ??
      matchIdFromValue(infoResult?.match_info?.match_id) ??
      currentMatchId;
  });

  overwolf.games.events.onInfoUpdates2.addListener((infoUpdate: any) => {
    try {
      const { info, feature } = infoUpdate;
      if (!info || typeof info !== 'object') {
        return;
      }

      // Iterate through categories (e.g., match_info, roster, items)
      for (const [category, categoryData] of Object.entries(info)) {
        if (!categoryData || typeof categoryData !== 'object') {
          continue;
        }

        // Iterate through key-values inside category
        for (const [key, rawValue] of Object.entries(categoryData)) {
          const receivedAt = Date.now();
          capture.captureRaw({
            receivedAt,
            source: 'onInfoUpdates2',
            feature,
            category,
            key,
            rawPayload: rawValue,
          });
          const parsedValue = parseJsonSafely(rawValue);
          if (key === 'match_id') {
            currentMatchId = matchIdFromValue(parsedValue) ?? currentMatchId;
          }

          onEvent({
            matchId: currentMatchId,
            receivedAt,
            source: 'onInfoUpdates2',
            feature,
            category,
            key,
            payload: parsedValue,
          });
        }
      }
    } catch (err) {
      console.error('Error handling onInfoUpdates2 event:', err);
    }
  });

  overwolf.games.events.onNewEvents.addListener((eventsEvent: any) => {
    try {
      const { events, feature } = eventsEvent;
      if (!Array.isArray(events)) {
        return;
      }

      for (const e of events) {
        if (!e || typeof e !== 'object') {
          continue;
        }

        const receivedAt = Date.now();
        capture.captureRaw({
          receivedAt,
          source: 'onNewEvents',
          feature,
          key: e.name,
          rawPayload: e.data,
        });
        const parsedData = parseJsonSafely(e.data);
        if (e.name === 'match_id') {
          currentMatchId = matchIdFromValue(parsedData) ?? currentMatchId;
        }

        onEvent({
          matchId: currentMatchId,
          receivedAt,
          source: 'onNewEvents',
          feature,
          key: e.name,
          payload: parsedData,
        });
      }
    } catch (err) {
      console.error('Error handling onNewEvents event:', err);
    }
  });
}
