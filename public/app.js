const socket = io();

const el = (id) => document.getElementById(id);

// ---- Theme ----
const themeToggle = el('themeToggle');
const themeIcon = el('themeIcon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
  localStorage.setItem('everise-theme', theme);
}

const savedTheme = localStorage.getItem('everise-theme')
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ---- View / server navigation ----
const homeView = el('homeView');
const serverView = el('serverView');
const ALL_VIEWS = [homeView, serverView];
const serverGrid = el('serverGrid');
const serverGridEmpty = el('serverGridEmpty');
const serverTitle = el('serverTitle');
const serverGameIcon = el('serverGameIcon');
const tpsBadge = el('tpsBadge');
const playersPanel = el('playersPanel');

let currentServerId = null;
let serverSummaries = new Map(); // id -> { id, name, game, status, players, gamePort }
let serverConfigs = new Map(); // id -> full config

// Stored WITHOUT the "bi-" prefix everywhere (matching the custom-icon picker convention);
// callers that need the CSS class add the prefix themselves.
const GAME_ICONS = {
  minecraft: 'joystick',
  gmod: 'wrench-adjustable-circle-fill',
  cs2: 'crosshair',
  valheim: 'tree-fill',
  vintagestory: 'hammer',
  rust: 'fire',
  projectzomboid: 'virus',
  palworld: 'egg-fill',
  fivem: 'car-front-fill',
  '7dtd': 'calendar-week',
};
const GAME_LABELS = {
  minecraft: 'Minecraft',
  gmod: "Garry's Mod",
  cs2: 'Counter-Strike 2',
  valheim: 'Valheim',
  vintagestory: 'Vintage Story',
  rust: 'Rust',
  projectzomboid: 'Project Zomboid',
  palworld: 'Palworld',
  fivem: 'FiveM',
  '7dtd': '7 Days to Die',
};
const DEFAULT_ICON_COLOR = '#1f6fc0';

const ICON_PICKER_PRESETS = [
  'joystick', 'wrench-adjustable-circle-fill', 'cloud-fill', 'shield-lock-fill', 'hdd-network-fill',
  'server', 'hdd-stack-fill', 'database-fill', 'cpu-fill', 'controller',
  'rocket-fill', 'lightning-charge-fill', 'globe', 'wifi', 'gear-fill',
  'star-fill', 'gem', 'trophy-fill', 'fire', 'moon-stars-fill',
  'sun-fill', 'tree-fill', 'lock-fill', 'key-fill', 'flag-fill',
];

function serverIcon(entry) { return 'bi-' + (entry.icon || GAME_ICONS[entry.game] || 'joystick'); }
function serverColor(entry) { return entry.color || 'var(--blue-dark)'; }
function toHexColor(color) { return (color && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : null; }

function renderIconPicker(gridId, iconInputId, colorInputId, previewId) {
  const grid = el(gridId);
  const iconInput = el(iconInputId);
  const colorInput = el(colorInputId);
  const preview = el(previewId);

  function updatePreview() {
    const icon = iconInput.value.trim().replace(/^bi-/, '') || 'joystick';
    preview.style.background = colorInput.value;
    preview.innerHTML = `<i class="bi bi-${icon}"></i>`;
    [...grid.children].forEach((btn) => btn.classList.toggle('active', btn.dataset.icon === icon));
  }

  if (!grid.dataset.built) {
    grid.dataset.built = 'true';
    ICON_PICKER_PRESETS.forEach((icon) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-picker-btn';
      btn.dataset.icon = icon;
      btn.title = icon;
      btn.innerHTML = `<i class="bi bi-${icon}"></i>`;
      btn.addEventListener('click', () => { iconInput.value = icon; updatePreview(); });
      grid.appendChild(btn);
    });
    iconInput.addEventListener('input', updatePreview);
    colorInput.addEventListener('input', updatePreview);
  }
  updatePreview();
}

function hideAllViews() {
  ALL_VIEWS.forEach((v) => v.classList.add('view-hidden'));
}

function showHome() {
  currentServerId = null;
  hideAllViews();
  homeView.classList.remove('view-hidden');
}

function showServer(id) {
  currentServerId = id;
  hideAllViews();
  serverView.classList.remove('view-hidden');
  resetServerViewState();
  socket.emit('server:join', { id });
}

let currentConsoleLines = [];

