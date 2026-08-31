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

// Hero Guide Integration
let currentBuilds: any[] = [];
let currentAdjustments: any[] = [];

function formatTime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return '--:--';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }

  return `${pad(minutes)}:${pad(secs)}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildComponentMaps(items: any[]): {
  componentsByParent: Map<number, Set<number>>;
} {
  const componentsByParent = new Map<number, Set<number>>();

  for (const item of items) {
    const parentId = Number(item.id);
    const componentIds = Array.isArray(item.componentItemIds) ? item.componentItemIds.map((id: any) => Number(id)) : [];
    if (!Number.isFinite(parentId) || componentIds.length === 0) {
      continue;
    }

    if (!componentsByParent.has(parentId)) {
      componentsByParent.set(parentId, new Set());
    }

    for (const componentId of componentIds) {
      if (!Number.isFinite(componentId)) {
        continue;
      }

      componentsByParent.get(parentId)!.add(componentId);
    }
  }

  return { componentsByParent };
}

function expandOwnedItemIds(purchasedIds: Set<number>, items: any[]): Set<number> {
  const { componentsByParent } = buildComponentMaps(items);
  const owned = new Set(purchasedIds);

  const addComponents = (itemId: number, visited = new Set<number>()) => {
    if (visited.has(itemId)) {
      return;
    }
    visited.add(itemId);

    for (const componentId of componentsByParent.get(itemId) || []) {
      owned.add(componentId);
      addComponents(componentId, visited);
    }
  };

  for (const itemId of purchasedIds) {
    addComponents(itemId);
  }

  return owned;
}

function isBuildItemAlreadyHandled(item: any, ownedIds: Set<number>): boolean {
  const itemId = Number(item.id);
  return Number.isFinite(itemId) && ownedIds.has(itemId);
}

function legacySkillActions(skillsOrder: number[]): any[] {
  const costs = [1, 2, 5];
  const seenBySkill = new Map<number, number>();
  const actions: any[] = [];

  for (const skill of skillsOrder || []) {
    const skillNum = Number(skill);
    if (!Number.isFinite(skillNum) || skillNum < 1 || skillNum > 4) {
      continue;
    }

    const seenCount = seenBySkill.get(skillNum) || 0;
    if (seenCount === 0) {
      actions.push({ step: actions.length + 1, skill: skillNum, action: 'UNLOCK', upgradeTier: 0, pointCost: 1 });
    } else if (seenCount <= costs.length) {
      actions.push({ step: actions.length + 1, skill: skillNum, action: 'UPGRADE', upgradeTier: seenCount, pointCost: costs[seenCount - 1] });
    }
    seenBySkill.set(skillNum, seenCount + 1);
  }

  return actions;
}

function getSkillActions(build: any): any[] {
  return Array.isArray(build?.skillBuild) && build.skillBuild.length > 0
    ? build.skillBuild
    : legacySkillActions(build?.skillsOrder || []);
}

function formatSkillAction(action: any): { label: string; detail: string } {
  const skill = Number(action.skill);
  const pointCost = Number(action.pointCost || 1);
  if (action.action === 'UNLOCK') {
    return {
      label: `Learn Skill ${skill}`,
      detail: `${pointCost} AP`,
    };
  }

  return {
    label: `Upgrade Skill ${skill}`,
    detail: `Tier ${action.upgradeTier} · ${pointCost} AP`,
  };
}

export function showHeroGuide(buildsData: any, heroName: string): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');
  const selectEl = document.getElementById('build-select') as HTMLSelectElement;
  const titleEl = document.getElementById('guide-title');

  if (!emptyEl || !activeEl || !selectEl) return;

  emptyEl.style.display = 'none';
  activeEl.style.display = 'flex';

  let displayHeroName = heroName;
  const ow = (window as any).overwolf;
  const mainWindow = (ow && ow.windows) ? ow.windows.getMainWindow() as any : null;
  const heroNamesMap = (mainWindow && mainWindow.heroNamesMap) ? mainWindow.heroNamesMap : {};

  const matchTitle = heroName.match(/Hero_(\d+)/i);
  if (matchTitle && heroNamesMap[matchTitle[1]]) {
    displayHeroName = heroNamesMap[matchTitle[1]];
  }

  if (titleEl) {
    titleEl.textContent = `${displayHeroName} Build Guide`;
  }

  // Handle recommendation DTO
  if (buildsData.recommendedBuildType && buildsData.baseBuild) {
    const recBuild = buildsData.baseBuild;
    recBuild.name = `${recBuild.buildType ? recBuild.buildType.toUpperCase() : 'BUILD'} (Matchup Score: ${buildsData.suitabilityScore})`;
    currentBuilds = [recBuild];
    currentAdjustments = buildsData.matchupAdjustments || [];
  } else {
    // Standard hero builds list
    currentBuilds = (buildsData.builds || []).map((b: any) => ({
      ...b,
      name: `${b.buildType ? b.buildType.toUpperCase() : 'BUILD'} (${b.winRate || 50}% WR | ${b.matchCount || 10} games)`,
    }));
    currentAdjustments = []; // No dynamic composition adjustments in static list
  }

  // Populate build dropdown
  selectEl.innerHTML = currentBuilds.map((b, idx) => `
    <option value="${idx}">${escapeHtml(b.name)}</option>
  `).join('');

  renderActiveBuild(0);
}

export function hideHeroGuide(): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');

  if (!emptyEl || !activeEl) return;

  emptyEl.style.display = 'flex';
  activeEl.style.display = 'none';
}

export function showWarningPopup(): void {
  // Dynamo warning is rendered by the dedicated `dynamo_warning` Overwolf window.
}

export function showSituationalPanel(data: any): void {
  const panel = document.getElementById('situational-recommendation-panel');
  const nameEl = document.getElementById('rec-item-name');
  const reasonEl = document.getElementById('rec-reason');
  const titleEl = document.getElementById('rec-decision-title');

  if (!panel || !nameEl || !reasonEl || !titleEl) return;

  panel.style.display = 'flex';
  nameEl.textContent = data.recommendedItemName || 'Предмет';
  titleEl.textContent = `Спецсовет от Динамо (${data.decision || 'РЕКОМЕНДАЦИЯ'})`;

  let reason = data.counterPurpose || '';
  if (data.supportingEvidence && data.supportingEvidence.length > 0) {
    // Take first 2 lines of evidence if available to make it brief
    reason = `${data.counterPurpose}: ${data.supportingEvidence.slice(0, 2).join('; ')}`;
  }
  reasonEl.textContent = reason;
}

export function showAdaptiveRecommendation(data: any): void {
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

export function hideSituationalPanel(): void {
  const panel = document.getElementById('situational-recommendation-panel');
  if (panel) {
    panel.style.display = 'none';
  }
}

// Backward-compatible aliases
export const showDynamoGuide = showHeroGuide;
export const hideDynamoGuide = hideHeroGuide;

function renderActiveBuild(idx: number): void {
  const build = currentBuilds[idx];
  if (!build) return;

  const descEl = document.getElementById('guide-build-desc');
  const earlyEl = document.getElementById('phase-early');
  const midEl = document.getElementById('phase-mid');
  const lateEl = document.getElementById('phase-late');
  const adjEl = document.getElementById('guide-adjustments');
  const adjListEl = document.getElementById('adjustments-list');

  if (descEl) {
    descEl.textContent = build.description || `${build.matchCount} matches | ${build.winRate}% win rate`;
  }

  // Hide the matchup adjustments block as it's now integrated directly into the phases
  if (adjEl) {
    adjEl.style.display = 'none';
  }

  function getSlotColorRu(slotType?: string): string {
    if (!slotType) return '';
    const s = slotType.toLowerCase();
    if (s === 'weapon') return 'оранжевый';
    if (s === 'vitality') return 'зелёный';
    if (s === 'spirit') return 'фиолетовый';
    return '';
  }

  const renderItemRows = (items: any[]) => {
    if (!items || items.length === 0) {
      return '<span style="color: var(--text-secondary); font-style: italic; font-size: 0.75rem;">No items</span>';
    }
    return items.map(i => {
      const colorRu = getSlotColorRu(i.slotType || i.slot);
      const costText = i.cost ? `${i.cost}` : '';
      const colorText = colorRu ? ` (${colorRu})` : '';

      let subtitle = `Avg buy: ${formatTime(i.avgPurchaseTimeS)}`;
      if (costText || colorText) {
        subtitle += ` | ${costText}${colorText}`;
      }

      let popularityOrContext = '';
      if (i.adjustmentText) {
        popularityOrContext = `<span class="item-adjustment-badge ${i.adjustmentType || ''}">${escapeHtml(i.adjustmentText)}</span>`;
      } else {
        const popularity = i.score || i.pickRate || i.popularity || 0;
        popularityOrContext = `<span class="item-popularity">${escapeHtml(popularity)}%</span>`;
      }

      return `
        <div class="guide-item-row ${i.slotType || i.slot || ''} ${i.adjustmentText ? 'adjustment-injected' : ''}">
          <div class="guide-item-main">
            <strong class="guide-item-title">${escapeHtml(i.name)}</strong>
            <span class="guide-item-subtitle">${escapeHtml(subtitle)}</span>
          </div>
          ${popularityOrContext}
        </div>
      `;
    }).join('');
  };

  // Support phase-based list
  if (build.phases) {
    let earlyList = [...(build.phases.early || [])];
    let midList = [...(build.phases.mid || [])];
    let lateList = [...(build.phases.late || [])];

    if (currentAdjustments && currentAdjustments.length > 0) {
      const ow = (window as any).overwolf;
      const mainWindow = (ow && ow.windows) ? ow.windows.getMainWindow() as any : null;
      const heroNamesMap = (mainWindow && mainWindow.heroNamesMap) ? mainWindow.heroNamesMap : {};

      for (const adj of currentAdjustments) {
        let reason = adj.reason || '';
        const match = reason.match(/Hero_(\d+)/i);
        if (match) {
          const id = match[1];
          if (heroNamesMap[id]) {
            reason = reason.replace(new RegExp(`Hero_${id}`, 'gi'), heroNamesMap[id]);
          }
        }

        let targetName = 'Hero';
        const matchEnemy = reason.match(/against\s+([^\(+]+)/i);
        const matchAlly = reason.match(/(?:with teammate|with)\s+([^\(+]+)/i);
        if (matchEnemy) {
          targetName = matchEnemy[1].trim();
        } else if (matchAlly) {
          targetName = matchAlly[1].trim();
        }

        const adjustmentText = adj.type === 'counter' ? `vs ${targetName}` : `with ${targetName}`;

        const adjItem = {
          ...adj,
          slot: adj.slotType,
          adjustmentText,
          adjustmentType: adj.type,
        };

        const time = adj.avgPurchaseTimeS || 0;
        if (time < 600) {
          earlyList.push(adjItem);
        } else if (time < 1200) {
          midList.push(adjItem);
        } else {
          lateList.push(adjItem);
        }
      }

      // Re-sort to preserve timeline purchase order
      earlyList.sort((a, b) => a.avgPurchaseTimeS - b.avgPurchaseTimeS);
      midList.sort((a, b) => a.avgPurchaseTimeS - b.avgPurchaseTimeS);
      lateList.sort((a, b) => a.avgPurchaseTimeS - b.avgPurchaseTimeS);
    }

    const isHUD = typeof window !== 'undefined' && window.location.href.includes('in_game.html');

    if (isHUD) {
      const ow = (window as any).overwolf;
      const mainWindow = (ow && ow.windows) ? ow.windows.getMainWindow() as any : null;
      const purchasedIds = (mainWindow && mainWindow.localPurchasedItemIds) ? mainWindow.localPurchasedItemIds : new Set<number>();
      const currentLevel = (mainWindow && mainWindow.localPlayerLevel) ? mainWindow.localPlayerLevel : 1;

      const allItemsOrdered = [...earlyList, ...midList, ...lateList];
      const ownedIds = expandOwnedItemIds(purchasedIds, allItemsOrdered);
      const remainingItems = allItemsOrdered.filter(item => !isBuildItemAlreadyHandled(item, ownedIds));
      const next3Items = remainingItems.slice(0, 3);

      if (earlyEl) {
        earlyEl.innerHTML = renderItemRows(next3Items);
        const titleEl = earlyEl.parentElement?.querySelector('.phase-col-title');
        if (titleEl) titleEl.textContent = 'Next Items to Buy';
      }
      if (midEl && midEl.parentElement) {
        midEl.parentElement.style.display = 'none';
      }
      if (lateEl && lateEl.parentElement) {
        lateEl.parentElement.style.display = 'none';
      }

      const skillsEl = document.getElementById('guide-skills');
      if (skillsEl) {
        skillsEl.innerHTML = renderSkillListHUD(getSkillActions(build), currentLevel);
      }
    } else {
      if (earlyEl) {
        earlyEl.innerHTML = renderItemRows(earlyList);
        const titleEl = earlyEl.parentElement?.querySelector('.phase-col-title');
        if (titleEl) titleEl.textContent = 'Early Game (0-10m)';
      }
      if (midEl) {
        if (midEl.parentElement) midEl.parentElement.style.display = 'flex';
        midEl.innerHTML = renderItemRows(midList);
      }
      if (lateEl) {
        if (lateEl.parentElement) lateEl.parentElement.style.display = 'flex';
        lateEl.innerHTML = renderItemRows(lateList);
      }

      const skillsEl = document.getElementById('guide-skills');
      if (skillsEl) {
        skillsEl.innerHTML = renderSkillGrid(getSkillActions(build));
      }
    }
  } else {
    // Legacy support
    const items: any[] = build.items || [];
    if (items.length > 0) {
      const third = Math.ceil(items.length / 3);
      const early = items.slice(0, third);
      const mid = items.slice(third, third * 2);
      const late = items.slice(third * 2);
      if (earlyEl) earlyEl.innerHTML = renderItemRows(early);
      if (midEl) midEl.innerHTML = renderItemRows(mid);
      if (lateEl) lateEl.innerHTML = renderItemRows(late);
    }
  }
}

function renderSkillGrid(skillActions: any[]): string {
  if (!skillActions || skillActions.length === 0) {
    return '<span style="color: var(--text-secondary); font-style: italic; font-size: 0.75rem;">No skill order recorded</span>';
  }

  // Determine unique skill IDs used in this build
  const uniqueSkills = [...new Set(skillActions.map((action) => Number(action.skill)))].sort((a, b) => a - b);
  const colors = ['active-1', 'active-2', 'active-3', 'active-4', 'active-5', 'active-6'];

  const skills = uniqueSkills.map((id, i) => ({
    id,
    name: `Skill ${id}`,
    activeClass: colors[i % colors.length],
  }));

  let headerCellsHtml = '';
  for (let col = 1; col <= skillActions.length; col++) {
    headerCellsHtml += `<div class="skill-header-cell">${col}</div>`;
  }

  const gridHeaderHtml = `
    <div class="skill-grid-header">
      <div class="skill-header-label"></div>
      <div class="skill-header-cells">${headerCellsHtml}</div>
    </div>
  `;

  const rowsHtml = skills.map(skill => {
    let cellsHtml = '';
    for (const action of skillActions) {
      const isActive = Number(action.skill) === skill.id;
      const cellText = isActive ? (action.action === 'UNLOCK' ? 'L' : String(action.pointCost || 'U')) : '';
      cellsHtml += `<div class="skill-cell ${isActive ? skill.activeClass : ''}" title="${isActive ? escapeHtml(formatSkillAction(action).label) : ''}">${cellText}</div>`;
    }
    return `
      <div class="skill-row">
        <span class="skill-label">${skill.name}</span>
        <div class="skill-cells">${cellsHtml}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="skill-grid-container">
      <span class="phase-col-title" style="margin-bottom: 0.5rem; display: block;">Recommended Skill Build Path (L = learn, number = AP cost)</span>
      ${gridHeaderHtml}
      ${rowsHtml}
    </div>
  `;
}
function renderSkillListHUD(skillActions: any[], currentLevel: number): string {
  if (!skillActions || skillActions.length === 0) {
    return '<span style="color: var(--text-secondary); font-style: italic; font-size: 0.75rem;">No skill order recorded</span>';
  }

  const nextUpgrades: string[] = [];
  const colors = ['active-1', 'active-2', 'active-3', 'active-4'];
  const actionCursor = Math.max(0, Math.min(skillActions.length, currentLevel - 1));

  for (let i = 0; i < 3; i++) {
    const idx = actionCursor + i;
    if (idx >= skillActions.length) break;
    const action = skillActions[idx];
    const skillNum = Number(action.skill);
    const activeClass = colors[(skillNum - 1) % colors.length];
    const formatted = formatSkillAction(action);

    nextUpgrades.push(`
      <div style="display:flex; align-items:center; justify-content:space-between; background-color: rgba(27, 27, 34, 0.4); border: 1px solid var(--border); padding: 0.35rem 0.5rem; border-radius: 6px; font-size: 0.7rem;">
        <span style="color: var(--text-secondary); font-weight: 500;">${escapeHtml(formatted.label)}</span>
        <span class="skill-badge ${activeClass}" style="font-weight: 700; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.65rem;">${escapeHtml(formatted.detail)}</span>
      </div>
    `);
  }

  if (nextUpgrades.length === 0) {
    return '<div style="font-size:0.75rem; color:var(--text-secondary); text-align:center; padding: 0.5rem 0;">All skills maxed! 🎉</div>';
  }

  return `
    <div style="display:flex; flex-direction:column; gap:0.35rem;">
      <span class="phase-col-title" style="margin-bottom:0.1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem;">Next Skill Actions</span>
      ${nextUpgrades.join('')}
    </div>
  `;
}

// Bind to window for HTML element access
(window as any).switchActiveBuild = () => {
  const selectEl = document.getElementById('build-select') as HTMLSelectElement;
  if (selectEl) {
    const idx = parseInt(selectEl.value, 10);
    renderActiveBuild(idx);
  }
};
