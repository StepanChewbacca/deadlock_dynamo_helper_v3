import {
  hideSituationalPanel,
  showAdaptiveError,
  showAdaptiveRecommendation,
} from './ui';

class FakeElement {
  textContent = '';
  className = '';
  title = '';
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  attributes = new Map<string, string>();

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'title') this.title = '';
  }
}

const elementIds = [
  'guide-empty',
  'guide-empty-title',
  'guide-empty-copy',
  'guide-active',
  'situational-recommendation-panel',
  'rec-item-name',
  'rec-headline',
  'rec-source',
  'rec-game-state',
  'rec-health',
  'rec-action-label',
  'rec-confidence-label',
  'rec-evidence',
  'rec-item-meta',
  'rec-item-glyph',
  'rec-confidence-fill',
  'rec-reasons',
  'rec-plan',
  'rec-plan-more',
  'rec-alternatives',
  'rec-alternatives-section',
  'rec-update-note',
];

function recommendation(overrides: Record<string, unknown> = {}): any {
  return {
    ready: true,
    blockers: [],
    decisionId: 'decision-a',
    stateRevision: 'revision-a',
    gameState: 'EVEN',
    nextAction: {
      actionKey: 'BUY:3862866912',
      type: 'BUY',
      buyItemId: 3862866912,
      reasonCodes: ['CORE_TARGET_PENDING'],
    },
    recommendedBuild: [],
    changes: [],
    rankedImmediateCandidates: [],
    totalScore: 0.8,
    confidence: 0.8,
    scorerVersion: 'scorer',
    plannerVersion: 'planner',
    configVersion: 'config',
    evidence: {
      rulesetVersion: 'rules',
      catalogSha256: 'catalog',
      snapshotIds: [],
      families: [{ dataset: 'builds', freshness: 'FRESH', confidence: 0.9 }],
      degradedReasons: [],
    },
    ...overrides,
  };
}

function plannedItem(itemId: number, position: number, status: 'OWNED' | 'NEXT' | 'PLANNED'): any {
  return {
    itemId,
    position,
    status,
    score: 0.5,
    confidence: 0.5,
    skeletonStrength: 0.5,
    contextualSupport: 0.5,
    reasonCodes: [],
  };
}

describe('adaptive recommendation UI state', () => {
  let elements: Map<string, FakeElement>;
  let inGameOverlay = false;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    elements = new Map(elementIds.map((id) => [id, new FakeElement()]));
    inGameOverlay = false;
    globalThis.document = {
      getElementById: (id: string) => elements.get(id) || null,
      createElement: () => new FakeElement(),
      querySelector: (selector: string) => selector === '.hud-container' && inGameOverlay ? new FakeElement() : null,
    } as unknown as Document;
    hideSituationalPanel();
  });

  afterAll(() => {
    globalThis.document = originalDocument;
  });

  it('keeps the last successful card visible during a transient failure and recovers', () => {
    showAdaptiveRecommendation(recommendation());
    showAdaptiveError('Adaptive recommendation HTTP 502');

    expect(elements.get('guide-active')?.style.display).toBe('flex');
    expect(elements.get('guide-empty')?.style.display).toBe('none');
    expect(elements.get('rec-item-name')?.textContent).toBe('Restorative Shot');
    expect(elements.get('rec-health')?.textContent).toBe('Updating');
    expect(elements.get('rec-update-note')?.style.display).toBe('flex');

    showAdaptiveRecommendation(recommendation());
    expect(elements.get('rec-health')?.textContent).toBe('Live');
    expect(elements.get('rec-update-note')?.style.display).toBe('none');
  });

  it('shows a reconnecting empty state when no recommendation has succeeded', () => {
    showAdaptiveError('Adaptive recommendation HTTP 500');

    expect(elements.get('guide-empty')?.style.display).toBe('flex');
    expect(elements.get('guide-empty-title')?.textContent).toBe('Statlocker is reconnecting');
    expect(elements.get('guide-active')?.style.display).toBe('none');
  });

  it('keeps owned items visible in the desktop build path', () => {
    showAdaptiveRecommendation(recommendation({
      recommendedBuild: [
        plannedItem(3862866912, 1, 'OWNED'),
        plannedItem(968099481, 2, 'NEXT'),
        plannedItem(1342610602, 3, 'PLANNED'),
      ],
    }));

    const rows = elements.get('rec-plan')?.children ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0].className).toContain('status-owned');
    expect(rows[1].className).toContain('status-next');
  });

  it('removes owned items from the in-game overlay build path', () => {
    inGameOverlay = true;
    showAdaptiveRecommendation(recommendation({
      recommendedBuild: [
        plannedItem(3862866912, 1, 'OWNED'),
        plannedItem(968099481, 2, 'NEXT'),
        plannedItem(1342610602, 3, 'PLANNED'),
      ],
    }));

    const rows = elements.get('rec-plan')?.children ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.className.includes('status-owned'))).toBe(true);
    expect(rows[0].className).toContain('status-next');
  });
});
