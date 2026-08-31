export const STATLOCKER_PROBE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statlocker Model Probe</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b0f0d; color: #e8ece9; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 60px; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-top: 28px; }
    p { color: #aeb8b1; line-height: 1.5; }
    .note { border: 1px solid #33443a; background: #101713; padding: 12px 14px; border-radius: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .card { border: 1px solid #28332d; background: #101512; padding: 14px; border-radius: 8px; }
    .priority { display: inline-block; font-size: 11px; border: 1px solid #476453; border-radius: 999px; padding: 2px 7px; margin-bottom: 8px; }
    .muted { color: #7f8d84; font-size: 13px; }
    button { cursor: pointer; border: 1px solid #496354; background: #17231c; color: #e9f5ed; padding: 8px 12px; border-radius: 6px; }
    button:hover { background: #203027; }
    input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #334039; background: #0c110e; color: #e8ece9; border-radius: 6px; padding: 9px; font: inherit; }
    textarea { min-height: 100px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .row { display: grid; grid-template-columns: 120px 1fr; gap: 10px; margin-bottom: 10px; }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    pre { overflow: auto; max-height: 560px; background: #070a08; border: 1px solid #28332d; padding: 12px; border-radius: 8px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #263029; padding: 8px 6px; vertical-align: top; }
    td code { word-break: break-all; }
    .good { color: #65d693; }
    .bad { color: #e69b9b; }
    .endpoint-button { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; padding: 5px 7px; }
  </style>
</head>
<body>
<main>
  <h1>Statlocker model endpoint probe</h1>
  <p>Small research-only tool. It does not use a Statlocker API key, does not send cookies, does not bypass auth, and only lets the backend call <code>statlocker.gg/api/*</code>.</p>
  <div class="note">
    We intentionally ignore raw match/profile data. Deadlock API and our own PostgreSQL already cover that. The targets below are only Statlocker-derived signals that could add value to candidate generation, build analysis, state evaluation, or external validation.
  </div>

  <h2>Useful targets</h2>
  <div id="targets" class="grid"></div>

  <h2>Discover API paths from public frontend assets</h2>
  <p>The discoverer loads a few public Statlocker model/build pages, reads their same-origin JavaScript bundles, and extracts literal <code>/api/...</code> paths. It is not a brute-force scanner.</p>
  <div class="actions">
    <button id="discover">Discover endpoints</button>
    <span id="discover-status" class="muted"></span>
  </div>
  <div id="discovered"></div>

  <h2>Request tester</h2>
  <p>Click any discovered endpoint to copy it here, add the required query/body, then run it. HTTP 401/403 is still useful evidence: it means the frontend route is not directly reusable without official access.</p>
  <div class="row">
    <select id="method"><option>GET</option><option>POST</option></select>
    <input id="path" placeholder="/api/..." />
  </div>
  <label>Query JSON</label>
  <textarea id="query">{}</textarea>
  <label>Body JSON</label>
  <textarea id="body">{}</textarea>
  <div class="actions" style="margin-top:10px">
    <button id="run">Run request</button>
    <span id="request-status" class="muted"></span>
  </div>
  <pre id="response">No request yet.</pre>

  <h2>Explicitly out of scope for this probe</h2>
  <div class="note">
    <code>/api/public/match/*</code>, <code>/api/public/matches</code>, <code>/api/public/profile/*</code>, <code>/api/public/profiles</code>, public draft, generic match history, generic item catalog, generic hero stats and ordinary build history. Those are not the reason to integrate Statlocker.
  </div>
</main>
<script>
  const apiBase = '/deadlock/tools/statlocker';

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

  async function loadTargets() {
    const response = await fetch(apiBase + '/presets');
    const targets = await response.json();
    document.getElementById('targets').innerHTML = targets.map((target) => {
      const signals = target.expectedSignals.map((signal) => '<li>' + escapeHtml(signal) + '</li>').join('');
      const query = target.suggestedQuery ? '<div class="muted">Suggested query: <code>' + escapeHtml(JSON.stringify(target.suggestedQuery)) + '</code></div>' : '';
      return '<div class="card">' +
        '<div class="priority">' + escapeHtml(target.priority) + '</div>' +
        '<strong>' + escapeHtml(target.title) + '</strong>' +
        '<p>' + escapeHtml(target.usefulFor) + '</p>' +
        '<ul>' + signals + '</ul>' +
        '<div class="muted">Source page: <code>' + escapeHtml(target.sourcePage) + '</code></div>' +
        query +
      '</div>';
    }).join('');
  }

  async function discover() {
    const status = document.getElementById('discover-status');
    const container = document.getElementById('discovered');
    status.textContent = 'Loading pages and JS bundles...';
    container.innerHTML = '';

    try {
      const response = await fetch(apiBase + '/discover');
      const result = await response.json();
      const rows = result.endpoints.map((endpoint) => {
        const useful = endpoint.likelyUseful ? '<span class="good">yes</span>' : 'no';
        const duplicate = endpoint.rawDeadlockDuplicate ? '<span class="bad">yes</span>' : 'no';
        return '<tr>' +
          '<td><button class="endpoint-button" data-path="' + escapeHtml(endpoint.path) + '">' + escapeHtml(endpoint.path) + '</button></td>' +
          '<td>' + useful + '</td>' +
          '<td>' + duplicate + '</td>' +
          '<td>' + escapeHtml(endpoint.matchedKeywords.join(', ')) + '</td>' +
        '</tr>';
      }).join('');

      container.innerHTML = '<p class="muted">Scripts checked: ' + result.scriptsChecked.length + '. Endpoints found: ' + result.endpoints.length + '. Errors: ' + result.errors.length + '.</p>' +
        '<table><thead><tr><th>Endpoint</th><th>Likely useful</th><th>Raw duplicate</th><th>Signals</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        (result.errors.length ? '<details><summary>Discovery errors</summary><pre>' + escapeHtml(pretty(result.errors)) + '</pre></details>' : '');

      for (const button of container.querySelectorAll('[data-path]')) {
        button.addEventListener('click', () => {
          document.getElementById('path').value = button.getAttribute('data-path') || '';
          document.getElementById('path').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }

      status.textContent = 'Done.';
    } catch (error) {
      status.textContent = 'Discovery failed.';
      container.innerHTML = '<pre>' + escapeHtml(String(error)) + '</pre>';
    }
  }

  async function runRequest() {
    const status = document.getElementById('request-status');
    const output = document.getElementById('response');
    status.textContent = 'Requesting...';

    try {
      const payload = {
        method: document.getElementById('method').value,
        path: document.getElementById('path').value,
        query: JSON.parse(document.getElementById('query').value || '{}'),
        body: JSON.parse(document.getElementById('body').value || '{}'),
      };

      const response = await fetch(apiBase + '/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      output.textContent = pretty(result);
      status.textContent = 'HTTP ' + response.status + (result.status ? ' -> Statlocker HTTP ' + result.status : '');
    } catch (error) {
      output.textContent = String(error);
      status.textContent = 'Failed.';
    }
  }

  document.getElementById('discover').addEventListener('click', discover);
  document.getElementById('run').addEventListener('click', runRequest);
  loadTargets().catch((error) => {
    document.getElementById('targets').innerHTML = '<pre>' + escapeHtml(String(error)) + '</pre>';
  });
</script>
</body>
</html>`;
