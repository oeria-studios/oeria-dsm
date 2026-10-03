const socket = io();

const el = (id) => document.getElementById(id);

// ---- App version (configurable in config.json) ----
fetch('/api/app-info').then((r) => r.json()).then((info) => {
  el('appVersionTag').textContent = `VERSION: ${info.version} | Copyright (c) 2026 OERIA STUDIOS`;
}).catch(() => {});

// ---- Theme ----
// The toggle buttons exist once per view (home.html and server.html each have their own copy,
// so they sit inline with that view's own header buttons instead of floating over them) —
// targeted by shared classes rather than an id, since an id can only match one element.
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-icon').forEach((iconEl) => {
    iconEl.className = 'theme-icon bi ' + (theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill');
  });
  localStorage.setItem('everise-theme', theme);
}

const savedTheme = localStorage.getItem('everise-theme')
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(savedTheme);

document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
});

// ---- Language ----
const I18N = {
  fr: {
    'topbar.changeLang': 'Changer de langue',
    'topbar.changeTheme': 'Changer de thème',
    'home.search': 'Rechercher un serveur...',
    'home.emptyGrid': 'Aucun serveur pour le moment.',
    'home.createServer': 'Créer un serveur',
    'home.totalCpu': 'CPU total',
    'home.totalRam': 'RAM totale',
    'home.totalDisk': 'Stockage total',
    'home.documentation': 'Documentation',
    'server.backHome': "Retour à l'accueil",
    'server.connecting': 'Connexion...',
    'server.authTitle': "Serveur d'authentification",
    'server.dbTitle': 'Base de données MySQL',
    'server.configFiles': 'Fichiers de configuration',
    'server.settings': 'Paramètres du serveur',
    'server.eulaBanner': "Le serveur refuse de démarrer tant que l'EULA n'est pas acceptée.",
    'server.acceptEula': "Accepter l'EULA",
    'server.console': 'Console',
    'server.errorsTitle': 'Erreurs (clic pour voir la liste)',
    'server.warningsTitle': 'Avertissements (clic pour voir la liste)',
    'server.errors': 'Erreurs',
    'server.warnings': 'Avertissements',
    'server.noErrors': 'Aucune erreur.',
    'server.noWarnings': 'Aucun avertissement.',
    'server.autoscrollTitle': 'Défilement automatique',
    'server.autoscroll': 'Auto-scroll',
    'server.exportLogsTitle': 'Exporter les logs (.txt)',
    'server.cmdPlaceholder': 'Entrez votre commande',
    'server.send': 'Envoyer',
    'server.players': 'Joueurs',
    'server.serverFolder': 'Dossier serveur',
    'server.network': 'Réseau',
    'server.start': 'Démarrer',
    'server.restart': 'Redémarrer',
    'server.stop': 'Arrêter',
    'server.edit': 'Modifier',
    'server.copyAddress': "Copier l'adresse",
    'server.connectedPlayers': 'Joueurs connectés',
    'server.noPlayers': 'Aucun joueur connecté',
    'common.export': 'Exporter',
    'common.close': 'Fermer',
    'common.save': 'Enregistrer',
    'common.cancel': 'Annuler',
    'common.delete': 'Supprimer',
    'common.create': 'Créer',
    'files.title': 'Fichiers de configuration',
    'files.search': 'Rechercher un fichier...',
    'files.selectFile': 'Sélectionne un fichier',
    'kill.title': "Forcer l'arrêt du serveur ?",
    'kill.body': 'Le kill coupe immédiatement le processus sans sauvegarde propre. Le monde peut perdre des données récentes.',
    'kill.confirm': 'Confirmer le kill',
    'delete.title': 'Supprimer ce serveur ?',
    'delete.body': 'Le serveur sera retiré du dashboard (les fichiers du dossier ne sont pas supprimés).',
    'create.title': 'Créer un serveur',
    'create.name': 'Nom du serveur',
    'create.namePlaceholder': 'Mon serveur',
    'create.game': 'Jeu',
    'create.port': 'Port',
    'create.folder': 'Dossier du serveur',
    'create.jarName': 'Nom du fichier .jar',
    'create.javaPath': 'Chemin Java (version)',
    'create.ramMin': 'RAM min',
    'create.ramMax': 'RAM max',
    'create.hytaleAssets': 'Chemin vers Assets.zip',
    'create.executable': 'Exécutable',
    'create.wowVersion': 'Version de WoW',
    'create.wowBuildTitleAttr': 'Clone, compile et crée automatiquement le serveur dans le dossier ci-dessus (20 à 60 minutes) — un seul clic. Nécessite Git, CMake et Visual Studio (Desktop C++), voir le bouton Dépendances. Seul WotLK a été testé de bout en bout ; les autres versions utilisent le même pipeline mais peuvent révéler un souci spécifique au premier essai.',
    'create.wowBuild': 'Compiler',
    'create.wowVersionNote': 'Pas de projet open source fiable pour cette version — installation manuelle requise.',
    'create.appearance': 'Apparence',
    'create.icon': 'Icône',
    'create.color': 'Couleur',
    'create.preview': 'Aperçu',
    'create.folderHint': "Le dossier doit déjà contenir les fichiers du serveur (jar / exécutable) — la création ici ne fait qu'enregistrer le serveur dans le dashboard.",
    'create.wowDeps': 'Dépendances',
    'wowBuild.title': 'Compilation',
    'wowBuild.titleDeps': 'Installation des dépendances',
    'wowBuild.starting': 'Démarrage...',
    'wowDeps.title': 'Dépendances de compilation WoW',
    'wowDeps.hint': "Git, CMake et Visual Studio doivent être installés manuellement (liens ci-dessous). Boost, OpenSSL et MySQL peuvent être installés automatiquement.",
    'wowDeps.vsHint': 'cocher "Desktop development with C++" à l\'installation, CMake est inclus',
    'wowDeps.install': 'Installer Boost/OpenSSL/MySQL',
    'wowDeps.ok': 'Installé',
    'wowDeps.missing': 'Manquant',
    'wowDeps.checking': 'Vérification...',
    'settings.title': 'Paramètres du serveur',
    'settings.name': 'Nom',
    'settings.extraJavaArgs': 'Arguments Java additionnels',
    'settings.launchArgs': 'Arguments de démarrage',
    'settings.wowExe': 'Exécutable (monde)',
    'settings.wowAuthExe': "Exécutable du serveur d'authentification",
    'settings.limits': 'Limites des jauges',
    'settings.cpuMax': 'CPU max (%)',
    'settings.ramMax': 'RAM max (Mo)',
    'settings.storageMax': 'Stockage max (Go)',
    'settings.stopTimeout': 'Arrêt forcé (s)',
    'status.running': 'En ligne',
    'status.starting': 'Démarrage...',
    'status.stopping': 'Arrêt en cours...',
    'status.stopped': 'Hors ligne',
  },
  en: {
    'topbar.changeLang': 'Change language',
    'topbar.changeTheme': 'Change theme',
    'home.search': 'Search a server...',
    'home.emptyGrid': 'No server yet.',
    'home.createServer': 'Create a server',
    'home.totalCpu': 'Total CPU',
    'home.totalRam': 'Total RAM',
    'home.totalDisk': 'Total storage',
    'home.documentation': 'Documentation',
    'server.backHome': 'Back to home',
    'server.connecting': 'Connecting...',
    'server.authTitle': 'Authentication server',
    'server.dbTitle': 'MySQL database',
    'server.configFiles': 'Configuration files',
    'server.settings': 'Server settings',
    'server.eulaBanner': 'The server refuses to start until the EULA is accepted.',
    'server.acceptEula': 'Accept EULA',
    'server.console': 'Console',
    'server.errorsTitle': 'Errors (click to view list)',
    'server.warningsTitle': 'Warnings (click to view list)',
    'server.errors': 'Errors',
    'server.warnings': 'Warnings',
    'server.noErrors': 'No errors.',
    'server.noWarnings': 'No warnings.',
    'server.autoscrollTitle': 'Auto-scroll',
    'server.autoscroll': 'Auto-scroll',
    'server.exportLogsTitle': 'Export logs (.txt)',
    'server.cmdPlaceholder': 'Enter your command',
    'server.send': 'Send',
    'server.players': 'Players',
    'server.serverFolder': 'Server folder',
    'server.network': 'Network',
    'server.start': 'Start',
    'server.restart': 'Restart',
    'server.stop': 'Stop',
    'server.edit': 'Edit',
    'server.copyAddress': 'Copy address',
    'server.connectedPlayers': 'Connected players',
    'server.noPlayers': 'No player connected',
    'common.export': 'Export',
    'common.close': 'Close',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.create': 'Create',
    'files.title': 'Configuration files',
    'files.search': 'Search a file...',
    'files.selectFile': 'Select a file',
    'kill.title': 'Force stop the server?',
    'kill.body': 'Killing immediately cuts the process with no clean save. The world may lose recent data.',
    'kill.confirm': 'Confirm kill',
    'delete.title': 'Delete this server?',
    'delete.body': 'The server will be removed from the dashboard (files on disk are not deleted).',
    'create.title': 'Create a server',
    'create.name': 'Server name',
    'create.namePlaceholder': 'My server',
    'create.game': 'Game',
    'create.port': 'Port',
    'create.folder': 'Server folder',
    'create.jarName': '.jar file name',
    'create.javaPath': 'Java path (version)',
    'create.ramMin': 'Min RAM',
    'create.ramMax': 'Max RAM',
    'create.hytaleAssets': 'Path to Assets.zip',
    'create.executable': 'Executable',
    'create.wowVersion': 'WoW version',
    'create.wowBuildTitleAttr': 'Clones, compiles and automatically creates the server in the folder above (20 to 60 minutes) — one click. Requires Git, CMake and Visual Studio (Desktop C++), see the Dependencies button. Only WotLK has been tested end-to-end; other versions use the same pipeline but may surface a version-specific issue on first try.',
    'create.wowBuild': 'Compile',
    'create.wowVersionNote': 'No reliable open-source project for this version — manual installation required.',
    'create.appearance': 'Appearance',
    'create.icon': 'Icon',
    'create.color': 'Color',
    'create.preview': 'Preview',
    'create.folderHint': 'The folder must already contain the server files (jar / executable) — creating it here just registers the server in the dashboard.',
    'create.wowDeps': 'Dependencies',
    'wowBuild.title': 'Compiling',
    'wowBuild.titleDeps': 'Installing dependencies',
    'wowBuild.starting': 'Starting...',
    'wowDeps.title': 'WoW build dependencies',
    'wowDeps.hint': 'Git, CMake and Visual Studio must be installed manually (links below). Boost, OpenSSL and MySQL can be installed automatically.',
    'wowDeps.vsHint': 'check "Desktop development with C++" during install, CMake is included',
    'wowDeps.install': 'Install Boost/OpenSSL/MySQL',
    'wowDeps.ok': 'Installed',
    'wowDeps.missing': 'Missing',
    'wowDeps.checking': 'Checking...',
    'settings.title': 'Server settings',
    'settings.name': 'Name',
    'settings.extraJavaArgs': 'Additional Java arguments',
    'settings.launchArgs': 'Launch arguments',
    'settings.wowExe': 'Executable (world)',
    'settings.wowAuthExe': 'Authentication server executable',
    'settings.limits': 'Gauge limits',
    'settings.cpuMax': 'Max CPU (%)',
    'settings.ramMax': 'Max RAM (MB)',
    'settings.storageMax': 'Max storage (GB)',
    'settings.stopTimeout': 'Forced stop (s)',
    'status.running': 'Online',
    'status.starting': 'Starting...',
    'status.stopping': 'Stopping...',
    'status.stopped': 'Offline',
  },
};

