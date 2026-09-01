import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Statlocker-only recommendation serving cutover', () => {
  test('legacy live build-serving controllers are not mounted by DeadlockLiveModule', () => {
    const moduleSource = readRepoFile('api/src/deadlock-live/deadlock-live.module.ts');
    const controllersBlock = moduleSource.match(/controllers:\s*\[([\s\S]*?)\],\s*providers:/)?.[1] || '';

    expect(controllersBlock).not.toContain('HeroBuildRecommendationController');
    expect(controllersBlock).not.toContain('HeroBuildContextualV3LiveController');
    expect(controllersBlock).not.toContain('SkillBuildAnalysisController');
  });

  test('Overwolf runtime has no legacy recommendation acquisition path', () => {
    const indexSource = readRepoFile('overwolf-client/src/index.ts');
    const uiSource = readRepoFile('overwolf-client/src/ui.ts');

    expect(indexSource).not.toContain('/deadlock/analysis/');
    expect(indexSource).not.toContain('latestRecommendation');
    expect(indexSource).not.toContain('latestSituational');
    expect(indexSource).not.toContain('inGameSituationalUpdate');
    expect(indexSource).not.toContain('inGameUIUpdate');

    expect(uiSource).not.toContain('showHeroGuide');
    expect(uiSource).not.toContain('showSituationalPanel');
    expect(uiSource).not.toContain('legacySkillActions');
    expect(uiSource).not.toContain('renderActiveBuild');
  });

  test('Overwolf build UIs are adaptive-only', () => {
    const inGameHtml = readRepoFile('overwolf-client/public/in_game.html');
    const desktopHtml = readRepoFile('overwolf-client/public/desktop.html');

    for (const html of [inGameHtml, desktopHtml]) {
      expect(html).not.toContain('build-select');
      expect(html).not.toContain('phase-early');
      expect(html).not.toContain('phase-mid');
      expect(html).not.toContain('phase-late');
      expect(html).not.toContain('guide-skills');
    }

    expect(inGameHtml).toContain('Statlocker Adaptive');
    expect(desktopHtml).toContain('Statlocker Adaptive');
  });

  test('adaptive client remains pinned to the only recommendation endpoint', () => {
    const adaptiveClientSource = readRepoFile('overwolf-client/src/adaptive-recommendation-client.ts');

    expect(adaptiveClientSource).toContain('/deadlock/adaptive/v1/recommend');
  });
});
