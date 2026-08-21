import { analyzeShopSignalCandidatesV1 } from './shop-signal-candidate-analysis';

export type DiagnosticRawSource = 'onInfoUpdates2' | 'onNewEvents';

export interface DiagnosticRawEvent {
  receivedAt: number;
  source: DiagnosticRawSource;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
}

type EntrySource = DiagnosticRawSource | 'getInfo' | 'runningGameInfo' | 'manifest' | 'system';

type DiagnosticEntry = {
  sequence: number;
  appSessionId: string;
  receivedAt: string;
  source: EntrySource;
  matchId?: string;
  feature?: string;
  category?: string;
  key?: string;
  rawPayload: unknown;
};

type DiagnosticNote = {
  id: string;
  createdAt: string;
  matchId?: string;
  approximateGameTime?: string;
  action: string;
  item?: string;
  note?: string;
};

type DiagnosticState = {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  currentMatchId?: string;
  manualSteamBuildId?: string;
  truncated: boolean;
  sequence: number;
  appSessions: Array<{ id: string; clientId: string; startedAt: string }>;
  entries: DiagnosticEntry[];
  notes: DiagnosticNote[];
};

type ZipFile = { name: string; content: string; modifiedAt?: Date };

const STORAGE_KEY = 'deadlock-live-probe-diagnostics-v1';
const MAX_PERSISTED_CHARS = 4_200_000;
const MAX_ENTRIES = 12_000;
const PERSIST_DELAY_MS = 750;

const nowIso = (): string => new Date().toISOString();
const randomId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitize(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitize(item, seen);
  }
  seen.delete(value);
  return result;
}

const stringify = (value: unknown, space?: number): string => JSON.stringify(sanitize(value), null, space);

function primitiveString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string' || (typeof parsed === 'number' && Number.isFinite(parsed))) {
      return String(parsed);
    }
  } catch {
    // Keep raw non-JSON strings.
  }
  return trimmed;
}

function findMatchId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    try {
      return findMatchId(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['match_id', 'matchId']) {
    const matchId = primitiveString(record[key]);
    if (matchId) return matchId;
  }
  for (const nested of Object.values(record)) {
    const matchId = findMatchId(nested, depth + 1);
    if (matchId) return matchId;
  }
  return undefined;
}

function collectVersionCandidates(value: unknown, result = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || value === null || value === undefined) return result;
  if (typeof value === 'string') {
    try {
      collectVersionCandidates(JSON.parse(value), result, depth + 1);
    } catch {
      // Parent keys are inspected below.
    }
    return result;
  }
  if (typeof value !== 'object') return result;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(build|version)/i.test(key) && (typeof nested === 'string' || typeof nested === 'number')) {
      result.add(`${key}: ${String(nested)}`);
    }
    collectVersionCandidates(nested, result, depth + 1);
  }
  return result;
}

function shouldCapture(event: DiagnosticRawEvent): boolean {
  if (event.source === 'onNewEvents') return true;
  return Boolean(event.key);
}

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function createStoredZipBytes(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const dos = dosDateTime(file.modifiedAt || new Date());

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, dos.time);
    write16(localView, 12, dos.date);
    write32(localView, 14, checksum);
    write32(localView, 18, content.length);
    write32(localView, 22, content.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, content);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, dos.time);
    write16(centralView, 14, dos.date);
    write32(centralView, 16, checksum);
    write32(centralView, 20, content.length);
    write32(centralView, 24, content.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + content.length;
  }

  const localData = concat(localParts);
  const centralData = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralData.length);
  write32(endView, 16, localData.length);
  write16(endView, 20, 0);
  return concat([localData, centralData, end]);
}

function initialState(clientId: string, appSessionId: string): DiagnosticState {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    truncated: false,
    sequence: 0,
    appSessions: [{ id: appSessionId, clientId, startedAt: timestamp }],
    entries: [],
    notes: [],
  };
}

