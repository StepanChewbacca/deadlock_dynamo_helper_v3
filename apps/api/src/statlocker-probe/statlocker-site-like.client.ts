export const STATLOCKER_SITE_LIKE_PROBE_CLIENT_JS = `(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const root = document.documentElement;
  const apiBase = (root.dataset.apiBase || location.pathname).replace(/\\/+$/, '');

  const state = {
    model: 'ITEM_META_WPA',
    requestInFlight: false,
  };

  const elements = {
    cards: Array.from(document.querySelectorAll('[data-model]')),
    run: byId('run'),
    hero: byId('hero'),
    min: byId('min'),
    matchId: byId('matchId'),
    statusIcon: byId('statusIcon'),
    statusTitle: byId('statusTitle'),
    statusText: byId('statusText'),
    statusModel: byId('statusModel'),
    statusHttp: byId('statusHttp'),
    statusTime: byId('statusTime'),
    output: byId('output'),
    outputHint: byId('outputHint'),
    captured: byId('captured'),
    raw: byId('raw'),
    clientState: byId('clientState'),
  };

  const required = ['run', 'hero', 'min', 'matchId', 'statusIcon', 'statusTitle', 'statusText', 'statusModel', 'statusHttp', 'statusTime', 'output', 'outputHint', 'captured', 'raw', 'clientState'];
  const missing = required.filter((key) => !elements[key]);
  if (missing.length) {
    document.body.insertAdjacentHTML('afterbegin', '<pre style="padding:12px;background:#310f0f;color:#ffd3d3">Statlocker UI initialization failed. Missing: ' + escapeHtml(missing.join(', ')) + '</pre>');
    return;
  }

  elements.cards.forEach((card) => {
    card.addEventListener('click', () => {
      selectModel(card.dataset.model || 'ITEM_META_WPA');
    });
  });

  elements.run.addEventListener('click', () => {
    void runModel();
  });

  elements.clientState.textContent = 'UI READY';
  elements.clientState.className = 'pill good';

  function selectModel(model) {
    state.model = model;
    elements.cards.forEach((card) => card.classList.toggle('selected', card.dataset.model === model));
    elements.statusModel.textContent = model;
    elements.statusTitle.textContent = 'Ready';
    elements.statusText.textContent = model === 'WIN_CHANCE'
      ? 'Enter a numeric Deadlock match ID, then press Run selected model.'
      : 'Press Run selected model.';
    elements.statusIcon.className = 'statusIcon';
  }

  async function runModel() {
    if (state.requestInFlight) return;

    const hero = String(elements.hero.value || '').trim() || 'Abrams';
    const minSampleSize = normalizeMinSampleSize(elements.min.value);
    const matchId = String(elements.matchId.value || '').trim();

    if (state.model === 'WIN_CHANCE' && !/^\\d{6,30}$/.test(matchId)) {
      setError('Match ID required', 'Enter a real numeric Deadlock match ID.');
      return;
    }

    state.requestInFlight = true;
    setLoading();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 85_000);
    const endpoint = apiBase + '/browser-request';
    const payload = {
      model: state.model,
      hero,
      minSampleSize,
      ...(matchId ? { matchId } : {}),
    };

    try {
      elements.statusText.textContent = 'Request sent to ' + endpoint + '. Waiting for the backend probe.';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });

      const text = await response.text();
      let result;
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('Probe returned non-JSON HTTP ' + response.status + ': ' + text.slice(0, 300));
      }

      if (!response.ok) {
        const message = Array.isArray(result.message)
          ? result.message.join('; ')
          : result.message || result.error || 'Browser model probe failed';
        throw new Error('HTTP ' + response.status + ': ' + String(message));
      }

      renderResult(result);
      elements.statusIcon.className = 'statusIcon ok';
      elements.statusTitle.textContent = 'Live model response captured';
      elements.statusText.textContent = 'The browser request completed and the selected Statlocker model response was captured.';
      elements.statusHttp.textContent = 'HTTP ' + String(result.primary && result.primary.status !== undefined ? result.primary.status : response.status);
      elements.statusTime.textContent = String(result.elapsedMs !== undefined ? result.elapsedMs : '-') + ' ms';
    } catch (error) {
      const message = error && error.name === 'AbortError'
        ? 'UI timeout after 85 seconds while waiting for /browser-request.'
        : error instanceof Error ? error.message : String(error);
      setError('Probe failed', message);
    } finally {
      clearTimeout(timeout);
      state.requestInFlight = false;
      elements.run.disabled = false;
      elements.run.textContent = 'Run selected model';
    }
  }

  function setLoading() {
    elements.run.disabled = true;
    elements.run.textContent = 'Requesting...';
    elements.statusIcon.className = 'statusIcon loading';
    elements.statusTitle.textContent = 'Requesting selected model';
    elements.statusText.textContent = 'Preparing request...';
    elements.statusHttp.textContent = '...';
    elements.statusTime.textContent = '...';
    elements.outputHint.textContent = 'request in progress';
  }

  function setError(title, message) {
    elements.statusIcon.className = 'statusIcon err';
    elements.statusTitle.textContent = title;
    elements.statusText.textContent = message;
    elements.statusHttp.textContent = 'ERROR';
    elements.statusTime.textContent = '-';
    elements.outputHint.textContent = 'request failed';
    elements.raw.textContent = message;
  }

  function renderResult(result) {
    const primary = result && result.primary ? result.primary : {};
    const data = primary.data;
    elements.output.className = 'panelBody';
    elements.outputHint.textContent = primary.path || 'captured response';
    elements.raw.textContent = JSON.stringify(result, null, 2);
    renderCaptured(Array.isArray(result.captured) ? result.captured : []);

    if (result.model === 'ITEM_META_WPA') {
      const items = Array.isArray(data && data.items) ? data.items : [];
      elements.output.innerHTML = summary([
        ['items', items.length],
        ['tiers', Array.isArray(data && data.tiers) ? data.tiers.length : 0],
        ['heroes', Array.isArray(data && data.availableHeroes) ? data.availableHeroes.length : 0],
        ['patches', Array.isArray(data && data.availablePatches) ? data.availablePatches.length : 0],
      ]) + smartTable(items);
      return;
    }

    if (result.model === 'ETERNUS_BUILD_ANALYSIS') {
      const build = data || {};
      const items = Array.isArray(build.items) ? build.items : [];
      const relationships = Array.isArray(build.itemRelationships) ? build.itemRelationships : [];
      elements.output.innerHTML = summary([
        ['matches', build.totalMatches || '-'],
        ['win rate', value(build.winRate)],
        ['items', items.length],
        ['relationships', relationships.length],
      ]) + smartTable(items.length ? items : relationships);
      return;
    }

    if (result.model === 'T4_BUILD_CHAINS') {
      const byHero = data && data.by_hero && typeof data.by_hero === 'object' ? data.by_hero : {};
      const names = Object.keys(byHero);
      const hero = String(elements.hero.value || '').trim();
      const heroData = byHero[hero] || byHero[hero.toLowerCase()] || byHero[names[0]];
      const rows = Array.isArray(heroData)
        ? heroData
        : heroData && typeof heroData === 'object'
          ? Object.entries(heroData).map(([key, entry]) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.assign({ key }, entry) : { key, value: entry })
          : [];
      elements.output.innerHTML = summary([
        ['heroes', names.length],
        ['selected', hero || '-'],
        ['rows', rows.length],
        ['metadata', data && data.metadata ? 'yes' : 'no'],
      ]) + smartTable(rows);
      return;
    }

    if (result.model === 'WIN_CHANCE') {
      const intervals = Array.isArray(data && data.winRateIntervals)
        ? data.winRateIntervals
        : Array.isArray(data) ? data : [];
      elements.output.innerHTML = summary([
        ['intervals', intervals.length],
        ['match', String(elements.matchId.value || '').trim() || '-'],
        ['payload', Array.isArray(data) ? 'array' : typeof data],
        ['status', intervals.length ? 'timeline loaded' : 'inspect raw'],
      ]) + smartTable(intervals);
      return;
    }

    elements.output.innerHTML = '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
  }

  function renderCaptured(items) {
    if (!items.length) {
      elements.captured.innerHTML = '<div class="captured mono">No matching model calls captured.</div>';
      return;
    }

    elements.captured.innerHTML = items.map((entry) => {
      const status = Number(entry.status || 0);
      const cls = status >= 200 && status < 300 ? 'okText' : 'badText';
      return '<div class="captured"><div class="capturedTop"><span class="mono">' +
        escapeHtml(String(entry.method || 'GET') + ' ' + String(entry.path || '')) +
        '</span><strong class="' + cls + '">' + escapeHtml(String(status || '-')) +
        '</strong></div><div class="url mono">' + escapeHtml(String(entry.url || '')) + '</div></div>';
    }).join('');
  }

  function summary(entries) {
    return '<div class="summary">' + entries.map((entry) =>
      '<div class="summaryCell"><strong>' + escapeHtml(value(entry[1])) + '</strong><span>' + escapeHtml(entry[0]) + '</span></div>'
    ).join('') + '</div>';
  }

  function smartTable(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return '<div class="empty">Endpoint returned successfully, but no array rows were detected.<br>Inspect raw JSON on the right.</div>';
    }

    const objects = rows.slice(0, 40).map((entry, index) => entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { index, value: entry });
    const preferred = ['name', 'itemName', 'item_name', 'itemId', 'item_id', 'id', 'key', 'wpa', 'avgWpa', 'averageWpa', 'winRate', 'pickRate', 'purchaseRate', 'sampleSize', 'sample_size', 'games', 'matches', 'count', 'avgPurchaseTime', 'averagePurchaseTime', 'purchaseTime', 'tier', 'cost'];
    const keys = [];

    objects.slice(0, 12).forEach((row) => {
      Object.keys(row).forEach((key) => {
        const current = row[key];
        const scalar = current === null || ['string', 'number', 'boolean'].includes(typeof current);
        if (scalar && !keys.includes(key)) keys.push(key);
      });
    });

    const columns = preferred.filter((key) => keys.includes(key)).concat(keys.filter((key) => !preferred.includes(key))).slice(0, 8);
    if (!columns.length) return '<pre>' + escapeHtml(JSON.stringify(rows.slice(0, 20), null, 2)) + '</pre>';

    const head = '<thead><tr>' + columns.map((key) => '<th>' + escapeHtml(key) + '</th>').join('') + '</tr></thead>';
    const body = '<tbody>' + objects.map((row) => '<tr>' + columns.map((key) => {
      const current = row[key];
      return '<td' + (typeof current === 'number' ? ' class="number"' : '') + '>' + escapeHtml(value(current)) + '</td>';
    }).join('') + '</tr>').join('') + '</tbody>';

    return '<div class="tableWrap"><table>' + head + body + '</table></div>';
  }

  function normalizeMinSampleSize(input) {
    const value = Number(input || 500);
    if (!Number.isFinite(value)) return 500;
    return Math.max(1, Math.min(100000, Math.round(value)));
  }

  function value(input) {
    if (input === null || input === undefined) return '-';
    if (typeof input === 'number') return Number.isInteger(input) ? String(input) : String(Math.round(input * 10000) / 10000);
    if (typeof input === 'object') return JSON.stringify(input);
    return String(input);
  }

  function escapeHtml(input) {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
`;
