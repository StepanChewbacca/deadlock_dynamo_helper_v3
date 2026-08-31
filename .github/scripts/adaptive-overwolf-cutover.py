from pathlib import Path
import re

index_path = Path('apps/overwolf-client/src/index.ts')
text = index_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    text = text.replace(old, new, 1)


replace_once(
    "import * as ui from './ui';\n",
    "import * as ui from './ui';\nimport { AdaptiveRecommendationClient } from './adaptive-recommendation-client';\n",
    'client import',
)

replace_once(
    "    mainWindow.inGameSituationalUpdate = (data: any) => {\n      if (data && (data.decision === 'BUY_SITUATIONAL_ITEM' || data.decision === 'DELAY_CURRENT_CORE_ITEM')) {\n        ui.showSituationalPanel(data);\n      } else {\n        ui.hideSituationalPanel();\n      }\n      ensureOverlayHeight();\n    };\n\n    mainWindow.inGameHide = () => {",
    "    mainWindow.inGameSituationalUpdate = (data: any) => {\n      if (data && (data.decision === 'BUY_SITUATIONAL_ITEM' || data.decision === 'DELAY_CURRENT_CORE_ITEM')) {\n        ui.showSituationalPanel(data);\n      } else {\n        ui.hideSituationalPanel();\n      }\n      ensureOverlayHeight();\n    };\n\n    mainWindow.inGameAdaptiveUpdate = (data: any) => {\n      if (data) {\n        ui.showAdaptiveRecommendation(data);\n      } else {\n        ui.hideSituationalPanel();\n      }\n      ensureOverlayHeight();\n    };\n\n    mainWindow.inGameHide = () => {",
    'in-game adaptive callback',
)

replace_once(
    "    if (mainWindow.latestSituational) {\n      mainWindow.inGameSituationalUpdate(mainWindow.latestSituational);\n    }\n",
    "    if (mainWindow.latestAdaptiveRecommendation) {\n      mainWindow.inGameAdaptiveUpdate(mainWindow.latestAdaptiveRecommendation);\n    } else if (mainWindow.latestSituational) {\n      mainWindow.inGameSituationalUpdate(mainWindow.latestSituational);\n    }\n",
    'startup adaptive render',
)

replace_once(
    "    mainWindow.latestRecommendation = null;\n",
    "    mainWindow.latestRecommendation = null;\n    mainWindow.latestAdaptiveRecommendation = null;\n",
    'adaptive state init',
)

replace_once(
    "    mainWindow.refreshBuild = () => {\n      ui.logConsole('Manual build refresh requested.');\n      lastRecommendationPayload = '';\n      triggerRecommendation();\n    };",
    "    mainWindow.refreshBuild = () => {\n      ui.logConsole('Manual adaptive build refresh requested.');\n      scheduleAdaptiveRecommendation(true);\n    };",
    'manual refresh',
)

replace_once(
    "    const buffer = new LiveEventBuffer(clientId, apiBaseUrl, customFetch, 1000);\n",
    "    const buffer = new LiveEventBuffer(clientId, apiBaseUrl, customFetch, 1000);\n    const adaptiveClient = new AdaptiveRecommendationClient(apiBaseUrl, customFetch, 1500);\n",
    'adaptive client init',
)

replace_once(
    "    let currentMatchId = '';\n",
    "    let currentMatchId = '';\n    let currentLocalSteamId = '';\n",
    'local steam state',
)

marker = "    let situationalTimerId: number | undefined;\n\n    const triggerSituationalRecommendation = () => {"
if marker not in text:
    raise SystemExit('adaptive scheduler insertion marker missing')
scheduler = """    let situationalTimerId: number | undefined;

    const scheduleAdaptiveRecommendation = (force = false) => {
      if (!currentHeroId || !currentMatchId) {
        adaptiveClient.cancel();
        mainWindow.latestAdaptiveRecommendation = null;
        if (mainWindow.inGameAdaptiveUpdate) {
          mainWindow.inGameAdaptiveUpdate(null);
        }
        return;
      }

      adaptiveClient.schedule(
        {
          matchId: currentMatchId,
          localSteamId: currentLocalSteamId || undefined,
        },
        {
          onResult: (data) => {
            mainWindow.latestAdaptiveRecommendation = data;
            if (mainWindow.inGameAdaptiveUpdate) {
              mainWindow.inGameAdaptiveUpdate(data);
            }
          },
          onError: (error) => {
            ui.logConsole(`Failed to fetch adaptive recommendation: ${error.message}`);
          },
        },
        force,
      );
    };

    const triggerSituationalRecommendation = () => {"""
text = text.replace(marker, scheduler, 1)