export class DiagnosticCapture {
  private readonly appSessionId = randomId('session');
  private state: DiagnosticState;
  private persistTimerId?: number;
  private estimatedChars = 0;
  private initialized = false;
  private readonly fingerprints = new Map<string, string>();

  constructor(private readonly clientId: string) {
    this.state = this.load();
    if (!this.state.appSessions.some((session) => session.id === this.appSessionId)) {
      this.state.appSessions.push({ id: this.appSessionId, clientId, startedAt: nowIso() });
    }
    this.state.appSessions = this.state.appSessions.slice(-100);
    this.captureSystem('system', 'app_session_started', { clientId, appSessionId: this.appSessionId });
  }

  initialize(overwolfApi: any): void {
    if (this.initialized) return;
    this.initialized = true;
    this.mountPanel();
    overwolfApi?.games?.events?.getInfo?.((value: unknown) => this.captureSystem('getInfo', 'initial_snapshot', value));
    overwolfApi?.games?.getRunningGameInfo?.((value: unknown) =>
      this.captureSystem('runningGameInfo', 'running_game_info', value),
    );
    overwolfApi?.extensions?.current?.getManifest?.((value: unknown) =>
      this.captureSystem('manifest', 'overwolf_manifest', value),
    );
  }

  captureRaw(event: DiagnosticRawEvent): void {
    if (!shouldCapture(event)) return;
    const rawPayload = sanitize(event.rawPayload);
    const fingerprint = stringify(rawPayload);
    const channel = [event.source, event.feature || '', event.category || '', event.key || ''].join('|');
    if (this.fingerprints.get(channel) === fingerprint) return;
    this.fingerprints.set(channel, fingerprint);

    if (event.key === 'match_id') this.state.currentMatchId = primitiveString(rawPayload) || this.state.currentMatchId;
    this.append({
      sequence: ++this.state.sequence,
      appSessionId: this.appSessionId,
      receivedAt: new Date(event.receivedAt).toISOString(),
      source: event.source,
      matchId: this.state.currentMatchId,
      feature: event.feature,
      category: event.category,
      key: event.key,
      rawPayload,
    });
  }

  private captureSystem(source: EntrySource, key: string, rawPayload: unknown): void {
    const payload = sanitize(rawPayload);
    this.state.currentMatchId = findMatchId(payload) || this.state.currentMatchId;
    this.append({
      sequence: ++this.state.sequence,
      appSessionId: this.appSessionId,
      receivedAt: nowIso(),
      source,
      matchId: this.state.currentMatchId,
      key,
      rawPayload: payload,
    });
  }

  private append(entry: DiagnosticEntry): void {
    const length = stringify(entry).length + 1;
    this.state.entries.push(entry);
    this.estimatedChars += length;
    while (this.state.entries.length > MAX_ENTRIES || this.estimatedChars > MAX_PERSISTED_CHARS) {
      const removed = this.state.entries.shift();
      if (!removed) break;
      this.estimatedChars = Math.max(0, this.estimatedChars - stringify(removed).length - 1);
      this.state.truncated = true;
    }
    this.state.updatedAt = nowIso();
    this.schedulePersist();
    this.refreshPanel();
  }

