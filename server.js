const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, exec } = require('child_process');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const pidusage = require('pidusage');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const SERVERS_PATH = path.join(__dirname, 'servers.json');

let appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function slugify(name) {
  return (
    name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'server'
  );
}

// Non-Minecraft games are all launched the same generic way (executable + args), so
// "compatibility" here just means sensible per-game defaults for that launcher.
const GAME_DEFAULTS = {
  gmod: { port: 27015, exePath: 'srcds.exe', launchArgs: ['-console', '-game', 'garrysmod'] },
  cs2: { port: 27015, exePath: 'cs2.exe', launchArgs: ['-dedicated', '-console'] },
  valheim: { port: 2456, exePath: 'valheim_server.exe', launchArgs: ['-nographics', '-batchmode'] },
  vintagestory: { port: 42420, exePath: 'VintagestoryServer.exe', launchArgs: [] },
  rust: { port: 28015, exePath: 'RustDedicated.exe', launchArgs: ['-batchmode'] },
  projectzomboid: { port: 16261, exePath: 'StartServer64.bat', launchArgs: [] },
  palworld: { port: 8211, exePath: 'PalServer.exe', launchArgs: ['-nographics'] },
  fivem: { port: 30120, exePath: 'FXServer.exe', launchArgs: ['+exec', 'server.cfg'] },
  '7dtd': { port: 26900, exePath: '7DaysToDieServer.exe', launchArgs: [] },
};
const VALID_GAMES = new Set(['minecraft', ...Object.keys(GAME_DEFAULTS)]);

function loadServerDefs() {
  if (fs.existsSync(SERVERS_PATH)) {
    return JSON.parse(fs.readFileSync(SERVERS_PATH, 'utf8'));
  }
  // Migrate the legacy single-server config.json into the new multi-server registry.
  const legacy = {
    id: 'mc1',
    name: 'Minecraft1',
    game: 'minecraft',
    serverDir: appConfig.serverDir,
    gamePort: appConfig.gamePort,
    jarName: appConfig.jarName,
    javaPath: appConfig.javaPath,
    minRam: appConfig.minRam,
    maxRam: appConfig.maxRam,
    extraJavaArgs: appConfig.extraJavaArgs || [],
    exePath: null,
    launchArgs: [],
    stopTimeoutMs: appConfig.stopTimeoutMs || 30000,
    limits: { cpuMaxPercent: 100, ramMaxMB: null, storageMaxGB: null },
  };
  const defs = [legacy];
  fs.writeFileSync(SERVERS_PATH, JSON.stringify(defs, null, 2));

  // Trim config.json down to just the dashboard-wide settings.
  appConfig = { dashboardPort: appConfig.dashboardPort, host: appConfig.host };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2));

  return defs;
}

