export const STATLOCKER_SITE_LIKE_PROBE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Statlocker Model Lab</title>
  <style>
    :root {
      color-scheme: dark;
      --bg:#080a09; --panel:#101412; --panel2:#151a17; --line:#29322d;
      --soft:#1b221f; --text:#ebe8dc; --muted:#929a94; --dim:#646d67;
      --gold:#d4a85e; --gold2:#efc676; --green:#72c992; --red:#df8a82; --blue:#86abc9;
      font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    *{box-sizing:border-box} html{scroll-behavior:smooth}
    body{margin:0;min-height:100vh;color:var(--text);background:radial-gradient(circle at 18% -8%,rgba(100,133,103,.13),transparent 31%),radial-gradient(circle at 90% 1%,rgba(182,132,66,.10),transparent 25%),var(--bg)}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.15;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.014) 1px,transparent 1px);background-size:36px 36px;mask-image:linear-gradient(to bottom,#000,transparent 78%)}
    button,input{font:inherit}button{cursor:pointer}.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    header{position:sticky;top:0;z-index:10;backdrop-filter:blur(16px);background:rgba(8,10,9,.92);border-bottom:1px solid rgba(76,88,81,.35)}
    .top{max-width:1460px;height:64px;padding:0 24px;margin:auto;display:flex;align-items:center;gap:22px}.brand{font-weight:950;letter-spacing:-.045em;font-size:20px}.brand b{color:var(--gold2)}
    .tag{padding:4px 7px;border:1px solid #5a4930;background:#1b160f;color:var(--gold2);font-size:9px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.nav{display:flex;gap:19px;color:var(--muted);font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.nav span:first-child{color:var(--text)}
    .live{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 14px rgba(114,201,146,.65)}
    main{max-width:1460px;margin:auto;padding:30px 24px 80px}.hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.45fr);border:1px solid var(--line);background:linear-gradient(135deg,rgba(18,24,20,.98),rgba(9,12,10,.98));overflow:hidden;position:relative}.hero:after{content:"MODEL";position:absolute;right:-28px;bottom:-46px;font-weight:950;font-size:150px;letter-spacing:-.08em;color:rgba(212,168,94,.035)}
    .heroCopy{padding:28px 30px;z-index:1}.eyebrow{color:var(--gold);font-size:10px;font-weight:900;letter-spacing:.17em;text-transform:uppercase}h1{margin:9px 0 0;font-size:clamp(34px,4.5vw,64px);line-height:.97;letter-spacing:-.055em}h1 span{color:var(--gold2)}.hero p{max-width:850px;color:#9ca49f;font-size:13px;line-height:1.6;margin:17px 0 0}
    .heroSide{padding:20px;border-left:1px solid var(--line);background:rgba(11,14,12,.66);z-index:1}.sideTitle{color:var(--dim);text-transform:uppercase;letter-spacing:.13em;font-size:9px;font-weight:900}.metrics{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:7px}.metric{padding:11px;border:1px solid var(--soft);background:#0d110f}.metric strong{display:block;font-size:20px}.metric small{color:var(--dim);text-transform:uppercase;font-size:8px;letter-spacing:.08em}.note{margin-top:11px;border-left:2px solid var(--gold);background:#17140e;color:#bbb19c;padding:10px;font-size:10px;line-height:1.45}
    .controls{margin-top:12px;border:1px solid var(--line);background:var(--panel);display:grid;grid-template-columns:1fr .7fr 1fr auto;gap:9px;padding:12px;align-items:end}label{display:block;color:var(--dim);font-size:8px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;margin-bottom:6px}input{width:100%;background:#090c0b;color:var(--text);border:1px solid #303a35;padding:10px 11px;outline:none}input:focus{border-color:#725e3e}.run{min-height:38px;border:1px solid var(--gold);background:var(--gold);color:#15110a;padding:9px 16px;font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.09em}.run:hover{background:var(--gold2)}.run:disabled{opacity:.45;cursor:wait}
    .models{margin-top:27px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.card{min-height:190px;border:1px solid var(--line);background:linear-gradient(180deg,#111613,#0d100f);padding:15px;display:flex;flex-direction:column;transition:.15s;position:relative}.card:hover{transform:translateY(-2px);border-color:#46534c}.card.selected{border-color:#745f3d;background:linear-gradient(180deg,#181711,#0e100e)}.card.selected:before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--gold)}.kicker{color:var(--dim);font-size:8px;letter-spacing:.12em;text-transform:uppercase;font-weight:900}.card h3{margin:9px 0 5px;font-size:16px}.card p{margin:0;color:var(--muted);font-size:10px;line-height:1.5}.path{margin-top:12px;padding:8px;border:1px solid var(--soft);background:#080b09;color:#bfc7c0;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cardBottom{margin-top:auto;padding-top:12px;display:flex;gap:6px;flex-wrap:wrap}
    .pill{border:1px solid #354039;padding:3px 6px;border-radius:999px;color:var(--muted);font-size:7px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.pill.good{color:var(--green);border-color:#34533f;background:#102118}.pill.blue{color:var(--blue);border-color:#31475a;background:#111c26}
    .status{margin-top:12px;border:1px solid var(--line);background:#0e1210;min-height:54px;display:flex;align-items:center;gap:12px;padding:10px 13px}.statusIcon{width:9px;height:9px;border-radius:50%;background:var(--dim)}.statusIcon.loading{background:var(--blue);box-shadow:0 0 12px rgba(134,171,201,.45);animation:pulse 1s infinite alternate}.statusIcon.ok{background:var(--green);box-shadow:0 0 12px rgba(114,201,146,.45)}.statusIcon.err{background:var(--red)}@keyframes pulse{from{opacity:.4}to{opacity:1}}.statusCopy strong{display:block;font-size:11px}.statusCopy span{color:var(--muted);font-size:9px}.statusMeta{margin-left:auto;display:flex;gap:6px}
    .results{margin-top:12px;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(350px,.55fr);gap:12px}.panel{border:1px solid var(--line);background:var(--panel);min-width:0}.panelHead{min-height:45px;border-bottom:1px solid var(--line);padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:10px}.panelHead strong{font-size:9px;text-transform:uppercase;letter-spacing:.12em}.panelHead span{color:var(--dim);font-size:8px}.panelBody{padding:12px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}.summaryCell{border:1px solid var(--soft);background:#0d110f;padding:10px;min-width:0}.summaryCell strong{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summaryCell span{color:var(--dim);font-size:7px;text-transform:uppercase;letter-spacing:.08em}
    .tableWrap{overflow:auto;max-height:500px;border:1px solid var(--soft)}table{width:100%;border-collapse:collapse;font-size:9px}th{position:sticky;top:0;z-index:1;text-align:left;color:var(--dim);background:#0c100e;text-transform:uppercase;letter-spacing:.06em;font-size:7px}th,td{padding:8px 9px;border-bottom:1px solid #1c231f;white-space:nowrap;max-width:230px;overflow:hidden;text-overflow:ellipsis}tr:hover td{background:#121713}td.number{font-variant-numeric:tabular-nums;color:#d7d3c6}
    .capturedList{display:grid;gap:7px;margin-bottom:10px}.captured{border:1px solid var(--soft);background:#0b0e0d;padding:9px}.capturedTop{display:flex;justify-content:space-between;gap:8px}.captured .url{margin-top:5px;color:#aab2ac;font-size:8px;word-break:break-all}.okText{color:var(--green)}.badText{color:var(--red)}pre{margin:0;padding:11px;max-height:520px;overflow:auto;border:1px solid var(--soft);background:#070a08;color:#bdc6bf;font-size:9px;line-height:1.5}.empty{min-height:260px;display:grid;place-items:center;color:var(--dim);text-align:center;font-size:11px;line-height:1.6}.foot{margin-top:12px;color:var(--dim);font-size:9px;line-height:1.5}
    @media(max-width:1000px){.hero{grid-template-columns:1fr}.heroSide{border-left:0;border-top:1px solid var(--line)}.models{grid-template-columns:1fr 1fr}.results{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.nav{display:none}}@media(max-width:620px){main{padding:18px 12px 50px}.top{padding:0 12px}.models,.controls{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr}.heroCopy{padding:22px 18px}.statusMeta{display:none}}
  </style>
</head>
<body>
<header><div class="top"><div class="brand">STATLOCKER<b>.</b>LAB</div><div class="tag">Browser POC</div><div class="nav"><span>Models</span><span>Item Meta</span><span>Eternus</span><span>Vision</span></div><div class="live"><span class="dot"></span> live proxy online</div></div></header>
<main>
  <section class="hero">
    <div class="heroCopy"><div class="eyebrow">Deadlock derived analytics</div><h1>Statlocker <span>Model Explorer</span></h1><p>This opens the real Statlocker page in Chromium, lets their frontend execute its normal model requests, then shows us the response. Our request does not provide an API key.</p></div>
    <aside class="heroSide"><div class="sideTitle">Verified browser behavior</div><div class="metrics"><div class="metric"><strong>200</strong><small>WPA via site</small></div><div class="metric"><strong>200</strong><small>Eternus via site</small></div><div class="metric"><strong>4</strong><small>model probes</small></div><div class="metric"><strong>0</strong><small>keys supplied</small></div></div><div class="note">Look at the captured Statlocker HTTP response below. That is the important result.</div></aside>
  </section>

  <section class="controls">
    <div><label for="hero">Hero</label><input id="hero" value="Abrams" placeholder="Abrams" /></div>
    <div><label for="min">Min sample size</label><input id="min" type="number" min="1" max="100000" value="500" /></div>
    <div><label for="matchId">Match ID - Win Chance only</label><input id="matchId" inputmode="numeric" placeholder="Enter a real match ID" /></div>
    <button id="run" class="run">Run selected model</button>
  </section>

  <section class="models">
    <article class="card selected" data-model="ITEM_META_WPA"><div class="kicker">Priority 01 / Item Meta</div><h3>Item Meta / WPA</h3><p>Context-aware item impact data loaded by the actual Statlocker frontend.</p><div class="path mono">/api/info/wpa-filtered-items</div><div class="cardBottom"><span class="pill good">browser 200</span><span class="pill blue">no key from us</span></div></article>
    <article class="card" data-model="ETERNUS_BUILD_ANALYSIS"><div class="kicker">Priority 02 / High rank</div><h3>Eternus Build Analysis</h3><p>High-rank build trajectory, item relationships and the WPA data used by Eternus.</p><div class="path mono">/api/info/player-build-analysis/:accountId/:heroId</div><div class="cardBottom"><span class="pill good">browser 200</span><span class="pill blue">derived</span></div></article>
    <article class="card" data-model="T4_BUILD_CHAINS"><div class="kicker">Priority 03 / Synergy</div><h3>T4 Build Chains</h3><p>Build-chain and synergy dataset used by Statlocker analysis.</p><div class="path mono">/api/info/t4-chains-data</div><div class="cardBottom"><span class="pill good">public 200</span><span class="pill blue">model dataset</span></div></article>
    <article class="card" data-model="WIN_CHANCE"><div class="kicker">Priority 04 / Vision</div><h3>Win Chance</h3><p>Loads their Win Chance page, enters a real match ID and presses Analyze.</p><div class="path mono">/api/match/:matchId/win-rate</div><div class="cardBottom"><span class="pill">needs match id</span><span class="pill blue">browser action</span></div></article>
  </section>

  <section class="status"><span id="statusIcon" class="statusIcon"></span><div class="statusCopy"><strong id="statusTitle">Ready</strong><span id="statusText">Item Meta / WPA is selected. Press Run.</span></div><div class="statusMeta"><span id="statusModel" class="pill">ITEM_META_WPA</span><span id="statusHttp" class="pill">-</span><span id="statusTime" class="pill">-</span></div></section>

  <section class="results">
    <div class="panel"><div class="panelHead"><strong>Model output</strong><span id="outputHint">waiting</span></div><div id="output" class="panelBody empty">Run a model to inspect the data returned to Statlocker's own frontend.</div></div>
    <div class="panel"><div class="panelHead"><strong>Captured network</strong><span>only selected model calls</span></div><div class="panelBody"><div id="captured" class="capturedList"><div class="captured mono">No model calls yet.</div></div><pre id="raw">{}</pre></div></div>
  </section>
  <div class="foot">The POC does not accept an API key, does not expose browser request headers, and does not return cookies or local storage. It only returns the selected model response body.</div>
</main>
<script>
  var apiBase = location.pathname.replace(/\/$/, '');
  var selectedModel = 'ITEM_META_WPA';
  var cards = Array.from(document.querySelectorAll('.card'));
  var run = document.getElementById('run');
  var statusIcon = document.getElementById('statusIcon');
  var statusTitle = document.getElementById('statusTitle');
  var statusText = document.getElementById('statusText');
  var statusModel = document.getElementById('statusModel');
  var statusHttp = document.getElementById('statusHttp');
  var statusTime = document.getElementById('statusTime');
  var output = document.getElementById('output');
  var outputHint = document.getElementById('outputHint');
  var captured = document.getElementById('captured');
  var raw = document.getElementById('raw');

  cards.forEach(function(card){card.addEventListener('click',function(){selectedModel=card.dataset.model;cards.forEach(function(x){x.classList.toggle('selected',x===card)});statusModel.textContent=selectedModel;statusTitle.textContent='Ready';statusText.textContent=selectedModel==='WIN_CHANCE'?'Enter a real match ID, then press Run.':'Press Run selected model.';statusIcon.className='statusIcon'})});
  run.addEventListener('click',runModel);

  async function runModel(){
    var hero=document.getElementById('hero').value.trim();
    var minSampleSize=Number(document.getElementById('min').value||500);
    var matchId=document.getElementById('matchId').value.trim();
    if(selectedModel==='WIN_CHANCE'&&!/^\d{6,30}$/.test(matchId)){setError('Match ID required','Enter a real numeric Deadlock match ID.');return}
    setLoading();
    try{
      var response=await fetch(apiBase+'/browser-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selectedModel,hero:hero,minSampleSize:minSampleSize,matchId:matchId||undefined})});
      var result=await response.json();
      if(!response.ok)throw new Error(result&&result.message?result.message:'Browser model probe failed');
      renderResult(result);
      statusIcon.className='statusIcon ok';statusTitle.textContent='Live model response captured';statusText.textContent='Statlocker frontend flow completed in Chromium. No API key was supplied by this POC.';statusHttp.textContent='HTTP '+String(result.primary&&result.primary.status||'-');statusTime.textContent=String(result.elapsedMs||'-')+' ms';
    }catch(error){setError('Probe failed',error instanceof Error?error.message:String(error))}finally{run.disabled=false;run.textContent='Run selected model'}
  }

  function setLoading(){run.disabled=true;run.textContent='Opening Statlocker...';statusIcon.className='statusIcon loading';statusTitle.textContent='Running real browser flow';statusText.textContent='Chromium is loading statlocker.gg and waiting for the model response.';statusHttp.textContent='...';statusTime.textContent='...';outputHint.textContent='live request in progress'}
  function setError(title,message){statusIcon.className='statusIcon err';statusTitle.textContent=title;statusText.textContent=message;statusHttp.textContent='ERROR';statusTime.textContent='-';outputHint.textContent='no usable response'}

  function renderResult(result){
    var primary=result.primary||{};var data=primary.data;output.className='panelBody';outputHint.textContent=primary.path||'captured response';raw.textContent=JSON.stringify(result,null,2);renderCaptured(result.captured||[]);
    if(result.model==='ITEM_META_WPA'){var items=Array.isArray(data&&data.items)?data.items:[];output.innerHTML=summary([['items',items.length],['tiers',Array.isArray(data&&data.tiers)?data.tiers.length:0],['heroes',Array.isArray(data&&data.availableHeroes)?data.availableHeroes.length:0],['patches',Array.isArray(data&&data.availablePatches)?data.availablePatches.length:0]])+smartTable(items);return}
    if(result.model==='ETERNUS_BUILD_ANALYSIS'){var build=data||{};var bi=Array.isArray(build.items)?build.items:[];var rel=Array.isArray(build.itemRelationships)?build.itemRelationships:[];output.innerHTML=summary([['matches',build.totalMatches||'-'],['win rate',value(build.winRate)],['items',bi.length],['relationships',rel.length]])+smartTable(bi.length?bi:rel);return}
    if(result.model==='T4_BUILD_CHAINS'){var by=data&&data.by_hero&&typeof data.by_hero==='object'?data.by_hero:{};var names=Object.keys(by);var h=document.getElementById('hero').value.trim();var hd=by[h]||by[h.toLowerCase()]||by[names[0]];var rows=Array.isArray(hd)?hd:(hd&&typeof hd==='object'?Object.entries(hd).map(function(e){return e[1]&&typeof e[1]==='object'&&!Array.isArray(e[1])?Object.assign({key:e[0]},e[1]):{key:e[0],value:e[1]}}):[]);output.innerHTML=summary([['heroes',names.length],['selected',h||'-'],['rows',rows.length],['metadata',data&&data.metadata?'yes':'no']])+smartTable(rows);return}
    if(result.model==='WIN_CHANCE'){var intervals=Array.isArray(data&&data.winRateIntervals)?data.winRateIntervals:(Array.isArray(data)?data:[]);output.innerHTML=summary([['intervals',intervals.length],['match',document.getElementById('matchId').value.trim()||'-'],['payload',Array.isArray(data)?'array':typeof data],['status',intervals.length?'timeline loaded':'inspect raw']])+smartTable(intervals);return}
    output.innerHTML='<pre>'+esc(JSON.stringify(data,null,2))+'</pre>';
  }

  function renderCaptured(items){if(!items.length){captured.innerHTML='<div class="captured mono">No matching model calls captured.</div>';return}captured.innerHTML=items.map(function(e){var cls=e.status>=200&&e.status<300?'okText':'badText';return '<div class="captured"><div class="capturedTop"><span class="mono">'+esc(e.method+' '+e.path)+'</span><strong class="'+cls+'">'+esc(String(e.status))+'</strong></div><div class="url mono">'+esc(e.url)+'</div></div>'}).join('')}
  function summary(entries){return '<div class="summary">'+entries.map(function(e){return '<div class="summaryCell"><strong>'+esc(value(e[1]))+'</strong><span>'+esc(e[0])+'</span></div>'}).join('')+'</div>'}
  function smartTable(rows){if(!Array.isArray(rows)||!rows.length)return '<div class="empty">Endpoint returned successfully, but no array rows were detected.<br>Inspect raw JSON on the right.</div>';var objects=rows.slice(0,40).map(function(e,i){return e&&typeof e==='object'&&!Array.isArray(e)?e:{index:i,value:e}});var preferred=['name','itemName','item_name','itemId','item_id','id','key','wpa','avgWpa','averageWpa','winRate','pickRate','purchaseRate','sampleSize','sample_size','games','matches','count','avgPurchaseTime','averagePurchaseTime','purchaseTime','tier','cost'];var keys=[];objects.slice(0,12).forEach(function(row){Object.keys(row).forEach(function(k){var v=row[k];var scalar=v===null||['string','number','boolean'].indexOf(typeof v)>=0;if(scalar&&keys.indexOf(k)<0)keys.push(k)})});var cols=preferred.filter(function(k){return keys.indexOf(k)>=0}).concat(keys.filter(function(k){return preferred.indexOf(k)<0})).slice(0,8);if(!cols.length)return '<pre>'+esc(JSON.stringify(rows.slice(0,20),null,2))+'</pre>';var head='<thead><tr>'+cols.map(function(k){return '<th>'+esc(k)+'</th>'}).join('')+'</tr></thead>';var body='<tbody>'+objects.map(function(row){return '<tr>'+cols.map(function(k){var v=row[k];return '<td'+(typeof v==='number'?' class="number"':'')+'>'+esc(value(v))+'</td>'}).join('')+'</tr>'}).join('')+'</tbody>';return '<div class="tableWrap"><table>'+head+body+'</table></div>'}
  function value(v){if(v===null||v===undefined)return '-';if(typeof v==='number')return Number.isInteger(v)?String(v):String(Math.round(v*10000)/10000);if(typeof v==='object')return JSON.stringify(v);return String(v)}
  function esc(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
</script>
</body>
</html>`;