  private load(): DiagnosticState {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState(this.clientId, this.appSessionId);
      const parsed = JSON.parse(raw) as DiagnosticState;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || !Array.isArray(parsed.notes)) {
        return initialState(this.clientId, this.appSessionId);
      }
      parsed.appSessions = Array.isArray(parsed.appSessions) ? parsed.appSessions : [];
      this.estimatedChars = parsed.entries.reduce((sum, entry) => sum + stringify(entry).length + 1, 0);
      return parsed;
    } catch (error) {
      console.error('Failed to restore diagnostic capture state:', error);
      return initialState(this.clientId, this.appSessionId);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimerId !== undefined) return;
    this.persistTimerId = window.setTimeout(() => {
      this.persistTimerId = undefined;
      this.persist();
    }, PERSIST_DELAY_MS);
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, stringify(this.state));
    } catch (error) {
      console.error('Failed to persist diagnostic capture state:', error);
      this.state.truncated = true;
      this.state.entries = this.state.entries.slice(-100);
      this.estimatedChars = this.state.entries.reduce((sum, entry) => sum + stringify(entry).length + 1, 0);
      try {
        window.localStorage.setItem(STORAGE_KEY, stringify(this.state));
      } catch (retryError) {
        console.error('Failed to persist reduced diagnostic state:', retryError);
      }
    }
  }

  private addNote(): void {
    const action = document.getElementById('diagnostic-action') as HTMLSelectElement | null;
    const item = document.getElementById('diagnostic-item') as HTMLInputElement | null;
    const gameTime = document.getElementById('diagnostic-game-time') as HTMLInputElement | null;
    const note = document.getElementById('diagnostic-note') as HTMLInputElement | null;
    if (!action) return;

    this.state.notes.push({
      id: randomId('note'),
      createdAt: nowIso(),
      matchId: this.state.currentMatchId,
      action: action.value,
      item: item?.value.trim() || undefined,
      approximateGameTime: gameTime?.value.trim() || undefined,
      note: note?.value.trim() || undefined,
    });
    this.state.updatedAt = nowIso();
    this.persist();
    if (item) item.value = '';
    if (gameTime) gameTime.value = '';
    if (note) note.value = '';
    this.refreshPanel();
  }

  private clear(): void {
    if (!window.confirm('Clear all captured diagnostic events and notes?')) return;
    this.state = initialState(this.clientId, this.appSessionId);
    this.fingerprints.clear();
    this.estimatedChars = 0;
    this.persist();
    this.refreshPanel();
  }

  private exportArchive(): void {
    this.persist();
    const matchIds = Array.from(
      new Set(this.state.entries.map((entry) => entry.matchId).filter((value): value is string => !!value)),
    );
    const candidates = Array.from(
      this.state.entries.reduce((result, entry) => collectVersionCandidates(entry.rawPayload, result), new Set<string>()),
    ).sort();
    const shopSignalAnalysis = analyzeShopSignalCandidatesV1(this.state.entries, this.state.notes);
    const sessionInfo = {
      schemaVersion: 1,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
      exportedAt: nowIso(),
      currentMatchId: this.state.currentMatchId,
      matchIds,
      manualSteamBuildId: this.state.manualSteamBuildId,
      truncated: this.state.truncated,
      entryCount: this.state.entries.length,
      appSessions: this.state.appSessions,
    };
    const zipBytes = createStoredZipBytes([
      { name: 'overwolf-events.ndjson', content: this.state.entries.map((entry) => stringify(entry)).join('\n') },
      { name: 'session-info.json', content: stringify(sessionInfo, 2) },
      { name: 'notes.json', content: stringify(this.state.notes, 2) },
      { name: 'shop-signal-candidates.json', content: stringify(shopSignalAnalysis, 2) },
      {
        name: 'steam-build.txt',
        content: [
          `Manual Steam build ID: ${this.state.manualSteamBuildId || 'not provided'}`,
          '',
          'Detected build/version candidates:',
          ...(candidates.length ? candidates.map((candidate) => `- ${candidate}`) : ['- none']),
        ].join('\n'),
      },
      {
        name: 'README.txt',
        content: [
          'Deadlock Live Probe diagnostic capture',
          '',
          'Upload this ZIP without editing it.',
          'It contains raw deduplicated GEP values, startup snapshots, match IDs, and manual action markers.',
          '',
          'Direct-shop discovery:',
          '- Add SHOP_AVAILABLE and SHOP_UNAVAILABLE markers immediately when you manually observe each state.',
          '- shop-signal-candidates.json only ranks correlated raw GEP channels.',
          '- A candidate is never promoted automatically to DIRECT_SOURCE_SIGNAL; independent validation is required.',
        ].join('\n'),
      },
    ]);

    const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
    new Uint8Array(zipBuffer).set(zipBytes);
    const objectUrl = URL.createObjectURL(new Blob([zipBuffer], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    const matchLabel = matchIds.length === 1 ? matchIds[0] : matchIds.length > 1 ? 'multiple-matches' : 'unknown-match';
    anchor.href = objectUrl;
    anchor.download = `deadlock-diagnostics-${matchLabel}-${nowIso().replace(/[:.]/g, '-')}.zip`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  private mountPanel(): void {
    if (document.getElementById('diagnostic-capture-panel')) return this.refreshPanel();
    const style = document.createElement('style');
    style.textContent = `
      #diagnostic-capture-panel{border:1px solid #3b3b4b;border-radius:10px;background:#14141a;padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-family:'Outfit',sans-serif}
      #diagnostic-capture-panel .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      #diagnostic-capture-panel .title{font-size:12px;font-weight:700;color:#ff6b4a;margin-right:auto}
      #diagnostic-capture-panel .status{font-size:11px;color:#9ca3af}
      #diagnostic-capture-panel input,#diagnostic-capture-panel select,#diagnostic-capture-panel button{border:1px solid #343444;border-radius:5px;background:#1b1b22;color:#f3f4f6;padding:5px 7px;font:inherit;font-size:11px}
      #diagnostic-capture-panel input{min-width:90px;flex:1}#diagnostic-capture-panel button{cursor:pointer}
      #diagnostic-capture-panel .primary{background:#ff6b4a;border-color:#ff6b4a;color:#111;font-weight:700}
      #diagnostic-capture-panel .danger{color:#f87171}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'diagnostic-capture-panel';
    panel.innerHTML = `
      <div class="row"><span class="title">Diagnostic Capture</span><span class="status" id="diagnostic-status"></span><button class="primary" id="diagnostic-export">Export ZIP</button><button class="danger" id="diagnostic-clear">Clear</button></div>
      <div class="row"><input id="diagnostic-steam-build" placeholder="Steam build ID (optional)"><select id="diagnostic-action"><option>SHOP_AVAILABLE</option><option>SHOP_UNAVAILABLE</option><option>BUY</option><option>UPGRADE</option><option>SELL</option><option>REBUY</option><option>CONSUME</option><option>RECONNECT</option><option>OTHER</option></select><input id="diagnostic-item" placeholder="Item name"><input id="diagnostic-game-time" placeholder="Game time MM:SS"><input id="diagnostic-note" placeholder="Optional note"><button id="diagnostic-add-note">Add marker</button></div>
    `;
    const appLayout = document.querySelector('.app-layout');
    appLayout?.parentElement ? appLayout.parentElement.insertBefore(panel, appLayout) : document.body.prepend(panel);
    document.getElementById('diagnostic-export')?.addEventListener('click', () => this.exportArchive());
    document.getElementById('diagnostic-clear')?.addEventListener('click', () => this.clear());
    document.getElementById('diagnostic-add-note')?.addEventListener('click', () => this.addNote());
    document.getElementById('diagnostic-steam-build')?.addEventListener('input', (event) => {
      this.state.manualSteamBuildId = (event.target as HTMLInputElement).value.trim() || undefined;
      this.state.updatedAt = nowIso();
      this.schedulePersist();
    });
    const buildInput = document.getElementById('diagnostic-steam-build') as HTMLInputElement | null;
    if (buildInput) buildInput.value = this.state.manualSteamBuildId || '';
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const status = document.getElementById('diagnostic-status');
    if (!status) return;
    status.textContent = `match ${this.state.currentMatchId || 'unknown'} | ${this.state.entries.length} events | ${this.state.notes.length} markers | ~${Math.round(this.estimatedChars / 1024)} KB${this.state.truncated ? ' | TRUNCATED' : ''}`;
  }
}
