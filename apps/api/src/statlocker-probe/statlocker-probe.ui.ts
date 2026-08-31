export const STATLOCKER_PROBE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statlocker Vision Model Probe</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a0a;
      --bg-2: #0c0f0e;
      --panel: #111513;
      --panel-2: #151b18;
      --line: #29312d;
      --line-soft: #1c2420;
      --text: #eee9da;
      --muted: #8f9992;
      --muted-2: #626b66;
      --accent: #d6a85c;
      --accent-2: #f0c875;
      --green: #70c991;
      --green-bg: #11251a;
      --red: #df8d84;
      --red-bg: #271513;
      --blue: #83a9c9;
      --blue-bg: #121d27;
      --cream: #d8d2bd;
      --shadow: 0 20px 60px rgba(0, 0, 0, .34);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 12% -10%, rgba(116, 143, 105, .13), transparent 34%),
        radial-gradient(circle at 92% 8%, rgba(181, 126, 60, .09), transparent 29%),
        var(--bg);
      color: var(--text);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .18;
      background-image: linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.014) 1px, transparent 1px);
      background-size: 38px 38px;
      mask-image: linear-gradient(to bottom, black, transparent 72%);
    }

    a { color: inherit; }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      border-bottom: 1px solid rgba(92, 104, 97, .28);
      background: rgba(8, 10, 10, .9);
      backdrop-filter: blur(18px);
    }

    .topbar-inner {
      max-width: 1440px;
      height: 66px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      gap: 26px;
    }

    .brand {
      display: flex;
      align-items: baseline;
      gap: 8px;
      white-space: nowrap;
      font-weight: 900;
      letter-spacing: -.04em;
      font-size: 20px;
    }

    .brand-dot { color: var(--accent); }
    .version { color: var(--muted-2); font-size: 10px; font-weight: 700; letter-spacing: .1em; }
    .lab-badge {
      border: 1px solid #4d4330;
      color: var(--accent-2);
      background: #1c1710;
      border-radius: 3px;
      padding: 4px 7px;
      font-size: 9px;
      letter-spacing: .13em;
      font-weight: 800;
    }

    nav {
      display: flex;
      align-items: center;
      gap: 22px;
      margin-left: 10px;
      color: #8f9690;
      font-size: 11px;
      letter-spacing: .09em;
      font-weight: 800;
    }

    nav a { text-decoration: none; }
    nav a:hover, nav a.active { color: var(--text); }
    nav a.active { position: relative; }
    nav a.active::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: -22px;
      height: 2px;
      background: var(--accent);
    }

    .top-status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
    }

    .pulse {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(112, 201, 145, .09), 0 0 18px rgba(112, 201, 145, .45);
    }

    main { max-width: 1440px; margin: 0 auto; padding: 34px 24px 80px; }

    .eyebrow {
      color: var(--accent);
      font-size: 10px;
      letter-spacing: .18em;
      text-transform: uppercase;
      font-weight: 900;
      margin-bottom: 10px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(310px, .7fr);
      gap: 22px;
      align-items: stretch;
    }

    .hero-copy {
      min-height: 250px;
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(19,24,21,.96), rgba(10,13,12,.96));
      box-shadow: var(--shadow);
      padding: 30px;
      position: relative;
      overflow: hidden;
    }

    .hero-copy::after {
      content: "WPA";
      position: absolute;
      right: -14px;
      bottom: -36px;
      color: rgba(214, 168, 92, .035);
      font-size: 150px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: -.08em;
    }

    h1 { margin: 0; font-size: clamp(34px, 5vw, 65px); letter-spacing: -.055em; line-height: .96; max-width: 850px; }
    h1 span { color: var(--accent-2); }
    .hero-copy p { max-width: 800px; color: #9ba49e; line-height: 1.65; font-size: 14px; margin: 18px 0 0; }

    .hero-side {
      border: 1px solid var(--line);
      background: #0d110f;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .mini-title { color: var(--muted); font-size: 10px; letter-spacing: .14em; font-weight: 900; text-transform: uppercase; }
    .model-score { margin-top: 14px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .score-cell { border: 1px solid var(--line-soft); background: #101411; padding: 12px; }
    .score-cell strong { display: block; font-size: 26px; letter-spacing: -.04em; }
    .score-cell span { display: block; margin-top: 4px; color: var(--muted-2); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }

    .warning {
      margin-top: 16px;
      border-left: 2px solid var(--accent);
      background: #17140f;
      padding: 11px 12px;
      color: #bcb39d;
      font-size: 11px;
      line-height: 1.5;
    }

    .filter-shell {
      margin-top: 16px;
      border: 1px solid var(--line);
      background: var(--panel);
      padding: 12px;
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr 1fr auto;
      gap: 8px;
      align-items: end;
    }

    .filter label, .form-field label {
      display: block;
      margin: 0 0 6px;
      color: var(--muted-2);
      font-size: 9px;
      letter-spacing: .11em;
      text-transform: uppercase;
      font-weight: 900;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid #303a35;
      background: #0a0d0c;
      color: var(--text);
      padding: 10px 11px;
      outline: none;
      border-radius: 2px;
    }
    input:focus, select:focus, textarea:focus { border-color: #78633f; box-shadow: 0 0 0 2px rgba(214,168,92,.06); }

    .primary, .secondary, .ghost, .endpoint-action {
      border: 1px solid transparent;
      padding: 10px 14px;
      border-radius: 2px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .primary { background: var(--accent); color: #17120b; border-color: var(--accent); }
    .primary:hover { background: var(--accent-2); border-color: var(--accent-2); }
    .secondary { background: #16201a; color: #dfe9e2; border-color: #395044; }
    .secondary:hover { background: #1d2c23; }
    .ghost { background: transparent; color: var(--muted); border-color: #303934; }
    .ghost:hover { color: var(--text); border-color: #515d56; }

    .tabs {
      margin: 26px 0 0;
      display: flex;
      gap: 0;
      overflow-x: auto;
      border-bottom: 1px solid var(--line);
    }
    .tabs span {
      padding: 11px 15px;
      color: #747e78;
      white-space: nowrap;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .08em;
      font-weight: 800;
      border-bottom: 2px solid transparent;
    }
    .tabs span.active { color: var(--text); border-bottom-color: var(--accent); background: rgba(214,168,92,.035); }

    .section-head {
      margin: 32px 0 13px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
    }
    .section-head h2 { margin: 0; font-size: 20px; letter-spacing: -.025em; }
    .section-head p { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
    .section-actions { display: flex; gap: 8px; align-items: center; }

    .endpoint-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .endpoint-card {
      min-height: 220px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #111613, #0d100f);
      padding: 16px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      transition: transform .14s ease, border-color .14s ease, background .14s ease;
    }
    .endpoint-card:hover { transform: translateY(-2px); border-color: #48564f; background: linear-gradient(180deg, #151b17, #0e1110); }
    .endpoint-card.public { border-color: #31513f; }
    .endpoint-card.public::before, .endpoint-card.auth::before, .endpoint-card.input::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 2px;
      background: var(--green);
    }
    .endpoint-card.auth::before { background: var(--red); }
    .endpoint-card.input::before { background: var(--blue); }

    .card-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .card-index { color: #4b554f; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .endpoint-card h3 { margin: 11px 0 5px; font-size: 17px; letter-spacing: -.025em; }
    .endpoint-card p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
    .endpoint-path {
      margin-top: 14px;
      padding: 9px 10px;
      border: 1px solid var(--line-soft);
      background: #080b09;
      color: #c7cdbf;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
    }

    .chips { display: flex; gap: 5px; flex-wrap: wrap; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid #303934;
      background: #111512;
      color: #929b95;
      padding: 4px 7px;
      border-radius: 999px;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: .08em;
      font-weight: 900;
    }
    .chip.green { border-color: #345440; background: var(--green-bg); color: var(--green); }
    .chip.red { border-color: #57342f; background: var(--red-bg); color: var(--red); }
    .chip.blue { border-color: #31465a; background: var(--blue-bg); color: var(--blue); }
    .chip.gold { border-color: #5c4b31; background: #201910; color: var(--accent-2); }

    .card-actions { margin-top: auto; padding-top: 15px; display: flex; gap: 7px; }
    .endpoint-action { flex: 1; background: #181f1b; color: #dfe3db; border-color: #344039; }
    .endpoint-action:hover { background: #222c26; }
    .endpoint-action.test { background: #241c11; color: var(--accent-2); border-color: #5c492d; }

    .lab-layout { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(330px, .65fr); gap: 12px; }
    .panel { border: 1px solid var(--line); background: var(--panel); }
    .panel-head { padding: 13px 15px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .panel-head strong { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
    .panel-body { padding: 14px; }

    .console {
      min-height: 270px;
      max-height: 560px;
      overflow: auto;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: #070908;
      color: #bdc8c0;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      line-height: 1.55;
    }

    .response-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 10px; }
    .response-meta div { border: 1px solid var(--line-soft); background: #0d110f; padding: 9px; }
    .response-meta span { display: block; color: var(--muted-2); font-size: 8px; letter-spacing: .1em; text-transform: uppercase; }
    .response-meta strong { display: block; margin-top: 4px; font-size: 15px; }

    .request-grid { display: grid; grid-template-columns: 94px 1fr; gap: 8px; }
    .form-field { margin-top: 9px; }
    textarea { min-height: 112px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.45; }
    .request-buttons { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    #request-status { color: var(--muted); font-size: 10px; }

    .discovery-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
    .summary-box { border: 1px solid var(--line-soft); background: #0e120f; padding: 11px; }
    .summary-box strong { display: block; font-size: 21px; }
    .summary-box span { display: block; margin-top: 3px; color: var(--muted-2); font-size: 8px; letter-spacing: .08em; text-transform: uppercase; }

    .endpoint-table-wrap { overflow-x: auto; border: 1px solid var(--line); }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { color: #707a74; text-transform: uppercase; letter-spacing: .09em; font-size: 8px; background: #0c0f0e; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft); text-align: left; vertical-align: middle; }
    tbody tr:hover { background: rgba(255,255,255,.018); }
    .table-path {
      border: 0;
      background: transparent;
      color: #d4d6cd;
      padding: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 9px;
      text-align: left;
    }
    .table-path:hover { color: var(--accent-2); }

    .research-note { margin-top: 20px; border: 1px solid var(--line); background: #0d100f; padding: 14px; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .research-note strong { color: var(--cream); }

    .hidden { display: none !important; }

    @media (max-width: 1100px) {
      .endpoint-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .lab-layout { grid-template-columns: 1fr; }
      nav { display: none; }
    }

    @media (max-width: 760px) {
      .topbar-inner { padding: 0 14px; }
      .lab-badge, .top-status { display: none; }
      main { padding: 22px 14px 60px; }
      .hero { grid-template-columns: 1fr; }
      .hero-copy { padding: 22px; min-height: 230px; }
      .filter-shell { grid-template-columns: 1fr 1fr; }
      .filter-shell .primary { grid-column: 1 / -1; }
      .endpoint-grid { grid-template-columns: 1fr; }
      .section-head { align-items: flex-start; flex-direction: column; }
      .discovery-summary { grid-template-columns: repeat(2, 1fr); }
      .response-meta { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">STATLOCKER<span class="brand-dot">.GG</span><span class="version">2.3.6</span></div>
      <span class="lab-badge">UNOFFICIAL PROBE</span>
      <nav>
        <a href="#models" class="active">VISION</a>
        <a href="#models">MODEL ENDPOINTS</a>
        <a href="#discovery">WPA</a>
        <a href="#request-lab">WIN CHANCE</a>
        <a href="#request-lab">BUILD LAB</a>
      </nav>
      <div class="top-status"><span class="pulse"></span><span>PROBE ONLINE</span></div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">VISION · MODEL ENDPOINT RESEARCH</div>
        <h1>ITEM META MODEL<br><span>ENDPOINT PROBE</span></h1>
        <p>This is an isolated research UI against Statlocker's own public frontend/API surface. The priority is not generic Deadlock data - it is the ML-derived WPA, chain, matchup, build-context and Win Chance endpoints their frontend actually calls.</p>
      </div>
      <aside class="hero-side">
        <div>
          <div class="mini-title">Current endpoint evidence</div>
          <div class="model-score">
            <div class="score-cell"><strong id="metric-confirmed">8</strong><span>frontend confirmed</span></div>
            <div class="score-cell"><strong id="metric-public">1</strong><span>anonymous 200</span></div>
            <div class="score-cell"><strong id="metric-auth">3</strong><span>anonymous 401</span></div>
            <div class="score-cell"><strong id="metric-models">6</strong><span>model families</span></div>
          </div>
        </div>
        <div class="warning">The strongest anonymous hit right now is <strong>T4 Build Chains</strong>: the exact frontend endpoint returns HTTP 200 without a Statlocker session. The primary WPA model endpoint is confirmed too, but anonymous requests return 401.</div>
      </aside>
    </section>

    <section class="filter-shell" aria-label="Probe filters">
      <div class="filter">
        <label for="filter-hero">Hero</label>
        <select id="filter-hero"><option>Abrams</option><option>All Heroes</option></select>
      </div>
      <div class="filter">
        <label for="filter-queue">Queue</label>
        <select id="filter-queue"><option value="ranked">Ranked</option><option value="all">All Queues</option></select>
      </div>
      <div class="filter">
        <label for="filter-patch">Patch</label>
        <select id="filter-patch"><option value="all">Latest / All</option></select>
      </div>
      <div class="filter">
        <label for="filter-min">Min Matches</label>
        <input id="filter-min" type="number" min="1" value="500" />
      </div>
      <button class="primary" id="test-public">TEST PUBLIC MODEL</button>
    </section>

    <div class="tabs" aria-label="Statlocker inspired navigation">
      <span>Items Hub</span>
      <span class="active">Item Meta Model</span>
      <span>Purchase Time</span>
      <span>Comeback / Win-More</span>
      <span>T4 Build Chains</span>
      <span>Items to Heroes</span>
      <span>Patch Changes</span>
    </div>

    <section id="models">
      <div class="section-head">
        <div>
          <div class="eyebrow">FRONTEND-CALL EVIDENCE</div>
          <h2>MODEL ENDPOINTS</h2>
          <p>Exact routes recovered from Statlocker's current lazy-loaded frontend chunks. Click TEST to make the request from our probe backend.</p>
        </div>
        <div class="section-actions">
          <button class="secondary" id="reload-targets">REFRESH CARDS</button>
          <button class="ghost" id="jump-discovery">SCAN FRONTEND</button>
        </div>
      </div>
      <div id="targets" class="endpoint-grid"></div>
    </section>

    <section id="request-lab">
      <div class="section-head">
        <div>
          <div class="eyebrow">LIVE REQUEST</div>
          <h2>MODEL REQUEST LAB</h2>
          <p>Runs through the isolated NestJS probe. No Statlocker cookies or API key are injected.</p>
        </div>
      </div>

      <div class="lab-layout">
        <div class="panel">
          <div class="panel-head">
            <strong>Response inspector</strong>
            <div class="chips"><span id="response-chip" class="chip">NO REQUEST</span></div>
          </div>
          <div class="panel-body">
            <div class="response-meta">
              <div><span>HTTP</span><strong id="meta-http">-</strong></div>
              <div><span>Latency</span><strong id="meta-latency">-</strong></div>
              <div><span>Model</span><strong id="meta-model">-</strong></div>
            </div>
            <pre id="response" class="console">Select a model endpoint above or press TEST PUBLIC MODEL.</pre>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><strong>Request builder</strong><span id="request-status">READY</span></div>
          <div class="panel-body">
            <div class="request-grid">
              <select id="method"><option>GET</option><option>POST</option></select>
              <input id="path" placeholder="/api/..." />
            </div>
            <div class="form-field">
              <label for="query">Query JSON</label>
              <textarea id="query">{}</textarea>
            </div>
            <div class="form-field">
              <label for="body">Body JSON</label>
              <textarea id="body">{}</textarea>
            </div>
            <div class="request-buttons">
              <button class="primary" id="run">RUN REQUEST</button>
              <button class="ghost" id="clear">CLEAR</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="discovery">
      <div class="section-head">
        <div>
          <div class="eyebrow">PUBLIC FRONTEND ASSETS</div>
          <h2>ENDPOINT DISCOVERY</h2>
          <p>Known model endpoints are seeded first, then the public page bundles are scanned for additional literal /api paths.</p>
        </div>
        <div class="section-actions">
          <span id="discover-status" class="chip">NOT SCANNED</span>
          <button class="secondary" id="discover">SCAN FRONTEND</button>
        </div>
      </div>
      <div id="discovered">
        <div class="research-note"><strong>Why this exists:</strong> the original simple scanner only saw generic routes in the main bundle. Statlocker lazy-loads the model pages. We traced the Webpack chunk map and recovered the model calls from the actual WPA / Win Chance / Vision chunks, so those routes are now first-class here.</div>
      </div>
    </section>

    <div class="research-note">
      <strong>Scope:</strong> this probe deliberately does not treat generic match history/profile/catalog endpoints as integration value. The interesting surface is Statlocker-derived ML/analytics data. HTTP 401 is displayed as evidence of a real frontend route requiring official/session access - it is not bypassed.
    </div>
  </main>

  <script>
    const apiBase = '/deadlock/tools/statlocker';
    let targetsCache = [];
    let activeModel = '';

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    function accessLabel(access) {
      if (access === 'PUBLIC_200') return 'PUBLIC 200';
      if (access === 'AUTH_401') return 'AUTH 401';
      if (access === 'NEEDS_INPUT') return 'NEEDS INPUT';
      return 'UNTESTED';
    }

    function accessClass(access) {
      if (access === 'PUBLIC_200') return 'green';
      if (access === 'AUTH_401') return 'red';
      if (access === 'NEEDS_INPUT') return 'blue';
      return '';
    }

    function cardClass(access) {
      if (access === 'PUBLIC_200') return 'public';
      if (access === 'AUTH_401') return 'auth';
      if (access === 'NEEDS_INPUT') return 'input';
      return '';
    }

    function buildWpaQuery() {
      return {
        hero: document.getElementById('filter-hero').value,
        tier: 'all',
        queue: document.getElementById('filter-queue').value,
        rank: 'all',
        category: 'all',
        gameState: 'all',
        purchaseTime: 'all',
        teamComp: 'all',
        buildType: 'all',
        patch: document.getElementById('filter-patch').value,
        minSampleSize: Number(document.getElementById('filter-min').value) || 500,
        searchTerm: '',
        sortBy: 'wpa',
        timeSyncEnabled: false,
        currentGameTime: 0,
        timeWindow: 5
      };
    }

    function endpointQuery(target) {
      if (target.id === 'item-meta-wpa') return buildWpaQuery();
      return target.suggestedQuery || {};
    }

    function fillRequest(target) {
      if (!target || !target.endpoint) return;
      activeModel = target.title || target.id || '';
      document.getElementById('method').value = target.method || 'GET';
      document.getElementById('path').value = target.endpoint;
      document.getElementById('query').value = pretty(endpointQuery(target));
      document.getElementById('body').value = '{}';
      document.getElementById('meta-model').textContent = activeModel || '-';
    }

    async function loadTargets() {
      const container = document.getElementById('targets');
      container.innerHTML = '<div class="endpoint-card"><div class="mini-title">Loading confirmed routes...</div></div>';
      const response = await fetch(apiBase + '/presets');
      const targets = await response.json();
      targetsCache = Array.isArray(targets) ? targets : [];

      const confirmed = targetsCache.filter(function(target) { return !!target.endpoint; }).length;
      const publicCount = targetsCache.filter(function(target) { return target.access === 'PUBLIC_200'; }).length;
      const authCount = targetsCache.filter(function(target) { return target.access === 'AUTH_401'; }).length;
      document.getElementById('metric-confirmed').textContent = String(confirmed);
      document.getElementById('metric-public').textContent = String(publicCount);
      document.getElementById('metric-auth').textContent = String(authCount);
      document.getElementById('metric-models').textContent = String(targetsCache.length);

      container.innerHTML = targetsCache.map(function(target, index) {
        const endpoint = target.endpoint || 'Discovery target - endpoint still being isolated';
        const access = target.access || 'UNKNOWN';
        const endpointButtons = target.endpoint
          ? '<div class="card-actions"><button class="endpoint-action use-target" data-index="' + index + '">USE</button><button class="endpoint-action test test-target" data-index="' + index + '">TEST</button></div>'
          : '<div class="card-actions"><button class="endpoint-action scan-target">SCAN FOR ROUTE</button></div>';
        const signals = (target.expectedSignals || []).slice(0, 3).map(function(signal) {
          return '<span class="chip">' + escapeHtml(signal) + '</span>';
        }).join('');
        return '<article class="endpoint-card ' + cardClass(access) + '">' +
          '<div class="card-top"><span class="card-index">MODEL ' + String(index + 1).padStart(2, '0') + '</span><div class="chips"><span class="chip gold">FRONTEND TARGET</span><span class="chip ' + accessClass(access) + '">' + accessLabel(access) + '</span></div></div>' +
          '<h3>' + escapeHtml(target.title) + '</h3>' +
          '<p>' + escapeHtml(target.usefulFor) + '</p>' +
          '<div class="endpoint-path" title="' + escapeHtml(endpoint) + '">' + escapeHtml(endpoint) + '</div>' +
          '<div class="chips" style="margin-top:10px">' + signals + '</div>' +
          endpointButtons +
        '</article>';
      }).join('');

      Array.from(container.querySelectorAll('.use-target')).forEach(function(button) {
        button.addEventListener('click', function() {
          const target = targetsCache[Number(button.getAttribute('data-index'))];
          fillRequest(target);
          document.getElementById('request-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      Array.from(container.querySelectorAll('.test-target')).forEach(function(button) {
        button.addEventListener('click', function() {
          const target = targetsCache[Number(button.getAttribute('data-index'))];
          testTarget(target);
        });
      });

      Array.from(container.querySelectorAll('.scan-target')).forEach(function(button) {
        button.addEventListener('click', function() {
          discover();
          document.getElementById('discovery').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }

    async function testTarget(target) {
      if (!target || !target.endpoint) return;
      fillRequest(target);
      if (target.endpoint.indexOf('{') >= 0) {
        document.getElementById('request-status').textContent = 'REPLACE PATH PARAMETERS';
        document.getElementById('response-chip').className = 'chip blue';
        document.getElementById('response-chip').textContent = 'NEEDS INPUT';
        document.getElementById('response').textContent = 'This is a frontend-confirmed model route, but it requires real path values. Replace the {…} placeholders in the Request Builder, then run it.';
        document.getElementById('request-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      await runRequest();
      document.getElementById('request-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function runRequest() {
      const status = document.getElementById('request-status');
      const output = document.getElementById('response');
      const chip = document.getElementById('response-chip');
      status.textContent = 'REQUESTING';
      chip.className = 'chip blue';
      chip.textContent = 'RUNNING';

      try {
        const payload = {
          method: document.getElementById('method').value,
          path: document.getElementById('path').value,
          query: JSON.parse(document.getElementById('query').value || '{}'),
          body: JSON.parse(document.getElementById('body').value || '{}')
        };

        const response = await fetch(apiBase + '/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        output.textContent = pretty(result);

        const remoteStatus = result && result.status ? Number(result.status) : Number(response.status);
        document.getElementById('meta-http').textContent = String(remoteStatus);
        document.getElementById('meta-latency').textContent = result && result.elapsedMs !== undefined ? String(result.elapsedMs) + ' ms' : '-';
        document.getElementById('meta-model').textContent = activeModel || inferModel(payload.path);

        if (remoteStatus >= 200 && remoteStatus < 300) {
          chip.className = 'chip green';
          chip.textContent = 'LIVE ' + remoteStatus;
          status.textContent = 'SUCCESS';
        } else if (remoteStatus === 401 || remoteStatus === 403) {
          chip.className = 'chip red';
          chip.textContent = 'AUTH ' + remoteStatus;
          status.textContent = 'ROUTE CONFIRMED / AUTH REQUIRED';
        } else {
          chip.className = 'chip';
          chip.textContent = 'HTTP ' + remoteStatus;
          status.textContent = 'COMPLETED';
        }
      } catch (error) {
        output.textContent = String(error);
        chip.className = 'chip red';
        chip.textContent = 'FAILED';
        status.textContent = 'FAILED';
      }
    }

    function inferModel(path) {
      const value = String(path || '').toLowerCase();
      if (value.indexOf('t4-chains') >= 0) return 'T4 Build Chains';
      if (value.indexOf('wpa-filtered') >= 0) return 'Item Meta / WPA';
      if (value.indexOf('vs-hero-wpa') >= 0) return 'Vs Hero WPA';
      if (value.indexOf('win-rate') >= 0) return 'Win Chance';
      if (value.indexOf('/wpa/') >= 0) return 'Player WPA';
      if (value.indexOf('build-context') >= 0) return 'Build Context';
      return 'Custom API route';
    }

    async function discover() {
      const status = document.getElementById('discover-status');
      const container = document.getElementById('discovered');
      status.className = 'chip blue';
      status.textContent = 'SCANNING';
      container.innerHTML = '<div class="research-note">Loading public pages and frontend assets...</div>';

      try {
        const response = await fetch(apiBase + '/discover');
        const result = await response.json();
        const endpoints = Array.isArray(result.endpoints) ? result.endpoints : [];
        const confirmed = endpoints.filter(function(endpoint) { return endpoint.confidence === 'FRONTEND_CONFIRMED'; }).length;
        const useful = endpoints.filter(function(endpoint) { return endpoint.likelyUseful && !endpoint.rawDeadlockDuplicate; }).length;
        const publicCount = endpoints.filter(function(endpoint) { return endpoint.access === 'PUBLIC_200'; }).length;
        const errors = Array.isArray(result.errors) ? result.errors : [];

        const rows = endpoints.map(function(endpoint) {
          const access = endpoint.access || 'UNKNOWN';
          const family = endpoint.modelFamily || (endpoint.likelyUseful ? 'CANDIDATE' : '-');
          return '<tr>' +
            '<td><button class="table-path" data-path="' + escapeHtml(endpoint.path) + '" data-model="' + escapeHtml(family) + '">' + escapeHtml(endpoint.path) + '</button></td>' +
            '<td><span class="chip ' + (endpoint.confidence === 'FRONTEND_CONFIRMED' ? 'gold' : '') + '">' + escapeHtml(endpoint.confidence || 'DISCOVERED') + '</span></td>' +
            '<td><span class="chip ' + accessClass(access) + '">' + accessLabel(access) + '</span></td>' +
            '<td>' + escapeHtml(family) + '</td>' +
            '<td>' + escapeHtml((endpoint.matchedKeywords || []).join(', ')) + '</td>' +
          '</tr>';
        }).join('');

        container.innerHTML =
          '<div class="discovery-summary">' +
            '<div class="summary-box"><strong>' + confirmed + '</strong><span>frontend confirmed</span></div>' +
            '<div class="summary-box"><strong>' + useful + '</strong><span>useful/model candidates</span></div>' +
            '<div class="summary-box"><strong>' + publicCount + '</strong><span>anonymous 200</span></div>' +
            '<div class="summary-box"><strong>' + errors.length + '</strong><span>scan errors</span></div>' +
          '</div>' +
          '<div class="endpoint-table-wrap"><table><thead><tr><th>Endpoint</th><th>Evidence</th><th>Access</th><th>Model family</th><th>Signals</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          (errors.length ? '<details><summary style="margin-top:10px;color:#8f9992">Discovery errors</summary><pre class="console">' + escapeHtml(pretty(errors)) + '</pre></details>' : '');

        Array.from(container.querySelectorAll('[data-path]')).forEach(function(button) {
          button.addEventListener('click', function() {
            activeModel = button.getAttribute('data-model') || '';
            document.getElementById('method').value = 'GET';
            document.getElementById('path').value = button.getAttribute('data-path') || '';
            document.getElementById('query').value = '{}';
            document.getElementById('meta-model').textContent = activeModel || '-';
            document.getElementById('request-lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });

        status.className = 'chip green';
        status.textContent = 'SCAN COMPLETE';
      } catch (error) {
        status.className = 'chip red';
        status.textContent = 'SCAN FAILED';
        container.innerHTML = '<pre class="console">' + escapeHtml(String(error)) + '</pre>';
      }
    }

    function clearRequest() {
      activeModel = '';
      document.getElementById('method').value = 'GET';
      document.getElementById('path').value = '';
      document.getElementById('query').value = '{}';
      document.getElementById('body').value = '{}';
      document.getElementById('response').textContent = 'Request cleared.';
      document.getElementById('response-chip').className = 'chip';
      document.getElementById('response-chip').textContent = 'NO REQUEST';
      document.getElementById('meta-http').textContent = '-';
      document.getElementById('meta-latency').textContent = '-';
      document.getElementById('meta-model').textContent = '-';
      document.getElementById('request-status').textContent = 'READY';
    }

    document.getElementById('run').addEventListener('click', runRequest);
    document.getElementById('clear').addEventListener('click', clearRequest);
    document.getElementById('discover').addEventListener('click', discover);
    document.getElementById('jump-discovery').addEventListener('click', function() {
      discover();
      document.getElementById('discovery').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('reload-targets').addEventListener('click', loadTargets);
    document.getElementById('test-public').addEventListener('click', function() {
      const target = targetsCache.find(function(entry) { return entry.id === 't4-build-chains'; });
      if (target) testTarget(target);
    });

    loadTargets().catch(function(error) {
      document.getElementById('targets').innerHTML = '<pre class="console">' + escapeHtml(String(error)) + '</pre>';
    });
  </script>
</body>
</html>`;