// Flag emoji (🇫🇷/🇬🇧) render as literal "FR"/"GB" text on Windows unless a recent-enough
// emoji font is installed, so these are drawn as small inline SVGs instead — guaranteed to
// render the same everywhere regardless of font/OS support.
const LANG_FLAGS = {
  fr: '<svg viewBox="0 0 3 2" width="20" height="14"><rect width="1" height="2" x="0" fill="#0055A4"/><rect width="1" height="2" x="1" fill="#FFFFFF"/><rect width="1" height="2" x="2" fill="#EF4135"/></svg>',
  en: '<svg viewBox="0 0 60 30" width="20" height="14"><rect width="60" height="30" fill="#00247d"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#cf142b" stroke-width="2"/><path d="M30,0 V30 M0,15 H60" stroke="#fff" stroke-width="10"/><path d="M30,0 V30 M0,15 H60" stroke="#cf142b" stroke-width="6"/></svg>',
};
let currentLang = localStorage.getItem('oeria-dsm-lang') || 'fr';

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) ?? (I18N.fr[key] ?? key);
}

function applyI18n() {
  const dict = I18N[currentLang] || I18N.fr;
  document.querySelectorAll('[data-i18n]').forEach((elm) => {
    const text = dict[elm.getAttribute('data-i18n')];
    if (text === undefined) return;
    const textNode = [...elm.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
    if (textNode) textNode.textContent = text;
    else elm.textContent = text;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((elm) => {
    const text = dict[elm.getAttribute('data-i18n-placeholder')];
    if (text !== undefined) elm.placeholder = text;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((elm) => {
    const text = dict[elm.getAttribute('data-i18n-title')];
    if (text !== undefined) elm.title = text;
  });
  document.querySelectorAll('.lang-flag').forEach((flagEl) => {
    flagEl.innerHTML = LANG_FLAGS[currentLang] || LANG_FLAGS.fr;
  });
  document.documentElement.lang = currentLang;
}

function setLang(lang) {
  currentLang = I18N[lang] ? lang : 'fr';
  localStorage.setItem('oeria-dsm-lang', currentLang);
  applyI18n();
}

applyI18n();
document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => setLang(currentLang === 'fr' ? 'en' : 'fr'));
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
const authStatusBadge = el('authStatusBadge');
const authStatusDot = el('authStatusDot');
const authStatusText = el('authStatusText');
const dbStatusBadge = el('dbStatusBadge');
const dbStatusDot = el('dbStatusDot');
const dbStatusText = el('dbStatusText');

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
  wow: 'shield-fill',
  hytale: 'box-seam-fill',
};
const WOW_VERSION_LABELS = {
  vanilla: 'Vanilla / Classic',
  tbc: 'The Burning Crusade',
  wotlk: 'Wrath of the Lich King',
  cata: 'Cataclysm',
  mop: 'Mists of Pandaria',
  wod: 'Warlords of Draenor',
  legion: 'Legion',
  bfa: 'Battle for Azeroth',
  shadowlands: 'Shadowlands',
  dragonflight: 'Dragonflight',
  thewarwithin: 'The War Within',
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
  wow: 'World of Warcraft',
  hytale: 'Hytale',
};
const DEFAULT_ICON_COLOR = '#1f6fc0';

const ICON_PICKER_PRESETS = [
  'joystick', 'wrench-adjustable-circle-fill', 'cloud-fill', 'shield-lock-fill', 'hdd-network-fill',
  'server', 'hdd-stack-fill', 'database-fill', 'cpu-fill', 'controller',
  'rocket-fill', 'lightning-charge-fill', 'globe', 'wifi', 'gear-fill',
  'star-fill', 'gem', 'trophy-fill', 'fire', 'moon-stars-fill',
  'sun-fill', 'tree-fill', 'lock-fill', 'key-fill', 'flag-fill',
  'emoji-dizzy-fill', 'award-fill', 'puzzle-fill', 'compass-fill', 'map-fill',
  'heart-fill', 'diamond-fill', 'rocket-takeoff-fill', 'boxes', 'grid-3x3-gap-fill',
  'terminal-fill', 'bug-fill', 'droplet-fill', 'snow2', 'palette-fill',
  'brush-fill', 'building-fill', 'house-fill', 'lightbulb-fill', 'bell-fill',
  'chat-fill', 'cup-hot-fill', 'binoculars-fill', 'magic', 'radioactive',
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
  mainConsoleBatch.reset();
  currentConsoleLines = [];
  errorCount = 0;
  warnCount = 0;
  severityEntries = [];
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
  const isWow = cfg.game === 'wow';
  tpsBadge.classList.toggle('view-hidden', !isMinecraft);
  playersPanel.classList.toggle('view-hidden', !isMinecraft);
  authStatusBadge.classList.toggle('view-hidden', !isWow);
  dbStatusBadge.classList.toggle('view-hidden', !isWow);
  serverPathEl.textContent = isMinecraft || cfg.game === 'hytale'
    ? `${cfg.serverDir}\\${cfg.jarName} • RAM ${cfg.minRam}-${cfg.maxRam}`
    : cfg.game === 'wow' && cfg.wowVersion
    ? `${cfg.serverDir}\\${cfg.exePath} • ${WOW_VERSION_LABELS[cfg.wowVersion] || cfg.wowVersion}`
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
    case 'running': return t('status.running');
    case 'starting': return t('status.starting');
    case 'stopping': return t('status.stopping');
    default: return t('status.stopped');
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
const MAX_SEVERITY_ENTRIES = 500;
let severityEntries = []; // { line, kind: 'error' | 'warn' }

function updateSeverityBadges() {
  errorCountEl.textContent = errorCount;
  warnCountEl.textContent = warnCount;
  errorBadge.classList.toggle('show', errorCount > 0);
  warnBadge.classList.toggle('show', warnCount > 0);
}

// ---- Error / warn list modal ----
const severityModal = el('severityModal');
const severityModalTitle = el('severityModalTitle');
const severityModalIcon = el('severityModalIcon');
const severityConsole = el('severityConsole');
let severityModalKind = null;

function appendSeverityLine(entry) {
  const div = document.createElement('div');
  div.className = 'console-line ' + entry.kind;
  div.innerHTML = formatLogLine(entry.line);
  severityConsole.appendChild(div);
}

// Full rebuild only happens when the modal opens — a live update while it's already open (a new
// matching entry arriving) just appends that one line instead of re-rendering the whole list,
// which otherwise turns a burst of errors into an O(n²) DOM rebuild.
function renderSeverityModal() {
  severityConsole.innerHTML = '';
  const matching = severityEntries.filter((e) => e.kind === severityModalKind);
  if (matching.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'files-list-empty';
    empty.textContent = severityModalKind === 'error' ? t('server.noErrors') : t('server.noWarnings');
    severityConsole.appendChild(empty);
    return;
  }
  matching.forEach(appendSeverityLine);
}

function openSeverityModal(kind) {
  severityModalKind = kind;
  severityModalTitle.textContent = kind === 'error' ? t('server.errors') : t('server.warnings');
  severityModalIcon.className = kind === 'error' ? 'bi bi-x-circle-fill' : 'bi bi-exclamation-triangle-fill';
  renderSeverityModal();
  severityModal.classList.add('show');
}

el('severityClose').addEventListener('click', () => {
  // Just closes the list — the badge/count stays as-is so the button doesn't vanish out from
  // under the user right after they clicked it (it only disappears once the count is truly 0,
  // e.g. after switching servers).
  severityModal.classList.remove('show');
});

errorBadge.addEventListener('click', () => openSeverityModal('error'));
warnBadge.addEventListener('click', () => openSeverityModal('warn'));

const LOG_LEVEL_REGEX = /\[[^\]]*\b(WARN|ERROR|SEVERE|FATAL)\b[^\]]*\]/i;

function detectSeverity(entry) {
  if (entry.kind === 'error') return 'error';
  if (entry.kind === 'warn') return 'warn';
  const m = LOG_LEVEL_REGEX.exec(entry.line);
  if (m) return m[1].toUpperCase() === 'WARN' ? 'warn' : 'error';
  return null;
}

const MAX_CLIENT_CONSOLE_LINES = 1000;

// A burst of log lines (world generation spam, a server's startup, hundreds of script-loading
// messages) used to append + scroll the DOM on every single line as it arrived — synchronous,
// so a big enough burst visibly stutters the whole page. Queuing lines and flushing them in one
// batch per animation frame (same fix already applied to the WoW build console) caps the actual
// DOM work to 60 times a second no matter how fast messages come in.
function createBatchedConsole(container, maxLines, onFlush) {
  const maxPending = Math.max(maxLines * 5, 2000);
  let pending = [];
  let scheduled = false;

  function flush() {
    scheduled = false;
    if (pending.length === 0) return;
    const toRender = pending.length > maxLines ? pending.slice(-maxLines) : pending;
    pending = [];
    const fragment = document.createDocumentFragment();
    for (const entry of toRender) {
      const div = document.createElement('div');
      div.className = 'console-line ' + (entry.kind || 'info');
      div.innerHTML = formatLogLine(entry.line);
      fragment.appendChild(div);
    }
    container.appendChild(fragment);
    while (container.children.length > maxLines) container.removeChild(container.firstChild);
    if (onFlush) onFlush();
  }

  return {
    push(entry) {
      pending.push(entry);
      if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    },
    reset() {
      pending = [];
      scheduled = false;
      container.innerHTML = '';
    },
  };
}

const mainConsoleBatch = createBatchedConsole(consoleEl, MAX_CLIENT_CONSOLE_LINES, () => {
  if (autoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
});

function addConsoleLine(entry) {
  mainConsoleBatch.push(entry);
  currentConsoleLines.push(entry.line);
  if (currentConsoleLines.length > MAX_CLIENT_CONSOLE_LINES) currentConsoleLines.shift();

  const severity = detectSeverity(entry);
  if (severity === 'error' || severity === 'warn') {
    severityEntries.push({ line: entry.line, kind: severity });
    if (severityEntries.length > MAX_SEVERITY_ENTRIES) severityEntries.shift();
    if (severity === 'error') errorCount++; else warnCount++;
    updateSeverityBadges();
    if (severityModal.classList.contains('show') && severityModalKind === severity) {
      const emptyPlaceholder = severityConsole.querySelector('.files-list-empty');
      if (emptyPlaceholder) emptyPlaceholder.remove();
      appendSeverityLine({ line: entry.line, kind: severity });
      severityConsole.scrollTop = severityConsole.scrollHeight;
    }
  }
}

function formatMem(bytes) {
  if (!bytes) return '0 ko';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

socket.on('console:history', ({ id, history }) => {
  if (id === logsViewId) {
    logsConsoleBatch.reset();
    logsConsoleLines = [];
    history.forEach(addLogsConsoleLine);
  }
  if (id !== currentServerId) return;
  mainConsoleBatch.reset();
  currentConsoleLines = [];
  errorCount = 0;
  warnCount = 0;
  severityEntries = [];
  history.forEach(addConsoleLine);
  updateSeverityBadges();
});

socket.on('console:line', ({ id, entry }) => {
  if (id === logsViewId) addLogsConsoleLine(entry);
  if (id === currentServerId) addConsoleLine(entry);
});
socket.on('status', (data) => { if (data.id === currentServerId) updateStatusUI(data); });

function applyAuthStatus(status) {
  authStatusDot.className = 'dot ' + status;
  authStatusText.textContent = 'Auth';
  authStatusBadge.title = status === 'running' ? "Serveur d'authentification en ligne" : "Serveur d'authentification hors ligne";
}
socket.on('authStatus', (data) => { if (data.id === currentServerId) applyAuthStatus(data.status); });

function applyDbStatus(open) {
  dbStatusDot.className = 'dot ' + (open ? 'running' : 'stopped');
  dbStatusText.textContent = 'MySQL';
  dbStatusBadge.title = open ? 'Base de données MySQL en ligne' : 'Base de données MySQL hors ligne';
}
socket.on('wowMysqlStatus', ({ open }) => applyDbStatus(open));

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

const logsConsoleBatch = createBatchedConsole(logsConsole, MAX_CLIENT_CONSOLE_LINES, () => {
  logsConsole.scrollTop = logsConsole.scrollHeight;
});

function addLogsConsoleLine(entry) {
  logsConsoleBatch.push(entry);
  logsConsoleLines.push(entry.line);
  if (logsConsoleLines.length > MAX_CLIENT_CONSOLE_LINES) logsConsoleLines.shift();
}

function openLogsModal(id, name) {
  logsViewId = id;
  logsViewName = name;
  logsModalTitle.textContent = `Logs — ${name}`;
  logsConsoleBatch.reset();
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
const newServerWowFields = el('newServerWowFields');
const newServerHytaleFields = el('newServerHytaleFields');
const createServerError = el('createServerError');

function showCreateServerError(message) {
  createServerError.textContent = message;
  createServerError.classList.toggle('show', !!message);
}

function toggleCreateFields() {
  const isMc = newServerGame.value === 'minecraft';
  const isWow = newServerGame.value === 'wow';
  const isHytale = newServerGame.value === 'hytale';
  newServerMcFields.classList.toggle('view-hidden', !isMc);
  // WoW's port and executable are auto-detected from the folder, so those inputs stay out of the way.
  newServerGmodFields.classList.toggle('view-hidden', isMc || isWow || isHytale);
  el('newServerPortField').classList.toggle('view-hidden', isWow);
  newServerWowFields.classList.toggle('view-hidden', !isWow);
  newServerHytaleFields.classList.toggle('view-hidden', !isHytale);
  el('newServerName').placeholder = isWow ? 'Laisser vide = nom du dossier' : 'Mon serveur';
  if (isWow) toggleWowBuildAvailability();
}
newServerGame.addEventListener('change', toggleCreateFields);

el('btnCreateServer').addEventListener('click', () => {
  pendingCloneId = null;
  createServerForm.reset();
  toggleCreateFields();
  showCreateServerError('');
  resetWowBuildUI();
  el('newServerColor').value = DEFAULT_ICON_COLOR;
  renderIconPicker('newServerIconGrid', 'newServerIcon', 'newServerColor', 'newServerIconPreview');
  createServerModal.classList.add('show');
});
el('createServerCancel').addEventListener('click', () => createServerModal.classList.remove('show'));

// ---- WoW automated build (compile AzerothCore into the chosen folder) ----
const newServerWowVersion = el('newServerWowVersion');
const btnWowBuild = el('btnWowBuild');
const wowBuildVersionNote = el('wowBuildVersionNote');
const wowBuildModal = el('wowBuildModal');
const wowBuildConsole = el('wowBuildConsole');
const wowBuildStatusText = el('wowBuildStatusText');
const wowBuildProgressFill = el('wowBuildProgressFill');
const WOW_BUILDABLE_VERSIONS = new Set(['vanilla', 'tbc', 'wotlk', 'cata', 'mop']);
let currentWowBuildId = null;
let currentWowBuildStatus = null;
let wowBuildProgressPercent = 0;
let wowBuildAutoCreateDone = false;
let currentWowBuildIsDepsOnly = false;

// No real percentage is available from the build itself (just a log stream), so this
// approximates progress from the same "[Dashboard] ..." markers already logged server-side —
// good enough to show movement without pretending to be exact.
const WOW_BUILD_PROGRESS_STAGES = [
  ['Téléchargement de vcpkg', 5],
  ['Initialisation de vcpkg', 8],
  ['Installation de Boost et OpenSSL via vcpkg', 12],
  ['MySQL introuvable', 45],
  ['MySQL installé dans', 55],
  ['Téléchargement des sources', 58],
  ['Sources déjà présentes', 58],
  ['Configuration CMake', 62],
  ['Compilation en cours (authserver', 68],
  ['Copie des exécutables', 96],
  ['Terminé :', 99],
];

function setWowBuildProgress(percent, statusClass) {
  wowBuildProgressPercent = percent;
  wowBuildProgressFill.style.width = `${percent}%`;
  wowBuildProgressFill.className = 'wow-build-progress-fill' + (statusClass ? ` ${statusClass}` : '');
}

function advanceWowBuildProgressFromLine(line) {
  const stage = WOW_BUILD_PROGRESS_STAGES.find(([marker]) => line.includes(marker));
  if (stage && stage[1] > wowBuildProgressPercent) setWowBuildProgress(stage[1], 'status-running');
}

function isWowBuildActive() {
  return !!currentWowBuildId && (currentWowBuildStatus === 'running' || currentWowBuildStatus === 'pending');
}

function toggleWowBuildAvailability() {
  const buildable = WOW_BUILDABLE_VERSIONS.has(newServerWowVersion.value);
  btnWowBuild.disabled = !buildable && !isWowBuildActive();
  wowBuildVersionNote.classList.toggle('view-hidden', buildable);
}
newServerWowVersion.addEventListener('change', toggleWowBuildAvailability);

// A full AzerothCore build with MSBuild's /m can print tens of thousands of lines (one build
// system compiles many hundreds of script files). Appending + auto-scrolling on every single
// line as it arrives forces a synchronous layout reflow each time, which is what was freezing/
// crashing the tab — so incoming lines are queued and flushed in one batch per animation frame,
// and the DOM is capped so it can't grow unbounded over a long build.
const MAX_WOW_BUILD_CONSOLE_LINES = 500;
let wowBuildPendingLines = [];
let wowBuildFlushScheduled = false;

// Kept separately from the (DOM-capped) rendered console so "download the log" still gets the
// full build output, not just the last 500 visible lines.
const MAX_WOW_BUILD_DOWNLOAD_LINES = 20000;
let wowBuildAllLines = [];

function resetWowBuildUI() {
  currentWowBuildId = null;
  currentWowBuildStatus = null;
  wowBuildAutoCreateDone = false;
  currentWowBuildIsDepsOnly = false;
  wowBuildModal.classList.remove('show');
  wowBuildConsole.innerHTML = '';
  wowBuildPendingLines = [];
  wowBuildAllLines = [];
  setWowBuildProgress(0, null);
  toggleWowBuildAvailability();
}

function flushWowBuildLines() {
  wowBuildFlushScheduled = false;
  if (wowBuildPendingLines.length === 0) return;
  // A single compiler error can dump thousands of lines at once (template instantiation
  // spam). Scanning all of them for progress markers is cheap, but only the tail end is
  // ever going to survive the DOM cap below, so only that tail is actually rendered —
  // otherwise one giant burst can still do enough synchronous DOM work in a single frame
  // to freeze/crash the tab even with capping applied afterwards.
  for (const entry of wowBuildPendingLines) advanceWowBuildProgressFromLine(entry.line);
  const toRender = wowBuildPendingLines.slice(-MAX_WOW_BUILD_CONSOLE_LINES);
  wowBuildPendingLines = [];

  const fragment = document.createDocumentFragment();
  for (const entry of toRender) {
    const div = document.createElement('div');
    div.className = 'console-line ' + (entry.kind || 'info');
    div.textContent = entry.line;
    fragment.appendChild(div);
  }
  wowBuildConsole.appendChild(fragment);
  while (wowBuildConsole.children.length > MAX_WOW_BUILD_CONSOLE_LINES) {
    wowBuildConsole.removeChild(wowBuildConsole.firstChild);
  }
  wowBuildConsole.scrollTop = wowBuildConsole.scrollHeight;
}

const MAX_WOW_BUILD_PENDING_LINES = 5000;

function addWowBuildLine(entry) {
  wowBuildAllLines.push(entry.line);
  if (wowBuildAllLines.length > MAX_WOW_BUILD_DOWNLOAD_LINES) wowBuildAllLines.shift();
  wowBuildPendingLines.push(entry);
  // Cap the queue itself too: if lines are arriving faster than animation frames can flush
  // them (a very large burst), drop the oldest queued ones rather than letting it grow
  // without bound until the next frame gets a chance to run.
  if (wowBuildPendingLines.length > MAX_WOW_BUILD_PENDING_LINES) {
    wowBuildPendingLines.splice(0, wowBuildPendingLines.length - MAX_WOW_BUILD_PENDING_LINES);
  }
  if (!wowBuildFlushScheduled) {
    wowBuildFlushScheduled = true;
    requestAnimationFrame(flushWowBuildLines);
  }
}

function applyWowBuildStatus(status) {
  currentWowBuildStatus = status;
  if (status === 'running' || status === 'pending') {
    wowBuildStatusText.className = 'wow-build-status status-running';
    wowBuildStatusText.textContent = 'Compilation en cours... (20 à 60 minutes)';
    btnWowBuild.disabled = true;
  } else if (status === 'done') {
    wowBuildStatusText.className = 'wow-build-status status-done';
    btnWowBuild.disabled = false;
    setWowBuildProgress(100, 'status-done');
    if (currentWowBuildIsDepsOnly) {
      wowBuildStatusText.textContent = 'Dépendances installées.';
    } else if (!wowBuildAutoCreateDone) {
      wowBuildAutoCreateDone = true;
      wowBuildStatusText.textContent = 'Terminé — création du serveur...';
      submitCreateServer((created) => {
        wowBuildStatusText.textContent = created
          ? 'Terminé — serveur créé !'
          : "Compilation terminée, mais la création du serveur a échoué (voir le message dans le formulaire).";
        if (created) setTimeout(() => wowBuildModal.classList.remove('show'), 1200);
      });
    } else {
      wowBuildStatusText.textContent = 'Terminé — serveur déjà créé.';
    }
  } else if (status === 'error') {
    wowBuildStatusText.className = 'wow-build-status status-error';
    wowBuildStatusText.textContent = 'Échec de la compilation, voir les logs ci-dessous.';
    btnWowBuild.disabled = false;
    setWowBuildProgress(wowBuildProgressPercent, 'status-error');
  }
}

el('wowBuildClose').addEventListener('click', () => wowBuildModal.classList.remove('show'));
el('wowBuildExport').addEventListener('click', () => {
  downloadTextFile('wow-build-log.txt', wowBuildAllLines.join('\n'));
});

// ---- WoW build dependencies checklist ----
const wowDepsModal = el('wowDepsModal');
const wowDepsList = el('wowDepsList');
const wowBuildModalTitle = el('wowBuildModalTitle');
const btnWowDepsInstall = el('btnWowDepsInstall');

function setWowDepItem(dep, state) {
  const item = wowDepsList.querySelector(`[data-dep="${dep}"]`);
  if (!item) return;
  item.classList.remove('deps-ok', 'deps-missing');
  const icon = item.querySelector('.wow-deps-icon');
  const status = item.querySelector('.wow-deps-status');
  if (state === null) {
    icon.className = 'bi bi-hourglass-split wow-deps-icon';
    status.textContent = t('wowDeps.checking');
  } else if (state) {
    item.classList.add('deps-ok');
    icon.className = 'bi bi-check-circle-fill wow-deps-icon';
    status.textContent = t('wowDeps.ok');
  } else {
    item.classList.add('deps-missing');
    icon.className = 'bi bi-x-circle-fill wow-deps-icon';
    status.textContent = t('wowDeps.missing');
  }
}

function refreshWowDeps() {
  ['git', 'cmake', 'visualStudio', 'boostOpenssl', 'mysql'].forEach((dep) => setWowDepItem(dep, null));
  socket.emit('wow:deps:check', {}, (status) => {
    Object.entries(status || {}).forEach(([dep, ok]) => setWowDepItem(dep, ok));
  });
}

el('btnWowDeps').addEventListener('click', () => {
  wowDepsModal.classList.add('show');
  refreshWowDeps();
});
el('wowDepsClose').addEventListener('click', () => wowDepsModal.classList.remove('show'));

btnWowDepsInstall.addEventListener('click', () => {
  btnWowDepsInstall.disabled = true;
  socket.emit('wow:deps:start', {}, (result) => {
    btnWowDepsInstall.disabled = false;
    if (result && result.error) {
      showCreateServerError(result.error);
      return;
    }
    currentWowBuildId = result.buildId;
    currentWowBuildIsDepsOnly = true;
    wowBuildConsole.innerHTML = '';
    wowBuildAllLines = [];
    setWowBuildProgress(2, 'status-running');
    wowBuildModalTitle.textContent = t('wowBuild.titleDeps');
    wowBuildStatusText.className = 'wow-build-status status-running';
    wowBuildStatusText.textContent = 'Démarrage...';
    wowDepsModal.classList.remove('show');
    wowBuildModal.classList.add('show');
  });
});

btnWowBuild.addEventListener('click', () => {
  // A build for this session is already running: just reopen the progress window on it.
  if (isWowBuildActive()) {
    wowBuildModal.classList.add('show');
    socket.emit('wow:build:join', { buildId: currentWowBuildId });
    return;
  }

  const serverDir = el('newServerDir').value.trim();
  if (!serverDir) {
    showCreateServerError('Indique le dossier du serveur avant de lancer la compilation.');
    return;
  }
  showCreateServerError('');
  wowBuildConsole.innerHTML = '';
  wowBuildAutoCreateDone = false;
  currentWowBuildIsDepsOnly = false;
  wowBuildModalTitle.textContent = t('wowBuild.title');
  setWowBuildProgress(2, 'status-running');
  wowBuildModal.classList.add('show');
  btnWowBuild.disabled = true;
  wowBuildStatusText.className = 'wow-build-status status-running';
  wowBuildStatusText.textContent = 'Démarrage de la compilation...';

  socket.emit('wow:build:start', { serverDir, versionKey: newServerWowVersion.value }, (result) => {
    if (result && result.error) {
      wowBuildStatusText.className = 'wow-build-status status-error';
      wowBuildStatusText.textContent = result.error;
      btnWowBuild.disabled = false;
      return;
    }
    currentWowBuildId = result.buildId;
  });
});

socket.on('wowBuild:line', ({ buildId, entry }) => {
  if (buildId === currentWowBuildId) addWowBuildLine(entry);
});

socket.on('wowBuild:status', ({ buildId, status }) => {
  if (buildId === currentWowBuildId) applyWowBuildStatus(status);
});

socket.on('wowBuild:history', ({ buildId, history, status }) => {
  if (buildId !== currentWowBuildId) return;
  wowBuildConsole.innerHTML = '';
  wowBuildPendingLines = [];
  wowBuildAllLines = [];
  setWowBuildProgress(0, null);
  history.forEach(addWowBuildLine);
  applyWowBuildStatus(status);
});

// ---- Clone an existing server into the create form ----
let pendingCloneId = null;

function fillCloneForm(cfg) {
  createServerForm.reset();
  showCreateServerError('');
  resetWowBuildUI();
  el('newServerName').value = `${cfg.name} (copie)`;
  newServerGame.value = cfg.game;
  toggleCreateFields();
  el('newServerPort').value = cfg.gamePort || '';
  el('newServerJar').value = cfg.jarName || '';
  el('newServerJava').value = cfg.javaPath || '';
  el('newServerMinRam').value = cfg.minRam || '';
  el('newServerMaxRam').value = cfg.maxRam || '';
  el('newServerExe').value = cfg.exePath || '';
  el('newServerWowVersion').value = cfg.wowVersion || 'wotlk';
  toggleWowBuildAvailability();
  el('newServerHytaleJar').value = cfg.jarName || '';
  el('newServerHytaleJava').value = cfg.javaPath || '';
  el('newServerHytaleMinRam').value = cfg.minRam || '';
  el('newServerHytaleMaxRam').value = cfg.maxRam || '';
  el('newServerAssetsPath').value = cfg.assetsPath || '';
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
    resetWowBuildUI();
    el('newServerColor').value = DEFAULT_ICON_COLOR;
    renderIconPicker('newServerIconGrid', 'newServerIcon', 'newServerColor', 'newServerIconPreview');
  }
  pendingCloneId = id;
  createServerModal.classList.add('show');
  socket.emit('server:join', { id });
}

function submitCreateServer(onDone) {
  const name = el('newServerName').value.trim();
  const serverDir = el('newServerDir').value.trim();
  const isWowCreate = newServerGame.value === 'wow';
  const isHytaleCreate = newServerGame.value === 'hytale';
  if ((!name && !isWowCreate) || !serverDir) {
    showCreateServerError('Le nom et le dossier du serveur sont obligatoires.');
    return;
  }
  showCreateServerError('');

  const payload = {
    name,
    game: newServerGame.value,
    serverDir,
    gamePort: el('newServerPort').value,
    jarName: (isHytaleCreate ? el('newServerHytaleJar') : el('newServerJar')).value.trim(),
    javaPath: (isHytaleCreate ? el('newServerHytaleJava') : el('newServerJava')).value.trim(),
    minRam: (isHytaleCreate ? el('newServerHytaleMinRam') : el('newServerMinRam')).value.trim(),
    maxRam: (isHytaleCreate ? el('newServerHytaleMaxRam') : el('newServerMaxRam')).value.trim(),
    assetsPath: el('newServerAssetsPath').value.trim(),
    exePath: el('newServerExe').value.trim(),
    wowVersion: el('newServerWowVersion').value,
    icon: el('newServerIcon').value.trim(),
    color: el('newServerColor').value,
  };
  socket.emit('servers:create', payload, (result) => {
    if (result && result.error) {
      showCreateServerError(result.error);
      if (onDone) onDone(false);
      return;
    }
    createServerModal.classList.remove('show');
    if (onDone) onDone(true);
  });
}

createServerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitCreateServer();
});

// ---- Settings modal ----
const settingsModal = el('settingsModal');
const settingsForm = el('settingsForm');
const setMcFields = el('setMcFields');
const setGmodFields = el('setGmodFields');
const setWowFields = el('setWowFields');
const setHytaleFields = el('setHytaleFields');

function openSettingsModal() {
  const cfg = serverConfigs.get(currentServerId);
  if (!cfg) return;
  const isMc = cfg.game === 'minecraft';
  const isWow = cfg.game === 'wow';
  const isHytale = cfg.game === 'hytale';
  setMcFields.classList.toggle('view-hidden', !isMc);
  setGmodFields.classList.toggle('view-hidden', isMc || isWow || isHytale);
  setWowFields.classList.toggle('view-hidden', !isWow);
  setHytaleFields.classList.toggle('view-hidden', !isHytale);
  if (isWow) {
    el('setWowVersion').value = cfg.wowVersion || 'wotlk';
    el('setWowAuthExe').value = cfg.authExePath || '';
    el('setWowExe').value = cfg.exePath || '';
  }
  if (isHytale) {
    el('setHytaleJar').value = cfg.jarName || '';
    el('setHytaleJava').value = cfg.javaPath || '';
    el('setHytaleMinRam').value = cfg.minRam || '';
    el('setHytaleMaxRam').value = cfg.maxRam || '';
    el('setAssetsPath').value = cfg.assetsPath || '';
  }

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
  } else if (cfg.game === 'wow') {
    patch.exePath = el('setWowExe').value.trim();
    patch.wowVersion = el('setWowVersion').value;
    patch.authExePath = el('setWowAuthExe').value.trim() || null;
  } else if (cfg.game === 'hytale') {
    patch.jarName = el('setHytaleJar').value.trim();
    patch.javaPath = el('setHytaleJava').value.trim();
    patch.minRam = el('setHytaleMinRam').value.trim();
    patch.maxRam = el('setHytaleMaxRam').value.trim();
    patch.assetsPath = el('setAssetsPath').value.trim();
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
