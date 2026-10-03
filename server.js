const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, exec, execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
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
  wow: { port: 8085, exePath: 'worldserver.exe', launchArgs: [] },
  hytale: { port: 5520 },
};
const VALID_GAMES = new Set(['minecraft', ...Object.keys(GAME_DEFAULTS)]);

// Expansion targeted by the emulator core (TrinityCore/AzerothCore/CMaNGOS...) running in
// the server's folder. Purely descriptive metadata — it doesn't change how the process is
// launched, but lets the dashboard show/filter servers by expansion.
const WOW_VERSIONS = new Set([
  'vanilla', 'tbc', 'wotlk', 'cata', 'mop', 'wod', 'legion', 'bfa', 'shadowlands', 'dragonflight', 'thewarwithin',
]);
const DEFAULT_WOW_VERSION = 'wotlk';

// A WoW server needs two binaries to actually be playable: the login/realmlist server and
// the world server. Different cores name them differently (TrinityCore/AzerothCore vs.
// MaNGOS), so the folder is scanned for either pair instead of asking the user to type paths.
const WOW_EXE_CANDIDATES = {
  world: ['worldserver.exe', 'mangosd.exe'],
  auth: ['authserver.exe', 'realmd.exe'],
};

function detectWowExecutables(serverDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(serverDir);
  } catch (e) {
    return { worldExe: null, authExe: null };
  }
  const byLowerName = new Map(entries.map((f) => [f.toLowerCase(), f]));
  const findFirst = (candidates) => candidates.map((c) => byLowerName.get(c)).find(Boolean) || null;
  return {
    worldExe: findFirst(WOW_EXE_CANDIDATES.world),
    authExe: findFirst(WOW_EXE_CANDIDATES.auth),
  };
}

// ---- WoW automated build (compile a core from source into the server folder) ----
// Neither TrinityCore, AzerothCore nor CMaNGOS publish precompiled binaries, so "installing" a
// WoW server means cloning the official source and compiling it with CMake + MSBuild.
// WotLK (AzerothCore) is the one path that's been fully exercised end-to-end; the CMaNGOS-based
// entries follow the same pipeline (same vcpkg toolchain, same generic CMake configure/build
// shape) but haven't been build-tested by us — a first attempt may surface a project-specific
// wrinkle the same way AzerothCore did, which the build log will show clearly enough to fix.
// CMaNGOS's own dep/CMakeLists.txt hooks add_library()/add_executable() the same way vcpkg's
// toolchain does (both preserve "the previous definition" under a leading-underscore name) —
// the collision between the two is patched out post-clone (see patchCmangosAddLibraryRecursion)
// rather than avoided, so all of these use the same vcpkg toolchain injection as AzerothCore.
const WOW_BUILD_REPOS = {
  vanilla: {
    label: 'CMaNGOS (Vanilla 1.12)',
    url: 'https://github.com/cmangos/mangos-classic.git',
    branch: 'master',
    targets: ['mangosd', 'realmd'],
    exeNames: ['mangosd.exe', 'realmd.exe'],
  },
  tbc: {
    label: 'CMaNGOS (TBC 2.4.3)',
    url: 'https://github.com/cmangos/mangos-tbc.git',
    branch: 'master',
    targets: ['mangosd', 'realmd'],
    exeNames: ['mangosd.exe', 'realmd.exe'],
  },
  wotlk: {
    label: 'AzerothCore (WotLK 3.3.5a)',
    url: 'https://github.com/azerothcore/azerothcore-wotlk.git',
    branch: 'master',
    targets: ['authserver', 'worldserver'],
    exeNames: ['authserver.exe', 'worldserver.exe'],
    extraConfigureArgs: ['-DTOOLS=0', '-DSCRIPTS=static'],
  },
  cata: {
    label: 'CMaNGOS (Cataclysm 4.3.4)',
    url: 'https://github.com/cmangos/mangos-cata.git',
    branch: 'master',
    targets: ['mangosd', 'realmd'],
    exeNames: ['mangosd.exe', 'realmd.exe'],
  },
  // Official MaNGOS lineage (getmangos.eu) for MoP, but the project labels itself "Early Alpha"
  // — genuinely less mature than the others here, not just "untested by us".
  mop: {
    label: 'MaNGOS Four (MoP 5.4.8, Early Alpha)',
    url: 'https://github.com/mangosfour/server.git',
    branch: 'master',
    targets: ['mangosd', 'realmd'],
    exeNames: ['mangosd.exe', 'realmd.exe'],
  },
};

// MySQL still comes from a pinned, verified direct download — it's a plain ZIP of
// precompiled dev libraries, no installer/GUI involved, so it isn't fragile like the Boost/
// OpenSSL installers turned out to be (see vcpkg note below). Extracted next to the dashboard
// itself (like vcpkg) rather than to C:\ — the system drive can be nearly full on some
// machines while the drive hosting the dashboard/game servers has plenty of room.
const WOW_DEPS = {
  mysql: {
    url: 'https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.11-winx64.zip',
    zipName: 'mysql-8.4.11-winx64.zip',
    extractedName: 'mysql-8.4.11-winx64',
    installDir: path.join(__dirname, '.wow-mysql', 'MySQL Server 8.4'),
  },
};

// A single shared MySQL instance (one per dashboard, not per WoW server) backs every WoW
// server's databases — AzerothCore's default configs all point at the same
// 127.0.0.1:3306/acore login regardless of which server folder they live in.
const WOW_MYSQL_DATA_DIR = path.join(path.parse(__dirname).root, '.oeria-dsm-wow-mysql-data');
const WOW_MYSQL_PORT = 3306;

// Boost and OpenSSL come via vcpkg instead of their official GUI installers: those are Inno
// Setup installers that proved unreliable to drive unattended (silently picking a dialog's
// default answer — e.g. "Abort" — and exiting non-zero for no visible reason). vcpkg is a
// pure command-line tool with no such surprises. Shared under the dashboard's own folder
// (not per-server) so the Boost/OpenSSL build — the slow part — only happens once.
const VCPKG_DIR = path.join(__dirname, '.wow-vcpkg');
const VCPKG_TRIPLET = 'x64-windows-static-md';

// The plain "boost" vcpkg port pulls in every Boost library, including boost-python — which
// drags in Python/libffi built via an autoconf ./configure script that doesn't work in vcpkg's
// plain MSVC environment. AzerothCore doesn't need Python at all, so instead this installs only
// the specific libraries it actually requires: filesystem/program-options/iostreams/regex/thread
// are the ones deps/boost/CMakeLists.txt links against, the rest are headers included directly
// in src/ (confirmed by grepping the cloned source for every "#include <boost/...>").
// boost-serialization is added on top of AzerothCore's own list because the CMaNGOS-family
// cores (vanilla/tbc/cata) require it too: find_package(Boost COMPONENTS ... serialization ...).
const VCPKG_BOOST_PORTS = [
  'boost-filesystem', 'boost-program-options', 'boost-iostreams', 'boost-regex', 'boost-thread',
  'boost-algorithm', 'boost-asio', 'boost-container', 'boost-dll', 'boost-heap',
  'boost-iterator', 'boost-lexical-cast', 'boost-preprocessor', 'boost-process', 'boost-stacktrace',
  'boost-serialization',
];