function resetServerViewState() {
  consoleEl.innerHTML = '';
  currentConsoleLines = [];
  errorCount = 0;
  warnCount = 0;
  updateSeverityBadges();
  currentStatus = 'stopped';
  startedAt = null;
  renderPlayers([]);
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let serverSearchQuery = '';

function renderServerGrid() {
  let list = [...serverSummaries.values()].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  if (serverSearchQuery) {
    list = list.filter((s) => s.name.toLowerCase().includes(serverSearchQuery));
  }

  serverGrid.querySelectorAll('.server-row').forEach((c) => c.remove());
  serverGridEmpty.classList.toggle('view-hidden', list.length > 0);
  serverGridEmpty.textContent = serverSearchQuery
    ? 'Aucun serveur ne correspond à la recherche.'
    : 'Aucun serveur pour le moment.';

  const draggable = !serverSearchQuery;

  list.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'server-row';
    row.dataset.id = s.id;
    row.draggable = draggable;
    const playersLabel = s.players ? `${s.players.online}/${s.players.max}` : '-/-';
    row.innerHTML = `
      <i class="bi bi-grip-vertical server-row-handle${draggable ? '' : ' disabled'}"></i>
      <div class="server-row-icon" style="background:${serverColor(s)}"><i class="bi ${serverIcon(s)}"></i></div>
      <div class="server-row-info">
        <div class="server-row-name">${escapeHtml(s.name)}</div>
        <div class="server-row-meta">
          <span><i class="bi bi-controller"></i> ${GAME_LABELS[s.game] || s.game}</span>
          <span><i class="bi bi-people-fill"></i> ${playersLabel}</span>
        </div>
      </div>
      <span class="dot ${s.status}"></span>
      <div class="server-row-actions">
        <button type="button" class="row-icon-btn pin-btn${s.pinned ? ' active' : ''}" title="${s.pinned ? 'Désépingler' : 'Épingler'}"><i class="bi ${s.pinned ? 'bi-pin-fill' : 'bi-pin'}"></i></button>
        <button type="button" class="row-icon-btn logs-btn" title="Voir les logs"><i class="bi bi-terminal"></i></button>
        <button type="button" class="row-icon-btn clone-btn" title="Cloner"><i class="bi bi-copy"></i></button>
        <button type="button" class="row-icon-btn delete-btn" title="Supprimer"><i class="bi bi-trash"></i></button>
      </div>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-icon-btn')) return;
      showServer(s.id);
    });
    row.querySelector('.pin-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('servers:togglePin', { id: s.id });
    });
    row.querySelector('.logs-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openLogsModal(s.id, s.name);
    });
    row.querySelector('.clone-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openCreateModalWithClone(s.id);
    });
    row.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal(s.id);
    });

    if (draggable) {
      row.addEventListener('dragstart', () => row.classList.add('dragging'));
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        const order = [...serverGrid.querySelectorAll('.server-row')].map((r) => r.dataset.id);
        socket.emit('servers:reorder', { order });
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = serverGrid.querySelector('.dragging');
        if (!dragging || dragging === row) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        serverGrid.insertBefore(dragging, before ? row : row.nextSibling);
      });
    }

    serverGrid.appendChild(row);
  });
}

socket.on('servers:list', (list) => {
  serverSummaries = new Map(list.map((s) => [s.id, s]));
  renderServerGrid();
});

el('btnHome').addEventListener('click', showHome);

el('serverSearchInput').addEventListener('input', (e) => {
  serverSearchQuery = e.target.value.trim().toLowerCase();
  renderServerGrid();
});

function applyServerConfig(cfg) {
  serverConfigs.set(cfg.id, cfg);
  if (pendingCloneId === cfg.id) {
    fillCloneForm(cfg);
    pendingCloneId = null;
  }
  if (cfg.id !== currentServerId) return;
  serverTitle.textContent = cfg.name;
  serverGameIcon.className = 'bi ' + serverIcon(cfg);
  serverGameIcon.parentElement.style.background = serverColor(cfg);
  const isMinecraft = cfg.game === 'minecraft';
  tpsBadge.classList.toggle('view-hidden', !isMinecraft);
  playersPanel.classList.toggle('view-hidden', !isMinecraft);
  serverPathEl.textContent = isMinecraft
    ? `${cfg.serverDir}\\${cfg.jarName} • RAM ${cfg.minRam}-${cfg.maxRam}`
    : `${cfg.serverDir}\\${cfg.exePath}`;
  gamePort = cfg.gamePort;
}

socket.on('config', ({ id, config }) => applyServerConfig({ id, ...config }));

const statusDot = el('statusDot');
const consoleStatusDot = el('consoleStatusDot');
const statusText = el('statusText');
const uptimeEl = el('uptime');
const consoleEl = el('console');
const serverPathEl = el('serverPath');
const eulaBanner = el('eulaBanner');
const tpsValue = el('tpsValue');

// ---- Auto-scroll console ----
const btnAutoscroll = el('btnAutoscroll');
let autoScroll = localStorage.getItem('everise-autoscroll') !== 'off';

function applyAutoscrollButton() {
  btnAutoscroll.classList.toggle('active', autoScroll);
}
applyAutoscrollButton();

btnAutoscroll.addEventListener('click', () => {
  autoScroll = !autoScroll;
  localStorage.setItem('everise-autoscroll', autoScroll ? 'on' : 'off');
  applyAutoscrollButton();
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
});

el('btnExportLogs').addEventListener('click', () => {
  if (!currentServerId) return;
  downloadTextFile(`${serverTitle.textContent}-logs.txt`, currentConsoleLines.join('\n'));
});

const playersValue = el('playersValue');
const playersBar = el('playersBar');
const cpuValue = el('cpuValue');
const cpuBar = el('cpuBar');
const ramValue = el('ramValue');
const ramBar = el('ramBar');
const diskValue = el('diskValue');
const diskBar = el('diskBar');
const networkValue = el('networkValue');
const networkDot = el('networkDot');
const networkStatusText = el('networkStatusText');

let currentStatus = 'stopped';
let startedAt = null;
let gamePort = null;

function statusLabel(s) {
  switch (s) {
    case 'running': return 'En ligne';
    case 'starting': return 'Démarrage...';
    case 'stopping': return 'Arrêt en cours...';
    default: return 'Hors ligne';
  }
}

function updateStatusUI(data) {
  currentStatus = data.status;
  startedAt = data.startedAt;
  statusDot.className = 'dot ' + currentStatus;
  consoleStatusDot.className = 'dot console-status-dot ' + currentStatus;
  statusText.textContent = statusLabel(currentStatus);

  const running = currentStatus === 'running' || currentStatus === 'starting' || currentStatus === 'stopping';
  el('btnStart').disabled = running;
  el('btnRestart').disabled = !running;
  el('btnStop').disabled = !running;
  el('btnKill').disabled = !running;

  if (currentStatus !== 'stopped') eulaBanner.classList.remove('show');
}

function tickUptime() {
  if (startedAt && (currentStatus === 'running' || currentStatus === 'starting')) {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    uptimeEl.textContent = `• ${hh}:${mm}:${ss}`;
  } else {
    uptimeEl.textContent = '';
  }
}
setInterval(tickUptime, 1000);

// ---- Console formatting ----
const MC_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// xterm 16-color palette, used both for legacy ANSI codes (30-37/90-97) and as the low end of the 256-color table.
const ANSI_16 = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
];

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}

function ansi256ToHex(n) {
  if (n < 16) return ANSI_16[n];
  if (n < 232) {
    const idx = n - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(idx / 36)];
    const g = levels[Math.floor((idx / 6) % 6)];
    const b = levels[idx % 6];
    return rgbToHex(r, g, b);
  }
  const gray = 8 + (n - 232) * 10;
  return rgbToHex(gray, gray, gray);
}

function resetStyle() {
  return { color: null, bold: false, italic: false, underline: false, strike: false };
}

// Renders both legacy Minecraft "§" codes and ANSI SGR escape sequences (used by Paper/Purpur's
// terminal console output) as inline spans, so colors/formatting show up whichever format is used.
function renderFormatting(text) {
  const parts = escapeHtml(text).split(/(§[0-9a-fk-or]|\x1b\[[0-9;]*[a-zA-Z])/i);
  let html = '';
  let style = resetStyle();

  for (const part of parts) {
    if (!part) continue;

    const mcMatch = /^§([0-9a-fk-or])$/i.exec(part);
    if (mcMatch) {
      const code = mcMatch[1].toLowerCase();
      if (code === 'r') style = resetStyle();
      else if (MC_COLORS[code]) style = { ...style, color: MC_COLORS[code] };
      else if (code === 'l') style = { ...style, bold: true };
      else if (code === 'o') style = { ...style, italic: true };
      else if (code === 'n') style = { ...style, underline: true };
      else if (code === 'm') style = { ...style, strike: true };
      continue;
    }

    const ansiMatch = /^\x1b\[([0-9;]*)([a-zA-Z])$/.exec(part);
    if (ansiMatch) {
      if (ansiMatch[2] === 'm') {
        const codes = ansiMatch[1] === '' ? [0] : ansiMatch[1].split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
          const c = codes[i];
          if (c === 0) style = resetStyle();
          else if (c === 1) style = { ...style, bold: true };
          else if (c === 3) style = { ...style, italic: true };
          else if (c === 4) style = { ...style, underline: true };
          else if (c === 9) style = { ...style, strike: true };
          else if (c === 22) style = { ...style, bold: false };
          else if (c === 23) style = { ...style, italic: false };
          else if (c === 24) style = { ...style, underline: false };
          else if (c === 29) style = { ...style, strike: false };
          else if (c === 39) style = { ...style, color: null };
          else if (c >= 30 && c <= 37) style = { ...style, color: ANSI_16[c - 30] };
          else if (c >= 90 && c <= 97) style = { ...style, color: ANSI_16[8 + (c - 90)] };
          else if (c === 38) {
            if (codes[i + 1] === 5) { style = { ...style, color: ansi256ToHex(codes[i + 2]) }; i += 2; }
            else if (codes[i + 1] === 2) { style = { ...style, color: rgbToHex(codes[i + 2], codes[i + 3], codes[i + 4]) }; i += 4; }
          }
        }
      }
      // Non-color CSI sequences (cursor moves, clear line, ...) are simply dropped.
      continue;
    }

    const css = [];
    if (style.color) css.push(`color:${style.color}`);
    if (style.bold) css.push('font-weight:700');
    if (style.italic) css.push('font-style:italic');
    const decorations = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean);
    if (decorations.length) css.push(`text-decoration:${decorations.join(' ')}`);

    html += css.length ? `<span style="${css.join(';')}">${part}</span>` : part;
  }
  return html;
}

// File-log style: "[10:27:52] [Server thread/INFO]: message"
const LOG_LINE_WITH_THREAD = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]+)\]:\s?([\s\S]*)$/;
// Live terminal style: "[10:40:18 INFO]: message" (no thread name, ANSI colors inline)
const LOG_LINE_NO_THREAD = /^\[(\d{2}:\d{2}:\d{2}) (\w+)\]:\s?([\s\S]*)$/;

function formatLogLine(line) {
  let time, thread, level, message;

  const withThread = LOG_LINE_WITH_THREAD.exec(line);
  if (withThread) {
    [, time, , message] = withThread;
    const slashIndex = withThread[2].lastIndexOf('/');
    thread = slashIndex >= 0 ? withThread[2].slice(0, slashIndex) : withThread[2];
    level = (slashIndex >= 0 ? withThread[2].slice(slashIndex + 1) : '').toUpperCase();
  } else {
    const noThread = LOG_LINE_NO_THREAD.exec(line);
    if (noThread) {
      [, time, level, message] = noThread;
      level = level.toUpperCase();
    }
  }

  if (time === undefined) return renderFormatting(line);

  return (
    `<span class="log-time">[${time}]</span> ` +
    `<span class="log-bracket">[</span>` +
    (thread ? `<span class="log-thread">${escapeHtml(thread)}</span><span class="log-bracket">/</span>` : '') +
    `<span class="log-level lvl-${level}">${level}</span>` +
    `<span class="log-bracket">]:</span> ` +
    `<span class="log-msg">${renderFormatting(message)}</span>`
  );
}

// ---- Error / warn badges ----
const errorBadge = el('errorBadge');
const warnBadge = el('warnBadge');
const errorCountEl = el('errorCount');
const warnCountEl = el('warnCount');
let errorCount = 0;
let warnCount = 0;

function updateSeverityBadges() {
  errorCountEl.textContent = errorCount;
  warnCountEl.textContent = warnCount;
  errorBadge.classList.toggle('show', errorCount > 0);
  warnBadge.classList.toggle('show', warnCount > 0);
}

errorBadge.addEventListener('click', () => { errorCount = 0; updateSeverityBadges(); });
warnBadge.addEventListener('click', () => { warnCount = 0; updateSeverityBadges(); });

const LOG_LEVEL_REGEX = /\[[^\]]*\b(WARN|ERROR|SEVERE|FATAL)\b[^\]]*\]/i;

function detectSeverity(entry) {
  if (entry.kind === 'error') return 'error';
  if (entry.kind === 'warn') return 'warn';
  const m = LOG_LEVEL_REGEX.exec(entry.line);
  if (m) return m[1].toUpperCase() === 'WARN' ? 'warn' : 'error';
  return null;
}

const MAX_CLIENT_CONSOLE_LINES = 1000;

function addConsoleLine(entry) {
  const div = document.createElement('div');
  div.className = 'console-line ' + (entry.kind || 'info');
  div.innerHTML = formatLogLine(entry.line);
  consoleEl.appendChild(div);
  while (consoleEl.children.length > MAX_CLIENT_CONSOLE_LINES) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
  currentConsoleLines.push(entry.line);
  if (currentConsoleLines.length > MAX_CLIENT_CONSOLE_LINES) currentConsoleLines.shift();

  const severity = detectSeverity(entry);
  if (severity === 'error') { errorCount++; updateSeverityBadges(); }
  else if (severity === 'warn') { warnCount++; updateSeverityBadges(); }
}

function formatMem(bytes) {
  if (!bytes) return '0 ko';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

socket.on('console:history', ({ id, history }) => {
  if (id === logsViewId) {
    logsConsole.innerHTML = '';
    logsConsoleLines = [];
    history.forEach(addLogsConsoleLine);
  }
  if (id !== currentServerId) return;
  consoleEl.innerHTML = '';
  currentConsoleLines = [];
  errorCount = 0;
  warnCount = 0;
  history.forEach(addConsoleLine);
  updateSeverityBadges();
});

socket.on('console:line', ({ id, entry }) => {
  if (id === logsViewId) addLogsConsoleLine(entry);
  if (id === currentServerId) addConsoleLine(entry);
});
socket.on('status', (data) => { if (data.id === currentServerId) updateStatusUI(data); });

socket.on('eulaRequired', ({ id }) => { if (id === currentServerId) eulaBanner.classList.add('show'); });

socket.on('tps', ({ id, tps }) => {
  if (id !== currentServerId) return;
  if (tps === null || tps === undefined) {
    tpsValue.textContent = '--';
    tpsValue.className = 'tps-value';
    return;
  }
  tpsValue.textContent = tps.toFixed(1);
  tpsValue.className = 'tps-value' + (tps < 15 ? ' bad' : tps < 18 ? ' warn' : '');
});

const playersList = el('playersList');
const playersCount = el('playersCount');

function renderPlayers(names) {
  playersCount.textContent = names.length;
  playersList.innerHTML = '';

  if (names.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'players-empty';
    empty.textContent = 'Aucun joueur connecté';
    playersList.appendChild(empty);
    return;
  }

  names.forEach((name) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="player-identity">
        <i class="bi bi-person-circle player-avatar"></i>
        <span class="player-name">${escapeHtml(name)}</span>
      </div>
      <div class="player-actions">
        <button type="button" class="player-btn heal" title="Soigner"><i class="bi bi-heart-fill"></i></button>
        <button type="button" class="player-btn feed" title="Nourrir"><i class="bi bi-egg-fried"></i></button>
        <button type="button" class="player-btn kill" title="Tuer"><i class="bi bi-skull"></i></button>
      </div>
    `;
    row.querySelector('.heal').addEventListener('click', () => socket.emit('action:playerCommand', { id: currentServerId, player: name, action: 'heal' }));
    row.querySelector('.feed').addEventListener('click', () => socket.emit('action:playerCommand', { id: currentServerId, player: name, action: 'feed' }));
    row.querySelector('.kill').addEventListener('click', () => socket.emit('action:playerCommand', { id: currentServerId, player: name, action: 'kill' }));
    playersList.appendChild(row);
  });
}

