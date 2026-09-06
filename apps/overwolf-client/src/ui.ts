import type { AdaptiveRecommendationResultV1 } from '@deadlock-live-probe/shared';
import type {
  AdaptivePresentedAlternative,
  AdaptivePresentedPlanItem,
  AdaptivePresentedStrategy,
} from './adaptive-recommendation-presentation';
import { buildAdaptiveRecommendationPresentation } from './adaptive-recommendation-presentation';

export function updateStatus(text: string, statusClass?: 'connected' | 'error' | 'init'): void {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = statusClass || '';
  }
}

export function updateLastEvent(text: string): void {
  const el = document.getElementById('last-event');
  if (el) {
    el.textContent = text;
  }
}

let sendCount = 0;

export function incrementSends(): void {
  sendCount++;
  const el = document.getElementById('last-send');
  if (el) {
    el.textContent = String(sendCount);
  }
}

export function logConsole(message: string): void {
  const el = document.getElementById('console');
  if (el) {
    const timestamp = new Date().toLocaleTimeString();
    el.textContent = `[${timestamp}] ${message}\n` + (el.textContent || '');
  }
  console.log(message);
}

export function updateIndicator(text: string, active: boolean): void {
  const textEl = document.getElementById('indicator-text');
  const dotEl = document.getElementById('indicator-dot');
  if (textEl) {
    textEl.textContent = text;
  }
  if (dotEl) {
    if (active) {
      dotEl.classList.add('active');
    } else {
      dotEl.classList.remove('active');
    }
  }
}

let hasAdaptiveRecommendation = false;

export function showAdaptiveRecommendation(data: AdaptiveRecommendationResultV1): void {
  const view = buildAdaptiveRecommendationPresentation(data);
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');
  const panel = document.getElementById('situational-recommendation-panel');
  const nameEl = document.getElementById('rec-item-name');
  const headlineEl = document.getElementById('rec-headline');

  if (!panel || !nameEl || !headlineEl) {
    return;
  }

  hasAdaptiveRecommendation = true;
  if (emptyEl) {
    emptyEl.style.display = 'none';
  }
  if (activeEl) {
    activeEl.style.display = 'flex';
  }
  panel.style.display = 'flex';

  setText('rec-source', view.sourceLabel);
  setText('rec-planner-badge', view.plannerMethodLabel);
  const badgeEl = document.getElementById('rec-planner-badge');
  if (badgeEl) {
    badgeEl.className = view.isStrategyFirst
      ? 'planner-badge planner-badge-strategy'
      : 'planner-badge planner-badge-legacy';
  }
  setText('rec-game-state', view.stateLabel);
  setText('rec-health', view.healthLabel);
  setText('rec-action-label', view.actionLabel);
  setText('rec-confidence-label', view.confidence.label);
  setText('rec-evidence', view.evidenceLabel);
  headlineEl.textContent = view.headline;
  nameEl.textContent = view.primaryItem?.name || 'Adaptive plan';
  setText(
    'rec-item-meta',
    [
      view.primaryItem?.tierLabel,
      view.primaryItem?.costLabel,
      view.replacedItem
        ? `Sell ${view.replacedItem.known ? view.replacedItem.name : view.replacedItem.diagnosticLabel}`
        : undefined,
      view.primaryItem?.diagnosticLabel,
    ].filter(Boolean).join(' · '),
  );
  setText('rec-item-glyph', itemGlyph(view.primaryItem?.slot));

  panel.setAttribute('data-slot', view.primaryItem?.slot || 'unknown');
  setTone('rec-health', `health-${view.healthTone}`);
  setTone('rec-game-state', `state-${view.stateTone}`);

  const confidenceFill = document.getElementById('rec-confidence-fill');
  if (confidenceFill) {
    confidenceFill.style.width = `${view.confidence.value}%`;
  }

  const planItems = isInGameOverlay()
    ? view.plan.items.filter((item) => item.status !== 'OWNED')
    : view.plan.items;

  renderStrategy(view.strategy);
  renderReasons(view.reasons);
  renderPlan(planItems, view.plan.remainingCount);
  // rankedImmediateCandidates are diagnostic only. A user-facing alternative requires a dedicated curated contract.
  renderAlternatives([]);
  clearAdaptiveError();
}

export function showAdaptiveError(message = 'Recommendation is updating'): void {
  const note = document.getElementById('rec-update-note');
  if (hasAdaptiveRecommendation) {
    setText('rec-health', 'Updating');
    setTone('rec-health', 'health-waiting');
    if (note) {
      note.textContent = 'Connection interrupted - showing the last safe recommendation.';
      note.style.display = 'flex';
      note.title = message;
    }
    return;
  }

  const emptyEl = document.getElementById('guide-empty');
  if (emptyEl) {
    emptyEl.style.display = 'flex';
  }
  setText('guide-empty-title', 'Statlocker is reconnecting');
  setText('guide-empty-copy', 'The recommendation will appear here as soon as fresh data arrives.');
}

export function hideSituationalPanel(): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');
  const panel = document.getElementById('situational-recommendation-panel');

  if (panel) {
    panel.style.display = 'none';
  }
  if (activeEl) {
    activeEl.style.display = 'none';
  }
  if (emptyEl) {
    emptyEl.style.display = 'flex';
  }
  setText('guide-empty-title', 'Waiting for match data');
  setText('guide-empty-copy', 'Your Statlocker recommendation will appear automatically when the match is detected.');
  hasAdaptiveRecommendation = false;
  clearAdaptiveError();
}