function commandExists(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// CMake ships bundled with Visual Studio's C++ workload but isn't necessarily on PATH.
function findVsBundledCmake() {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!fs.existsSync(vswhere)) return null;
  try {
    const installPath = execFileSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
    if (!installPath) return null;
    const candidate = path.join(installPath, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe');
    return fs.existsSync(candidate) ? candidate : null;
  } catch (e) {
    return null;
  }
}

function hasVsCppWorkload() {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!fs.existsSync(vswhere)) return false;
  try {
    const out = execFileSync(vswhere, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' }).trim();
    return !!out;
  } catch (e) {
    return false;
  }
}

// Checks our own extraction spot next to the dashboard first, then falls back to recognizing
// a manually-installed MySQL (Program Files, or the plain "C:/MySQL" layout some guides use).
function findMySqlRoot() {
  if (fs.existsSync(path.join(WOW_DEPS.mysql.installDir, 'include', 'mysql.h'))) return WOW_DEPS.mysql.installDir;
  if (commandExists('mysql')) return 'PATH';
  for (const base of ['C:\\MySQL', 'C:\\Program Files\\MySQL']) {
    try {
      const match = fs.readdirSync(base).filter((n) => /^MySQL Server/i.test(n)).sort().pop();
      if (match) return path.join(base, match);
    } catch (e) {}
  }
  return null;
}

function checkWowBuildPrerequisites() {
  const missing = [];
  if (!commandExists('git')) missing.push('Git (git-scm.com)');
  const cmakeExe = commandExists('cmake') ? 'cmake' : findVsBundledCmake();
  if (!cmakeExe) missing.push('CMake');
  if (!hasVsCppWorkload()) missing.push('Visual Studio avec le composant "Desktop development with C++"');
  // Boost/OpenSSL (via vcpkg) and MySQL are handled separately: if missing, the build pipeline
  // installs them itself rather than failing here (git/cmake/VS are too heavy to automate safely).
  return {
    ok: missing.length === 0,
    missing,
    cmakeExe,
    mysqlRoot: findMySqlRoot(),
  };
}

// Breadth-first search bounded like listConfigFiles() above — the build tree can be huge
// (git history, intermediate object files) and we only need the handful of files sitting
// next to the compiled executables.
function findFilesRecursive(rootDir, wantedLowerNames, maxDepth = 6) {
  const found = [];
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        queue.push({ dir: full, depth: depth + 1 });
      } else if (wantedLowerNames.has(entry.name.toLowerCase())) {
        found.push(full);
      }
    }
  }
  return found;
}

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
app.get('/api/app-info', (req, res) => res.json({ version: appConfig.version || '0.1.0' }));

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
    this.authProcess = null; // WoW only: authserver/realmd, launched alongside the world server
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
  if (cfg.game === 'hytale') {
    // Official launch shape per Hypixel Studios' server manual:
    // java -jar HytaleServer.jar --assets Assets.zip --bind 0.0.0.0:<port>
    return {
      command: cfg.javaPath,
      args: [
        `-Xms${cfg.minRam}`,
        `-Xmx${cfg.maxRam}`,
        ...(cfg.extraJavaArgs || []),
        '-jar',
        cfg.jarName,
        '--assets',
        cfg.assetsPath,
        '--bind',
        `0.0.0.0:${cfg.gamePort}`,
      ],
      checkFiles: [cfg.javaPath, path.join(cfg.serverDir, cfg.jarName), cfg.assetsPath],
    };
  }
  // Garry's Mod / generic executable-based server.
  return {
    command: path.isAbsolute(cfg.exePath) ? cfg.exePath : path.join(cfg.serverDir, cfg.exePath),
    args: cfg.launchArgs || [],
    checkFiles: [path.isAbsolute(cfg.exePath) ? cfg.exePath : path.join(cfg.serverDir, cfg.exePath)],
  };
}

// WoW's login/realmlist server (authserver/realmd) runs as a second, independent process
// alongside the world server. Optional: some setups run auth on a separate machine, so a
// missing binary just means "world-only" rather than a hard error.
function buildWowAuthLaunchSpec(cfg) {
  if (!cfg.authExePath) return null;
  const command = path.isAbsolute(cfg.authExePath) ? cfg.authExePath : path.join(cfg.serverDir, cfg.authExePath);
  return { command, args: [] };
}

function broadcastAuthStatus(rt) {
  io.emit('authStatus', { id: rt.cfg.id, status: rt.authProcess ? 'running' : 'stopped' });
}

function startWowAuthProcess(rt) {
  const cfg = rt.cfg;
  if (rt.authProcess) return;
  const spec = buildWowAuthLaunchSpec(cfg);
  if (!spec || !fs.existsSync(spec.command)) {
    pushLog(rt, "[Dashboard] Aucun serveur d'authentification (authserver/realmd) trouvé, seul le monde a été démarré.", 'warn');
    return;
  }

  pushLog(rt, `[Dashboard] Démarrage du serveur d'authentification : ${spec.command}`, 'info');
  rt.authProcess = spawn(spec.command, spec.args, { cwd: cfg.serverDir });
  broadcastAuthStatus(rt);

  const onAuthData = (kind) => (chunk) => {
    chunk.toString().split(/\r?\n/).forEach((l) => {
      if (l.length === 0) return;
      pushLog(rt, `[Auth] ${l}`, kind);
    });
  };
  rt.authProcess.stdout.on('data', onAuthData('info'));
  rt.authProcess.stderr.on('data', onAuthData('error'));

  rt.authProcess.on('exit', (code) => {
    pushLog(rt, `[Dashboard] Serveur d'authentification arrêté (code ${code}).`, code === 0 ? 'info' : 'warn');
    rt.authProcess = null;
    broadcastAuthStatus(rt);
  });
  rt.authProcess.on('error', (err) => {
    pushLog(rt, `[Dashboard] Erreur au lancement du serveur d'authentification : ${err.message}`, 'error');
    rt.authProcess = null;
    broadcastAuthStatus(rt);
  });
}

// ---- WoW: shared MySQL instance ----
function runCommandAsync(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) { resolve(); return; }
      const detail = stderr.trim().split('\n').pop();
      reject(new Error(`${command} a échoué (code ${code})${detail ? ` : ${detail.slice(0, 300)}` : '.'}`));
    });
  });
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} a échoué (code ${code}).`))));
  });
}

// Streaming the file into mysql's stdin (rather than `-e "source <path>"`) sidesteps any
// escaping/backslash issues with Windows paths and works regardless of file size.
function runMysqlImport(mysqlCliExe, dbName, sqlFilePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(mysqlCliExe, ['-h', '127.0.0.1', '-P', String(WOW_MYSQL_PORT), '-u', 'root', dbName]);
    fs.createReadStream(sqlFilePath).pipe(proc.stdin);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(sqlFilePath)} (code ${code}): ${stderr.slice(0, 300)}`))));
  });
}