socket.on('players', ({ id, players: p }) => {
  if (id !== currentServerId) return;
  if (p) {
    playersValue.textContent = `${p.online}/${p.max}`;
    playersBar.style.width = p.max ? `${Math.min(100, (p.online / p.max) * 100)}%` : '0%';
    renderPlayers(p.names || []);
  } else {
    playersValue.textContent = '-/-';
    playersBar.style.width = '0%';
    renderPlayers([]);
  }
});

socket.on('stats', (stats) => {
  latestStatsByServer.set(stats.id, stats);
  updateAggregateStats();

  if (stats.id !== currentServerId) return;
  cpuValue.textContent = `${stats.cpu} %`;
  cpuBar.style.width = `${Math.min(100, stats.cpuPercentOfMax || 0)}%`;

  ramValue.textContent = formatMem(stats.ramBytes);
  ramBar.style.width = `${stats.ramPercentOfMax || 0}%`;

  if (stats.disk) {
    diskValue.textContent = `${stats.disk.serverFolderGB} Go`;
    diskBar.style.width = `${stats.disk.percentOfDisk}%`;
  }

  if (stats.network) {
    networkValue.textContent = stats.network.port;
    networkDot.className = 'dot ' + (stats.network.open ? 'running' : 'stopped');
    networkStatusText.textContent = stats.network.open ? 'Ouvert' : 'Fermé';
  }
});

