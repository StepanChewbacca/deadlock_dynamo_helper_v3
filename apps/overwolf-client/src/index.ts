import { LiveEventBuffer } from './overwolf/live-event-buffer';
import { setRequiredFeatures } from './overwolf/set-required-features';
import { listenOverwolfEvents } from './overwolf/listen-overwolf-events';
import * as ui from './ui';
import { AdaptiveRecommendationClient } from './adaptive-recommendation-client';

const clientId = `client-${Math.random().toString(36).substring(2, 8)}`;
const apiBaseUrl = 'https://aboba-telegramovich.duckdns.org';

const ow = (window as any).overwolf;

ow.windows.getCurrentWindow(async (windowResult: any) => {
  const currentWindowName = windowResult.window.name;

  if (currentWindowName === 'in_game') {
    ui.logConsole('In-game HUD Overlay window loaded.');
    const mainWindow = ow.windows.getMainWindow() as any;
    const windowId = windowResult.window.id;

    const ensureOverlayHeight = () => {
      const hud = document.querySelector('.hud-container') as HTMLElement;
      if (!hud) return;

      requestAnimationFrame(() => {
        const minHeight = 260;
        const maxHeight = 700;
        const contentHeight = Math.ceil(hud.scrollHeight + 24);
        const targetHeight = Math.max(minHeight, Math.min(maxHeight, contentHeight));
        ow.windows.getCurrentWindow((wRes: any) => {
          if (wRes.success) {
            ow.windows.changeSize(wRes.window.id, 340, targetHeight);
          }
        });
      });
    };
    (window as any).ensureOverlayHeight = ensureOverlayHeight;

    const toggleHudMode = () => {
      const hud = document.querySelector('.hud-container');
      const btn = document.getElementById('hud-toggle-mode');
      if (!hud || !btn) return;

      const isCompact = hud.classList.toggle('compact');
      btn.textContent = isCompact ? '🗖' : '🗕';
      ensureOverlayHeight();
    };
    (window as any).toggleHudMode = toggleHudMode;

    const refreshBuild = () => {
      if (mainWindow && mainWindow.refreshBuild) {
        mainWindow.refreshBuild();
      }
    };
    (window as any).refreshBuild = refreshBuild;

    const setupInGameDrag = () => {
      setTimeout(ensureOverlayHeight, 500);

      const container = document.querySelector('.hud-container');
      if (container) {
        container.addEventListener('mousedown', (e: any) => {
          if (
            e.target.tagName === 'SELECT' ||
            e.target.tagName === 'OPTION' ||
            e.target.tagName === 'BUTTON' ||
            e.target.closest('button') ||
            e.target.closest('.guide-item-row') ||
            e.target.closest('.skill-badge') ||
            e.target.closest('.phase-col')
          ) {
            return;
          }
          ow.windows.dragMove(windowId);
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupInGameDrag);
    } else {
      setupInGameDrag();
    }

    mainWindow.inGameAdaptiveUpdate = (data: any) => {
      if (data) {
        ui.showAdaptiveRecommendation(data);
      } else {
        ui.hideSituationalPanel();
      }
      ensureOverlayHeight();
    };

    mainWindow.inGameHide = () => {
      ui.hideSituationalPanel();
    };

    if (mainWindow.latestAdaptiveRecommendation) {
      mainWindow.inGameAdaptiveUpdate(mainWindow.latestAdaptiveRecommendation);
    }
  } else {
    ui.logConsole(`Initializing Background Controller for clientId: ${clientId}`);

    const mainWindow = ow.windows.getMainWindow() as any;
    mainWindow.latestAdaptiveRecommendation = null;
    mainWindow.heroNamesMap = mainWindow.heroNamesMap || {};
    mainWindow.warningActive = false;
    mainWindow.overlayMenuActive = false;

    let dynamoWarningWindowId: string | null = null;
    ow.windows.obtainDeclaredWindow('dynamo_warning', (result: any) => {
      if (result.success) {
        dynamoWarningWindowId = result.window.id;
        ow.windows.restore(dynamoWarningWindowId, (restoreResult: any) => {
          if (!restoreResult?.success) {
            ui.logConsole(`Failed to restore dynamo_warning window: ${restoreResult?.error || 'unknown error'}`);
            return;
          }
          ui.logConsole('dynamo_warning window pre-loaded and restored on startup.');
          if (mainWindow.updateWarningUI) {
            mainWindow.updateWarningUI();
          }
        });
      }
    });

    mainWindow.refreshBuild = () => {
      ui.logConsole('Manual adaptive build refresh requested.');
      scheduleAdaptiveRecommendation(true);
    };

    mainWindow.inGameShowWarning = () => {
      ui.logConsole('DEBUG: inGameShowWarning invoked.');
      mainWindow.warningActive = true;
      if (mainWindow.updateWarningUI) {
        mainWindow.updateWarningUI();
      }

      setTimeout(() => {
        mainWindow.warningActive = false;
        if (mainWindow.updateWarningUI) {
          mainWindow.updateWarningUI();
        }
        ui.logConsole('dynamo_warning timeout finished.');
      }, 15000);
    };

    const cleanHeroName = (rawName: string): string => {
      if (!rawName) return '';
      let name = rawName.replace(/^hero_/, '');
      name = name.replace(/_/g, ' ');
      return name.replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const customFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      try {
        const res = await fetch(url, init);
        if (res.ok) {
          ui.incrementSends();
          ui.updateIndicator('NestJS API connected & sending', true);
        } else {
          ui.logConsole(`Ingest error: HTTP ${res.status}`);
          ui.updateIndicator(`Ingest error: HTTP ${res.status}`, false);
        }
        return res;
      } catch (err: any) {
        ui.logConsole(`Network error: ${err.message || err}`);
        ui.updateIndicator('NestJS API offline', false);
        throw err;
      }
    };

    const buffer = new LiveEventBuffer(clientId, apiBaseUrl, customFetch, 1000);
    const adaptiveClient = new AdaptiveRecommendationClient(apiBaseUrl, customFetch, 1500);

    let currentHeroId: number | null = null;
    const matchRoster: Record<string, { heroId: number; teamId: number; isLocal: boolean; level?: number; deaths?: number }> = {};
    let currentMatchId = '';
    let currentLocalSteamId = '';
    let localPlayerDeathTimestamps: number[] = [];
    let lastWarningTriggeredAt = 0;

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
            mainWindow.latestAdaptiveRecommendation = null;
            if (mainWindow.inGameAdaptiveUpdate) {
              mainWindow.inGameAdaptiveUpdate(null);
            }
            ui.logConsole(`Failed to fetch adaptive recommendation: ${error.message}`);
          },
        },
        force,
      );
    };

    const triggerRecommendation = () => {
      if (!currentHeroId) {
        adaptiveClient.cancel();
        mainWindow.latestAdaptiveRecommendation = null;
        ui.hideSituationalPanel();
        if (mainWindow.inGameHide) {
          mainWindow.inGameHide();
        }
        return;
      }

      scheduleAdaptiveRecommendation();
    };

    const toggleInGameWindow = () => {
      ow.windows.obtainDeclaredWindow('in_game', (result: any) => {
        if (!result.success) return;

        const windowId = result.window.id;
        ow.windows.getWindowState(windowId, (stateResult: any) => {
          if (!stateResult.success) return;

          const state = stateResult.window_state;
          if (state === 'minimized' || state === 'closed') {
            ow.windows.restore(windowId, (restoreResult: any) => {
              if (!restoreResult?.success) {
                ui.logConsole(`Failed to restore in-game HUD overlay: ${restoreResult?.error || 'unknown error'}`);
              }
            });
          } else {
            ow.windows.minimize(windowId, (minimizeResult: any) => {
              if (!minimizeResult?.success) {
                ui.logConsole(`Failed to minimize in-game HUD overlay: ${minimizeResult?.error || 'unknown error'}`);
              }
            });
          }
        });
      });
    };

    ow.windows.obtainDeclaredWindow('in_game', (result: any) => {
      if (result.success) {
        ow.windows.restore(result.window.id, (restoreResult: any) => {
          if (!restoreResult?.success) {
            ui.logConsole(`Failed to restore in-game HUD overlay: ${restoreResult?.error || 'unknown error'}`);
          }
        });
        ui.logConsole('In-game HUD overlay auto-launched.');
      }
    });

    ow.settings.hotkeys.onPressed.addListener((info: any) => {
      if (info.name === 'toggle_overlay') {
        ui.logConsole('Hotkey toggle_overlay pressed. Toggling HUD window.');
        toggleInGameWindow();
      }
    });

    const resetRecommendationState = () => {
      for (const key of Object.keys(matchRoster)) {
        delete matchRoster[key];
      }
      mainWindow.heroNamesMap = {};
      currentHeroId = null;
      currentLocalSteamId = '';
      adaptiveClient.cancel();
      mainWindow.latestAdaptiveRecommendation = null;
      if (mainWindow.inGameHide) {
        mainWindow.inGameHide();
      }
    };

    const tryRegister = async () => {
      try {
        ui.updateStatus('REGISTERING...', 'init');
        await setRequiredFeatures();
        ui.updateStatus('REGISTERED', 'connected');
        ui.logConsole('Successfully registered GEP required features: game_info, match_info');

        ow.games.events.getInfo((infoResult: any) => {
          if (infoResult && infoResult.success && infoResult.res) {
            const res = infoResult.res;

            if (res.match_info && res.match_info.match_id) {
              currentMatchId = res.match_info.match_id;
              ui.logConsole(`Restored Match ID from GEP cache: ${currentMatchId}`);
            }

            if (res.roster) {
              ui.logConsole(`Restoring roster from GEP cache: ${JSON.stringify(res.roster)}`);
              for (const key of Object.keys(res.roster)) {
                try {
                  const payloadStr = res.roster[key];
                  const payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
                  const steamId = payload.steam_id || payload.steamId;
                  const heroId = payload.hero_id || payload.heroId;
                  const teamId = payload.team_id !== undefined ? payload.team_id : (payload.team !== undefined ? payload.team : payload.teamId);
                  const isLocal = payload.is_local || payload.isLocal;

                  if (steamId && heroId) {
                    const rosterKey = (steamId !== '0') ? steamId : `hero_${heroId}`;
                    matchRoster[rosterKey] = {
                      heroId: Number(heroId),
                      teamId: Number(teamId),
                      isLocal: !!isLocal,
                    };
                    if (payload.hero_name) {
                      mainWindow.heroNamesMap[Number(heroId)] = cleanHeroName(payload.hero_name);
                    }
                    if (isLocal) {
                      currentHeroId = Number(heroId);
                      if (steamId !== '0') currentLocalSteamId = String(steamId);
                    }
                  }
                } catch (e: any) {
                  ui.logConsole(`Error parsing cached roster entry ${key}: ${e.message}`);
                }
              }
              triggerRecommendation();
            }
          }
        });

        listenOverwolfEvents((event) => {
          const eventDetails = `Source: ${event.source} | Key: ${event.key || 'n/a'} | Cat: ${event.category || 'n/a'}`;
          ui.updateLastEvent(eventDetails);

          const isMatchIdKey = event.key === 'match_id' || (event.category === 'match_info' && event.key === 'match_id');
          if (isMatchIdKey && typeof event.payload === 'string' && event.payload.length > 0) {
            const matchId = event.payload;
            if (matchId !== currentMatchId) {
              currentMatchId = matchId;
              ui.logConsole(`New match detected: ${matchId}. Resetting match roster and adaptive recommendation.`);
              resetRecommendationState();
              currentMatchId = matchId;
            }
          }

          if (event.key === 'match_state' && event.payload === 'ended') {
            ui.logConsole('Match ended. Resetting match roster and adaptive recommendation.');
            resetRecommendationState();
            currentMatchId = '';
          }

          if (event.category === 'roster' || (event.key && event.key.startsWith('roster_'))) {
            const payload: any = event.payload || {};
            const steamId = payload.steam_id || payload.steamId;
            const heroId = payload.hero_id || payload.heroId;
            const teamId = payload.team_id !== undefined ? payload.team_id : (payload.team !== undefined ? payload.team : payload.teamId);
            const isLocal = payload.is_local || payload.isLocal;

            if (steamId) {
              const rosterKey = (steamId !== '0') ? steamId : (heroId ? `hero_${heroId}` : null);
              if (rosterKey && matchRoster[rosterKey]) {
                const player = matchRoster[rosterKey];
                let localContextChanged = false;

                if (payload.level !== undefined) {
                  player.level = Number(payload.level);
                  if (player.isLocal) {
                    localContextChanged = true;
                    mainWindow.localPlayerLevel = Number(payload.level);
                  }
                }

                if (player.isLocal && payload.deaths !== undefined) {
                  const currentDeaths = Number(payload.deaths);
                  const isFirstCheck = player.deaths === undefined;
                  const previousDeaths = player.deaths || 0;
                  player.deaths = currentDeaths;
                  localContextChanged = true;

                  if (!isFirstCheck && currentDeaths > previousDeaths) {
                    ui.logConsole(`Local player died! Current deaths: ${currentDeaths}, Previous: ${previousDeaths}`);
                    const now = Date.now();
                    localPlayerDeathTimestamps.push(now);
                    localPlayerDeathTimestamps = localPlayerDeathTimestamps.filter((timestamp) => timestamp > now - 120000);

                    if (localPlayerDeathTimestamps.length >= 2) {
                      localPlayerDeathTimestamps.length = 0;
                      if (now - lastWarningTriggeredAt >= 600000) {
                        ui.logConsole('Warning triggered: local player died 2 times in 2 minutes! Sending warning event.');
                        lastWarningTriggeredAt = now;
                        if (mainWindow.inGameShowWarning) {
                          mainWindow.inGameShowWarning();
                        }
                      } else {
                        ui.logConsole('Warning skipped due to 10-minute warning cooldown.');
                      }
                    }
                  }
                }

                if (player.isLocal && (
                  payload.health !== undefined ||
                  payload.souls !== undefined ||
                  payload.hero_damage !== undefined ||
                  payload.heroDamage !== undefined
                )) {
                  localContextChanged = true;
                }

                if (localContextChanged) {
                  scheduleAdaptiveRecommendation();
                }
              }

              if (heroId !== undefined && heroId !== null && heroId !== 0) {
                const finalKey = (steamId !== '0') ? steamId : `hero_${heroId}`;
                if (!matchRoster[finalKey]) {
                  matchRoster[finalKey] = {
                    heroId: Number(heroId),
                    teamId: Number(teamId !== undefined ? teamId : 0),
                    isLocal: isLocal !== undefined ? !!isLocal : false,
                  };
                } else {
                  const player = matchRoster[finalKey];
                  player.heroId = Number(heroId);
                  if (teamId !== undefined) player.teamId = Number(teamId);
                  if (isLocal !== undefined) player.isLocal = !!isLocal;
                }

                if (payload.hero_name) {
                  mainWindow.heroNamesMap[Number(heroId)] = cleanHeroName(payload.hero_name);
                }
                if (isLocal) {
                  currentHeroId = Number(heroId);
                  if (steamId !== '0') currentLocalSteamId = String(steamId);
                  if (payload.level !== undefined) {
                    mainWindow.localPlayerLevel = Number(payload.level);
                  }
                }
                triggerRecommendation();
              }
            }
          }

          if (event.category === 'items' || (event.key && event.key.startsWith('items_'))) {
            const payload: any = event.payload || {};
            const eventSteamId = payload.steam_id || payload.steamId;

            let localSteamId: string | null = null;
            for (const [steamId, player] of Object.entries(matchRoster)) {
              if (player.isLocal) {
                localSteamId = steamId;
                break;
              }
            }

            if (eventSteamId && eventSteamId === localSteamId) {
              const rawItems = payload.items || [];
              const boughtIds = rawItems
                .map((item: any) => Number(item.id ?? item.itemId ?? item.item_id))
                .filter((id: number) => Number.isFinite(id) && id > 0);

              mainWindow.localPurchasedItemIds = new Set(boughtIds);
              scheduleAdaptiveRecommendation();
            }
          }

          buffer.push(event);
        });

        if (ow && ow.overlay) {
          ow.overlay.onGameInputExclusiveModeChanged.addListener((event: any) => {
            mainWindow.overlayMenuActive = !!event.enabled;
            ui.logConsole(`Overlay exclusive mode changed: ${mainWindow.overlayMenuActive}`);
            if (mainWindow.updateWarningUI) {
              mainWindow.updateWarningUI();
            }
          });
        }
      } catch (err: any) {
        ui.updateStatus('FAILED', 'error');
        ui.logConsole(`GEP feature registration failed: ${err.message}. Retrying in 5s...`);
        setTimeout(tryRegister, 5000);
      }
    };

    tryRegister();
  }
});