// mysqld intermittently fails its very first startup right after --initialize-insecure with a
// spurious "UNDO tablespace already exists" error (a known flaky Windows/InnoDB issue, most
// likely antivirus real-time scanning briefly locking the freshly-written tablespace files) —
// it reliably works within a couple of retries, so failure here just means "try spawning again"
// rather than a real problem with the install.
// "Didn't crash within N ms" is not the same as "is accepting connections" — mysqld can take
// well over 4s to finish initializing its listener (slower disk, antivirus scanning, a machine
// still busy from the build that just finished), and reporting ready too early just moves this
// same failure to whatever tries to connect next (the game server, or our own db bootstrap SQL).
// So this polls the port itself instead of trusting a fixed grace period.
function trySpawnMysqldOnce(mysqldExe, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(mysqldExe, [
      `--datadir=${WOW_MYSQL_DATA_DIR}`,
      `--basedir=${WOW_DEPS.mysql.installDir}`,
      `--port=${WOW_MYSQL_PORT}`,
      '--bind-address=127.0.0.1',
    ], { stdio: 'ignore', detached: true });
    proc.unref();
    let exited = false;
    proc.once('exit', () => { exited = true; });
    proc.once('error', () => { exited = true; });

    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      if (exited) { reject(new Error('mysqld a quitté immédiatement')); return; }
      if (await checkPortOpen(WOW_MYSQL_PORT, 500)) { resolve(proc); return; }
      if (Date.now() >= deadline) { reject(new Error("mysqld n'écoute toujours pas sur le port après le délai imparti")); return; }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 500);
  });
}

let wowMysqlEnsurePromise = null;

// Each core family expects its own MySQL user/database names — AzerothCore always uses
// acore/acore_*, CMaNGOS always uses mangos/mangos but the database name *prefix* varies by
// expansion (confirmed so far only for vanilla; tbc/cata are a best guess). The wildcard grant
// on `%`.* means even an unlisted/guessed-wrong database name still lets that user connect and
// self-provision it, rather than failing outright — only vanilla's names are pinned exactly
// since those were confirmed from a real generated .conf file.
const WOW_DB_BOOTSTRAP = {
  wotlk: { user: 'acore', password: 'acore', databases: ['acore_auth', 'acore_world', 'acore_characters'] },
  vanilla: { user: 'mangos', password: 'mangos', databases: ['classicrealmd', 'classicmangos', 'classiccharacters', 'classiclogs'] },
  tbc: { user: 'mangos', password: 'mangos', databases: [] },
  cata: { user: 'mangos', password: 'mangos', databases: [] },
  mop: { user: 'mangos', password: 'mangos', databases: [] },
};

// Idempotent (CREATE ... IF NOT EXISTS throughout) and cheap, so it's safe to run on every
// server start rather than only the first time MySQL itself is initialized — otherwise a
// second WoW server using a different core family than the first would never get its own
// user/databases created, since MySQL would already be running and skip past that step.
async function mysqlIsDatabaseEmpty(mysqlCliExe, dbName) {
  const out = await runCommandCapture(mysqlCliExe, [
    '-h', '127.0.0.1', '-P', String(WOW_MYSQL_PORT), '-u', 'root', '-N', '-B', '-e',
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${dbName}';`,
  ]);
  return parseInt(out.trim(), 10) === 0;
}

// Unlike AzerothCore, CMaNGOS's own binaries never create or update their schema — the error
// message it prints literally says "Reinstall your database with the included sql file".
// Admins normally do this by hand (sql/base/<name>.sql, then every sql/updates/<name>/*.sql in
// order); automated here instead, gated on the database actually being empty so it only runs
// once. WOW_CMANGOS_SQL_MAP's values are the base filename/subfolder name — the CMaNGOS
// convention keeps these the same (realmd/mangos/characters/logs) across expansions, only the
// database *name* prefix (classicrealmd, tbcrealmd, ...) is expected to change.
const WOW_CMANGOS_SQL_MAP = { realmd: 'realmd', mangos: 'mangos', characters: 'characters', logs: 'logs' };
// Table holding the single `required_<last-applied-update-filename>` tracking column — every
// core follows the "<base>_db_version" pattern except the world db, which is just "db_version".
const WOW_CMANGOS_VERSION_TABLE = { realmd: 'realmd_db_version', mangos: 'db_version', characters: 'character_db_version', logs: 'logs_db_version' };

// Unlike the other CMaNGOS-family cores, mop's source repo (mangosfour/server) doesn't bundle a
// sql/ folder at all — its schema lives in a separate repo with its own Setup/Updates layout per
// database, and "Realm" is itself a nested submodule of that repo (mangos/Realm_DB).
const MANGOSFOUR_DB_REPO = { url: 'https://github.com/mangosfour/database.git', branch: 'master' };
// Keyed by the same baseName patchWowConfDatabaseCredentials() already derives from each
// *DatabaseInfo line (realmd/mangos/characters), so the two line up without a separate mapping.
const MANGOSFOUR_DB_LAYOUT = {
  realmd: { folder: 'Realm', loadFile: 'realmdLoadDB.sql' },
  mangos: { folder: 'World', loadFile: 'mangosdLoadDB.sql', fullDbDir: 'FullDB' },
  characters: { folder: 'Character', loadFile: 'characterLoadDB.sql' },
};