// ---- Aggregate stats (home view) ----
const latestStatsByServer = new Map();
const totalCpuValue = el('totalCpuValue');
const totalRamValue = el('totalRamValue');
const totalDiskValue = el('totalDiskValue');

function updateAggregateStats() {
  let cpu = 0;
  let ramBytes = 0;
  let diskGB = 0;
  for (const stats of latestStatsByServer.values()) {
    cpu += stats.cpu || 0;
    ramBytes += stats.ramBytes || 0;
    diskGB += (stats.disk && stats.disk.serverFolderGB) || 0;
  }
  totalCpuValue.textContent = `${Math.round(cpu * 10) / 10} %`;
  totalRamValue.textContent = formatMem(ramBytes);
  totalDiskValue.textContent = `${Math.round(diskGB * 100) / 100} Go`;
}

el('btnStart').addEventListener('click', () => socket.emit('action:start', { id: currentServerId }));
el('btnRestart').addEventListener('click', () => socket.emit('action:restart', { id: currentServerId }));
el('btnStop').addEventListener('click', () => socket.emit('action:stop', { id: currentServerId }));
el('btnEula').addEventListener('click', () => {
  socket.emit('action:acceptEula', { id: currentServerId });
  eulaBanner.classList.remove('show');
});

el('btnCopy').addEventListener('click', () => {
  const address = `localhost:${gamePort || 25565}`;
  navigator.clipboard.writeText(address).then(() => {
    const btn = el('btnCopy');
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="pill-icon">✓</span> Copié !';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  });
});

const killModal = el('killModal');
el('btnKill').addEventListener('click', () => killModal.classList.add('show'));
el('killCancel').addEventListener('click', () => killModal.classList.remove('show'));
el('killConfirm').addEventListener('click', () => {
  socket.emit('action:kill', { id: currentServerId });
  killModal.classList.remove('show');
});

const cmdForm = el('cmdForm');
const cmdInput = el('cmdInput');
const cmdHistory = [];
let historyIndex = -1;

cmdForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cmd = cmdInput.value.trim();
  if (!cmd) return;
  socket.emit('command', { id: currentServerId, cmd });
  cmdHistory.push(cmd);
  historyIndex = cmdHistory.length;
  cmdInput.value = '';
  cmdInput.focus();
});

cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    if (historyIndex > 0) historyIndex--;
    cmdInput.value = cmdHistory[historyIndex] || '';
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    if (historyIndex < cmdHistory.length - 1) {
      historyIndex++;
      cmdInput.value = cmdHistory[historyIndex] || '';
    } else {
      historyIndex = cmdHistory.length;
      cmdInput.value = '';
    }
    e.preventDefault();
  }
});

// ---- Delete server modal ----
const deleteModal = el('deleteModal');
let deleteTargetId = null;

function openDeleteModal(id) {
  deleteTargetId = id;
  deleteModal.classList.add('show');
}
el('deleteCancel').addEventListener('click', () => deleteModal.classList.remove('show'));
el('deleteConfirm').addEventListener('click', () => {
  if (deleteTargetId) socket.emit('servers:delete', { id: deleteTargetId });
  deleteModal.classList.remove('show');
  deleteTargetId = null;
});

// ---- Logs modal (quick read-only view without leaving the current page) ----
const logsModal = el('logsModal');
const logsConsole = el('logsConsole');
const logsModalTitle = el('logsModalTitle');
let logsViewId = null;
let logsViewName = '';
let logsConsoleLines = [];

function addLogsConsoleLine(entry) {
  const div = document.createElement('div');
  div.className = 'console-line ' + (entry.kind || 'info');
  div.innerHTML = formatLogLine(entry.line);
  logsConsole.appendChild(div);
  while (logsConsole.children.length > MAX_CLIENT_CONSOLE_LINES) {
    logsConsole.removeChild(logsConsole.firstChild);
  }
  logsConsole.scrollTop = logsConsole.scrollHeight;
  logsConsoleLines.push(entry.line);
  if (logsConsoleLines.length > MAX_CLIENT_CONSOLE_LINES) logsConsoleLines.shift();
}

function openLogsModal(id, name) {
  logsViewId = id;
  logsViewName = name;
  logsModalTitle.textContent = `Logs — ${name}`;
  logsConsole.innerHTML = '';
  logsConsoleLines = [];
  socket.emit('server:join', { id });
  logsModal.classList.add('show');
}

el('logsClose').addEventListener('click', () => {
  logsModal.classList.remove('show');
  logsViewId = null;
});

el('logsExport').addEventListener('click', () => {
  if (!logsViewName) return;
  downloadTextFile(`${logsViewName}-logs.txt`, logsConsoleLines.join('\n'));
});

// ---- Create server modal ----
const createServerModal = el('createServerModal');
const createServerForm = el('createServerForm');
const newServerGame = el('newServerGame');
const newServerMcFields = el('newServerMcFields');
const newServerGmodFields = el('newServerGmodFields');
const createServerError = el('createServerError');

function showCreateServerError(message) {
  createServerError.textContent = message;
  createServerError.classList.toggle('show', !!message);
}

function toggleCreateFields() {
  const isMc = newServerGame.value === 'minecraft';
  newServerMcFields.classList.toggle('view-hidden', !isMc);
  newServerGmodFields.classList.toggle('view-hidden', isMc);
}
newServerGame.addEventListener('change', toggleCreateFields);

el('btnCreateServer').addEventListener('click', () => {
  pendingCloneId = null;
  createServerForm.reset();
  toggleCreateFields();
  showCreateServerError('');
  el('newServerColor').value = DEFAULT_ICON_COLOR;
  renderIconPicker('newServerIconGrid', 'newServerIcon', 'newServerColor', 'newServerIconPreview');
  createServerModal.classList.add('show');
});
el('createServerCancel').addEventListener('click', () => createServerModal.classList.remove('show'));

// ---- Clone an existing server into the create form ----
let pendingCloneId = null;

