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

export function showAdaptiveRecommendation(data: any): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');
  const panel = document.getElementById('situational-recommendation-panel');
  const nameEl = document.getElementById('rec-item-name');
  const reasonEl = document.getElementById('rec-reason');
  const titleEl = document.getElementById('rec-decision-title');

  if (!panel || !nameEl || !reasonEl || !titleEl) {
    return;
  }

  if (emptyEl) {
    emptyEl.style.display = 'none';
  }
  if (activeEl) {
    activeEl.style.display = 'flex';
  }
  panel.style.display = 'flex';

  const action = data?.nextAction || {};
  const targetItemId = action.buyItemId ?? action.itemId ?? action.targetItemId ?? data?.nextTargetItemId;
  const actionLabel = String(action.type || 'ABSTAIN');
  const confidence = Number.isFinite(Number(data?.confidence))
    ? Math.round(Number(data.confidence) * 100)
    : 0;

  nameEl.textContent = targetItemId
    ? `${actionLabel} · Item #${targetItemId}`
    : actionLabel;
  titleEl.textContent = `Statlocker Adaptive · ${data?.gameState || 'UNKNOWN'} · ${confidence}% confidence`;

  const plan = Array.isArray(data?.recommendedBuild)
    ? [...data.recommendedBuild]
        .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
        .map((item: any) => `#${item.itemId} [${item.status || 'PLANNED'}]`)
        .join(' → ')
    : '';
  const reasons = Array.isArray(action.reasonCodes)
    ? action.reasonCodes.slice(0, 3).join(', ')
    : '';
  const freshness = Array.isArray(data?.evidence?.families)
    ? data.evidence.families
        .map((family: any) => `${family.dataset}:${family.freshness}`)
        .join(', ')
    : '';

  reasonEl.textContent = [
    plan ? `Plan: ${plan}` : 'Plan: no planned items',
    reasons ? `Reasons: ${reasons}` : '',
    freshness ? `Evidence: ${freshness}` : '',
  ].filter(Boolean).join(' | ');
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
}
