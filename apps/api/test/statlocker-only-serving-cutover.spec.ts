import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', '..', relativePath), 'utf8');
}

describe('Statlocker-only recommendation serving cutover', () => {
  test('legacy analysis controllers are not mounted by DeadlockLiveModule', () => {
    const moduleSource = readRepoFile('api/src/deadlock-live/deadlock-live.module.ts');
    const controllersBlock = moduleSource.match(/controllers:\s*\[([\s\S]*?)\],\s*providers:/)?.[1] || '';

    expect(controllersBlock).not.toContain('HeroAnalysisController');
    expect(controllersBlock).not.toContain('AllHeroesAnalysisController');
  });

  test('Overwolf runtime has no legacy build or situational recommendation path', () => {
    const indexSource = readRepoFile('overwolf-client/src/index.ts');

    expect(indexSource).not.toContain('/deadlock/analysis/');
    expect(indexSource).not.toContain('latestRecommendation');
    expect(indexSource).not.toContain('latestSituational');
    expect(indexSource).not.toContain('inGameSituationalUpdate');
    expect(indexSource).not.toContain('inGameUIUpdate');
    expect(indexSource).not.toContain('showHeroGuide');
    expect(indexSource).not.toContain('showSituationalPanel');
  });

  test('Overwolf adaptive client remains pinned to Statlocker adaptive serving', () => {
    const adaptiveClientSource = readRepoFile('overwolf-client/src/adaptive-recommendation-client.ts');

    expect(adaptiveClientSource).toContain('/deadlock/adaptive/v1/recommend');
  });
});
