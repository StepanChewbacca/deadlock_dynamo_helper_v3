export const STATLOCKER_SITE_LIKE_PROBE_HTML = `<!doctype html>
<html lang="en" data-api-base="/deadlock/tools/statlocker" data-browser-request="/deadlock/tools/statlocker/browser-request">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statlocker Model Probe</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080a09;
      --panel: #101412;
      --panel-2: #151a17;
      --line: #29322d;
      --soft: #1b221f;
      --text: #ebe8dc;
      --muted: #929a94;
      --dim: #646d67;
      --gold: #d4a85e;
      --gold-2: #efc676;
      --green: #72c992;
      --red: #df8a82;
      --blue: #86abc9;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 18% -8%, rgba(100, 133, 103, .13), transparent 31%),
        radial-gradient(circle at 90% 1%, rgba(182, 132, 66, .10), transparent 25%),
        var(--bg);
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .mono, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(8, 10, 9, .94);
      border-bottom: 1px solid rgba(76, 88, 81, .35);
      backdrop-filter: blur(16px);
    }
    .top {
      max-width: 1380px;
      height: 62px;
      margin: auto;
      padding: 0 22px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand { font-size: 19px; font-weight: 950; letter-spacing: -.04em; }
    .brand b { color: var(--gold-2); }
    .tag, .pill {
      border: 1px solid #3a453f;
      border-radius: 999px;
      padding: 4px 7px;
      color: var(--muted);
      font-size: 8px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .tag { border-color: #5a4930; color: var(--gold-2); border-radius: 3px; }
    .pill.good { color: var(--green); border-color: #34533f; background: #102118; }
    .pill.blue { color: var(--blue); border-color: #31475a; background: #111c26; }
    .live { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }

    main { max-width: 1380px; margin: auto; padding: 28px 22px 70px; }
    .hero {
      border: 1px solid var(--line);
      background: linear-gradient(135deg, rgba(18, 24, 20, .98), rgba(9, 12, 10, .98));
      padding: 26px;
    }
    .eyebrow { color: var(--gold); font-size: 9px; font-weight: 900; letter-spacing: .15em; text-transform: uppercase; }
    h1 { margin: 8px 0 0; font-size: clamp(34px, 4.5vw, 58px); line-height: .98; letter-spacing: -.05em; }
    h1 span { color: var(--gold-2); }
    .hero p { max-width: 850px; margin: 14px 0 0; color: #9ca49f; line-height: 1.6; font-size: 12px; }

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
    label { display: block; margin-bottom: 6px; color: var(--dim); font-size: 8px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
    input { width: 100%; background: #090c0b; color: var(--text); border: 1px solid #303a35; padding: 10px 11px; outline: none; }
    input:focus { border-color: #725e3e; }
    .run {
      min-height: 38px;
      border: 1px solid var(--gold);
      background: var(--gold);
      color: #15110a;
      padding: 9px 16px;
      font-size: 9px;
      font-weight: 950;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .run:hover { background: var(--gold-2); }
    .run:disabled { opacity: .5; cursor: wait; }

    .models { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .card {
      min-height: 176px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #111613, #0d100f);
      padding: 14px;
      display: flex;
      flex-direction: column;
      transition: .15s;
      position: relative;
      user-select: none;
    }
    .card:hover { transform: translateY(-2px); border-color: #46534c; }
    .card.selected { border-color: #745f3d; background: linear-gradient(180deg, #181711, #0e100e); }
    .card.selected::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 2px; background: var(--gold); }
    .kicker { color: var(--dim); font-size: 8px; font-weight: 900; letter-spacing: .11em; text-transform: uppercase; }
    .card h3 { margin: 9px 0 5px; font-size: 15px; }
    .card p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .path { margin-top: 11px; padding: 8px; border: 1px solid var(--soft); background: #080b09; color: #bfc7c0; font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cardBottom { margin-top: auto; padding-top: 11px; display: flex; gap: 5px; flex-wrap: wrap; }

    .status {
      margin-top: 12px;
      min-height: 58px;
      border: 1px solid var(--line);
      background: #0e1210;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 13px;
    }
    .statusIcon { width: 9px; height: 9px; border-radius: 50%; background: var(--dim); flex: 0 0 auto; }
    .statusIcon.loading { background: var(--blue); box-shadow: 0 0 12px rgba(134, 171, 201, .45); }
    .statusIcon.ok { background: var(--green); box-shadow: 0 0 12px rgba(114, 201, 146, .45); }
    .statusIcon.err { background: var(--red); }
    .statusCopy strong { display: block; font-size: 11px; }
    .statusCopy span { display: block; margin-top: 2px; color: var(--muted); font-size: 9px; }
    .statusMeta { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

    .results { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(340px, .55fr); gap: 12px; }
    .panel { min-width: 0; border: 1px solid var(--line); background: var(--panel); }
    .panelHead { min-height: 44px; border-bottom: 1px solid var(--line); padding: 10px 13px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .panelHead strong { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; }
    .panelHead span { color: var(--dim); font-size: 8px; }
    .panelBody { padding: 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 10px; }
    .summaryCell { border: 1px solid var(--soft); background: #0d110f; padding: 10px; min-width: 0; }
    .summaryCell strong { display: block; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .summaryCell span { color: var(--dim); font-size: 7px; text-transform: uppercase; letter-spacing: .07em; }
    .tableWrap { overflow: auto; max-height: 500px; border: 1px solid var(--soft); }
    table { width: 100%; border-collapse: collapse; font-size: 9px; }
    th { position: sticky; top: 0; z-index: 1; text-align: left; color: var(--dim); background: #0c100e; text-transform: uppercase; font-size: 7px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #1c231f; white-space: nowrap; max-width: 230px; overflow: hidden; text-overflow: ellipsis; }
    td.number { font-variant-numeric: tabular-nums; color: #d7d3c6; }
    .capturedList { display: grid; gap: 7px; margin-bottom: 10px; }
    .captured { border: 1px solid var(--soft); background: #0b0e0d; padding: 9px; }
    .capturedTop { display: flex; justify-content: space-between; gap: 8px; }
    .captured .url { margin-top: 5px; color: #aab2ac; font-size: 8px; word-break: break-all; }
    .okText { color: var(--green); }
    .badText { color: var(--red); }
    pre { margin: 0; padding: 11px; max-height: 520px; overflow: auto; border: 1px solid var(--soft); background: #070a08; color: #bdc6bf; font-size: 9px; line-height: 1.5; }
    .empty { min-height: 260px; display: grid; place-items: center; color: var(--dim); text-align: center; font-size: 11px; line-height: 1.6; }
    .foot { margin-top: 12px; color: var(--dim); font-size: 9px; line-height: 1.5; }

    @media (max-width: 1000px) {
      .models { grid-template-columns: 1fr 1fr; }
      .results { grid-template-columns: 1fr; }
      .controls { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 620px) {
      main { padding: 18px 12px 50px; }
      .top { padding: 0 12px; }
      .models, .controls { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr 1fr; }
      .statusMeta { display: none; }
    }
  </style>
  <script src="/deadlock/tools/statlocker/client.js?v=3" defer></script>
</head>
<body>
  <header>
    <div class="top">
      <div class="brand">STATLOCKER<b>.</b>LAB</div>
      <div class="tag">POC</div>
      <span id="clientState" class="pill blue">JS LOADING</span>
      <div class="live"><span class="dot"></span> isolated probe online</div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="eyebrow">Deadlock derived analytics</div>
      <h1>Statlocker <span>Model Probe</span></h1>
      <p>Select one model and press Run. The browser sends POST /deadlock/tools/statlocker/browser-request to our isolated NestJS probe. The probe then opens the real Statlocker page in Chromium and captures the selected derived analytics response.</p>
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
        <label for="matchId">Match ID, Win Chance only</label>
        <input id="matchId" inputmode="numeric" placeholder="Enter a real match ID" />
      </div>
      <button id="run" type="button" class="run" data-action="run">Run selected model</button>
    </section>

    <section class="models" aria-label="Statlocker model probes">
      <article class="card selected" data-model="ITEM_META_WPA" tabindex="0">
        <div class="kicker">Priority 01</div>
        <h3>Item Meta / WPA</h3>
        <p>Context-aware item impact data loaded by Statlocker's own frontend.</p>
        <div class="path mono">/api/info/wpa-filtered-items</div>
        <div class="cardBottom"><span class="pill good">browser flow</span><span class="pill blue">derived</span></div>
      </article>

      <article class="card" data-model="ETERNUS_BUILD_ANALYSIS" tabindex="0">
        <div class="kicker">Priority 02</div>
        <h3>Eternus Build Analysis</h3>
        <p>High-rank build trajectory and item relationships.</p>
        <div class="path mono">/api/info/player-build-analysis/:accountId/:heroId</div>
        <div class="cardBottom"><span class="pill good">browser flow</span><span class="pill blue">derived</span></div>
      </article>

      <article class="card" data-model="T4_BUILD_CHAINS" tabindex="0">
        <div class="kicker">Priority 03</div>
        <h3>T4 Build Chains</h3>
        <p>Build-chain and synergy dataset from Statlocker analysis.</p>
        <div class="path mono">/api/info/t4-chains-data</div>
        <div class="cardBottom"><span class="pill good">public 200</span><span class="pill blue">model dataset</span></div>
      </article>

      <article class="card" data-model="WIN_CHANCE" tabindex="0">
        <div class="kicker">Priority 04</div>
        <h3>Win Chance</h3>
        <p>Loads the Win Chance page, enters a match ID and captures its timeline response.</p>
        <div class="path mono">/api/match/:matchId/win-rate</div>
        <div class="cardBottom"><span class="pill">needs match id</span><span class="pill blue">browser action</span></div>
      </article>
    </section>

    <section class="status">
      <span id="statusIcon" class="statusIcon"></span>
      <div class="statusCopy">
        <strong id="statusTitle">Ready</strong>
        <span id="statusText">Item Meta / WPA is selected. Press Run selected model.</span>
      </div>
      <div class="statusMeta">
        <span id="statusModel" class="pill">ITEM_META_WPA</span>
        <span id="statusHttp" class="pill">-</span>
        <span id="statusTime" class="pill">-</span>
      </div>
    </section>

    <section class="results">
      <div class="panel">
        <div class="panelHead"><strong>Model output</strong><span id="outputHint">waiting</span></div>
        <div id="output" class="panelBody empty">Run a model to inspect the response returned to Statlocker's frontend.</div>
      </div>
      <div class="panel">
        <div class="panelHead"><strong>Captured network</strong><span>selected model calls only</span></div>
        <div class="panelBody">
          <div id="captured" class="capturedList"><div class="captured mono">No model calls yet.</div></div>
          <pre id="raw">{}</pre>
        </div>
      </div>
    </section>

    <div class="foot">No Statlocker API key is accepted or injected by this POC. The UI and client script are served with no-store so stale frontend code does not survive deploys.</div>
  </main>
</body>
</html>`;
