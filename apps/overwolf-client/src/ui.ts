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
  title.textContent = 'Selected strategy';
  const commitment = document.createElement('span');
  commitment.className = 'strategy-commitment';
  commitment.textContent = `${strategy.commitmentLabel} · ${strategy.buildStatusLabel}`;
  header.append(title, commitment);

  const name = document.createElement('strong');
  name.className = 'strategy-name';
  name.textContent = strategy.idLabel;

  const progress = document.createElement('div');
  progress.className = 'strategy-progress';
  const progressCopy = document.createElement('span');
  progressCopy.textContent = strategy.progressLabel;
  const track = document.createElement('span');
  track.className = 'strategy-progress-track';
  const fill = document.createElement('span');
  fill.className = 'strategy-progress-fill';
  fill.style.width = `${strategy.progressValue}%`;
  track.appendChild(fill);
  progress.append(progressCopy, track);

  const details = document.createElement('div');
  details.className = 'strategy-details';
  [
    strategy.currentGoalLabel,
    strategy.branchLabel,
    strategy.slotLabel,
    strategy.investmentLabel,
    strategy.situationalLabel,
  ].filter((value): value is string => Boolean(value)).forEach((value) => {
    const row = document.createElement('div');
    row.textContent = value;
    details.appendChild(row);
  });

  section.append(header, name, progress, details);
}

function renderReasons(reasons: readonly string[]): void {
  const container = document.getElementById('rec-reasons');
  if (!container) {
    return;
  }
  container.replaceChildren();
  const visibleReasons = reasons.length > 0
    ? reasons
    : ['Following the strongest available Statlocker plan'];
  visibleReasons.forEach((reason) => {
    const item = document.createElement('li');
    item.textContent = reason;
    container.appendChild(item);
  });
}

function renderPlan(
  items: readonly AdaptivePresentedPlanItem[],
  remainingCount: number,
): void {
  const container = document.getElementById('rec-plan');
  if (!container) {
    return;
  }
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-row';
    empty.textContent = 'Plan is being assembled';
    container.appendChild(empty);
  } else {
    items.forEach((planned) => container.appendChild(createPlanItem(planned)));
  }

  setText('rec-plan-more', remainingCount > 0 ? `+${remainingCount} later` : '');
}

function createPlanItem(planned: AdaptivePresentedPlanItem): HTMLElement {
  const row = document.createElement('div');
  row.className = `plan-item slot-${planned.item.slot} status-${planned.status.toLowerCase()}`;

  const position = document.createElement('span');
  position.className = 'plan-position';
  position.textContent = String(planned.position).padStart(2, '0');

  const details = document.createElement('span');
  details.className = 'plan-details';
  const name = document.createElement('strong');
  name.textContent = planned.item.name;
  const meta = document.createElement('small');
  meta.textContent = [planned.statusLabel, planned.item.costLabel].filter(Boolean).join(' · ');
  details.append(name, meta);

  row.append(position, details);
  return row;
}

function renderAlternatives(alternatives: readonly AdaptivePresentedAlternative[]): void {
  const container = document.getElementById('rec-alternatives');
  const section = document.getElementById('rec-alternatives-section');
  if (!container || !section) {
    return;
  }
  container.replaceChildren();
  section.style.display = alternatives.length > 0 ? 'block' : 'none';
  alternatives.forEach((alternative) => {
    const row = document.createElement('div');
    row.className = `alternative-row slot-${alternative.item?.slot || 'unknown'}`;

    const name = document.createElement('span');
    name.textContent = alternative.headline;
    const score = document.createElement('small');
    score.textContent = alternative.scoreLabel;
    row.append(name, score);
    container.appendChild(row);
  });
}

function clearAdaptiveError(): void {
  const note = document.getElementById('rec-update-note');
  if (note) {
    note.textContent = '';
    note.style.display = 'none';
    note.removeAttribute('title');
  }
}

function isInGameOverlay(): boolean {
  return document.querySelector('.hud-container') !== null;
}

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = text;
  }
}

function setTone(id: string, tone: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.className = tone;
  }
}

function itemGlyph(slot: string | undefined): string {
  return { weapon: 'W', vitality: 'V', spirit: 'S' }[slot || ''] || '•';
}