function renderStrategy(strategy: AdaptivePresentedStrategy | undefined): void {
  const secondary = document.querySelector('.adaptive-secondary');
  if (!secondary) return;
  let section = document.getElementById('rec-strategy-section');
  if (!strategy) {
    if (section) section.style.display = 'none';
    return;
  }
  if (!section) {
    section = document.createElement('section');
    section.id = 'rec-strategy-section';
    section.className = 'section-card';
    section.setAttribute('data-strategy-card', 'true');
    secondary.insertBefore(section, secondary.firstChild);
  }
  section.style.display = 'block';
  section.replaceChildren();

  const header = document.createElement('div');
  header.className = 'section-header';
  const title = document.createElement('span');
  title.className = 'section-title';
  title.textContent = `Strategy · ${strategy.idLabel}`;
  const commitment = document.createElement('span');
  commitment.className = 'strategy-commitment';
  commitment.textContent = strategy.commitmentLabel;
  header.append(title, commitment);

  const grid = document.createElement('div');
  grid.className = 'strategy-grid';

  if (strategy.currentGoalLabel) {
    grid.append(createStrategyRow('Current goal', strategy.currentGoalLabel));
  }
  if (strategy.branchLabel) {
    grid.append(createStrategyRow('Path', strategy.branchLabel));
  }
  if (strategy.investmentLabel) {
    grid.append(createStrategyRow('Investment', strategy.investmentLabel));
  }
  if (strategy.situationalLabel) {
    grid.append(createStrategyRow('Situational', strategy.situationalLabel));
  }
  grid.append(createStrategyRow('Slots', strategy.slotLabel));
  grid.append(createStrategyRow('Progress', `${strategy.progressLabel} (${strategy.progressValue}%)`));

  section.append(header, grid);
}

function createStrategyRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'strategy-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'strategy-row-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'strategy-row-value';
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

function renderReasons(reasons: readonly string[]): void {
  const list = document.getElementById('rec-reasons');
  if (!list) {
    return;
  }

  list.replaceChildren();
  if (reasons.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Highest weighted value for current game phase';
    list.appendChild(li);
    return;
  }

  for (const reason of reasons) {
    const li = document.createElement('li');
    li.textContent = reason;
    list.appendChild(li);
  }
}

function renderPlan(items: readonly AdaptivePresentedPlanItem[], remainingCount: number): void {
  const container = document.getElementById('rec-plan');
  const moreEl = document.getElementById('rec-plan-more');
  if (!container) {
    return;
  }

  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = 'Adaptive build path will populate after initial farm.';
    container.appendChild(empty);
    if (moreEl) {
      moreEl.textContent = '';
    }
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = `plan-item slot-${item.item.slot} status-${item.status.toLowerCase()}`;
    const position = document.createElement('span');
    position.className = 'plan-position';
    position.textContent = String(item.position);
    const details = document.createElement('div');
    details.className = 'plan-details';
    const strong = document.createElement('strong');
    strong.textContent = item.item.name;
    const small = document.createElement('small');
    small.textContent = [item.statusLabel, item.item.costLabel].filter(Boolean).join(' · ');
    details.append(strong, small);
    card.append(position, details);
    container.appendChild(card);
  }

  if (moreEl) {
    moreEl.textContent = remainingCount > 0 ? `+${remainingCount} more` : '';
  }
}

function renderAlternatives(alternatives: readonly AdaptivePresentedAlternative[]): void {
  const section = document.getElementById('rec-alternatives-section');
  const container = document.getElementById('rec-alternatives');
  if (!section || !container) {
    return;
  }

  if (alternatives.length === 0) {
    section.style.display = 'none';
    container.replaceChildren();
    return;
  }

  section.style.display = 'block';
  container.replaceChildren();
  for (const alternative of alternatives) {
    const row = document.createElement('div');
    row.className = `alternative-row slot-${alternative.item?.slot || 'unknown'}`;
    const name = document.createElement('span');
    name.textContent = `${alternative.actionLabel} ${alternative.item?.name || 'Alternative'}`;
    const score = document.createElement('small');
    score.textContent = alternative.scoreLabel;
    row.append(name, score);
    container.appendChild(row);
  }
}

function clearAdaptiveError(): void {
  const note = document.getElementById('rec-update-note');
  if (note) {
    note.style.display = 'none';
    note.textContent = '';
    note.removeAttribute('title');
  }
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function setTone(id: string, toneClass: string): void {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  const baseClasses = el.className
    .split(/\s+/)
    .filter((name) => !name.startsWith('health-') && !name.startsWith('state-'));
  baseClasses.push(toneClass);
  el.className = baseClasses.join(' ').trim();
}

function itemGlyph(slot: string | undefined): string {
  switch (slot) {
    case 'weapon':
      return 'W';
    case 'vitality':
      return 'V';
    case 'spirit':
      return 'S';
    default:
      return '•';
  }
}

function isInGameOverlay(): boolean {
  if (typeof document !== 'undefined' && Boolean(document.querySelector?.('.hud-container'))) {
    return true;
  }
  return typeof window !== 'undefined' && typeof window.location?.pathname === 'string' && window.location.pathname.includes('in_game');
}