function fillCloneForm(cfg) {
  createServerForm.reset();
  showCreateServerError('');
  el('newServerName').value = `${cfg.name} (copie)`;
  newServerGame.value = cfg.game;
  toggleCreateFields();
  el('newServerPort').value = cfg.gamePort || '';
  el('newServerJar').value = cfg.jarName || '';
  el('newServerJava').value = cfg.javaPath || '';
  el('newServerMinRam').value = cfg.minRam || '';
  el('newServerMaxRam').value = cfg.maxRam || '';
  el('newServerExe').value = cfg.exePath || '';
  el('newServerIcon').value = cfg.icon || (GAME_ICONS[cfg.game] || 'bi-joystick').replace(/^bi-/, '');
  el('newServerColor').value = toHexColor(cfg.color) || DEFAULT_ICON_COLOR;
  renderIconPicker('newServerIconGrid', 'newServerIcon', 'newServerColor', 'newServerIconPreview');
}

function openCreateModalWithClone(id) {
  const cached = serverConfigs.get(id);
  if (cached) {
    fillCloneForm(cached);
  } else {
    createServerForm.reset();
    toggleCreateFields();
    showCreateServerError('');
    el('newServerColor').value = DEFAULT_ICON_COLOR;
    renderIconPicker('newServerIconGrid', 'newServerIcon', 'newServerColor', 'newServerIconPreview');
  }
  pendingCloneId = id;
  createServerModal.classList.add('show');
  socket.emit('server:join', { id });
}

createServerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('newServerName').value.trim();
  const serverDir = el('newServerDir').value.trim();
  if (!name || !serverDir) {
    showCreateServerError('Le nom et le dossier du serveur sont obligatoires.');
    return;
  }
  showCreateServerError('');

  const payload = {
    name,
    game: newServerGame.value,
    serverDir,
    gamePort: el('newServerPort').value,
    jarName: el('newServerJar').value.trim(),
    javaPath: el('newServerJava').value.trim(),
    minRam: el('newServerMinRam').value.trim(),
    maxRam: el('newServerMaxRam').value.trim(),
    exePath: el('newServerExe').value.trim(),
    icon: el('newServerIcon').value.trim(),
    color: el('newServerColor').value,
  };
  socket.emit('servers:create', payload, (result) => {
    if (result && result.error) {
      showCreateServerError(result.error);
      return;
    }
    createServerModal.classList.remove('show');
  });
});

// ---- Settings modal ----
const settingsModal = el('settingsModal');
const settingsForm = el('settingsForm');
const setMcFields = el('setMcFields');
const setGmodFields = el('setGmodFields');

function openSettingsModal() {
  const cfg = serverConfigs.get(currentServerId);
  if (!cfg) return;
  const isMc = cfg.game === 'minecraft';
  setMcFields.classList.toggle('view-hidden', !isMc);
  setGmodFields.classList.toggle('view-hidden', isMc);

  el('setName').value = cfg.name || '';
  el('setPort').value = cfg.gamePort || '';
  el('setJar').value = cfg.jarName || '';
  el('setJava').value = cfg.javaPath || '';
  el('setMinRam').value = cfg.minRam || '';
  el('setMaxRam').value = cfg.maxRam || '';
  el('setExtraArgs').value = (cfg.extraJavaArgs || []).join(' ');
  el('setExe').value = cfg.exePath || '';
  el('setLaunchArgs').value = (cfg.launchArgs || []).join(' ');
  el('setCpuMax').value = (cfg.limits && cfg.limits.cpuMaxPercent) || '';
  el('setRamMax').value = (cfg.limits && cfg.limits.ramMaxMB) || '';
  el('setStorageMax').value = (cfg.limits && cfg.limits.storageMaxGB) || '';
  el('setStopTimeout').value = Math.round((cfg.stopTimeoutMs || 30000) / 1000);
  el('setIcon').value = cfg.icon || (GAME_ICONS[cfg.game] || 'bi-joystick').replace(/^bi-/, '');
  el('setColor').value = toHexColor(cfg.color) || DEFAULT_ICON_COLOR;
  renderIconPicker('setIconGrid', 'setIcon', 'setColor', 'setIconPreview');

  settingsModal.classList.add('show');
}

el('btnSettings').addEventListener('click', openSettingsModal);
el('btnEditServer').addEventListener('click', openSettingsModal);
el('settingsCancel').addEventListener('click', () => settingsModal.classList.remove('show'));

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const cfg = serverConfigs.get(currentServerId);
  if (!cfg) return;

  const patch = {
    name: el('setName').value.trim(),
    gamePort: Number(el('setPort').value) || cfg.gamePort,
    icon: el('setIcon').value.trim(),
    color: el('setColor').value,
    stopTimeoutMs: (Number(el('setStopTimeout').value) || 30) * 1000,
    limits: {
      cpuMaxPercent: Number(el('setCpuMax').value) || 100,
      ramMaxMB: Number(el('setRamMax').value) || null,
      storageMaxGB: Number(el('setStorageMax').value) || null,
    },
  };

  if (cfg.game === 'minecraft') {
    patch.jarName = el('setJar').value.trim();
    patch.javaPath = el('setJava').value.trim();
    patch.minRam = el('setMinRam').value.trim();
    patch.maxRam = el('setMaxRam').value.trim();
    patch.extraJavaArgs = el('setExtraArgs').value.trim().split(/\s+/).filter(Boolean);
  } else {
    patch.exePath = el('setExe').value.trim();
    patch.launchArgs = el('setLaunchArgs').value.trim().split(/\s+/).filter(Boolean);
  }

  socket.emit('servers:updateSettings', { id: currentServerId, patch });
  settingsModal.classList.remove('show');
});

// ---- Config file editor ----
const filesModal = el('filesModal');
const filesList = el('filesList');
const filesSearchInput = el('filesSearchInput');
const filesEditorArea = el('filesEditorArea');
const filesCurrentName = el('filesCurrentName');
const filesSave = el('filesSave');
const filesStatus = el('filesStatus');
const codeEditor = el('codeEditor');
const codeGutter = el('codeGutter');
const codeHighlight = el('codeHighlight');
const codeErrorLine = el('codeErrorLine');
let filesCurrentFile = null;
let allConfigFiles = [];
let expandedFolders = new Set();
let currentFileLang = 'text';
let validateTimer = null;