// Update files live under "<folder>/Updates/<release>/*.sql" (e.g. Rel22, Rel23, one folder per
// past release); applied oldest-release-first, alphabetically within each, same order the
// project's own InstallDatabases.sh uses.
function listMangosFourUpdateFiles(dbRepoDir, folder) {
  const updatesDir = path.join(dbRepoDir, folder, 'Updates');
  let releaseDirs;
  try {
    releaseDirs = fs.readdirSync(updatesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (e) {
    return [];
  }
  const files = [];
  for (const rel of releaseDirs) {
    const relDir = path.join(updatesDir, rel);
    for (const f of fs.readdirSync(relDir).filter((f) => f.endsWith('.sql')).sort()) {
      files.push(path.join(relDir, f));
    }
  }
  return files;
}

async function ensureMangosFourWorldData(rt, mysqlCliExe, discovered) {
  const dbRepoDir = path.join(rt.cfg.serverDir, '_build', 'database');
  if (!fs.existsSync(path.join(dbRepoDir, '.git'))) {
    pushLog(rt, '[Dashboard] Téléchargement de la base de données MaNGOS Four (mangosfour/database, peut prendre quelques minutes)...', 'info');
    try {
      await runCommandAsync('git', [
        'clone', '--depth', '1', '--recurse-submodules', '--shallow-submodules',
        '--branch', MANGOSFOUR_DB_REPO.branch, MANGOSFOUR_DB_REPO.url, dbRepoDir,
      ]);
    } catch (e) {
      pushLog(rt, `[Dashboard] Échec du téléchargement de la base de données MaNGOS Four : ${e.message}`, 'error');
      return;
    }
  }

  for (const { dbName, baseName } of discovered) {
    const layout = MANGOSFOUR_DB_LAYOUT[baseName];
    if (!layout) continue;
    let isEmpty;
    try {
      isEmpty = await mysqlIsDatabaseEmpty(mysqlCliExe, dbName);
    } catch (e) {
      pushLog(rt, `[Dashboard] Impossible de vérifier si ${dbName} est vide : ${e.message}`, 'warn');
      continue;
    }
    if (!isEmpty) continue;

    pushLog(rt, `[Dashboard] Création de la structure de ${dbName}...`, 'info');
    try {
      await runMysqlImport(mysqlCliExe, dbName, path.join(dbRepoDir, layout.folder, 'Setup', layout.loadFile));
    } catch (e) {
      pushLog(rt, `[Dashboard] Échec de la création de la structure de ${dbName} : ${e.message}`, 'error');
      continue;
    }

    if (layout.fullDbDir) {
      const fullDbDir = path.join(dbRepoDir, layout.folder, 'Setup', layout.fullDbDir);
      let fullFiles = [];
      try {
        fullFiles = fs.readdirSync(fullDbDir).filter((f) => f.endsWith('.sql')).sort();
      } catch (e) {}
      if (fullFiles.length > 0) {
        pushLog(rt, `[Dashboard] Import du contenu du monde pour ${dbName} (${fullFiles.length} fichiers, peut prendre plusieurs minutes)...`, 'info');
        for (const f of fullFiles) {
          try {
            await runMysqlImport(mysqlCliExe, dbName, path.join(fullDbDir, f));
          } catch (e) {
            pushLog(rt, `[Dashboard] Échec de l'import de ${f} pour ${dbName} : ${e.message}`, 'warn');
          }
        }
      }
    }

    const updateFiles = listMangosFourUpdateFiles(dbRepoDir, layout.folder);
    if (updateFiles.length > 0) {
      pushLog(rt, `[Dashboard] Application de ${updateFiles.length} mise(s) à jour SQL pour ${dbName}...`, 'info');
      for (const f of updateFiles) {
        try {
          await runMysqlImport(mysqlCliExe, dbName, f);
        } catch (e) {
          pushLog(rt, `[Dashboard] Échec de la mise à jour ${path.basename(f)} pour ${dbName} : ${e.message}`, 'warn');
        }
      }
    }
    pushLog(rt, `[Dashboard] Base ${dbName} prête.`, 'info');
  }
}

// Each update file does `ALTER TABLE ... CHANGE COLUMN required_<previous> required_<this> bit`,
// so it only applies cleanly directly on top of the exact update named by the *previous* column —
// applying every file in the folder (including ones the base dump's schema already includes)
// breaks this chain immediately. The base dump's own column names the last update it already
// contains, so this finds that file in the sorted list and returns everything strictly after it.
async function getWowDbVersionColumn(mysqlCliExe, dbName, versionTable) {
  const out = await runCommandCapture(mysqlCliExe, [
    '-h', '127.0.0.1', '-P', String(WOW_MYSQL_PORT), '-u', 'root', '-N', '-B', '-e',
    `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema='${dbName}' AND table_name='${versionTable}' AND column_name LIKE 'required_%' LIMIT 1;`,
  ]);
  return out.trim() || null;
}

async function importCmangosDatabaseIfEmpty(rt, mysqlCliExe, dbName, baseName, sqlRootDir) {
  let isEmpty;
  try {
    isEmpty = await mysqlIsDatabaseEmpty(mysqlCliExe, dbName);
  } catch (e) {
    pushLog(rt, `[Dashboard] Impossible de vérifier si ${dbName} est vide : ${e.message}`, 'warn');
    return;
  }
  if (!isEmpty) return;

  const baseFile = path.join(sqlRootDir, 'base', `${baseName}.sql`);
  if (fs.existsSync(baseFile)) {
    pushLog(rt, `[Dashboard] Import du schéma de base pour ${dbName} (peut prendre plusieurs minutes)...`, 'info');
    try {
      await runMysqlImport(mysqlCliExe, dbName, baseFile);
    } catch (e) {
      pushLog(rt, `[Dashboard] Échec de l'import du schéma de base pour ${dbName} : ${e.message}`, 'error');
      return;
    }
  } else {
    pushLog(rt, `[Dashboard] Fichier SQL de base introuvable pour ${dbName} : ${baseFile}`, 'warn');
    return;
  }

  const updatesDir = path.join(sqlRootDir, 'updates', baseName);
  let updateFiles = [];
  try {
    updateFiles = fs.readdirSync(updatesDir).filter((f) => f.endsWith('.sql')).sort();
  } catch (e) {}

  const versionTable = WOW_CMANGOS_VERSION_TABLE[baseName];
  if (versionTable) {
    try {
      const col = await getWowDbVersionColumn(mysqlCliExe, dbName, versionTable);
      if (col) {
        const stem = col.replace(/^required_/, '');
        const idx = updateFiles.findIndex((f) => f === `${stem}.sql`);
        if (idx >= 0) {
          updateFiles = updateFiles.slice(idx + 1);
        } else {
          pushLog(rt, `[Dashboard] Révision actuelle (${stem}) introuvable parmi les mises à jour disponibles pour ${dbName} — application de toutes les mises à jour.`, 'warn');
        }
      }
    } catch (e) {
      pushLog(rt, `[Dashboard] Impossible de déterminer la révision actuelle de ${dbName} : ${e.message}`, 'warn');
    }
  }

  if (updateFiles.length > 0) {
    pushLog(rt, `[Dashboard] Application de ${updateFiles.length} mise(s) à jour SQL pour ${dbName}...`, 'info');
    for (const f of updateFiles) {
      try {
        await runMysqlImport(mysqlCliExe, dbName, path.join(updatesDir, f));
      } catch (e) {
        pushLog(rt, `[Dashboard] Échec de la mise à jour ${f} pour ${dbName} : ${e.message}`, 'warn');
      }
    }
  }
  pushLog(rt, `[Dashboard] Base ${dbName} prête.`, 'info');
}

// Default *.conf.dist templates across the MaNGOS family don't agree on which MySQL user they
// expect — vanilla's already matches what's provisioned below, but MaNGOS Four (mop) ships
// "root;mangos" — while the dashboard only ever provisions WOW_DB_BOOTSTRAP's user/password.
// Rewriting the *DatabaseInfo lines to match keeps every core's config consistent with the one
// user actually granted access, and doubles as database-name discovery: the db name each core's
// own template already uses (e.g. "mangos4"/"character4" for mop) is read straight out of that
// same line instead of being guessed ahead of time in WOW_DB_BOOTSTRAP.
const WOW_DB_INFO_SQL_BASE = {
  LoginDatabaseInfo: 'realmd',
  WorldDatabaseInfo: 'mangos',
  CharacterDatabaseInfo: 'characters',
  LogsDatabaseInfo: 'logs',
};

function patchWowConfDatabaseCredentials(rt, bootstrap) {
  const discovered = [];
  for (const confName of ['mangosd.conf', 'realmd.conf', 'worldserver.conf', 'authserver.conf']) {
    const confPath = path.join(rt.cfg.serverDir, confName);
    let content;
    try {
      content = fs.readFileSync(confPath, 'utf8');
    } catch (e) {
      continue;
    }
    let changed = false;
    content = content.replace(
      /^(\s*(LoginDatabaseInfo|WorldDatabaseInfo|CharacterDatabaseInfo|LogsDatabaseInfo)\s*=\s*")([^"]*)(")/gm,
      (full, pre, key, value, post) => {
        const parts = value.split(';');
        if (parts.length < 5) return full;
        const [host, port, , , dbName] = parts;
        discovered.push({ dbName, baseName: WOW_DB_INFO_SQL_BASE[key] });
        const newValue = [host, port, bootstrap.user, bootstrap.password, dbName].join(';');
        if (newValue !== value) changed = true;
        return pre + newValue + post;
      },
    );
    if (changed) fs.writeFileSync(confPath, content, 'utf8');
  }
  return discovered;
}

async function ensureWowGameDatabases(rt, mysqlCliExe) {
  const bootstrap = WOW_DB_BOOTSTRAP[rt.cfg.wowVersion];
  if (!bootstrap) return true;

  const discovered = patchWowConfDatabaseCredentials(rt, bootstrap);
  const databases = discovered.length > 0 ? discovered.map((d) => d.dbName) : bootstrap.databases;

  const dbStatements = databases.map((db) => `CREATE DATABASE IF NOT EXISTS ${db} DEFAULT CHARACTER SET utf8mb4;`).join('');
  const sql = dbStatements
    + `CREATE USER IF NOT EXISTS '${bootstrap.user}'@'127.0.0.1' IDENTIFIED BY '${bootstrap.password}';`
    + `GRANT ALL PRIVILEGES ON \`%\`.* TO '${bootstrap.user}'@'127.0.0.1';`
    + 'FLUSH PRIVILEGES;';
  try {
    await runCommandAsync(mysqlCliExe, ['-h', '127.0.0.1', '-P', String(WOW_MYSQL_PORT), '-u', 'root', '-e', sql]);
    pushLog(rt, `[Dashboard] Base(s) MySQL prête(s) pour ${rt.cfg.wowVersion} (utilisateur '${bootstrap.user}'/'${bootstrap.password}').`, 'info');
  } catch (e) {
    pushLog(rt, `[Dashboard] Échec de la préparation des bases MySQL : ${e.message}`, 'error');
    return false;
  }

  // AzerothCore's source lives under "data/sql/" (its own binaries update it automatically
  // anyway); CMaNGOS's plain "sql/" layout existing here is what actually distinguishes the
  // two, rather than checking which repo/version this is by name.
  const sqlRootDir = path.join(rt.cfg.serverDir, '_build', 'src', 'sql');
  if (fs.existsSync(sqlRootDir)) {
    if (discovered.length > 0) {
      for (const { dbName, baseName } of discovered) {
        if (baseName) await importCmangosDatabaseIfEmpty(rt, mysqlCliExe, dbName, baseName, sqlRootDir);
      }
    } else {
      // Conf files weren't found yet (shouldn't normally happen once a server's been built) —
      // fall back to the old guess-by-suffix behavior against the hardcoded database list.
      for (const dbName of bootstrap.databases) {
        const suffix = Object.keys(WOW_CMANGOS_SQL_MAP).find((baseName) => dbName.toLowerCase().endsWith(baseName));
        if (suffix) await importCmangosDatabaseIfEmpty(rt, mysqlCliExe, dbName, WOW_CMANGOS_SQL_MAP[suffix], sqlRootDir);
      }
    }
  } else if (rt.cfg.wowVersion === 'mop' && discovered.length > 0) {
    await ensureMangosFourWorldData(rt, mysqlCliExe, discovered);
  }
  return true;
}

async function ensureWowMysqlRunning(rt) {
  const mysqlCliExe = path.join(WOW_DEPS.mysql.installDir, 'bin', 'mysql.exe');
  if (await checkPortOpen(WOW_MYSQL_PORT, 500)) {
    return ensureWowGameDatabases(rt, mysqlCliExe);
  }
  if (wowMysqlEnsurePromise) {
    const ready = await wowMysqlEnsurePromise;
    return ready ? ensureWowGameDatabases(rt, mysqlCliExe) : false;
  }

  wowMysqlEnsurePromise = (async () => {
    const mysqldExe = path.join(WOW_DEPS.mysql.installDir, 'bin', 'mysqld.exe');
    if (!fs.existsSync(mysqldExe)) {
      pushLog(rt, "[Dashboard] MySQL n'est pas encore installé — compile un serveur WoW au moins une fois pour le récupérer.", 'error');
      return false;
    }

    fs.mkdirSync(WOW_MYSQL_DATA_DIR, { recursive: true });
    const alreadyInitialized = fs.existsSync(path.join(WOW_MYSQL_DATA_DIR, 'mysql'));
    if (!alreadyInitialized) {
      pushLog(rt, '[Dashboard] Initialisation de la base MySQL locale (une seule fois, ~20s)...', 'info');
      try {
        await runCommandAsync(mysqldExe, [`--datadir=${WOW_MYSQL_DATA_DIR}`, `--basedir=${WOW_DEPS.mysql.installDir}`, '--initialize-insecure']);
      } catch (e) {
        pushLog(rt, `[Dashboard] Échec de l'initialisation de MySQL : ${e.message}`, 'error');
        return false;
      }
    }

    pushLog(rt, `[Dashboard] Démarrage de MySQL (127.0.0.1:${WOW_MYSQL_PORT})...`, 'info');
    let mysqlProc = null;
    for (let attempt = 1; attempt <= 4 && !mysqlProc; attempt++) {
      try {
        mysqlProc = await trySpawnMysqldOnce(mysqldExe, 15000);
      } catch (e) {
        pushLog(rt, `[Dashboard] MySQL n'a pas démarré (essai ${attempt}/4), nouvelle tentative...`, 'warn');
      }
    }
    if (!mysqlProc) {
      pushLog(rt, '[Dashboard] Impossible de démarrer MySQL après plusieurs tentatives.', 'error');
      return false;
    }

    pushLog(rt, '[Dashboard] MySQL prêt.', 'info');
    return true;
  })();

  try {
    const ready = await wowMysqlEnsurePromise;
    return ready ? ensureWowGameDatabases(rt, mysqlCliExe) : false;
  } finally {
    wowMysqlEnsurePromise = null;
  }
}

// ---- WoW automated build orchestration ----
const wowBuilds = new Map(); // buildId -> { id, serverDir, versionKey, cmakeExe, status, log }

function wowBuildLog(build, line, kind = 'info') {
  const entry = { line, kind, t: Date.now() };
  build.log.push(entry);
  if (build.log.length > MAX_LOG_LINES) build.log.shift();
  io.emit('wowBuild:line', { buildId: build.id, entry });
}

function wowBuildStatus(build, status) {
  build.status = status;
  io.emit('wowBuild:status', { buildId: build.id, status });
}

function runWowBuildStep(build, command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    wowBuildLog(build, `> ${command} ${args.join(' ')}`, 'command');
    const proc = spawn(command, args, { cwd });
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      wowBuildLog(build, `[Dashboard] Délai dépassé (${Math.round(timeoutMs / 1000)}s), arrêt du processus...`, 'warn');
      proc.kill();
    }, timeoutMs) : null;
    const onOut = (kind) => (chunk) => chunk.toString().split(/\r?\n/).forEach((l) => { if (l) wowBuildLog(build, l, kind); });
    proc.stdout.on('data', onOut('info'));
    proc.stderr.on('data', onOut('error'));
    proc.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    proc.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) { reject(new Error('délai dépassé — une élévation administrateur est probablement requise')); return; }
      code === 0 ? resolve() : reject(new Error(`${command} a échoué (code ${code}).`));
    });
  });
}