function saveServerDefs() {
  fs.writeFileSync(SERVERS_PATH, JSON.stringify([...runtimes.values()].map((rt) => rt.cfg), null, 2));
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const MAX_LOG_LINES = 1000;

const PLAYER_LIST_REGEX = /There are (\d+)(?:\/| of a max of )(\d+) players online:?\s*(.*)$/i;
const JOIN_REGEX = /([A-Za-z0-9_]{1,16}) joined the game$/;
const LEAVE_REGEX = /([A-Za-z0-9_]{1,16}) left the game$/;
const VALID_PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/;
const EULA_REGEX = /You need to agree to the EULA/i;
const TPS_LINE_REGEX = /TPS from last ([^:]+):\s*(.+)/i;
const DONE_REGEX = /Done \(/;

function stripColorCodes(line) {
  return line.replace(/§[0-9a-fk-or]/gi, '').replace(/\*/g, '');
}

// Handles both Paper ("1m, 5m, 15m: 20.0, ...") and Purpur ("5s, 1m, 5m, 15m: 20,0, ...",
// comma as decimal separator) TPS output formats.
function parseTps(line) {
  const m = stripColorCodes(line).match(TPS_LINE_REGEX);
  if (!m) return null;
  const labels = m[1].split(',').map((s) => s.trim().toLowerCase());
  const values = (m[2].match(/\d+[.,]\d+/g) || []).map((v) => parseFloat(v.replace(',', '.')));
  if (values.length === 0) return null;
  const idx = labels.indexOf('1m');
  const value = idx >= 0 && idx < values.length ? values[idx] : values[0];
  return Number.isFinite(value) ? Math.min(20, Math.round(value * 10) / 10) : null;
}

// ---- Per-server runtime state ----
class ServerRuntime {
  constructor(cfg) {
    this.cfg = cfg;
    this.process = null;
    this.status = 'stopped'; // stopped | starting | running | stopping
    this.startedAt = null;
    this.pendingRestart = false;
    this.consoleHistory = [];
    this.players = null; // { online, max, names } - minecraft only
    this.playerSet = new Set();
    this.playersMax = null;
    this.eulaRequired = false;
    this.tps = null;
    this.serverFolderBytes = 0;
    this.networkOpen = false;
    this.lastPortCheckAt = 0;
  }
}

const runtimes = new Map(); // id -> ServerRuntime

for (const cfg of loadServerDefs()) {
  if (!cfg.limits) cfg.limits = { cpuMaxPercent: 100, ramMaxMB: null, storageMaxGB: null };
  runtimes.set(cfg.id, new ServerRuntime(cfg));
}

function summarize(rt) {
  return {
    id: rt.cfg.id,
    name: rt.cfg.name,
    game: rt.cfg.game,
    status: rt.status,
    players: rt.players,
    gamePort: rt.cfg.gamePort,
    pinned: !!rt.cfg.pinned,
    icon: rt.cfg.icon || null,
    color: rt.cfg.color || null,
  };
}

function broadcastServerList() {
  io.emit('servers:list', [...runtimes.values()].map(summarize));
}

function pushLog(rt, line, kind = 'info') {
  const entry = { line, kind, t: Date.now() };
  rt.consoleHistory.push(entry);
  if (rt.consoleHistory.length > MAX_LOG_LINES) rt.consoleHistory.shift();
  io.emit('console:line', { id: rt.cfg.id, entry });
}

function broadcastStatus(rt) {
  io.emit('status', {
    id: rt.cfg.id,
    status: rt.status,
    pid: rt.process ? rt.process.pid : null,
    startedAt: rt.startedAt,
  });
  broadcastServerList();
}

function emitPlayers(rt) {
  rt.players = rt.playerSet.size > 0 || rt.playersMax !== null
    ? { online: rt.playerSet.size, max: rt.playersMax, names: [...rt.playerSet] }
    : null;
  io.emit('players', { id: rt.cfg.id, players: rt.players });
  broadcastServerList();
}

function handleMinecraftLine(rt, l) {
  if (rt.status === 'starting' && DONE_REGEX.test(l)) {
    rt.status = 'running';
    broadcastStatus(rt);
  }

  const stripped = stripColorCodes(l);

  const joinMatch = JOIN_REGEX.exec(stripped);
  if (joinMatch) { rt.playerSet.add(joinMatch[1]); emitPlayers(rt); }

  const leaveMatch = LEAVE_REGEX.exec(stripped);
  if (leaveMatch) { rt.playerSet.delete(leaveMatch[1]); emitPlayers(rt); }

  const listMatch = stripped.match(PLAYER_LIST_REGEX);
  if (listMatch) {
    rt.playersMax = +listMatch[2];
    // Some plugins (e.g. TAB) reformat player names in "/list" output. Only trust the
    // parsed names when their count matches the announced online count, otherwise keep
    // relying on the join/leave-tracked set, which stays accurate either way.
    const parsedNames = (listMatch[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (+listMatch[1] === parsedNames.length) {
      rt.playerSet = new Set(parsedNames);
    }
    emitPlayers(rt);
  }

  const parsedTps = parseTps(l);
  if (parsedTps !== null) {
    rt.tps = parsedTps;
    io.emit('tps', { id: rt.cfg.id, tps: rt.tps });
  }

  if (EULA_REGEX.test(l)) {
    rt.eulaRequired = true;
    io.emit('eulaRequired', { id: rt.cfg.id, required: true });
  }
}

function buildLaunchSpec(cfg) {
  if (cfg.game === 'minecraft') {
    return {
      command: cfg.javaPath,
      args: [
        `-Xms${cfg.minRam}`,
        `-Xmx${cfg.maxRam}`,
        ...(cfg.extraJavaArgs || []),
        '-jar',
        cfg.jarName,
        'nogui',
      ],
      checkFiles: [cfg.javaPath, path.join(cfg.serverDir, cfg.jarName)],
    };
  }
  // Garry's Mod / generic executable-based server.
  return {
    command: path.isAbsolute(cfg.exePath) ? cfg.exePath : path.join(cfg.serverDir, cfg.exePath),
    args: cfg.launchArgs || [],
    checkFiles: [path.isAbsolute(cfg.exePath) ? cfg.exePath : path.join(cfg.serverDir, cfg.exePath)],
  };
}

function startServerRuntime(rt) {
  const cfg = rt.cfg;
  if (rt.process) {
    pushLog(rt, '[Dashboard] Le serveur tourne déjà.', 'warn');
    return;
  }
  if (!fs.existsSync(cfg.serverDir)) {
    pushLog(rt, `[Dashboard] Dossier serveur introuvable : ${cfg.serverDir}`, 'error');
    return;
  }
  const spec = buildLaunchSpec(cfg);
  for (const f of spec.checkFiles) {
    if (!fs.existsSync(f)) {
      pushLog(rt, `[Dashboard] Fichier introuvable : ${f}`, 'error');
      return;
    }
  }

  pushLog(rt, `[Dashboard] Démarrage : ${spec.command} ${spec.args.join(' ')}`, 'info');
  rt.status = 'starting';
  rt.eulaRequired = false;
  broadcastStatus(rt);

  rt.process = spawn(spec.command, spec.args, { cwd: cfg.serverDir });
  rt.startedAt = Date.now();
  rt.playerSet = new Set();
  rt.playersMax = null;
  rt.players = null;

  const onData = (kind) => (chunk) => {
    const text = chunk.toString();
    text.split(/\r?\n/).forEach((l) => {
      if (l.length === 0) return;
      pushLog(rt, l, kind);
      if (cfg.game === 'minecraft') handleMinecraftLine(rt, l);
    });
  };

  rt.process.stdout.on('data', onData('info'));
  rt.process.stderr.on('data', onData('error'));

  rt.process.on('exit', (code) => {
    pushLog(rt, `[Dashboard] Processus terminé (code ${code}).`, code === 0 ? 'info' : 'error');
    rt.process = null;
    rt.status = 'stopped';
    rt.startedAt = null;
    rt.playerSet = new Set();
    rt.playersMax = null;
    emitPlayers(rt);
    rt.tps = null;
    io.emit('tps', { id: cfg.id, tps: null });
    broadcastStatus(rt);
    if (rt.pendingRestart) {
      rt.pendingRestart = false;
      setTimeout(() => startServerRuntime(rt), 500);
    }
  });

  rt.process.on('error', (err) => {
    pushLog(rt, `[Dashboard] Erreur au lancement : ${err.message}`, 'error');
    rt.process = null;
    rt.status = 'stopped';
    broadcastStatus(rt);
  });
}

function stopServerRuntime(rt) {
  if (!rt.process) {
    pushLog(rt, '[Dashboard] Le serveur est déjà arrêté.', 'warn');
    return;
  }
  if (rt.status === 'stopping') {
    pushLog(rt, '[Dashboard] Arrêt déjà en cours...', 'warn');
    return;
  }
  rt.status = 'stopping';
  broadcastStatus(rt);
  const stopCmd = rt.cfg.game === 'minecraft' ? 'stop' : 'quit';
  pushLog(rt, `[Dashboard] Envoi de la commande "${stopCmd}"...`, 'info');
  rt.process.stdin.write(stopCmd + '\n');

  const pid = rt.process.pid;
  setTimeout(() => {
    if (rt.process && rt.process.pid === pid) {
      pushLog(rt, '[Dashboard] Le serveur ne répond pas, arrêt forcé.', 'warn');
      forceKillRuntime(rt, pid);
    }
  }, rt.cfg.stopTimeoutMs || 30000);
}

function restartServerRuntime(rt) {
  if (!rt.process) {
    startServerRuntime(rt);
    return;
  }
  rt.pendingRestart = true;
  pushLog(rt, '[Dashboard] Redémarrage demandé...', 'info');
  stopServerRuntime(rt);
}

function forceKillRuntime(rt, pid) {
  const targetPid = pid || (rt.process && rt.process.pid);
  if (!targetPid) {
    pushLog(rt, '[Dashboard] Aucun processus à tuer.', 'warn');
    return;
  }
  if (process.platform === 'win32') {
    exec(`taskkill /PID ${targetPid} /T /F`, (err) => {
      if (err) pushLog(rt, `[Dashboard] taskkill: ${err.message}`, 'error');
    });
  } else {
    try {
      process.kill(-targetPid, 'SIGKILL');
    } catch (e) {
      try { process.kill(targetPid, 'SIGKILL'); } catch (e2) {}
    }
  }
}

function killServerRuntime(rt) {
  if (!rt.process) {
    pushLog(rt, '[Dashboard] Le serveur est déjà arrêté.', 'warn');
    return;
  }
  pushLog(rt, '[Dashboard] KILL forcé du processus.', 'error');
  forceKillRuntime(rt, rt.process.pid);
}

function playerCommandRuntime(rt, player, action) {
  if (typeof player !== 'string' || !VALID_PLAYER_NAME.test(player)) return;
  switch (action) {
    case 'heal':
      sendCommandRuntime(rt, `effect give ${player} minecraft:instant_health 1 255 true`);
      break;
    case 'feed':
      sendCommandRuntime(rt, `effect give ${player} minecraft:saturation 1 255 true`);
      break;
    case 'kill':
      sendCommandRuntime(rt, `kill ${player}`);
      break;
  }
}

function sendCommandRuntime(rt, cmd) {
  if (!rt.process || !rt.process.stdin.writable) {
    pushLog(rt, "[Dashboard] Impossible d'envoyer la commande : serveur arrêté.", 'warn');
    return;
  }
  pushLog(rt, `> ${cmd}`, 'command');
  rt.process.stdin.write(cmd + '\n');
}

function acceptEulaRuntime(rt) {
  try {
    fs.writeFileSync(path.join(rt.cfg.serverDir, 'eula.txt'), 'eula=true\n');
    rt.eulaRequired = false;
    pushLog(rt, '[Dashboard] eula.txt mis à jour (eula=true).', 'info');
  } catch (e) {
    pushLog(rt, `[Dashboard] Impossible d'écrire eula.txt : ${e.message}`, 'error');
  }
}

// Poll "list" / "tps" silently (not echoed as a user command) to keep stats fresh.
setInterval(() => {
  for (const rt of runtimes.values()) {
    if (rt.cfg.game === 'minecraft' && rt.status === 'running' && rt.process && rt.process.stdin.writable) {
      rt.process.stdin.write('list\n');
    }
  }
}, 15000);

setInterval(() => {
  for (const rt of runtimes.values()) {
    if (rt.cfg.game === 'minecraft' && rt.status === 'running' && rt.process && rt.process.stdin.writable) {
      rt.process.stdin.write('tps\n');
    }
  }
}, 5000);

// ---- Stats loop ----
function driveRoot(p) {
  const root = path.parse(p).root; // e.g. "D:\\"
  return root.replace(/\\$/, ''); // "D:"
}

function parseRamString(str) {
  const m = /^(\d+(?:\.\d+)?)([GgMm])$/.exec(str || '');
  if (!m) return null;
  const value = parseFloat(m[1]);
  return m[2].toLowerCase() === 'g' ? value * 1e9 : value * 1e6;
}

function ramCeilingBytes(cfg) {
  if (cfg.limits && cfg.limits.ramMaxMB) return cfg.limits.ramMaxMB * 1e6;
  if (cfg.game === 'minecraft') return parseRamString(cfg.maxRam);
  return null;
}

// Recursively sums file sizes under a directory (async, non-blocking).
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch (e) {
        // file may have been deleted/rotated mid-scan, ignore
      }
    }
  }
  return total;
}

// Walking the whole server folder (world saves, etc.) on every 2s tick would be too slow,
// so it's measured on its own slower timer and cached, per server.
async function measureServerFolders() {
  for (const rt of runtimes.values()) {
    rt.serverFolderBytes = await dirSize(rt.cfg.serverDir);
  }
}
measureServerFolders();
setInterval(measureServerFolders, 20000);

// Real TCP check (works for Minecraft). Source-engine (GMod) traffic is UDP and can't be
// verified this way, so callers fall back to the process status for that case instead.
function checkPortOpen(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function pollStats() {
  let fsSizes;
  try {
    fsSizes = await si.fsSize();
  } catch (e) {
    return;
  }

  for (const rt of runtimes.values()) {
    try {
      const cfg = rt.cfg;
      const drive = driveRoot(cfg.serverDir);
      let disk = fsSizes.find((d) => d.mount && d.mount.toUpperCase().startsWith(drive.toUpperCase()));
      if (!disk) disk = fsSizes[0];

      let cpuPercent = 0;
      let ramBytes = 0;
      if (rt.process) {
        try {
          const stats = await pidusage(rt.process.pid);
          cpuPercent = Math.round(stats.cpu * 10) / 10;
          ramBytes = stats.memory;
        } catch (e) {
          // process may have just exited, ignore
        }
      }

      const ramMax = ramCeilingBytes(cfg);
      const cpuMax = (cfg.limits && cfg.limits.cpuMaxPercent) || 100;
      const storageMaxBytes = cfg.limits && cfg.limits.storageMaxGB ? cfg.limits.storageMaxGB * 1e9 : (disk ? disk.size : null);

      // Opening a TCP probe socket every 2s tick is unnecessary overhead — the port's
      // state doesn't change that fast, so it's only re-checked every ~10s and cached
      // in between (immediately false when the process isn't even running).
      if (rt.status !== 'running') {
        rt.networkOpen = false;
      } else if (cfg.game !== 'minecraft') {
        rt.networkOpen = true;
      } else if (Date.now() - rt.lastPortCheckAt > 10000) {
        rt.lastPortCheckAt = Date.now();
        rt.networkOpen = await checkPortOpen(cfg.gamePort);
      }

      io.emit('stats', {
        id: cfg.id,
        cpu: cpuPercent,
        cpuPercentOfMax: Math.min(100, Math.round((cpuPercent / cpuMax) * 1000) / 10),
        ramBytes,
        ramPercentOfMax: ramMax ? Math.min(100, Math.round((ramBytes / ramMax) * 1000) / 10) : null,
        disk: disk
          ? {
              serverFolderGB: +(rt.serverFolderBytes / 1e9).toFixed(2),
              percentOfDisk: storageMaxBytes ? Math.min(100, Math.round((rt.serverFolderBytes / storageMaxBytes) * 1000) / 10) : 0,
              totalGB: +((storageMaxBytes || disk.size) / 1e9).toFixed(1),
              mount: disk.mount,
            }
          : null,
        network: { port: cfg.gamePort, open: rt.networkOpen },
        players: rt.players,
      });
    } catch (e) {
      // ignore transient per-server stats errors
    }
  }
}
setInterval(pollStats, 2000);

// ---- Server registry management ----
function publicConfig(cfg) {
  return {
    id: cfg.id,
    name: cfg.name,
    game: cfg.game,
    serverDir: cfg.serverDir,
    gamePort: cfg.gamePort,
    jarName: cfg.jarName,
    javaPath: cfg.javaPath,
    minRam: cfg.minRam,
    maxRam: cfg.maxRam,
    extraJavaArgs: cfg.extraJavaArgs || [],
    exePath: cfg.exePath,
    launchArgs: cfg.launchArgs || [],
    stopTimeoutMs: cfg.stopTimeoutMs,
    limits: cfg.limits,
    icon: cfg.icon || null,
    color: cfg.color || null,
  };
}

function createServer(payload = {}) {
  const name = (payload.name || '').trim();
  const game = VALID_GAMES.has(payload.game) ? payload.game : 'minecraft';
  if (!name || !payload.serverDir) return { error: 'Nom et dossier serveur requis.' };

  let id = slugify(name);
  let suffix = 2;
  while (runtimes.has(id)) { id = `${slugify(name)}-${suffix++}`; }

  const isMinecraft = game === 'minecraft';
  const defaults = GAME_DEFAULTS[game] || {};

  const cfg = {
    id,
    name,
    game,
    serverDir: payload.serverDir,
    gamePort: Number(payload.gamePort) || defaults.port || 25565,
    jarName: isMinecraft ? (payload.jarName || 'server.jar') : null,
    javaPath: isMinecraft ? (payload.javaPath || '') : null,
    minRam: isMinecraft ? (payload.minRam || '1G') : null,
    maxRam: isMinecraft ? (payload.maxRam || '4G') : null,
    extraJavaArgs: isMinecraft ? [] : [],
    exePath: isMinecraft ? null : (payload.exePath || defaults.exePath || ''),
    launchArgs: isMinecraft ? [] : (defaults.launchArgs || []),
    stopTimeoutMs: 30000,
    limits: { cpuMaxPercent: 100, ramMaxMB: null, storageMaxGB: null },
    pinned: false,
    icon: (payload.icon || '').trim() || null,
    color: (payload.color || '').trim() || null,
  };

  runtimes.set(id, new ServerRuntime(cfg));
  saveServerDefs();
  broadcastServerList();
  return { id };
}

function toggleServerPin(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  rt.cfg.pinned = !rt.cfg.pinned;
  saveServerDefs();
  broadcastServerList();
}

function reorderServers(orderedIds) {
  if (!Array.isArray(orderedIds)) return;
  const reordered = new Map();
  for (const id of orderedIds) {
    if (runtimes.has(id)) reordered.set(id, runtimes.get(id));
  }
  // Any id not included (out of sync client, concurrent create/delete) keeps its relative place at the end.
  for (const [id, rt] of runtimes) {
    if (!reordered.has(id)) reordered.set(id, rt);
  }
  runtimes.clear();
  for (const [id, rt] of reordered) runtimes.set(id, rt);
  saveServerDefs();
  broadcastServerList();
}

function deleteServer(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  if (rt.process) forceKillRuntime(rt);
  runtimes.delete(id);
  saveServerDefs();
  broadcastServerList();
}

function updateServerSettings(id, patch = {}) {
  const rt = runtimes.get(id);
  if (!rt) return;
  const cfg = rt.cfg;
  const editable = [
    'name', 'gamePort', 'jarName', 'javaPath', 'minRam', 'maxRam',
    'extraJavaArgs', 'exePath', 'launchArgs', 'stopTimeoutMs', 'icon', 'color',
  ];
  for (const key of editable) {
    if (patch[key] !== undefined) cfg[key] = patch[key];
  }
  if (patch.limits) {
    cfg.limits = { ...cfg.limits, ...patch.limits };
  }
  saveServerDefs();
  io.emit('config', { id, config: publicConfig(cfg) });
  broadcastServerList();
  pushLog(rt, '[Dashboard] Paramètres mis à jour (appliqués au prochain démarrage).', 'info');
}

// ---- Config file editor ----
const EDITABLE_EXTENSIONS = new Set(['.properties', '.json', '.yml', '.yaml', '.txt', '.cfg', '.toml', '.conf', '.ini']);
const MAX_EDITABLE_FILE_BYTES = 512 * 1024;
const CONFIG_SCAN_SKIP_DIRS = new Set(['libraries', 'cache', 'logs', '.git', 'versions']);
const CONFIG_SCAN_MAX_DEPTH = 5;
const CONFIG_SCAN_MAX_FILES = 300;

// A Minecraft world save folder is recognizable by its level.dat — skip those entirely,
// they hold thousands of unrelated region/chunk files, not configuration.
function isWorldFolder(dirPath) {
  try {
    return fs.existsSync(path.join(dirPath, 'level.dat'));
  } catch (e) {
    return false;
  }
}

// Recurses into the server directory (bounded depth/count) so configs living in
// subfolders (plugins/<name>/config.yml, cfg/server.cfg, config/paper-global.yml...)
// show up too, not just files sitting directly at the root.
// Breadth-first: fully drains each depth level before descending further, so root-level
// files (the ones you actually care about, like server.properties) can never get starved
// out of the CONFIG_SCAN_MAX_FILES budget by a deep dive into one large subfolder.
function listConfigFiles(rootDir) {
  const results = [];
  const queue = [{ dir: rootDir, rel: '', depth: 0 }];
  while (queue.length > 0 && results.length < CONFIG_SCAN_MAX_FILES) {
    const { dir, rel, depth } = queue.shift();
    if (depth > CONFIG_SCAN_MAX_DEPTH) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= CONFIG_SCAN_MAX_FILES) break;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (CONFIG_SCAN_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        const full = path.join(dir, entry.name);
        if (isWorldFolder(full)) continue;
        queue.push({ dir: full, rel: relPath, depth: depth + 1 });
      } else if (entry.isFile() && EDITABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(relPath);
      }
    }
  }
  return results.sort();
}