// ---- Folder tree ----
function buildFileTree(paths) {
  const root = { folders: new Map(), files: [] };
  paths.forEach((p) => {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(parts[parts.length - 1]);
  });
  return root;
}

function renderTreeNode(node, container, depth, prefix, forceOpen) {
  const indent = 10 + depth * 16;
  const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
  folderNames.forEach((folderName) => {
    const folderPath = prefix ? `${prefix}/${folderName}` : folderName;
    const isOpen = forceOpen || expandedFolders.has(folderPath);
    const header = document.createElement('div');
    header.className = 'files-tree-folder-header' + (isOpen ? ' open' : '');
    header.style.paddingLeft = `${indent}px`;
    header.innerHTML = `<i class="bi bi-chevron-right"></i><i class="bi ${isOpen ? 'bi-folder2-open' : 'bi-folder-fill'}"></i><span>${escapeHtml(folderName)}</span>`;
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'files-tree-children' + (isOpen ? '' : ' collapsed');
    header.addEventListener('click', () => {
      if (expandedFolders.has(folderPath)) expandedFolders.delete(folderPath);
      else expandedFolders.add(folderPath);
      renderFilesList(allConfigFiles);
    });
    container.appendChild(header);
    container.appendChild(childrenWrap);
    renderTreeNode(node.folders.get(folderName), childrenWrap, depth + 1, folderPath, forceOpen);
  });

  const fileNames = [...node.files].sort((a, b) => a.localeCompare(b));
  fileNames.forEach((fileName) => {
    const fullPath = prefix ? `${prefix}/${fileName}` : fileName;
    const item = document.createElement('div');
    item.className = 'files-list-item';
    item.style.paddingLeft = `${indent}px`;
    item.title = fullPath;
    item.innerHTML = `<i class="bi bi-file-earmark-text"></i><span>${escapeHtml(fileName)}</span>`;
    item.classList.toggle('active', fullPath === filesCurrentFile);
    item.addEventListener('click', () => openFile(fullPath));
    container.appendChild(item);
  });
}

function renderFilesList(files) {
  filesList.innerHTML = '';
  if (files.length === 0) {
    filesList.innerHTML = '<div class="files-list-empty">Aucun résultat.</div>';
    return;
  }
  const searching = filesSearchInput.value.trim().length > 0;
  const tree = buildFileTree(files);
  renderTreeNode(tree, filesList, 0, '', searching);
}

filesSearchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim().toLowerCase();
  renderFilesList(query ? allConfigFiles.filter((f) => f.toLowerCase().includes(query)) : allConfigFiles);
});

// ---- Syntax highlighting (lightweight, regex-based per line) ----
function langForFile(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  return 'properties';
}