function downloadWowDep(build, url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  wowBuildLog(build, `[Dashboard] Téléchargement : ${url}`, 'info');
  return runWowBuildStep(build, 'curl', ['-L', '--fail', '-o', destPath, url], path.dirname(destPath));
}

// vcpkg is a plain CLI tool (bootstrap script + `vcpkg install`), so unlike the old Boost/
// OpenSSL GUI installers, there's no silent-mode guesswork or elevation prompt to worry about.
// It's bootstrapped once and shared across every WoW server (see VCPKG_DIR).
async function ensureVcpkgDeps(build) {
  const vcpkgExe = path.join(VCPKG_DIR, 'vcpkg.exe');
  if (!fs.existsSync(vcpkgExe)) {
    if (!fs.existsSync(path.join(VCPKG_DIR, '.git'))) {
      wowBuildLog(build, '[Dashboard] Téléchargement de vcpkg...', 'info');
      await runWowBuildStep(build, 'git', ['clone', '--depth', '1', 'https://github.com/microsoft/vcpkg.git', VCPKG_DIR], __dirname);
    }
    wowBuildLog(build, '[Dashboard] Initialisation de vcpkg...', 'info');
    await runWowBuildStep(build, path.join(VCPKG_DIR, 'bootstrap-vcpkg.bat'), ['-disableMetrics'], VCPKG_DIR);
  }
  wowBuildLog(build, `[Dashboard] Installation de Boost et OpenSSL via vcpkg dans ${VCPKG_DIR} (peut prendre 30 à 60 minutes la première fois, réutilisé ensuite pour tous tes serveurs WoW)...`, 'info');
  const ports = [...VCPKG_BOOST_PORTS, 'openssl'].map((p) => `${p}:${VCPKG_TRIPLET}`);
  // AzerothCore's own code hard-requires a standalone, loadable "legacy.dll" OpenSSL provider
  // module next to the exe (OSSL_PROVIDER_load("legacy") at runtime) — something a fully static
  // OpenSSL build never produces, since providers are always separate loadable modules even
  // when libssl/libcrypto themselves are linked statically. So the default (dynamic) triplet's
  // openssl port is installed too, purely to harvest that one file from its bin/ folder.
  ports.push('openssl:x64-windows');
  await runWowBuildStep(build, vcpkgExe, ['install', ...ports], VCPKG_DIR, 90 * 60 * 1000);
}

