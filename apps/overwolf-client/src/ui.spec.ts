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
  'rec-planner-badge',
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

  it('renders strategy badge and method correctly', () => {
    showAdaptiveRecommendation(recommendation({
      plannerMethod: 'STRATEGY_FIRST',
      strategy: {
        strategyId: 'burst-spirit',
        commitment: 'COMMITTED',
        posterior: 0.9,
        reasonCodes: [],
        selectedBranches: {},
        committedBranches: {},
        buildStatus: 'IN_PROGRESS',
        progress: { satisfiedHardGoals: 1, totalHardGoals: 3 },
        slotPlan: { currentUsedSlots: 2, currentFlexUsed: 0, reservedSituationalSlots: 1, feasible: true, reasonCodes: [] },
        investmentObjectives: [],
      },
    }));

    expect(elements.get('rec-planner-badge')?.textContent).toBe('Strategy-First');
    expect(elements.get('rec-planner-badge')?.className).toBe('planner-badge planner-badge-strategy');
    expect(elements.get('rec-source')?.textContent).toBe('Strategy-first Adaptive');
  });

  it('prunes owned items only when in-game overlay is rendered', () => {
    inGameOverlay = true;
    const items = [
      plannedItem(3862866912, 1, 'OWNED'),
      plannedItem(1577772648, 2, 'NEXT'),
      plannedItem(1773091176, 3, 'PLANNED'),
    ];

    showAdaptiveRecommendation(recommendation({ recommendedBuild: items }));
    const planEl = elements.get('rec-plan');
    expect(planEl?.children.length).toBe(2);
    expect(planEl?.children[0].className).toContain('status-next');
    expect(planEl?.children[1].className).toContain('status-planned');
  });
});