pattern = re.compile(r"    const triggerRecommendation = \(\) => \{.*?\n    \};\n\n    // Toggle overlay visibility helper", re.S)
matches = pattern.findall(text)
if len(matches) != 1:
    raise SystemExit(f'triggerRecommendation block: expected 1 match, got {len(matches)}')
replacement = """    const triggerRecommendation = () => {
      if (!currentHeroId) {
        adaptiveClient.cancel();
        mainWindow.latestAdaptiveRecommendation = null;
        mainWindow.latestRecommendation = null;
        mainWindow.heroName = '';
        ui.hideHeroGuide();
        ui.hideSituationalPanel();
        if (mainWindow.inGameHide) {
          mainWindow.inGameHide();
        }
        guideLoaded = false;
        return;
      }

      scheduleAdaptiveRecommendation();
    };

    // Toggle overlay visibility helper"""
text = pattern.sub(replacement, text, count=1)

cached_local = """                    if (isLocal) {
                      currentHeroId = Number(heroId);
                      currentHeroName = payload.hero_name || currentHeroName;
                    }"""
cached_new = """                    if (isLocal) {
                      currentHeroId = Number(heroId);
                      currentHeroName = payload.hero_name || currentHeroName;
                      if (steamId !== '0') currentLocalSteamId = String(steamId);
                    }"""
replace_once(cached_local, cached_new, 'cached local steam')

live_local = """                if (isLocal) {
                  currentHeroId = Number(heroId);
                  currentHeroName = payload.hero_name || currentHeroName;
                  if (payload.level !== undefined) {"""
live_new = """                if (isLocal) {
                  currentHeroId = Number(heroId);
                  currentHeroName = payload.hero_name || currentHeroName;
                  if (steamId !== '0') currentLocalSteamId = String(steamId);
                  if (payload.level !== undefined) {"""
replace_once(live_local, live_new, 'live local steam')

text = text.replace('                  scheduleSituationalRecommendation();', '                  scheduleAdaptiveRecommendation();')
text = text.replace('                scheduleSituationalRecommendation();', '                scheduleAdaptiveRecommendation();')

reset_marker = """              currentHeroId = null;
              currentHeroName = '';
              lastRecommendationPayload = '';"""
reset_replacement = """              currentHeroId = null;
              currentHeroName = '';
              currentLocalSteamId = '';
              adaptiveClient.cancel();
              mainWindow.latestAdaptiveRecommendation = null;
              lastRecommendationPayload = '';"""
count = text.count(reset_marker)
if count != 2:
    raise SystemExit(f'match reset blocks: expected 2, got {count}')
text = text.replace(reset_marker, reset_replacement)
index_path.write_text(text)

ui_path = Path('apps/overwolf-client/src/ui.ts')
ui = ui_path.read_text()
ui_marker = """export function hideSituationalPanel(): void {
  const panel = document.getElementById('situational-recommendation-panel');
"""
if ui.count(ui_marker) != 1:
    raise SystemExit('adaptive UI insertion marker mismatch')
adaptive_ui = """export function showAdaptiveRecommendation(data: any): void {
  const panel = document.getElementById('situational-recommendation-panel');
  const nameEl = document.getElementById('rec-item-name');
  const reasonEl = document.getElementById('rec-reason');
  const titleEl = document.getElementById('rec-decision-title');
  if (!panel || !nameEl || !reasonEl || !titleEl) return;

  panel.style.display = 'flex';
  const action = data?.nextAction || {};
  const targetItemId = action.buyItemId ?? action.itemId ?? action.targetItemId ?? data?.nextTargetItemId;
  const actionLabel = String(action.type || 'ABSTAIN');
  nameEl.textContent = targetItemId ? `${actionLabel} · Item #${targetItemId}` : actionLabel;
  const confidence = Number.isFinite(Number(data?.confidence)) ? Math.round(Number(data.confidence) * 100) : 0;
  titleEl.textContent = `Adaptive ${data?.gameState || 'UNKNOWN'} · ${confidence}% confidence`;

  const plan = Array.isArray(data?.recommendedBuild)
    ? [...data.recommendedBuild]
        .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
        .map((item: any) => `#${item.itemId} [${item.status || 'PLANNED'}]`)
        .join(' → ')
    : '';
  const reasons = Array.isArray(action.reasonCodes) ? action.reasonCodes.slice(0, 3).join(', ') : '';
  const freshness = Array.isArray(data?.evidence?.families)
    ? data.evidence.families.map((family: any) => `${family.dataset}:${family.freshness}`).join(', ')
    : '';
  reasonEl.textContent = [
    plan ? `Plan: ${plan}` : 'Plan: no planned items',
    reasons ? `Reasons: ${reasons}` : '',
    freshness ? `Evidence: ${freshness}` : '',
  ].filter(Boolean).join(' | ');
}

""" + ui_marker
ui = ui.replace(ui_marker, adaptive_ui, 1)
ui_path.write_text(ui)