// MySQL has no auto-fetch mechanism in AzerothCore's CMake either, so this downloads and
// extracts it (precompiled dev libraries only, no installer) before configure runs.
async function installMissingWowDeps(build) {
  // Shared (not per-server) since this can also run standalone from the "Dépendances" button,
  // with no server folder to speak of yet — and it's just a download scratch space either way.
  const depsDir = path.join(__dirname, '.wow-deps-download');

  // `vcpkg install` is idempotent — it only (re)builds ports that are missing or out of date —
  // so it's always run rather than gated on a "looks installed" heuristic. A prior partial/
  // different attempt can leave behind a shared header (boost/version.hpp) without every
  // specific library this build actually needs (e.g. boost-process), which a heuristic based
  // on that one file can't tell apart from a truly complete install.
  await ensureVcpkgDeps(build);

  if (!build.mysqlRoot) {
    wowBuildLog(build, "[Dashboard] MySQL introuvable — téléchargement et extraction (bibliothèques de compilation uniquement)...", 'info');
    const zipPath = path.join(depsDir, WOW_DEPS.mysql.zipName);
    await downloadWowDep(build, WOW_DEPS.mysql.url, zipPath);
    const extractRoot = path.dirname(WOW_DEPS.mysql.installDir);
    fs.mkdirSync(extractRoot, { recursive: true });
    await runWowBuildStep(build, 'powershell.exe', [
      '-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractRoot}' -Force`,
    ], depsDir);
    const extractedDir = path.join(extractRoot, WOW_DEPS.mysql.extractedName);
    if (fs.existsSync(extractedDir) && !fs.existsSync(WOW_DEPS.mysql.installDir)) {
      fs.renameSync(extractedDir, WOW_DEPS.mysql.installDir);
    }
    if (!fs.existsSync(path.join(WOW_DEPS.mysql.installDir, 'include', 'mysql.h'))) {
      throw new Error('En-têtes MySQL introuvables après extraction.');
    }
    build.mysqlRoot = WOW_DEPS.mysql.installDir;
    wowBuildLog(build, `[Dashboard] MySQL installé dans ${build.mysqlRoot} (bibliothèques uniquement — le service de base de données n'est pas démarré).`, 'info');
  }
}

// CMaNGOS's dep/CMakeLists.txt redefines add_library/add_executable/add_custom_target purely
// to sort dependency targets into a "Dependencies" folder in the Visual Studio solution
// explorer — cosmetic, nothing the build needs. But each of those macros hardcodes calling
// `_add_library` (etc.), and vcpkg's toolchain does the exact same "wrap and call the
// previous definition as _name" trick to inject itself. The two collide: vcpkg's wrap
// overwrites what `_add_library` points to, so CMaNGOS's own macro ends up calling itself
// through that name, infinitely, until CMake's recursion guard (1000) aborts the configure.
// Since the folder-grouping is purely cosmetic, the safe fix is deleting these macros outright
// rather than avoiding vcpkg's Boost (which would mean building Boost from source instead).
function patchCmangosAddLibraryRecursion(srcDir, log) {
  const depCMakeLists = path.join(srcDir, 'dep', 'CMakeLists.txt');
  if (!fs.existsSync(depCMakeLists)) return;
  const content = fs.readFileSync(depCMakeLists, 'utf8');
  if (!content.includes('macro(add_library _target)')) return; // not this codebase, or already patched
  const patched = content.replace(/macro\(add_(?:library|executable|custom_target)\s+_target\)[\s\S]*?endmacro\(\)\s*/g, '');
  fs.writeFileSync(depCMakeLists, patched, 'utf8');
  log('[Dashboard] Correctif appliqué : neutralisation du hook add_library de dep/CMakeLists.txt (conflit avec vcpkg, cosmétique uniquement).', 'info');
}

async function runWowBuild(build) {
  const repo = WOW_BUILD_REPOS[build.versionKey];
  const workDir = path.join(build.serverDir, '_build');
  const srcDir = path.join(workDir, 'src');
  const binDir = path.join(workDir, 'bin');

  try {
    wowBuildStatus(build, 'running');
    fs.mkdirSync(build.serverDir, { recursive: true });

    await installMissingWowDeps(build);

    if (!fs.existsSync(path.join(srcDir, '.git'))) {
      wowBuildLog(build, `[Dashboard] Téléchargement des sources : ${repo.url}`, 'info');
      fs.mkdirSync(workDir, { recursive: true });
      await runWowBuildStep(build, 'git', ['clone', '--depth', '1', '--branch', repo.branch, repo.url, srcDir], workDir);
    } else {
      wowBuildLog(build, '[Dashboard] Sources déjà présentes, clonage sauté.', 'info');
    }
    wowBuildLog(build, '[Dashboard] Initialisation des sous-modules Git (dep/, modules/)...', 'info');
    await runWowBuildStep(build, 'git', ['submodule', 'update', '--init', '--recursive', '--depth', '1'], srcDir);
    patchCmangosAddLibraryRecursion(srcDir, (line, kind) => wowBuildLog(build, line, kind));

    wowBuildLog(build, '[Dashboard] Configuration CMake...', 'info');
    const configureArgs = [
      '-S', srcDir, '-B', binDir, '-A', 'x64', ...(repo.extraConfigureArgs || []),
      `-DCMAKE_TOOLCHAIN_FILE=${path.join(VCPKG_DIR, 'scripts', 'buildsystems', 'vcpkg.cmake')}`,
      `-DVCPKG_TARGET_TRIPLET=${VCPKG_TRIPLET}`,
    ];
    if (build.mysqlRoot && build.mysqlRoot !== 'PATH') configureArgs.push(`-DMYSQL_ROOT=${build.mysqlRoot}`);
    await runWowBuildStep(build, build.cmakeExe, configureArgs, workDir);

    wowBuildLog(build, `[Dashboard] Compilation en cours (${repo.targets.join(' + ')})... cela peut prendre 20 à 60 minutes.`, 'info');
    const buildArgs = ['--build', binDir, '--config', 'RelWithDebInfo'];
    for (const t of repo.targets) buildArgs.push('--target', t);
    buildArgs.push('--', '/m');
    await runWowBuildStep(build, build.cmakeExe, buildArgs, workDir);

    wowBuildLog(build, '[Dashboard] Copie des exécutables dans le dossier du serveur...', 'info');
    const exeFiles = findFilesRecursive(binDir, new Set(repo.exeNames));
    if (exeFiles.length === 0) throw new Error('Compilation terminée mais aucun exécutable trouvé dans le dossier de build.');

    const copiedDirs = new Set();
    for (const exe of exeFiles) {
      const dir = path.dirname(exe);
      if (copiedDirs.has(dir)) continue;
      copiedDirs.add(dir);
      for (const f of fs.readdirSync(dir)) {
        const src = path.join(dir, f);
        if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(build.serverDir, f));
      }
      const configsDir = path.join(dir, 'configs');
      if (fs.existsSync(configsDir)) fs.cpSync(configsDir, path.join(build.serverDir, 'configs'), { recursive: true });
    }

    // Some targets (e.g. CMaNGOS Four's bundled Lua interpreter, built as lua55.dll) land in a
    // build output directory completely separate from the exe that needs them at runtime
    // (dep/lualib/lua/ vs src/mangosd/), so the exe-directory copy above misses them — causing
    // the exe to fail at launch with STATUS_DLL_NOT_FOUND before it even reaches main(). Sweep
    // the whole build tree for DLLs instead. First one found for a given name wins, so this never
    // overrides what the exe-directory copy already placed.
    for (const dll of findFilesRecursive(binDir, { has: (n) => n.endsWith('.dll') })) {
      const dest = path.join(build.serverDir, path.basename(dll));
      if (!fs.existsSync(dest)) fs.copyFileSync(dll, dest);
    }

    // CMaNGOS-family builds (vanilla/tbc/cata/mop) place each *.conf.dist one directory above
    // its exe (e.g. src/mangosd/mangosd.conf.dist next to src/mangosd/RelWithDebInfo/mangosd.exe)
    // rather than alongside the exe itself or in a "configs" subfolder, so the exe-directory copy
    // above never finds them either. Sweep the whole build tree for those too.
    for (const distFile of findFilesRecursive(binDir, { has: (n) => n.endsWith('.conf.dist') })) {
      const dest = path.join(build.serverDir, path.basename(distFile));
      if (!fs.existsSync(dest)) fs.copyFileSync(distFile, dest);
    }

    // These cores ship only *.conf.dist templates — they refuse to start without the real
    // *.conf file, which admins normally create by hand. Bootstrapped here with the untouched
    // defaults (only if the real file doesn't already exist, so a re-run never clobbers
    // settings someone already customized). Scanning for "*.conf.dist" rather than hardcoding
    // exact filenames covers both layouts seen so far: AzerothCore puts them in a "configs"
    // subfolder next to the exe, CMaNGOS's now land directly in build.serverDir root via the
    // sweep above.
    for (const dir of [build.serverDir, path.join(build.serverDir, 'configs')]) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.conf.dist')) continue;
          const real = path.join(dir, f.replace(/\.dist$/, ''));
          if (!fs.existsSync(real)) fs.copyFileSync(path.join(dir, f), real);
        }
      } catch (e) {}
    }

    // libmysql.lib is only the *import* library used at link time — the actual libmysql.dll
    // runtime dependency doesn't come from the build output at all, so it has to be copied in
    // separately or the exe fails to start with STATUS_DLL_NOT_FOUND.
    const libmysqlDll = path.join(WOW_DEPS.mysql.installDir, 'lib', 'libmysql.dll');
    if (fs.existsSync(libmysqlDll)) fs.copyFileSync(libmysqlDll, path.join(build.serverDir, 'libmysql.dll'));

    // libmysql.dll and legacy.dll (the OpenSSL 3.x "legacy" provider module, needed by
    // AzerothCore/CMaNGOS's own OSSL_PROVIDER_load("legacy") at startup) both depend on a DLL
    // named libcrypto-3-x64.dll/libssl-3-x64.dll — but MySQL bundles its own OpenSSL build
    // (3.5.x) and vcpkg's is a different one (3.6.4), and only one file can exist under that
    // name in the server folder. legacy.dll needs its *exact* matching build (provider-loading
    // is version-sensitive internal ABI, not the stable public API), whereas libmysql.dll only
    // calls OpenSSL's stable public API and tolerates a newer 3.x build fine — so vcpkg's copy
    // wins the name collision and is placed last.
    const mysqlBinDir = path.join(WOW_DEPS.mysql.installDir, 'bin');
    try {
      for (const f of fs.readdirSync(mysqlBinDir)) {
        if (/^lib(ssl|crypto)-.*\.dll$/i.test(f)) fs.copyFileSync(path.join(mysqlBinDir, f), path.join(build.serverDir, f));
      }
    } catch (e) {}

    const vcpkgOpensslBinDir = path.join(VCPKG_DIR, 'installed', 'x64-windows', 'bin');
    try {
      for (const f of fs.readdirSync(vcpkgOpensslBinDir)) {
        if (/^lib(ssl|crypto)-.*\.dll$/i.test(f) || f === 'legacy.dll') {
          fs.copyFileSync(path.join(vcpkgOpensslBinDir, f), path.join(build.serverDir, f));
        }
      }
    } catch (e) {}

    wowBuildLog(build, "[Dashboard] Terminé : worldserver.exe / authserver.exe installés dans le dossier du serveur.", 'info');
    wowBuildStatus(build, 'done');
  } catch (e) {
    wowBuildLog(build, `[Dashboard] Échec de la compilation : ${e.message}`, 'error');
    wowBuildStatus(build, 'error');
  }
}