function highlightYamlValue(escaped) {
  return escaped
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>')
    .replace(/\b(true|false|null|yes|no|True|False|Null|Yes|No)\b/g, '<span class="tok-boolean">$1</span>')
    .replace(/\b(-?\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
}

function highlightYamlLine(line) {
  const comment = /^(\s*)(#.*)$/.exec(line);
  if (comment) return escapeHtml(comment[1]) + `<span class="tok-comment">${escapeHtml(comment[2])}</span>`;
  const kv = /^(\s*(?:-\s+)?)([\w.\-/]+)(\s*:)(.*)$/.exec(line);
  if (kv) {
    const [, indent, key, colon, rest] = kv;
    return escapeHtml(indent) + `<span class="tok-key">${escapeHtml(key)}</span>` + escapeHtml(colon) + highlightYamlValue(escapeHtml(rest));
  }
  const listItem = /^(\s*)(-)(\s+)(.*)$/.exec(line);
  if (listItem) {
    const [, indent, dash, sp, rest] = listItem;
    return escapeHtml(indent) + `<span class="tok-punct">${dash}</span>` + escapeHtml(sp) + highlightYamlValue(escapeHtml(rest));
  }
  return highlightYamlValue(escapeHtml(line));
}

function highlightJsonLine(line) {
  let html = escapeHtml(line);
  html = html.replace(/(&quot;.*?&quot;)(\s*:)/g, '<span class="tok-key">$1</span>$2');
  html = html.replace(/:(\s*)(&quot;.*?&quot;)/g, ':$1<span class="tok-string">$2</span>');
  html = html.replace(/\b(true|false|null)\b/g, '<span class="tok-boolean">$1</span>');
  html = html.replace(/\b(-?\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  html = html.replace(/([{}[\],])/g, '<span class="tok-punct">$1</span>');
  return html;
}

function highlightPropertiesLine(line) {
  const comment = /^(\s*)([#;].*)$/.exec(line);
  if (comment) return escapeHtml(comment[1]) + `<span class="tok-comment">${escapeHtml(comment[2])}</span>`;
  const section = /^(\s*)(\[[^\]]+\])(\s*)$/.exec(line);
  if (section) return escapeHtml(section[1]) + `<span class="tok-section">${escapeHtml(section[2])}</span>` + escapeHtml(section[3]);
  const kv = /^(\s*)([\w.\-]+)(\s*=\s*)(.*)$/.exec(line);
  if (kv) {
    const [, indent, key, eq, value] = kv;
    return escapeHtml(indent) + `<span class="tok-key">${escapeHtml(key)}</span>` + escapeHtml(eq) + `<span class="tok-string">${escapeHtml(value)}</span>`;
  }
  return escapeHtml(line);
}

const HIGHLIGHTERS = { yaml: highlightYamlLine, json: highlightJsonLine, properties: highlightPropertiesLine };

let cachedRawLines = [];

// Replacing the whole highlighted blob's innerHTML on every keystroke is what made large
// files (hundreds/thousands of lines) lag — the browser has to re-parse and re-layout
// every line even though typing only ever changes one. Each line is its own DOM node here,
// so an edit that doesn't change the line count patches only the line(s) that actually
// changed; the rest are left completely untouched (no reflow for them at all).
function renderCodeEditor(content, forceFull) {
  const lines = content.split(/\r?\n/);
  codeGutter.textContent = lines.map((_, i) => i + 1).join('\n');
  const highlightFn = HIGHLIGHTERS[currentFileLang] || escapeHtml;

  if (forceFull || lines.length !== cachedRawLines.length) {
    const frag = document.createDocumentFragment();
    lines.forEach((line) => {
      const div = document.createElement('div');
      div.className = 'code-line';
      div.innerHTML = highlightFn(line);
      frag.appendChild(div);
    });
    codeHighlight.innerHTML = '';
    codeHighlight.appendChild(frag);
  } else {
    const children = codeHighlight.children;
    for (let i = 0; i < lines.length; i++) {
      if (cachedRawLines[i] !== lines[i]) {
        children[i].innerHTML = highlightFn(lines[i]);
      }
    }
  }
  cachedRawLines = lines;
}

// ---- Live syntax validation → error line highlight ----
function validateContent(content) {
  if (currentFileLang === 'json') {
    try { JSON.parse(content); return null; }
    catch (e) {
      const m = /position (\d+)/.exec(e.message);
      const line = m ? content.slice(0, +m[1]).split('\n').length - 1 : 0;
      return { line };
    }
  }
  if (currentFileLang === 'yaml' && window.jsyaml) {
    try { window.jsyaml.load(content); return null; }
    catch (e) {
      const line = (e && e.mark && typeof e.mark.line === 'number') ? e.mark.line : 0;
      return { line };
    }
  }
  return null;
}

function updateErrorHighlight() {
  const validation = validateContent(filesEditorArea.value);
  if (!validation) {
    codeErrorLine.classList.remove('show');
    if (filesStatus.classList.contains('files-error-status')) filesStatus.textContent = '';
    filesStatus.classList.remove('files-error-status');
    return;
  }
  const cs = getComputedStyle(codeHighlight);
  const lineHeightPx = parseFloat(cs.lineHeight);
  const paddingTopPx = parseFloat(cs.paddingTop);
  codeErrorLine.style.top = `${paddingTopPx + validation.line * lineHeightPx}px`;
  codeErrorLine.style.height = `${lineHeightPx}px`;
  codeErrorLine.classList.add('show');
  filesStatus.textContent = `Erreur de syntaxe ligne ${validation.line + 1}`;
  filesStatus.classList.add('files-error-status');
}

filesEditorArea.addEventListener('input', () => {
  renderCodeEditor(filesEditorArea.value);
  clearTimeout(validateTimer);
  validateTimer = setTimeout(updateErrorHighlight, 300);
});

function setEditorEnabled(enabled) {
  filesEditorArea.disabled = !enabled;
  filesSave.disabled = !enabled;
  codeEditor.classList.toggle('disabled', !enabled);
}

function openFile(name) {
  filesCurrentFile = name;
  filesCurrentName.textContent = name;
  filesStatus.textContent = 'Chargement...';
  filesStatus.classList.remove('files-error-status');
  filesEditorArea.value = '';
  renderCodeEditor('');
  codeErrorLine.classList.remove('show');
  setEditorEnabled(false);
  currentFileLang = langForFile(name);
  renderFilesList(filesSearchInput.value.trim() ? allConfigFiles.filter((f) => f.toLowerCase().includes(filesSearchInput.value.trim().toLowerCase())) : allConfigFiles);

  socket.emit('files:read', { id: currentServerId, filename: name }, (result) => {
    if (result && result.error) {
      filesStatus.textContent = result.error;
      return;
    }
    const content = (result && result.content) || '';
    filesEditorArea.value = content;
    renderCodeEditor(content, true);
    setEditorEnabled(true);
    filesStatus.textContent = '';
    updateErrorHighlight();
  });
}

el('btnFiles').addEventListener('click', () => {
  if (!currentServerId) return;
  filesList.innerHTML = '<div class="files-list-empty">Chargement...</div>';
  filesSearchInput.value = '';
  filesEditorArea.value = '';
  renderCodeEditor('');
  codeErrorLine.classList.remove('show');
  setEditorEnabled(false);
  filesCurrentFile = null;
  filesCurrentName.textContent = 'Sélectionne un fichier';
  filesStatus.textContent = '';
  filesStatus.classList.remove('files-error-status');

  socket.emit('files:list', { id: currentServerId }, (result) => {
    if (result && result.error) {
      allConfigFiles = [];
      filesList.innerHTML = `<div class="files-list-empty">${escapeHtml(result.error)}</div>`;
      return;
    }
    allConfigFiles = (result && result.files) || [];
    if (allConfigFiles.length === 0) {
      filesList.innerHTML = '<div class="files-list-empty">Aucun fichier de config trouvé dans le dossier serveur.</div>';
      return;
    }
    renderFilesList(allConfigFiles);
  });

  filesModal.classList.add('show');
});

el('filesClose').addEventListener('click', () => filesModal.classList.remove('show'));

filesSave.addEventListener('click', () => {
  if (!filesCurrentFile) return;
  filesStatus.classList.remove('files-error-status');
  filesStatus.textContent = 'Enregistrement...';
  socket.emit('files:write', { id: currentServerId, filename: filesCurrentFile, content: filesEditorArea.value }, (result) => {
    if (result && result.error) {
      filesStatus.textContent = result.error;
      return;
    }
    filesStatus.textContent = 'Enregistré ✓';
    setTimeout(() => { filesStatus.textContent = ''; }, 2000);
  });
});

// ---- Init ----
showHome();