// Accepts relative sub-paths (e.g. "plugins/EssentialsX/config.yml") but verifies the
// resolved, normalized path still lives inside serverDir before returning it, which is
// what actually blocks traversal — merely rejecting ".." substrings isn't enough once
// subfolders are allowed.
function safeConfigFilePath(serverDir, filename) {
  if (typeof filename !== 'string' || !filename) return null;
  const root = path.resolve(serverDir);
  const full = path.resolve(root, filename);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function readConfigFile(rt, filename) {
  const full = safeConfigFilePath(rt.cfg.serverDir, filename);
  if (!full) return { error: 'Nom de fichier invalide.' };
  try {
    const stat = fs.statSync(full);
    if (stat.size > MAX_EDITABLE_FILE_BYTES) return { error: 'Fichier trop volumineux pour l\'éditeur (>512 Ko).' };
    return { content: fs.readFileSync(full, 'utf8') };
  } catch (e) {
    return { error: e.message };
  }
}

function writeConfigFile(rt, filename, content) {
  const full = safeConfigFilePath(rt.cfg.serverDir, filename);
  if (!full || typeof content !== 'string') return { error: 'Requête invalide.' };
  try {
    fs.writeFileSync(full, content, 'utf8');
    pushLog(rt, `[Dashboard] Fichier ${filename} modifié via l'éditeur.`, 'info');
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ---- Socket.io wiring ----
io.on('connection', (socket) => {
  socket.emit('servers:list', [...runtimes.values()].map(summarize));

  socket.on('servers:create', (payload, ack) => {
    const result = createServer(payload || {});
    if (typeof ack === 'function') ack(result);
  });

  socket.on('servers:delete', ({ id } = {}) => deleteServer(id));

  socket.on('servers:togglePin', ({ id } = {}) => toggleServerPin(id));

  socket.on('servers:reorder', ({ order } = {}) => reorderServers(order));

  socket.on('servers:updateSettings', ({ id, patch } = {}) => updateServerSettings(id, patch || {}));

  socket.on('server:join', ({ id } = {}) => {
    const rt = runtimes.get(id);
    if (!rt) return;
    socket.emit('console:history', { id, history: rt.consoleHistory });
    socket.emit('status', { id, status: rt.status, pid: rt.process ? rt.process.pid : null, startedAt: rt.startedAt });
    socket.emit('config', { id, config: publicConfig(rt.cfg) });
    socket.emit('players', { id, players: rt.players });
    socket.emit('tps', { id, tps: rt.tps });
    if (rt.eulaRequired) socket.emit('eulaRequired', { id, required: true });
  });

  socket.on('files:list', ({ id } = {}, ack) => {
    const rt = runtimes.get(id);
    if (typeof ack !== 'function') return;
    if (!rt) { ack({ error: 'Serveur introuvable.' }); return; }
    try {
      ack({ files: listConfigFiles(rt.cfg.serverDir) });
    } catch (e) {
      ack({ error: e.message });
    }
  });

  socket.on('files:read', ({ id, filename } = {}, ack) => {
    const rt = runtimes.get(id);
    if (typeof ack !== 'function') return;
    if (!rt) { ack({ error: 'Serveur introuvable.' }); return; }
    ack(readConfigFile(rt, filename));
  });

  socket.on('files:write', ({ id, filename, content } = {}, ack) => {
    const rt = runtimes.get(id);
    if (typeof ack !== 'function') return;
    if (!rt) { ack({ error: 'Serveur introuvable.' }); return; }
    ack(writeConfigFile(rt, filename, content));
  });

  socket.on('action:start', ({ id } = {}) => { const rt = runtimes.get(id); if (rt) startServerRuntime(rt); });
  socket.on('action:stop', ({ id } = {}) => { const rt = runtimes.get(id); if (rt) { rt.pendingRestart = false; stopServerRuntime(rt); } });
  socket.on('action:restart', ({ id } = {}) => { const rt = runtimes.get(id); if (rt) restartServerRuntime(rt); });
  socket.on('action:kill', ({ id } = {}) => { const rt = runtimes.get(id); if (rt) { rt.pendingRestart = false; killServerRuntime(rt); } });
  socket.on('action:acceptEula', ({ id } = {}) => { const rt = runtimes.get(id); if (rt) acceptEulaRuntime(rt); });
  socket.on('action:playerCommand', ({ id, player, action } = {}) => { const rt = runtimes.get(id); if (rt) playerCommandRuntime(rt, player, action); });
  socket.on('command', ({ id, cmd } = {}) => {
    const rt = runtimes.get(id);
    if (rt && typeof cmd === 'string' && cmd.trim().length > 0) sendCommandRuntime(rt, cmd.trim());
  });
});

server.listen(appConfig.dashboardPort, appConfig.host, () => {
  console.log(`OERIA - DSM disponible sur http://${appConfig.host}:${appConfig.dashboardPort}`);
});