async function startServerRuntime(rt) {
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

  if (cfg.game === 'wow') {
    const mysqlReady = await ensureWowMysqlRunning(rt);
    if (!mysqlReady) {
      pushLog(rt, '[Dashboard] Démarrage annulé : MySQL est requis pour le monde WoW.', 'error');
      return;
    }
    // The world/auth processes may have been requested to stop while MySQL was starting.
    if (rt.process) return;
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
    // The auth server is only useful while the world is up, so it follows the world's lifecycle.
    if (rt.authProcess) forceKillRuntime(rt, rt.authProcess.pid);
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

  if (cfg.game === 'wow') startWowAuthProcess(rt);
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
  if (rt.authProcess && rt.authProcess.stdin.writable) rt.authProcess.stdin.write(stopCmd + '\n');

  const pid = rt.process.pid;
  setTimeout(() => {
    if (rt.process && rt.process.pid === pid) {
      pushLog(rt, '[Dashboard] Le serveur ne répond pas, arrêt forcé.', 'warn');
      forceKillRuntime(rt, pid);
    }
    if (rt.authProcess) forceKillRuntime(rt, rt.authProcess.pid);
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
  if (rt.authProcess) forceKillRuntime(rt, rt.authProcess.pid);
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

// MySQL is a single shared instance (not per-runtime), so its status is polled and broadcast
// once here rather than duplicated inside pollStats for every WoW server.
let wowMysqlLastOpen = false;
setInterval(async () => {
  wowMysqlLastOpen = await checkPortOpen(WOW_MYSQL_PORT, 400);
  io.emit('wowMysqlStatus', { open: wowMysqlLastOpen });
}, 5000);

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
    assetsPath: cfg.assetsPath || null,
    extraJavaArgs: cfg.extraJavaArgs || [],
    exePath: cfg.exePath,
    authExePath: cfg.authExePath || null,
    launchArgs: cfg.launchArgs || [],
    wowVersion: cfg.wowVersion || null,
    stopTimeoutMs: cfg.stopTimeoutMs,
    limits: cfg.limits,
    icon: cfg.icon || null,
    color: cfg.color || null,
  };
}

function createServer(payload = {}) {
  const game = VALID_GAMES.has(payload.game) ? payload.game : 'minecraft';
  let name = (payload.name || '').trim();
  // WoW creation only asks for the folder, so fall back to its name rather than blocking.
  if (!name && game === 'wow' && payload.serverDir) {
    name = path.basename(path.resolve(payload.serverDir.trim()));
  }
  if (!name || !payload.serverDir) return { error: 'Nom et dossier serveur requis.' };

  let id = slugify(name);
  let suffix = 2;
  while (runtimes.has(id)) { id = `${slugify(name)}-${suffix++}`; }

  const isMinecraft = game === 'minecraft';
  const isHytale = game === 'hytale';
  const isJavaBased = isMinecraft || isHytale;
  const defaults = GAME_DEFAULTS[game] || {};
  const wowExe = game === 'wow' ? detectWowExecutables(payload.serverDir) : null;

  const cfg = {
    id,
    name,
    game,
    serverDir: payload.serverDir,
    gamePort: Number(payload.gamePort) || defaults.port || 25565,
    jarName: isJavaBased ? (payload.jarName || (isHytale ? 'HytaleServer.jar' : 'server.jar')) : null,
    javaPath: isJavaBased ? (payload.javaPath || '') : null,
    minRam: isJavaBased ? (payload.minRam || '1G') : null,
    maxRam: isJavaBased ? (payload.maxRam || (isHytale ? '6G' : '4G')) : null,
    extraJavaArgs: isJavaBased ? [] : [],
    assetsPath: isHytale ? (payload.assetsPath || '') : null,
    exePath: isJavaBased ? null : (game === 'wow' ? (wowExe.worldExe || defaults.exePath || '') : (payload.exePath || defaults.exePath || '')),
    authExePath: game === 'wow' ? (wowExe.authExe || null) : null,
    launchArgs: isJavaBased ? [] : (defaults.launchArgs || []),
    wowVersion: game === 'wow' ? (WOW_VERSIONS.has(payload.wowVersion) ? payload.wowVersion : DEFAULT_WOW_VERSION) : null,
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
  if (rt.authProcess) forceKillRuntime(rt, rt.authProcess.pid);
  runtimes.delete(id);
  saveServerDefs();
  broadcastServerList();
}

function updateServerSettings(id, patch = {}) {
  const rt = runtimes.get(id);
  if (!rt) return;
  const cfg = rt.cfg;
  const editable = [
    'name', 'gamePort', 'jarName', 'javaPath', 'minRam', 'maxRam', 'assetsPath',
    'extraJavaArgs', 'exePath', 'authExePath', 'launchArgs', 'stopTimeoutMs', 'icon', 'color',
  ];
  for (const key of editable) {
    if (patch[key] !== undefined) cfg[key] = patch[key];
  }
  if (cfg.game === 'wow' && WOW_VERSIONS.has(patch.wowVersion)) cfg.wowVersion = patch.wowVersion;
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
  socket.emit('wowMysqlStatus', { open: wowMysqlLastOpen });

  socket.on('servers:create', (payload, ack) => {
    const result = createServer(payload || {});
    if (typeof ack === 'function') ack(result);
  });

  socket.on('wow:build:start', ({ serverDir, versionKey } = {}, ack) => {
    if (typeof ack !== 'function') return;
    if (!serverDir) { ack({ error: 'Dossier du serveur requis.' }); return; }
    if (!WOW_BUILD_REPOS[versionKey]) {
      ack({ error: "Compilation automatique non disponible pour cette version — aucun projet open source fiable et standardisé n'existe pour celle-ci pour le moment." });
      return;
    }
    const existing = [...wowBuilds.values()].find((b) => b.serverDir === serverDir && b.status === 'running');
    if (existing) { ack({ buildId: existing.id }); return; }

    const prereq = checkWowBuildPrerequisites();
    if (!prereq.ok) { ack({ error: `Outils manquants : ${prereq.missing.join(', ')}` }); return; }

    const build = {
      id: randomUUID(), serverDir, versionKey,
      cmakeExe: prereq.cmakeExe, mysqlRoot: prereq.mysqlRoot,
      status: 'pending', log: [],
    };
    wowBuilds.set(build.id, build);
    ack({ buildId: build.id });
    runWowBuild(build);
  });

  socket.on('wow:deps:check', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const prereq = checkWowBuildPrerequisites();
    const vcpkgInstalled = path.join(VCPKG_DIR, 'installed', VCPKG_TRIPLET);
    ack({
      git: commandExists('git'),
      cmake: !!prereq.cmakeExe,
      visualStudio: hasVsCppWorkload(),
      boostOpenssl: fs.existsSync(path.join(vcpkgInstalled, 'include', 'boost', 'version.hpp'))
        && fs.existsSync(path.join(vcpkgInstalled, 'include', 'openssl', 'ssl.h')),
      mysql: fs.existsSync(path.join(WOW_DEPS.mysql.installDir, 'include', 'mysql.h')),
    });
  });

  // Same build-log/status/modal plumbing as a real server build, just with no serverDir/repo —
  // lets "Installer les dépendances" run standalone (Boost/OpenSSL via vcpkg, MySQL client
  // libs) without requiring the user to have already filled in a server folder.
  socket.on('wow:deps:start', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const prereq = checkWowBuildPrerequisites();
    if (!prereq.ok) {
      ack({ error: `Outils à installer manuellement (Visual Studio Installer / git-scm.com) : ${prereq.missing.join(', ')}` });
      return;
    }
    const existing = [...wowBuilds.values()].find((b) => b.serverDir === null && b.status === 'running');
    if (existing) { ack({ buildId: existing.id }); return; }

    const build = {
      id: randomUUID(), serverDir: null, versionKey: null,
      cmakeExe: prereq.cmakeExe, mysqlRoot: prereq.mysqlRoot,
      status: 'pending', log: [],
    };
    wowBuilds.set(build.id, build);
    ack({ buildId: build.id });
    (async () => {
      wowBuildStatus(build, 'running');
      try {
        await installMissingWowDeps(build);
        wowBuildLog(build, '[Dashboard] Dépendances prêtes.', 'info');
        wowBuildStatus(build, 'done');
      } catch (e) {
        wowBuildLog(build, `[Dashboard] Échec de l'installation des dépendances : ${e.message}`, 'error');
        wowBuildStatus(build, 'error');
      }
    })();
  });

  socket.on('wow:build:join', ({ buildId } = {}) => {
    const build = wowBuilds.get(buildId);
    if (!build) return;
    socket.emit('wowBuild:history', { buildId, history: build.log, status: build.status });
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
    if (rt.cfg.game === 'wow') socket.emit('authStatus', { id, status: rt.authProcess ? 'running' : 'stopped' });
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
