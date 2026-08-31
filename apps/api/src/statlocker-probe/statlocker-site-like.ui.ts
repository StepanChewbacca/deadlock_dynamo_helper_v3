export const STATLOCKER_SITE_LIKE_PROBE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statlocker Model Lab</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a09;
      --panel: #101412;
      --panel2: #151a17;
      --line: #29322d;
      --soft: #1b221f;
      --text: #ebe8dc;
      --muted: #929a94;
      --dim: #646d67;
      --gold: #d4a85e;
      --gold2: #efc676;
      --green: #72c992;
      --red: #df8a82;
      --blue: #86abc9;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 18% -8%, rgba(100, 133, 103, .13), transparent 31%),
        radial-gradient(circle at 90% 1%, rgba(182, 132, 66, .10), transparent 25%),
        var(--bg);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .16;
      background-image:
        linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.014) 1px, transparent 1px);
      background-size: 36px 36px;
      mask-image: linear-gradient(to bottom, #000, transparent 78%);
    }

    button, input, select { font: inherit; }
    button { cursor: pointer; }
    code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

    header {
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(16px);
      background: rgba(8, 10, 9, .91);
      border-bottom: 1px solid rgba(76, 88, 81, .35);
    }
    .topbar {
      max-width: 1460px;
      height: 64px;
      padding: 0 24px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .brand { font-weight: 950; letter-spacing: -.045em; font-size: 20px; }
    .brand b { color: var(--gold2); }
    .tag {
      padding: 4px 7px;
      border: 1px solid #5a4930;
      background: #1b160f;
      color: var(--gold2);
      font-size: 9px;
      font-weight: 900;
      letter-spacing: .13em;
      text-transform: uppercase;
      border-radius: 2px;
    }
    nav { display: flex; gap: 20px; color: var(--muted); font-size: 10px; font-weight: 850; letter-spacing: .10em; text-transform: uppercase; }
    nav span.active { color: var(--text); }
    .live { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 14px rgba(114,201,146,.65); }

    main { max-width: 1460px; margin: 0 auto; padding: 30px 24px 80px; }
    .hero {
      min-height: 215px;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(300px, .45fr);
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(18,24,20,.98), rgba(9,12,10,.98));
      overflow: hidden;
      position: relative;
    }
    .hero::after {
      content: "MODEL";
      position: absolute;
      right: -28px;
      bottom: -46px;
      font-weight: 950;
      font-size: 150px;
      letter-spacing: -.08em;
      color: rgba(212,168,94,.035);
    }
    .hero-copy { padding: 28px 30px; position: relative; z-index: 1; }
    .eyebrow { color: var(--gold); font-size: 10px; font-weight: 900; letter-spacing: .17em; text-transform: uppercase; }
    h1 { margin: 9px 0 0; font-size: clamp(34px, 4.5vw, 64px); line-height: .97; letter-spacing: -.055em; }
    h1 span { color: var(--gold2); }
    .hero p { max-width: 860px; color: #9ca49f; font-size: 13px; line-height: 1.6; margin: 17px 0 0; }
    .hero-side { padding: 20px; border-left: 1px solid var(--line); background: rgba(11,14,12,.66); z-index: 1; }
    .hero-side-title { color: var(--dim); text-transform: uppercase; letter-spacing: .13em; font-size: 9px; font-weight: 900; }
    .metric-grid { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .metric { padding: 11px; border: 1px solid var(--soft); background: #0d110f; }
    .metric strong { display: block; font-size: 20px; letter-spacing: -.03em; }
    .metric small { color: var(--dim); text-transform: uppercase; font-size: 8px; letter-spacing: .08em; }
    .note { margin-top: 11px; border-left: 2px solid var(--gold); background: #17140e; color: #bbb19c; padding: 10px 11px; font-size: 10px; line-height: 1.45; }

    .controls {
      margin-top: 12px;
      border: 1px solid var(--line);
      background: var(--panel);
      display: grid;
      grid-template-columns: 1fr .7fr 1fr auto;
      gap: 9px;
      padding: 12px;
      align-items: end;
    }
    label { display: block; color: var(--dim); font-size: 8px; font-weight: 900; letter-spacing: .11em; text-transform: uppercase; margin-bottom: 6px; }
    input, select {
      width: 100%;
      background: #090c0b;
      color: var(--text);
      border: 1px solid #303a35;
      border-radius: 2px;
      padding: 10px 11px;
      outline: none;
    }
    input:focus, select:focus { border-color: #725e3e; box-shadow: 0 0 0 2px rgba(212,168,94,.06); }
    .run {
      min-height: 38px;
      border: 1px solid var(--gold);
      background: var(--gold);
      color: #15110a;
      padding: 9px 16px;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .09em;
      border-radius: 2px;
    }
    .run:hover { background: var(--gold2); border-color: var(--gold2); }
    .run:disabled { opacity: .45; cursor: wait; }

    .tabs { margin-top: 28px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .model-card {
      min-height: 184px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #111613, #0d100f);
      padding: 15px;
      display: flex;
      flex-direction: column;
      transition: .15s ease;
      position: relative;
      overflow: hidden;
    }
    .model-card:hover { transform: translateY(-2px); border-color: #46534c; }
    .model-card.selected { border-color: #745f3d; background: linear-gradient(180deg, #181711, #0e100e); }
    .model-card.selected::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--gold); }
    .model-kicker { color: var(--dim); font-size: 8px; letter-spacing: .12em; text-transform: uppercase; font-weight: 900; }
    .model-card h3 { margin: 9px 0 5px; font-size: 16px; letter-spacing: -.025em; }
    .model-card p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .path { margin-top: 12px; padding: 8px; border: 1px solid var(--soft); background: #080b09; color: #bfc7c0; font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-bottom { margin-top: auto; padding-top: 12px; display: flex; gap: 6px; align-items: center; }
    .pill { border: 1px solid #354039; padding: 3px 6px; border-radius: 999px; color: var(--muted); font-size: 7px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .pill.good { color: var(--green); border-color: #34533f; background: #102118; }
    .pill.blue { color: var(--blue); border-color: #31475a; background: #111c26; }

    .statusbar { margin-top: 12px; border: 1px solid var(--line); background: #0e1210; min-height: 54px; display: flex; align-items: center; gap: 12px; padding: 10px 13px; }
    .status-icon { width: 9px; height: 9px; border-radius: 50%; background: var(--dim); }
    .status-icon.loading { background: var(--blue); box-shadow: 0 0 12px rgba(134,171,201,.45); animation: pulse 1s infinite alternate; }
    .status-icon.ok { background: var(--green); box-shadow: 0 0 12px rgba(114,201,146,.45); }
    .status-icon.err { background: var(--red); box-shadow: 0 0 12px rgba(223,138,130,.35); }
    @keyframes pulse { from { opacity: .45; } to { opacity: 1; } }
    .status-copy strong { display: block; font-size: 11px; }
    .status-copy span { color: var(--muted); font-size: 9px; }
    .status-meta { margin-left: auto; display: flex; gap: 6px; }

    .results { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(350px, .55fr); gap: 12px; }
    .panel { border: 1px solid var(--line); background: var(--panel); min-width: 0; }
    .panel-head { min-height: 45px; border-bottom: 1px solid var(--line); padding: 10px 13px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .panel-head strong { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
    .panel-head span { color: var(--dim); font-size: 8px; }
    .panel-body { padding: 12px; }

    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 10px; }
    .summary-cell { border: 1px solid var(--soft); background: #0d110f; padding: 10px; min-width: 0; }
    .summary-cell strong { display: block; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .summary-cell span { color: var(--dim); font-size: 7px; text-transform: uppercase; letter-spacing: .08em; }

    .table-wrap { overflow: auto; max-height: 500px; border: 1px solid var(--soft); }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { position: sticky; top: 0; z-index: 1; text-align: left; color: var(--dim); background: #0c100e; text-transform: uppercase; letter-spacing: .06em; font-size: 7px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #1c231f; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    tr:hover td { background: #121713; }
    td.number { font-variant-numeric: tabular-nums; color: #d7d3c6; }

    .captured-list { display: grid; gap: 7px; margin-bottom: 10px; }
    .captured { border: 1px solid var(--soft); background: #0b0e0d; padding: 9px; }
    .captured-top { display: flex; justify-content: space-between; gap: 8px; }
    .captured .url { margin-top: 5px; color: #aab2ac; font-size: 8px; word-break: break-all; }
    .http200 { color: var(--green); }
    .httpbad { color: var(--red); }
    pre { margin: 0; padding: 11px; max-height: 520px; overflow: auto; border: 1px solid var(--soft); background: #070a08; color: #bdc6bf; font-size: 9px; line-height: 1.5; }

    .empty { min-height: 260px; display: grid; place-items: center; color: var(--dim); text-align: center; font-size: 11px; line-height: 1.6; }
    .footer-note { margin-top: 12px; color: var(--dim); font-size: 9px; line-height: 1.5; }

    @media (max-width: 1000px) {
      .hero { grid-template-columns: 1fr; }
      .hero-side { border-left: 0; border-top: 1px solid var(--line); }
      .tabs { grid-template-columns: repeat(2, 1fr); }
      .results { grid-template-columns: 1fr; }
      .controls { grid-template-columns: 1fr 1fr; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      nav { display: none; }
    }
    @media (max-width: 600px) {
      main { padding: 18px 12px 50px; }
      .topbar { padding: 0 12px; }
      .tabs, .controls { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: 1fr 1fr; }
      .hero-copy { padding: 22px 18px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="brand">STATLOCKER<b>.</b>LAB</div>
      <div class="tag">Browser POC</div>
      <nav><span class="active">Models</span><span>Item Meta</span><span>Eternus</span><span>Vision</span></nav>
      <div class="live"><span class="dot"></span> live proxy online</div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">Deadlock derived analytics</div>
        <h1>Statlocker <span>Model Explorer</span></h1>
        <p>
          This POC opens the real Statlocker page in Chromium, lets their frontend make its normal requests,
          and captures only the model/derived responses we care about. Our backend does not supply an API key.
        </p>
      </div>
      <aside class="hero-side">
        <div class="hero-side-title">Verified in real Chromium</div>
        <div class="metric-grid">
          <div class="metric"><strong>200</strong><small>WPA via site</small></div>
          <div class="metric"><strong>200</strong><small>Eternus via site</small></div>
          <div class="metric"><strong>4</strong><small>model probes</small></div>
          <div class="metric"><strong>0</strong><small>keys supplied</small></div>
        </div>
        <div class="note">The useful check is the captured Statlocker response below, not our own proxy HTTP status.</div>
      </aside>
    </section>

    <section class="controls">
      <div>
        <label for="hero">Hero</label>
        <input id="hero" value="Abrams" placeholder="Abrams" />
      </div>
      <div>
        <label for="min">Min sample size</label>
        <input id="min" type="number" min="1" max="100000" value="500" />
      </div>
      <div>
        <label for="matchId">Match ID - Win Chance only</label>
        <input id="matchId" inputmode="numeric" placeholder="Enter a real match ID" />
      </div>
      <button id="run" class="run">Run selected model</button>
    </section>

    <section class="tabs" id="models">
      <article class="model-card selected" data-model="ITEM_META_WPA">
        <div class="model-kicker">Priority 01 / Item Meta</div>
        <h3>Item Meta / WPA</h3>
        <p>Context-aware item impact model. The site itself requests the filtered WPA result and we capture the JSON.</p>
        <div class="path mono">/api/info/wpa-filtered-items</div>
        <div class="card-bottom"><span class="pill good">browser 200</span><span class="pill blue">no key from us</span></div>
      </article>

      <article class="model-card" data-model="ETERNUS_BUILD_ANALYSIS">
        <div class="model-kicker">Priority 02 / High rank</div>
        <h3>Eternus Build Analysis</h3>
        <p>High-rank build trajectory, item relationships and the WPA request used by the Eternus page.</p>
        <div class="path mono">/api/info/player-build-analysis/:accountId/:heroId</div>
        <div class="card-bottom"><span class="pill good">browser 200</span><span class="pill blue">derived</span></div>
      </article>

      <article class="model-card" data-model="T4_BUILD_CHAINS">
        <div class="model-kicker">Priority 03 / Synergy</div>
        <h3>T4 Build Chains</h3>
        <p>Chain and synergy data behind the T4 analysis. Requested inside the Statlocker page context.</p>
        <div class="path mono">/api/info/t4-chains-data</div>
        <div class="card-bottom"><span class="pill good">public 200</span><span class="pill blue">model dataset</span></div>
      </article>

      <article class="model-card" data-model="WIN_CHANCE">
        <div class="model-kicker">Priority 04 / Vision</div>
        <h3>Win Chance</h3>
        <p>Loads the real Win Chance page, fills a match ID, presses Analyze and captures the model timeline.</p>
        <div class="path mono">/api/match/:matchId/win-rate</div>
        <div class="card-bottom"><span class="pill">needs match id</span><span class="pill blue">browser action</span></div>
      </article>
    </section>

    <section class="statusbar">
      <span id="statusIcon" class="status-icon"></span>
      <div class="status-copy">
        <strong id="statusTitle">Ready</strong>
        <span id="statusText">Select a model and run it. Item Meta / WPA is the main test.</span>
      </div>
      <div class="status-meta">
        <span id="statusModel" class="pill">ITEM_META_WPA</span>
        <span id="statusHttp" class="pill">-</span>
        <span id="statusTime" class="pill">-</span>
      </div>
    </section>

    <section class="results">
      <div class="panel">
        <div class="panel-head"><strong>Model output</strong><span id="outputHint">Waiting for a live response</span></div>
        <div id="output" class="panel-body empty">Run Item Meta / WPA to see the real data returned to Statlocker's frontend.</div>
      </div>
      <div class="panel">
        <div class="panel-head"><strong>Captured network</strong><span>Statlocker frontend calls only</span></div>
        <div class="panel-body">
          <div id="captured" class="captured-list"><div class="captured"><div class="mono">No requests captured yet.</div></div></div>
          <pre id="raw">{}</pre>
        </div>
      </div>
    </section>

    <div class="footer-note">
      POC behavior: Chromium opens statlocker.gg, no API key is accepted from this UI and no API key is stored by our service.
      Only the selected derived/model responses are returned to this page.
    </div>
  </main>

  <script>
    const apiBase = location.pathname.replace(/\/$/, '');
    let selectedModel = 'ITEM_META_WPA';

    const modelCards = Array.from(document.querySelectorAll('.model-card'));
    const runButton = document.getElementById('run');
    const statusIcon = document.getElementById('statusIcon');
    const statusTitle = document.getElementById('statusTitle');
    const statusText = document.getElementById('statusText');
    const statusModel = document.getElementById('statusModel');
    const statusHttp = document.getElementById('statusHttp');
    const statusTime = document.getElementById('statusTime');
    const output = document.getElementById('output');
    const outputHint = document.getElementById('outputHint');
    const captured = document.getElementById('captured');
    const raw = document.getElementById('raw');

    modelCards.forEach((card) => {
      card.addEventListener('click', () => {
        selectedModel = card.dataset.model;
        modelCards.forEach((entry) => entry.classList.toggle('selected', entry === card));
        statusModel.textContent = selectedModel;
        statusTitle.textContent = 'Ready';
        statusText.textContent = selectedModel === 'WIN_CHANCE'
          ? 'Enter a real match ID, then run the model.'
          : 'Press Run selected model to execute the Statlocker page flow.';
        statusIcon.className = 'status-icon';
      });
    });

    runButton.addEventListener('click', runSelectedModel);

    async function runSelectedModel() {
      const hero = document.getElementById('hero').value.trim();
      const minSampleSize = Number(document.getElementById('min').value || 500);
      const matchId = document.getElementById('matchId').value.trim();

      if (selectedModel === 'WIN_CHANCE' && !/^\d{6,30}$/.test(matchId)) {
        setError('Match ID required', 'Enter a real numeric Deadlock match ID for Win Chance.');
        return;
      }

      setLoading();
      const startedAt = performance.now();

      try {
        const response = await fetch(apiBase + '/browser-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            hero,
            minSampleSize,
            matchId: matchId || undefined
          })
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result?.message || result?.error || 'Browser model probe failed');
        }

        renderResult(result);
        statusIcon.className = 'status-icon ok';
        statusTitle.textContent = 'Live model response captured';
        statusText.textContent = 'Statlocker frontend flow completed in Chromium. No API key was supplied by our request.';
        statusHttp.textContent = 'HTTP ' + String(result.primary?.status ?? '-');
        statusTime.textContent = String(result.elapsedMs ?? Math.round(performance.now() - startedAt)) + ' ms';
      } catch (error) {
        setError('Probe failed', error instanceof Error ? error.message : String(error));
      } finally {
        runButton.disabled = false;
        runButton.textContent = 'Run selected model';
      }
    }

    function setLoading() {
      runButton.disabled = true;
      runButton.textContent = 'Opening Statlocker...';
      statusIcon.className = 'status-icon loading';
      statusTitle.textContent = 'Running real browser flow';
      statusText.textContent = 'Chromium is loading the Statlocker page and waiting for its model request.';
      statusHttp.textContent = '...';
      statusTime.textContent = '...';
      outputHint.textContent = 'Live request in progress';
    }

    function setError(title, message) {
      statusIcon.className = 'status-icon err';
      statusTitle.textContent = title;
      statusText.textContent = message;
      statusHttp.textContent = 'ERROR';
      statusTime.textContent = '-';
      outputHint.textContent = 'No usable model response';
    }

    function renderResult(result) {
      const primary = result.primary || {};
      const data = primary.data;
      output.className = 'panel-body';
      outputHint.textContent = primary.path || 'captured model response';
      raw.textContent = JSON.stringify(result, null, 2);
      renderCaptured(result.captured || []);

      if (result.model === 'ITEM_META_WPA') {
        renderWpa(data);
        return;
      }
      if (result.model === 'ETERNUS_BUILD_ANALYSIS') {
        renderEternus(data, result.captured || []);
        return;
      }
      if (result.model === 'T4_BUILD_CHAINS') {
        renderT4(data);
        return;
      }
      if (result.model === 'WIN_CHANCE') {
        renderWinChance(data);
        return;
      }

      output.innerHTML = '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
    }

    function renderCaptured(items) {
      if (!items.length) {
        captured.innerHTML = '<div class="captured"><div class="mono">No matching model requests captured.</div></div>';
        return;
      }
      captured.innerHTML = items.map((entry) => {
        const statusClass = entry.status >= 200 && entry.status < 300 ? 'http200' : 'httpbad';
        return '<div class="captured">' +
          '<div class="captured-top"><span class="mono">' + escapeHtml(entry.method + ' ' + entry.path) + '</span>' +
          '<strong class="' + statusClass + '">' + escapeHtml(String(entry.status)) + '</strong></div>' +
          '<div class="url mono">' + escapeHtml(entry.url) + '</div>' +
        '</div>';
      }).join('');
    }

    function renderWpa(data) {
      const items = Array.isArray(data?.items) ? data.items : [];
      const tiers = Array.isArray(data?.tiers) ? data.tiers : [];
      const heroes = Array.isArray(data?.availableHeroes) ? data.availableHeroes : [];
      const patches = Array.isArray(data?.availablePatches) ? data.availablePatches : [];
      output.innerHTML = summaryGrid([
        ['items', items.length],
        ['tiers', tiers.length],
        ['heroes', heroes.length],
        ['patches', patches.length]
      ]) + renderSmartTable(items);
    }

    function renderEternus(data, responses) {
      const buildResponse = [...responses].reverse().find((entry) => entry.path?.startsWith('/api/info/player-build-analysis/'));
      const build = buildResponse?.data || data || {};
      const items = Array.isArray(build?.items) ? build.items : [];
      const relationships = Array.isArray(build?.itemRelationships) ? build.itemRelationships : [];
      output.innerHTML = summaryGrid([
        ['matches', build?.totalMatches ?? '-'],
        ['win rate', formatValue(build?.winRate)],
        ['items', items.length],
        ['relationships', relationships.length]
      ]) + renderSmartTable(items.length ? items : relationships);
    }

    function renderT4(data) {
      const byHero = data?.by_hero && typeof data.by_hero === 'object' ? data.by_hero : {};
      const heroNames = Object.keys(byHero);
      const selectedHero = document.getElementById('hero').value.trim();
      const heroData = byHero[selectedHero] ?? byHero[selectedHero.toLowerCase()] ?? byHero[heroNames[0]];
      const rows = Array.isArray(heroData)
        ? heroData
        : heroData && typeof heroData === 'object'
          ? objectToRows(heroData)
          : [];
      output.innerHTML = summaryGrid([
        ['heroes', heroNames.length],
        ['selected', selectedHero || '-'],
        ['rows', rows.length],
        ['metadata', data?.metadata ? 'yes' : 'no']
      ]) + renderSmartTable(rows);
    }

    function renderWinChance(data) {
      const intervals = Array.isArray(data?.winRateIntervals)
        ? data.winRateIntervals
        : Array.isArray(data)
          ? data
          : [];
      output.innerHTML = summaryGrid([
        ['intervals', intervals.length],
        ['match', document.getElementById('matchId').value.trim() || '-'],
        ['payload', Array.isArray(data) ? 'array' : typeof data],
        ['status', intervals.length ? 'timeline loaded' : 'inspect raw']
      ]) + renderSmartTable(intervals);
    }

    function objectToRows(value) {
      return Object.entries(value).map(([key, entry]) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          return { key, ...entry };
        }
        return { key, value: entry };
      });
    }

    function summaryGrid(entries) {
      return '<div class="summary-grid">' + entries.map(([label, value]) =>
        '<div class="summary-cell"><strong>' + escapeHtml(formatValue(value)) + '</strong><span>' + escapeHtml(label) + '</span></div>'
      ).join('') + '</div>';
    }

    function renderSmartTable(rows) {
      if (!Array.isArray(rows) || !rows.length) {
        return '<div class="empty">The endpoint returned successfully, but no array-like rows were detected.<br>Inspect the raw JSON on the right.</div>';
      }

      const objects = rows.slice(0, 40).map((entry, index) =>
        entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { index, value: entry }
      );
      const preferred = [
        'name', 'itemName', 'item_name', 'itemId', 'item_id', 'id', 'key',
        'wpa', 'avgWpa', 'averageWpa', 'winRate', 'pickRate', 'purchaseRate',
        'sampleSize', 'sample_size', 'games', 'matches', 'count', 'avgPurchaseTime',
        'averagePurchaseTime', 'purchaseTime', 'tier', 'cost'
      ];
      const allKeys = [];
      objects.slice(0, 12).forEach((row) => Object.keys(row).forEach((key) => {
        const value = row[key];
        const scalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);
        if (scalar && !allKeys.includes(key)) allKeys.push(key);
      }));
      const columns = [
        ...preferred.filter((key) => allKeys.includes(key)),
        ...allKeys.filter((key) => !preferred.includes(key))
      ].slice(0, 8);

      if (!columns.length) {
        return '<pre>' + escapeHtml(JSON.stringify(rows.slice(0, 20), null, 2)) + '</pre>';
      }

      const head = '<thead><tr>' + columns.map((key) => '<th>' + escapeHtml(key) + '</th>').join('') + '</tr></thead>';
      const body = '<tbody>' + objects.map((row) => '<tr>' + columns.map((key) => {
        const value = row[key];
        const cls = typeof value === 'number' ? ' class="number"' : '';
        return '<td' + cls + ' title="' + escapeAttr(formatValue(value)) + '">' + escapeHtml(formatValue(value)) + '</td>';
      }).join('') + '</tr>').join('') + '</tbody>';
      return '<div class="table-wrap"><table>' + head + body + '</table></div>';
    }

    function formatValue(value) {
      if (value === null || value === undefined) return '-';
      if (typeof value === 'number') {
        if (Number.isInteger(value)) return String(value);
        return String(Math.round(value * 10000) / 10000);
      }
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function escapeAttr(value) {
      return escapeHtml(value).replaceAll('`', '&#096;');
    }
  </script>
</body>
</html>`;
