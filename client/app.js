/**
 * app.js — PocketDex PWA main logic
 *
 * Connection flow:
 *   1. Extract #token=JWT (or legacy ?token=JWT) or reuse a stored device session token
 *   2. Connect to Socket.IO with auto-reconnect enabled
 *   3. If Codex is not authenticated, start ChatGPT login from the phone
 *   4. On connect: receive session_state (resume threadId if present) or start a new thread
 *   4. Stream notifications (agentMessage deltas, reasoning, turn state)
 *   5. Show approval overlay on serverRequest
 *   6. Send turn/start on user input; turn/interrupt on stop
 */
(function () {
  'use strict';

  // ── i18n shorthand ───────────────────────────────────────────────
  function t(key) { return window.i18n ? window.i18n.t(key) : key; }

  // ── Configure marked.js ─────────────────────────────────────────
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  // ── Configure Prism.js autoloader ────────────────────────────────
  if (typeof Prism !== 'undefined' && Prism.plugins && Prism.plugins.autoloader) {
    Prism.plugins.autoloader.languages_path = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/';
  }

  // ── DOM refs ────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const rootStyle = document.documentElement ? document.documentElement.style : null;

  const installBanner        = $('install-banner');
  const installBtn           = $('install-btn');
  const installDismissBtn    = $('install-dismiss');
  const iosInstallHint       = $('ios-install-hint');
  const screenConnecting     = $('screen-connecting');
  const screenError          = $('screen-error');
  const screenMain           = $('screen-main');
  const errorMessage         = $('error-message');
  const messagesEl           = $('messages');
  const emptyState           = $('empty-state');
  const userInput            = $('user-input');
  const sendBtn              = $('send-btn');
  const stopBtn              = $('stop-btn');
  const voiceBtn             = $('voice-btn');
  const statusDot            = $('status-dot');
  const modelPicker          = $('model-picker');
  const headerCwd            = $('header-cwd');
  const composerContextBar   = $('composer-context-bar');
  const composerContextSummary = $('composer-context-summary');
  const disconnectedBanner   = $('disconnected-banner');
  const approvalOverlay      = $('approval-overlay');
  const approvalBadge        = $('approval-badge');
  const approvalTitle        = $('approval-title');
  const approvalDetailLabel  = $('approval-detail-label');
  const approvalDetail       = $('approval-detail');
  const approvalApprove      = $('approval-approve');
  const approvalApproveAll   = $('approval-approve-all');
  const approvalDeny         = $('approval-deny');
  const toastEl              = $('toast');
  const accountBanner        = $('account-banner');
  const accountBannerTitle   = $('account-banner-title');
  const accountBannerText    = $('account-banner-text');
  const accountLoginBtn      = $('account-login-btn');
  const accountBannerClose   = $('account-banner-close');
  const chatStatusStack      = $('chat-status-stack');
  const headerInsights       = $('header-insights');
  const rateSummaryBar       = $('rate-summary-bar');
  const rateSummaryStatus    = $('rate-summary-status');
  const rateSummaryCards     = $('rate-summary-cards');
  const activeTurnChip       = $('active-turn-chip');
  const activeTurnChipHint   = $('active-turn-chip-hint');
  const settingsBtn          = $('settings-btn');
  const settingsOverlay      = $('settings-overlay');
  const settingsBackdrop     = $('settings-backdrop');
  const settingsCloseBtn     = $('settings-close-btn');
  const settingsAccountStatus = $('settings-account-status');
  const settingsAccountEmail = $('settings-account-email');
  const settingsAccountPlan  = $('settings-account-plan');
  const settingsConnectionStatus = $('settings-connection-status');
  const settingsCurrentModel = $('settings-current-model');
  const settingsCwdValue     = $('settings-cwd-value');
  const settingsRateStatus   = $('settings-rate-status');
  const settingsRateLimits   = $('settings-rate-limits');
  const settingsRateRefresh  = $('settings-rate-refresh');
  const settingsVoiceToggle  = $('settings-voice-toggle');
  const settingsVoiceStatus  = $('settings-voice-status');
  const settingsVoiceHint    = $('settings-voice-hint');
  const settingsEnterToggle  = $('settings-enter-toggle');
  const settingsCompactCommandsToggle = $('settings-compact-commands-toggle');
  const settingsRateSummaryToggle = $('settings-rate-summary-toggle');
  const settingsRateSummaryNote = $('settings-rate-summary-note');
  const settingsThemeSelect  = $('settings-theme-select');
  const settingsThemeStatus  = $('settings-theme-status');
  const settingsLanguageSelect = $('settings-language-select');
  const settingsThreadsRefresh = null; // moved to history drawer
  const settingsThreadsStatus = null;  // moved to history drawer
  const settingsThreadsList  = null;   // moved to history drawer
  const historyBtn           = $('history-btn');
  const historyOverlay       = $('history-overlay');
  const historyBackdrop      = $('history-backdrop');
  const historyCloseBtn      = $('history-close-btn');
  const historyRefreshBtn    = $('history-refresh-btn');
  const historyFilterGroup   = $('history-filter-group');
  const historyTabGroup      = $('history-tab-group');
  const historyPanelRecent   = $('history-panel-recent');
  const historyPanelSearch   = $('history-panel-search');
  const historyPanelNew      = $('history-panel-new');
  const historyStatus        = $('history-status');
  const historyThreadList    = $('history-thread-list');
  const historyCurrentWorkspaceCopy = $('history-current-workspace-copy');
  const historyWorkspaceList = $('history-workspace-list');
  const historyWorkspaceInput = $('history-workspace-input');
  const historyWorkspaceStartBtn = $('history-workspace-start-btn');
  const historyNewCurrentBtn = $('history-new-current-btn');
  const settingsInstallStatus = $('settings-install-status');
  const settingsInstallHint  = $('settings-install-hint');
  const settingsInstallAction = $('settings-install-action');
  const settingsQrRefreshBtn  = $('settings-qr-refresh-btn');
  const themeColorMeta       = document.querySelector('meta[name="theme-color"]');
  const turnProgressBar      = $('turn-progress-bar');
  const turnProgressFill     = $('turn-progress-fill');
  const turnStatsBadge       = $('turn-stats-badge');
  const approvalQueueBtn      = $('approval-queue-btn');
  const approvalQueueCount    = $('approval-queue-count');
  const approvalQueueDrawer   = $('approval-queue-drawer');
  const approvalQueueBackdrop = $('approval-queue-backdrop');
  const approvalQueueClose    = $('approval-queue-close');
  const approvalQueueList     = $('approval-queue-list');
  const scrollBottomBtn      = $('scroll-bottom-btn');
  const approvalTimerBar     = $('approval-timer-bar');
  const approvalTimerFill    = $('approval-timer-fill');
  const ctxMenu              = $('ctx-menu');
  const slashMenu            = $('slash-menu');
  const imageInput           = $('image-input');
  const fileInput            = $('file-input');
  const attachBtn            = $('attach-btn');
  const composerToolsMenu    = $('composer-tools-menu');
  const composerOpenAttachBtn = $('composer-open-attach-btn');
  const composerOpenCommandBtn = $('composer-open-command-btn');
  const composerModeGroup    = $('composer-mode-group');
  const composerSpeedGroup   = $('composer-speed-group');
  const imagePreviewArea     = $('image-preview-area');
  const attachSheetOverlay   = $('attach-sheet-overlay');
  const attachSheetBackdrop  = $('attach-sheet-backdrop');
  const attachSheetCloseBtn  = $('attach-sheet-close-btn');
  const attachDeviceBtn      = $('attach-device-btn');
  const attachWorkspaceBtn   = $('attach-workspace-btn');
  const workspaceSheetOverlay = $('workspace-sheet-overlay');
  const workspaceSheetBackdrop = $('workspace-sheet-backdrop');
  const workspaceSheetCloseBtn = $('workspace-sheet-close-btn');
  const workspaceSearchInput = $('workspace-search-input');
  const workspaceSearchStatus = $('workspace-search-status');
  const workspaceSearchResults = $('workspace-search-results');
  const commandSheetOverlay  = $('command-sheet-overlay');
  const commandSheetBackdrop = $('command-sheet-backdrop');
  const commandSheetCloseBtn = $('command-sheet-close-btn');
  const commandSheetCwd      = $('command-sheet-cwd');
  const commandSheetInput    = $('command-sheet-input');
  const commandRunBtn        = $('command-run-btn');
  const commandStopBtn       = $('command-stop-btn');
  const commandClearBtn      = $('command-clear-btn');
  const commandSheetStatus   = $('command-sheet-status');
  const commandSheetOutput   = $('command-sheet-output');
  const searchInput  = $('search-input');
  const searchCount  = $('search-count');
  const searchPrev   = $('search-prev');
  const searchNext   = $('search-next');
  const searchClose  = $('search-close');

  // ── State ────────────────────────────────────────────────────────
  let socket       = null;
  let threadId     = null;
  let turnActive   = false;
  let currentAiEl  = null;
  let currentAiModelEl = null;
  let thinkingEl   = null;
  let thinkingText = '';
  let pendingApprovalId = null;
  let pendingApprovalRequest = null;
  let pendingApprovalChoices = null;
  let pendingApprovalMap = new Map(); // id → request object
  let toastTimer   = null;
  let sessionStateReady = false;
  let accountReady = false;
  let authRequired = false;
  let accountInfo = null;
  let loginWindow = null;
  let loginPending = false;
  let pendingLoginId = null;
  let historyHydratedThreadId = null;
  let accountPollTimer = null;
  let authFailureStreak = 0;
  let settingsOpen = false;
  let historyOpen = false;
  let rateLimitsResult = null;
  let rateLimitsLoading = false;
  let rateLimitRefreshTimer = null;
  let rateLimitsUpdatedAt = 0;
  let useExtendedHistory = true;
  let historyUnavailableUntilFirstTurn = false;
  let accountStateSeen = false;
  let currentModelId = '';
  let currentModelLabel = '';
  let currentTurnModelLabel = '';
  let currentTurnId = '';
  let currentThreadTurnCount = 0;
  let modelCatalog = Object.create(null);
  let voiceSupported = false;
  let voiceEnabled = true;
  let sendOnEnter = true;
  let voiceRecognition = null;
  let voiceListening = false;
  let voiceBaseText = '';
  let accountBannerDismissed = false;
  let activeAccountBannerMode = '';
  let threadsListResult = null;
  let threadsListLoading = false;
  let pendingResumeThreadId = '';
  let pendingForkThreadId = '';
  let installDeferredPrompt = null;
  let installAvailable = false;
  let installSupported = false;
  let installDismissed = false;
  let installBannerSeen = false;
  let installCompleted = false;
  let installHintTimer = null;
  let showRateSummary = true;
  let themeMode = 'auto';
  let colorSchemeQuery = null;
  let scrollButtonHasUnread = false;
  let historyFilterMode = 'all';
  let historyTab = 'recent';
  let composerMenuOpen = false;
  let composerMenuHideTimer = null;
  let pendingFileAttachment = null;
  let pendingDraft = null;
  let composerMode = 'default';
  let composerSpeed = 'auto';
  let compactCommandCards = false;
  let attachSheetOpen = false;
  let workspaceSheetOpen = false;
  let workspaceSearchLoading = false;
  let workspaceSearchResultsState = [];
  let workspaceSearchTimer = null;
  let pendingWorkspaceSearchRequestId = '';
  let pendingWorkspaceFilePath = '';
  let pendingWorkspaceFileRequestId = '';
  let commandSheetOpen = false;
  let commandExecState = null;
  let pendingThreadReadRequestId = '';
  let pendingThreadStartRequestId = '';
  let pendingThreadStartOptions = null;
  let lastUserMessageText = '';
  let searchResults  = []; // Array of DOM mark elements with search-highlight class
  let searchIndex    = -1;
  let searchActive   = false;

  // ── Turn statistics (shared by progress bar + turn summary) ──────
  let turnStats = { toolCount: 0, fileCount: 0, startMs: 0, tokenCount: 0 };

  // ── RAF delta buffering (Item 14) ─────────────────────────────────
  let pendingDelta = '';
  let rafScheduled = false;

  // ── Approval timeout (Item 15) ───────────────────────────────────
  const APPROVAL_TIMEOUT_MS = 120_000;
  let approvalUrgentTimer = null;

  // ── Image attachment state (Item 9) ──────────────────────────────
  let pendingImageDataUrl = '';

  // ── Slash menu state (Item 7) ────────────────────────────────────
  let _slashSelectedIndex = -1;

  // ── Swipe approval state (Item 2) ────────────────────────────────
  let _swipeHandlers = null;
  let _approvalKeyHandler = null;
  const _activityCards = new Map();
  const _activityItems = new Map();
  const _activityOutputs = new Map();
  let _planCard = null;
  let _turnToolGroups = [];
  let _turnToolGroup = null;
  let _turnToolGroupCount = 0;

  const SESSION_TOKEN_KEY = 'pocketdex.sessionToken';
  const VOICE_INPUT_ENABLED_KEY = 'pocketdex.voiceInputEnabled';
  const THEME_MODE_KEY = 'pocketdex.themeMode';
  const SEND_ON_ENTER_KEY = 'pocketdex.sendOnEnter';
  const COMPACT_COMMAND_CARDS_KEY = 'pocketdex.compactCommandCards';
  const COMPOSER_MODE_KEY = 'pocketdex.composerMode';
  const COMPOSER_SPEED_KEY = 'pocketdex.composerSpeed';
  const WORKSPACE_HISTORY_KEY = 'pocketdex.workspaceHistory';
  const INSTALL_DISMISSED_KEY = 'pocketdex.installDismissed';
  const INSTALL_BANNER_SEEN_KEY = 'pocketdex.installBannerSeen';
  const INSTALL_COMPLETED_KEY = 'pocketdex.installCompleted';
  const RATE_SUMMARY_VISIBLE_KEY = 'pocketdex.rateSummaryVisible';
  let initialPairingToken = '';
  let activeCredential = '';
  let lastSocketCredential = '';
  let pairingFallbackAttempted = false;
  const approvalProtocol = window.PocketDexApprovalProtocol || null;
  const AUTH_FAILURE_THRESHOLD = 4;
  const RATE_LIMIT_AUTO_REFRESH_MS = 60_000;
  const FILE_ATTACHMENT_MAX_BYTES = 300_000;
  const THEME_META_COLORS = {
    dark: '#0d1117',
    light: '#f4efe3',
  };

  // ── Helpers ──────────────────────────────────────────────────────
  function showScreen(name) {
    [screenConnecting, screenError, screenMain].forEach((el) => {
      if (el) el.hidden = true;
    });
    if (name === 'connecting') screenConnecting.hidden = false;
    if (name === 'error')      screenError.hidden = false;
    if (name === 'main')       screenMain.hidden = false;
  }

  function showError(msg) {
    if (errorMessage) errorMessage.textContent = msg;
    showScreen('error');
  }

  function normalizeToastMessage(msg) {
    if (msg === null || msg === undefined) return '';
    if (typeof msg === 'string') return msg.trim();
    if (typeof msg === 'number' || typeof msg === 'boolean') return String(msg);
    if (typeof msg === 'object') {
      const fields = [
        'message', 'error', 'title', 'displayName', 'label', 'name',
        'detail', 'details', 'description', 'reason', 'additionalDetails', 'codexErrorInfo',
      ];
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(msg, field)) continue;
        const text = normalizeToastMessage(msg[field]);
        if (text) return text;
      }
      const keys = Object.keys(msg);
      if (keys.length === 1) {
        const nested = normalizeToastMessage(msg[keys[0]]);
        if (nested) return nested;
      }
      return '';
    }
    return String(msg).trim();
  }

  function parseEmbeddedJson(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const startsLikeJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (startsLikeJson) {
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return null;
      }
    }

    const objectStart = trimmed.indexOf('{');
    const arrayStart = trimmed.indexOf('[');
    let start = -1;
    if (objectStart >= 0 && arrayStart >= 0) start = Math.min(objectStart, arrayStart);
    else start = Math.max(objectStart, arrayStart);
    if (start < 0) return null;

    const candidate = trimmed.slice(start).trim();
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch (_) {
      return null;
    }
  }

  function getUserFacingErrorText(errorLike, fallback) {
    if (typeof errorLike === 'string') {
      const text = errorLike
        .replace(/^Codex RPC error:\s*/i, '')
        .replace(/^Error:\s*/i, '')
        .trim();
      if (!text) return fallback || '';
      const parsed = parseEmbeddedJson(text);
      if (parsed) return getUserFacingErrorText(parsed, fallback);
      if (text === '[object Object]') return fallback || '';
      return text;
    }
    return normalizeToastMessage(errorLike) || fallback || '';
  }

  function formatErrorDisplay(errorLike, fallback) {
    return getUserFacingErrorText(errorLike, fallback) || fallback || '';
  }

  function showToast(msg, duration) {
    const text = normalizeToastMessage(msg);
    if (!toastEl || !text) return;
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration || 3000);
  }

  function formatUiText(template, values) {
    return String(template || '').replace(/\{(\w+)\}/g, function (_, key) {
      if (!values || values[key] === undefined || values[key] === null) return '';
      return String(values[key]);
    });
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function loadStoredValue(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storeValue(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Ignore storage failures.
    }
  }

  function removeStoredValue(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }

  function loadBooleanSetting(key, fallbackValue) {
    const stored = loadStoredValue(key);
    if (stored === null) return fallbackValue;
    return stored !== 'false';
  }

  function loadNumberSetting(key, fallbackValue) {
    const stored = loadStoredValue(key);
    if (!stored) return fallbackValue;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : fallbackValue;
  }

  function loadThemeMode() {
    const stored = loadStoredValue(THEME_MODE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  }

  function loadComposerMode() {
    const stored = loadStoredValue(COMPOSER_MODE_KEY);
    return stored === 'plan' ? 'plan' : 'default';
  }

  function loadComposerSpeed() {
    const stored = loadStoredValue(COMPOSER_SPEED_KEY);
    if (stored === 'fast' || stored === 'flex') return stored;
    return 'auto';
  }

  function loadRateSummaryVisible() {
    return loadBooleanSetting(RATE_SUMMARY_VISIBLE_KEY, true);
  }

  function loadWorkspaceHistory() {
    try {
      const raw = loadStoredValue(WORKSPACE_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()) : [];
    } catch {
      return [];
    }
  }

  function storeWorkspaceHistory(paths) {
    try {
      const next = Array.isArray(paths) ? paths.slice(0, 8) : [];
      storeValue(WORKSPACE_HISTORY_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }

  function isStandaloneDisplayMode() {
    return !!(
      window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
    ) || window.navigator.standalone === true;
  }

  function loadInstallState() {
    installDismissed = loadStoredValue(INSTALL_DISMISSED_KEY) === 'true';
    installBannerSeen = loadStoredValue(INSTALL_BANNER_SEEN_KEY) === 'true';
    installCompleted = loadStoredValue(INSTALL_COMPLETED_KEY) === 'true' || isStandaloneDisplayMode();
  }

  function loadStoredSessionToken() {
    return loadStoredValue(SESSION_TOKEN_KEY) || '';
  }

  function storeSessionToken(token) {
    if (!token) return;
    activeCredential = token;
    storeValue(SESSION_TOKEN_KEY, token);
  }

  function clearStoredSessionToken() {
    removeStoredValue(SESSION_TOKEN_KEY);
    activeCredential = '';
  }

  function getSocketCredential() {
    return activeCredential || loadStoredSessionToken() || initialPairingToken;
  }

  function clearPairingCredential() {
    initialPairingToken = '';
    if (activeCredential === lastSocketCredential) {
      activeCredential = loadStoredSessionToken() || '';
    }
    removePairingTokenFromUrl();
  }

  function removePairingTokenFromUrl() {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.has('token')) {
      url.searchParams.delete('token');
      changed = true;
    }

    const rawHash = window.location.hash || '';
    if (rawHash.startsWith('#')) {
      const hashBody = rawHash.slice(1);
      if (hashBody.includes('=')) {
        const hashParams = new URLSearchParams(hashBody);
        if (hashParams.has('token')) {
          hashParams.delete('token');
          const nextHash = hashParams.toString();
          url.hash = nextHash ? '#' + nextHash : '';
          changed = true;
        }
      }
    }

    if (!changed) return;

    const nextUrl = url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : '');
    history.replaceState(null, '', nextUrl || window.location.pathname);
  }

  function formatTime(valueMs) {
    try {
      const normalized = valueMs && valueMs < 1e12 ? valueMs * 1000 : valueMs;
      return new Date(normalized).toLocaleTimeString(getIntlLocale(), {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function formatDateTime(valueMs) {
    try {
      const normalized = valueMs && valueMs < 1e12 ? valueMs * 1000 : valueMs;
      return new Date(normalized).toLocaleString(getIntlLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function formatElapsedLabel(valueMs) {
    const ms = Number(valueMs);
    if (!Number.isFinite(ms) || ms <= 0) return t('activity_elapsed_short');
    const totalSeconds = Math.max(1, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours) parts.push(hours + 'h');
    if (minutes) parts.push(minutes + 'm');
    if (seconds || parts.length === 0) parts.push(seconds + 's');
    return parts.join(' ');
  }

  function decodeBase64ToText(dataBase64) {
    if (!dataBase64) return '';
    try {
      const binary = atob(dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(bytes);
      }
      let decoded = '';
      for (let i = 0; i < bytes.length; i++) decoded += String.fromCharCode(bytes[i]);
      return decoded;
    } catch {
      return '';
    }
  }

  function getWorkspaceRoot() {
    return (headerCwd && headerCwd.title) || '';
  }

  function makeRuntimeId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function emitSocketRequest(method, params, clientRequestId) {
    if (!socket) return '';
    const requestId = clientRequestId || makeRuntimeId('req');
    socket.emit('request', {
      method,
      params,
      clientRequestId: requestId,
    });
    return requestId;
  }

  function buildCommandExecArgv(commandText) {
    const raw = String(commandText || '').trim();
    if (!raw) return [];
    const cwd = getWorkspaceRoot();
    const isWindows = /^[a-zA-Z]:[\\/]/.test(cwd);
    return isWindows
      ? ['cmd', '/d', '/s', '/c', raw]
      : ['sh', '-lc', raw];
  }

  function resolveWorkspaceSearchPath(file) {
    if (!file) return '';
    const filePath = String(file.path || '');
    if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(filePath)) return filePath;
    const root = String(file.root || '');
    if (!root) return filePath;
    const sep = /\\/.test(root) ? '\\' : '/';
    return root.replace(/[\\/]+$/, '') + sep + filePath.replace(/^[\\/]+/, '');
  }

  function getStatePillLabel(state) {
    const labels = {
      idle:       '',
      connecting: t('status_connecting'),
      thinking:   t('status_thinking'),
      streaming:  t('status_streaming'),
      approval:   t('status_approval'),
      error:      t('status_error'),
      connected:  '',
    };
    return labels[state] ?? '';
  }

  function setStatus(state) {
    if (!statusDot) return;
    statusDot.setAttribute('data-state', state || 'idle');
    const labelEl = statusDot.querySelector('.status-pill-label');
    if (labelEl) {
      const label = getStatePillLabel(state);
      labelEl.textContent = label;
      statusDot.setAttribute('aria-label', label ? `Status: ${label}` : 'Status');
    }
    renderSettings();
  }

  // Turn progress timers
  let _progressTimer1 = null;
  let _progressTimer2 = null;
  let _progressCompleteTimer = null;

  function setTurnActive(active) {
    turnActive = active;
    sendBtn.classList.toggle('stop-mode', active);
    if (stopBtn) stopBtn.classList.toggle('visible', active);
    if (active) {
      sendBtn.disabled = false;
      sendBtn.setAttribute('aria-label', 'Stop current turn');
    } else {
      sendBtn.setAttribute('aria-label', 'Send message');
    }
    const header = $('header');
    if (header) header.classList.toggle('thinking-active', active);
    if (active) {
      setStatus('thinking');
      sendBtn.setAttribute('aria-disabled', 'true');
      // Progress bar: animate to simulate progression
      if (turnProgressBar && turnProgressFill) {
        clearTimeout(_progressTimer1);
        clearTimeout(_progressTimer2);
        clearTimeout(_progressCompleteTimer);
        turnProgressFill.style.transition = 'none';
        turnProgressFill.style.width = '0%';
        turnProgressBar.classList.add('active');
        requestAnimationFrame(() => {
          turnProgressFill.style.transition = 'width 0.5s ease';
          turnProgressFill.style.width = '5%';
          _progressTimer1 = setTimeout(() => { turnProgressFill.style.width = '40%'; }, 1000);
          _progressTimer2 = setTimeout(() => { turnProgressFill.style.width = '75%'; }, 3000);
        });
      }
    } else {
      setStatus(socket && socket.connected ? 'connected' : 'error');
      sendBtn.removeAttribute('aria-disabled');
      finalizeAiBubble();
      // Progress bar: complete and hide
      if (turnProgressBar && turnProgressFill) {
        clearTimeout(_progressTimer1);
        clearTimeout(_progressTimer2);
        turnProgressFill.style.transition = 'width 0.4s ease';
        turnProgressFill.style.width = '100%';
        _progressCompleteTimer = setTimeout(() => {
          turnProgressBar.classList.remove('active');
          turnProgressFill.style.transition = 'none';
          turnProgressFill.style.width = '0%';
        }, 400);
      }
      // Clear stats badge
      if (turnStatsBadge) turnStatsBadge.textContent = '';
    }
    syncComposerState();
  }

  function updateTurnStatsBadge() {
    if (!turnStatsBadge || !turnActive) return;
    const parts = [];
    if (turnStats.toolCount > 0) parts.push('\u2699 ' + turnStats.toolCount);
    if (turnStats.fileCount > 0) parts.push('\uD83D\uDCC1 ' + turnStats.fileCount);
    turnStatsBadge.textContent = parts.join(' \u00B7 ');
    renderActiveTurnChip();
  }

  function autoGrow() {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + 'px';
    syncComposerState();
  }

  function syncViewportMetrics() {
    if (!rootStyle) return;
    const viewport = window.visualViewport;
    const height = viewport && viewport.height ? viewport.height : window.innerHeight;
    const roundedHeight = Math.max(320, Math.round(height || 0));
    const shouldStickToBottom = !!messagesEl && isAtBottom();
    rootStyle.setProperty('--viewport-height', roundedHeight + 'px');
    if (!messagesEl) return;
    if (shouldStickToBottom) {
      scrollToBottom();
    } else {
      updateScrollBottomButton();
    }
  }

  function clearConversation() {
    if (messagesEl) messagesEl.innerHTML = '';
    currentAiEl = null;
    if (thinkingEl) {
      thinkingEl.classList.replace('is-live', 'is-done');
    }
    thinkingEl = null;
    thinkingText = '';
    _activityCards.clear();
    _activityItems.clear();
    _activityOutputs.clear();
    _planCard = null;
    resetTurnToolGroups();
    _toolCards.clear();
    if (emptyState && !emptyState.isConnected) {
      messagesEl.appendChild(emptyState);
    }
  }

  function prepareForInlineArtifact() {
    if (pendingDelta && currentAiEl) flushDelta();
    const aiBubble = currentAiEl;
    const aiMessage = aiBubble ? aiBubble.parentElement : null;
    const hasAiText = !!(aiBubble && String(aiBubble.dataset.raw || '').trim());
    const currentThinking = thinkingEl;
    const hasThinking = !!String(thinkingText || '').trim();
    if (!aiBubble && !currentThinking) return;
    finalizeAiBubble();
    if (aiMessage && !hasAiText) aiMessage.remove();
    if (currentThinking && !hasThinking) currentThinking.remove();
  }

  function appendArtifactNode(node) {
    if (!node || !messagesEl) return;
    const stickToBottom = isAtBottom();
    prepareForInlineArtifact();
    if (turnActive) {
      const group = _ensureTurnToolGroup();
      const body = group.querySelector('.tool-group-body');
      if (body) {
        body.appendChild(node);
        _turnToolGroupCount++;
        _updateToolGroupHeader();
        if (stickToBottom) scrollToBottom();
        else updateScrollBottomButton();
        return;
      }
    }
    messagesEl.appendChild(node);
    if (stickToBottom) scrollToBottom();
    else updateScrollBottomButton();
  }

  function resetTurnToolGroups() {
    _turnToolGroups = [];
    _turnToolGroup = null;
    _turnToolGroupCount = 0;
  }

  function getToolGroupCount(group) {
    const count = parseInt(group && group.dataset ? group.dataset.count || '0' : '0', 10);
    return Number.isFinite(count) ? count : 0;
  }

  function setToolGroupCount(group, count) {
    if (!group) return;
    const safeCount = Math.max(0, count || 0);
    group.dataset.count = String(safeCount);
    const countEl = group.querySelector('.tool-group-count');
    if (!countEl) return;
    countEl.textContent = safeCount > 0
      ? formatUiText(t('activity_group_count'), { count: safeCount })
      : '';
  }

  function inferToolGroupSuccess(group, fallbackSuccess) {
    if (typeof fallbackSuccess === 'boolean') return fallbackSuccess;
    if (!group) return true;
    if (group.querySelector('.tool-card.running, .activity-card[data-tone="running"]')) return null;
    if (group.querySelector('.tool-card.error, .activity-card[data-tone="error"]')) return false;
    return true;
  }

  function _ensureTurnToolGroup() {
    if (_turnToolGroup) return _turnToolGroup;
    const group = document.createElement('div');
    group.className = 'tool-group running open';
    group.innerHTML =
      '<div class="tool-group-header">' +
        '<div class="tool-group-spinner"></div>' +
        '<span class="tool-group-label">' + escapeHtml(t('activity_group_running')) + '</span>' +
        '<span class="tool-group-count"></span>' +
        '<svg class="tool-group-chevron" viewBox="0 0 24 24" fill="none">' +
          '<polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
        '</svg>' +
      '</div>' +
      '<div class="tool-group-body"></div>';
    group.querySelector('.tool-group-header').addEventListener('click', function () {
      group.classList.toggle('open');
    });
    setToolGroupCount(group, 0);
    messagesEl.appendChild(group);
    _turnToolGroups.push(group);
    _turnToolGroup = group;
    return group;
  }

  function _updateToolGroupHeader() {
    if (!_turnToolGroup) return;
    setToolGroupCount(_turnToolGroup, _turnToolGroupCount);
  }

  function finalizeToolGroup(group, success) {
    if (!group || group.dataset.finalized === '1') return;
    const count = getToolGroupCount(group);
    if (count === 0) { group.remove(); return; }
    group.dataset.finalized = '1';
    group.classList.remove('running', 'open');
    group.classList.add(success ? 'done' : 'error');
    const spinner = group.querySelector('.tool-group-spinner');
    if (spinner) {
      if (success) {
        spinner.outerHTML =
          '<svg class="tool-group-status-icon ok" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="20 6 9 17 4 12" stroke="currentColor"></polyline>' +
          '</svg>';
      } else {
        spinner.outerHTML =
          '<svg class="tool-group-status-icon fail" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="18" y1="6" x2="6" y2="18" stroke="currentColor"></line>' +
            '<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor"></line>' +
          '</svg>';
      }
    }
    const label = group.querySelector('.tool-group-label');
    if (label) {
      if (success) {
        label.textContent = formatUiText(t('activity_group_done'), { count });
      } else {
        label.textContent = formatUiText(t('activity_group_error'), { count });
      }
    }
    const countEl = group.querySelector('.tool-group-count');
    if (countEl) countEl.textContent = '';
  }

  function sealTurnToolGroup(options) {
    if (!_turnToolGroup) return null;
    const group = _turnToolGroup;
    const count = _turnToolGroupCount;
    _turnToolGroup = null;
    _turnToolGroupCount = 0;
    setToolGroupCount(group, count);
    if (count === 0) {
      _turnToolGroups = _turnToolGroups.filter((entry) => entry !== group);
      group.remove();
      return null;
    }
    const inferredSuccess = inferToolGroupSuccess(group, options && options.success);
    if (inferredSuccess === null) {
      group.classList.remove('open');
      return group;
    }
    finalizeToolGroup(group, inferredSuccess);
    return group;
  }

  function finalizeTurnToolGroups(success) {
    sealTurnToolGroup({ success });
    _turnToolGroups.forEach((group) => {
      const inferredSuccess = inferToolGroupSuccess(group, success);
      finalizeToolGroup(group, inferredSuccess === null ? !!success : inferredSuccess);
    });
    resetTurnToolGroups();
  }

  function addHistoryDivider(title) {
    const divider = document.createElement('div');
    divider.className = 'history-divider';
    divider.innerHTML =
      '<span class="history-divider-line"></span>' +
      '<span class="history-divider-text">' + escapeHtml(title) + '</span>' +
      '<span class="history-divider-line"></span>';
    messagesEl.appendChild(divider);
  }

  // ── CWD display ──────────────────────────────────────────────────
  function setCwd(cwd) {
    if (!headerCwd || !cwd) return;
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    const display = parts.length > 2 ? '\u2026/' + parts.slice(-2).join('/') : cwd;
    headerCwd.textContent = display;
    headerCwd.title = cwd;
    rememberWorkspace(cwd);
    renderComposerContext();
    renderWorkspaceChoices();
    renderSettings();
  }

  function getCurrentWorkspacePath() {
    return (headerCwd && headerCwd.title) || '';
  }

  function normalizeWorkspacePath(cwd) {
    const raw = String(cwd || '').trim();
    if (!raw) return '';
    return raw.replace(/^\\\\\?\\/, '');
  }

  function rememberWorkspace(cwd) {
    const nextPath = normalizeWorkspacePath(cwd);
    if (!nextPath) return;
    const unique = [nextPath].concat(loadWorkspaceHistory().filter((item) => item !== nextPath));
    storeWorkspaceHistory(unique);
  }

  function getWorkspaceCandidates() {
    const candidates = [];
    const seen = new Set();
    const current = normalizeWorkspacePath(getCurrentWorkspacePath());
    if (current) {
      seen.add(current);
      candidates.push(current);
    }
    const threadItems = threadsListResult && Array.isArray(threadsListResult.data) ? threadsListResult.data : [];
    threadItems.forEach((thread) => {
      const cwd = normalizeWorkspacePath(thread && typeof thread.cwd === 'string' ? thread.cwd : '');
      if (cwd && !seen.has(cwd)) {
        seen.add(cwd);
        candidates.push(cwd);
      }
    });
    loadWorkspaceHistory().forEach((item) => {
      const cwd = normalizeWorkspacePath(item);
      if (cwd && !seen.has(cwd)) {
        seen.add(cwd);
        candidates.push(cwd);
      }
    });
    return candidates.slice(0, 8);
  }

  function getWorkspaceDisplay(cwd) {
    const normalized = normalizeWorkspacePath(cwd).replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.length > 2 ? '\u2026/' + parts.slice(-2).join('/') : normalized || cwd;
  }

  function getAccountBannerMode() {
    if (loginPending) return 'loginPending';
    if (!socket || !socket.connected) return 'disconnected';
    if (!accountStateSeen) return 'initial';
    if (authRequired) return 'authRequired';
    return '';
  }

  function dismissAuthBanner() {
    const mode = getAccountBannerMode();
    if (!mode || mode === 'loginPending') return;
    accountBannerDismissed = true;
    updateAccountBanner();
  }

  function clearAuthBannerDismissal() {
    accountBannerDismissed = false;
  }

  function getResolvedTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme(nextMode) {
    themeMode = nextMode === 'light' || nextMode === 'dark' ? nextMode : 'auto';
    storeValue(THEME_MODE_KEY, themeMode);
    const resolvedTheme = getResolvedTheme(themeMode);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', THEME_META_COLORS[resolvedTheme] || THEME_META_COLORS.dark);
    }
    renderSettings();
  }

  function hideInstallHint() {
    if (!iosInstallHint) return;
    iosInstallHint.classList.remove('show');
    if (installHintTimer) {
      clearTimeout(installHintTimer);
      installHintTimer = null;
    }
  }

  function showInstallHint() {
    if (!iosInstallHint) return;
    iosInstallHint.classList.add('show');
    if (installHintTimer) clearTimeout(installHintTimer);
    installHintTimer = setTimeout(() => {
      iosInstallHint.classList.remove('show');
      installHintTimer = null;
    }, 6000);
  }

  function syncInstallBanner() {
    if (!installBanner) return;
    if (screenMain && screenMain.hidden) return;
    const shouldShow = !!(installAvailable && !installDismissed && !installBannerSeen && !installCompleted && !isStandaloneDisplayMode());
    if (shouldShow) {
      installBannerSeen = true;
      storeValue(INSTALL_BANNER_SEEN_KEY, 'true');
    }
    installBanner.classList.toggle('visible', shouldShow);
    installBanner.hidden = !shouldShow;
  }

  function updateInstallState() {
    const isIosSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    installSupported = !!installDeferredPrompt || isIosSafari;
    installAvailable = !!installDeferredPrompt || (isIosSafari && !installCompleted);
    // Always check current standalone mode dynamically — do NOT persist based on
    // standalone detection alone (that would show 'Installed' in regular browser tabs).
    const isStandalone = isStandaloneDisplayMode();
    if (isStandalone) {
      installCompleted = true;
      installAvailable = false;
      installDeferredPrompt = null;
      // Only store the flag when actually running as a PWA right now
      storeValue(INSTALL_COMPLETED_KEY, 'true');
      removeStoredValue(INSTALL_DISMISSED_KEY);
      removeStoredValue(INSTALL_BANNER_SEEN_KEY);
      installDismissed = false;
      installBannerSeen = false;
    }
    syncInstallBanner();
    renderSettings();
  }

  function dismissInstallBanner() {
    installDismissed = true;
    storeValue(INSTALL_DISMISSED_KEY, 'true');
    syncInstallBanner();
    renderSettings();
  }

  async function startInstallFlow() {
    if (installCompleted) return;

    if (installDeferredPrompt) {
      try {
        installDeferredPrompt.prompt();
        const choice = await installDeferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          installCompleted = true;
          storeValue(INSTALL_COMPLETED_KEY, 'true');
          removeStoredValue(INSTALL_DISMISSED_KEY);
          showToast(t('toast_installed'), 2500);
        } else {
          installDismissed = true;
          storeValue(INSTALL_DISMISSED_KEY, 'true');
        }
      } catch {
        showToast(t('toast_install_fail'), 3000);
      } finally {
        installDeferredPrompt = null;
        installAvailable = false;
        updateInstallState();
      }
      return;
    }

    if (installSupported) {
      showInstallHint();
      showToast(t('toast_ios_hint'), 3500);
      return;
    }

    showToast(t('toast_install_unavail'), 3000);
  }

  function getModelId(modelLike) {
    if (!modelLike) return '';
    if (typeof modelLike === 'string') return modelLike;
    if (typeof modelLike === 'object') {
      return String(modelLike.model || modelLike.id || modelLike.slug || modelLike.name || modelLike.title || '');
    }
    return String(modelLike);
  }

  function humanizeModelIdentifier(modelLike) {
    const text = String(modelLike || '').trim();
    if (!text) return '';
    if (/\s/.test(text)) return text;
    return text
      .replace(/[-_]+/g, ' ')
      .replace(/\bgpt\b/ig, 'GPT')
      .replace(/\bclaude\b/ig, 'Claude')
      .replace(/\bgemini\b/ig, 'Gemini')
      .trim();
  }

  function getModelDisplayLabel(modelLike) {
    if (!modelLike) return '';
    if (typeof modelLike === 'string') {
      return modelCatalog[modelLike] || humanizeModelIdentifier(modelLike);
    }
    if (typeof modelLike === 'object') {
      const modelId = getModelId(modelLike);
      return String(
        modelLike.displayName ||
        modelLike.label ||
        modelLike.title ||
        modelLike.name ||
        (modelId && modelCatalog[modelId]) ||
        humanizeModelIdentifier(modelId)
      );
    }
    return humanizeModelIdentifier(modelLike);
  }

  function rememberModelDescriptor(modelLike) {
    const id = getModelId(modelLike);
    const label = getModelDisplayLabel(modelLike);
    if (id && label) modelCatalog[id] = label;
    return { id, label };
  }

  function getModelLabel(modelLike) {
    if (!modelLike) return currentModelLabel || getUiCopy('status_checking');
    return rememberModelDescriptor(modelLike).label || currentModelLabel || getUiCopy('status_checking');
  }

  function setCurrentModel(modelLike, fallbackLabel) {
    const resolved = rememberModelDescriptor(modelLike);
    currentModelId = resolved.id || currentModelId || '';
    currentModelLabel = fallbackLabel || resolved.label || getModelLabel(currentModelId) || getUiCopy('status_checking');
    refreshAiMessageLabels();
    renderComposerContext();
    renderSettings();
    if (currentAiModelEl && !currentTurnModelLabel) {
      currentAiModelEl.textContent = currentModelLabel;
    }
  }

  function getMessageModelLabel(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'model')) {
      if (options.model) return getModelLabel(options.model);
    }
    if (currentTurnModelLabel) return currentTurnModelLabel;
    if (currentModelLabel) return currentModelLabel;
    return getUiCopy('status_unknown');
  }

  function refreshAiMessageLabels() {
    const resolvedLabel = currentTurnModelLabel || currentModelLabel;
    if (!resolvedLabel || resolvedLabel === getUiCopy('status_checking')) return;
    messagesEl.querySelectorAll('.message.message-ai .message-author').forEach((labelEl) => {
      const currentLabel = (labelEl.textContent || '').trim();
      if (!currentLabel || currentLabel === getUiCopy('status_checking') || currentLabel === getUiCopy('status_unknown')) {
        labelEl.textContent = resolvedLabel;
      }
    });
  }

  function renderMessageLabel(label, timestamp) {
    return '<p class="message-label message-label-rich" aria-label="' + escapeHtml(label) + '">' +
      '<span class="message-author">' + escapeHtml(label) + '</span>' +
      (timestamp ? '<span class="message-time">' + escapeHtml(timestamp) + '</span>' : '') +
      '</p>';
  }

  function syncVoiceUI() {
    const shouldShowVoice = !!(voiceSupported && voiceEnabled);

    if (voiceBtn) {
      voiceBtn.hidden = !shouldShowVoice;
      voiceBtn.classList.toggle('available', shouldShowVoice);
      voiceBtn.setAttribute('aria-hidden', shouldShowVoice ? 'false' : 'true');
      if (!shouldShowVoice) {
        voiceBtn.classList.remove('listening');
      }
    }

    if (settingsVoiceToggle) {
      settingsVoiceToggle.checked = !!voiceEnabled;
      settingsVoiceToggle.disabled = !voiceSupported;
    }

    if (settingsEnterToggle) settingsEnterToggle.checked = sendOnEnter;

    if (settingsVoiceStatus) {
      settingsVoiceStatus.textContent = !voiceSupported
        ? t('voice_unsupported')
        : voiceEnabled
          ? t('voice_mic_visible')
          : t('voice_mic_hidden');
    }

    if (settingsVoiceHint) {
      settingsVoiceHint.textContent = !voiceSupported
        ? t('voice_use_browser')
        : t('voice_toggle_hint');
    }
  }

  function setVoiceEnabled(enabled) {
    voiceEnabled = !!enabled;
    storeValue(VOICE_INPUT_ENABLED_KEY, voiceEnabled);
    if (!voiceEnabled && voiceRecognition && voiceListening) {
      voiceRecognition.stop();
    }
    syncVoiceUI();
    syncComposerState();
    renderSettings();
  }

  function setRateSummaryVisible(visible) {
    showRateSummary = !!visible;
    storeValue(RATE_SUMMARY_VISIBLE_KEY, showRateSummary);
    if (showRateSummary && accountInfo && !rateLimitsLoading && !rateLimitsResult) {
      requestRateLimits();
    }
    renderSettings();
    syncRateLimitAutoRefresh();
  }

  function updateAccountBanner() {
    if (!accountBanner) return;

    const mode = getAccountBannerMode();
    activeAccountBannerMode = mode;

    const showBanner = !!mode && (mode === 'loginPending' || !accountBannerDismissed);
    if (!showBanner) {
      accountBanner.hidden = true;
      if (accountBannerClose) accountBannerClose.disabled = false;
      if (accountBannerClose) accountBannerClose.hidden = false;
      if (accountLoginBtn) accountLoginBtn.disabled = false;
      renderSettings();
      return;
    }

    accountBanner.hidden = false;
    if (accountBannerTitle) {
      if (mode === 'loginPending') {
        accountBannerTitle.textContent = t('banner_signing_in');
      } else if (mode === 'disconnected') {
        accountBannerTitle.textContent = t('banner_reconnect');
      } else if (mode === 'initial') {
        accountBannerTitle.textContent = t('banner_checking_signin');
      } else {
        accountBannerTitle.textContent = t('banner_sign_in');
      }
    }
    if (accountBannerText) {
      if (mode === 'loginPending') {
        accountBannerText.textContent = t('banner_chatgpt_flow');
      } else if (mode === 'disconnected') {
        accountBannerText.textContent = t('banner_offline');
      } else if (mode === 'initial') {
        accountBannerText.textContent = t('banner_syncing');
      } else {
        accountBannerText.textContent = authFailureStreak > AUTH_FAILURE_THRESHOLD
          ? t('banner_still_out')
          : 'Continue with ChatGPT on this phone to unlock Codex controls.';
      }
    }
    if (accountLoginBtn) {
      accountLoginBtn.disabled = mode !== 'authRequired';
      accountLoginBtn.textContent = mode === 'loginPending'
        ? t('banner_waiting_login')
        : mode === 'disconnected'
          ? t('banner_waiting_reconnect')
          : mode === 'initial'
            ? t('banner_checking')
            : 'Continue with ChatGPT';
    }
    if (accountBannerClose) {
      accountBannerClose.disabled = mode === 'loginPending';
      accountBannerClose.hidden = mode === 'loginPending';
    }
    syncComposerState();
    renderSettings();
  }

  function isInteractive() {
    return !!(socket && socket.connected && accountReady && !authRequired);
  }

  function hasPendingAttachments() {
    return !!(pendingImageDataUrl || pendingFileAttachment);
  }

  function getComposerDraftText() {
    return userInput ? userInput.value.trim() : '';
  }

  function syncComposerState() {
    const interactive = isInteractive();
    const canSteer = !!(turnActive && currentTurnId);
    const hasDraft = getComposerDraftText().length > 0 || hasPendingAttachments();
    if (userInput) userInput.disabled = !interactive;
    if (sendBtn) {
      if (sendBtn.classList.contains('stop-mode')) {
        sendBtn.disabled = false;
      } else {
        sendBtn.disabled = !interactive || !hasDraft || (turnActive && !canSteer);
      }
    }
    if (voiceBtn) voiceBtn.disabled = !interactive || voiceBtn.hidden;
    if (modelPicker) modelPicker.disabled = !interactive;
    if (settingsBtn) settingsBtn.disabled = !socket;
    if (attachBtn) attachBtn.disabled = !interactive;
  }

  function setComposerMode(nextMode) {
    composerMode = nextMode === 'plan' ? 'plan' : 'default';
    storeValue(COMPOSER_MODE_KEY, composerMode);
    renderComposerToolStates();
    renderComposerContext();
  }

  function setComposerSpeed(nextSpeed) {
    composerSpeed = nextSpeed === 'fast' || nextSpeed === 'flex' ? nextSpeed : 'auto';
    storeValue(COMPOSER_SPEED_KEY, composerSpeed);
    renderComposerToolStates();
    renderComposerContext();
  }

  function renderComposerToolStates() {
    if (composerModeGroup) {
      composerModeGroup.querySelectorAll('[data-mode]').forEach((button) => {
        const active = button.getAttribute('data-mode') === composerMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (composerSpeedGroup) {
      composerSpeedGroup.querySelectorAll('[data-speed]').forEach((button) => {
        const active = button.getAttribute('data-speed') === composerSpeed;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  function setComposerMenuOpen(open) {
    if (!composerToolsMenu) return;
    const nextOpen = !!open;
    clearTimeout(composerMenuHideTimer);
    composerMenuOpen = nextOpen;
    attachBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
      composerToolsMenu.hidden = false;
      composerToolsMenu.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => composerToolsMenu.classList.add('open'));
    } else {
      composerToolsMenu.classList.remove('open');
      composerToolsMenu.setAttribute('aria-hidden', 'true');
      composerMenuHideTimer = setTimeout(() => {
        if (!composerMenuOpen) composerToolsMenu.hidden = true;
      }, 180);
    }
  }

  function setAttachSheetOpen(open) {
    if (!attachSheetOverlay) return;
    attachSheetOpen = !!open;
    attachSheetOverlay.hidden = !attachSheetOpen;
    attachSheetOverlay.setAttribute('aria-hidden', attachSheetOpen ? 'false' : 'true');
    if (attachSheetOpen) {
      setComposerMenuOpen(false);
    }
  }

  function renderWorkspaceSearch() {
    if (!workspaceSearchResults || !workspaceSearchStatus) return;
    workspaceSearchResults.innerHTML = '';
    if (workspaceSearchLoading) {
      workspaceSearchStatus.textContent = t('composer_workspace_searching');
      return;
    }
    if (!workspaceSearchResultsState.length) {
      const query = workspaceSearchInput ? workspaceSearchInput.value.trim() : '';
      workspaceSearchStatus.textContent = query
        ? t('composer_workspace_empty')
        : t('composer_workspace_idle');
      return;
    }
    workspaceSearchStatus.textContent = t('composer_workspace_results');
    workspaceSearchResultsState.forEach((file) => {
      const resolvedPath = resolveWorkspaceSearchPath(file);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'workspace-search-result';
      button.dataset.path = resolvedPath;
      button.innerHTML =
        '<span class="workspace-search-result-name">' + escapeHtml(file.file_name || file.path || '') + '</span>' +
        '<span class="workspace-search-result-path">' + escapeHtml(resolvedPath || file.path || '') + '</span>';
      workspaceSearchResults.appendChild(button);
    });
  }

  function setWorkspaceSheetOpen(open) {
    if (!workspaceSheetOverlay) return;
    workspaceSheetOpen = !!open;
    workspaceSheetOverlay.hidden = !workspaceSheetOpen;
    workspaceSheetOverlay.setAttribute('aria-hidden', workspaceSheetOpen ? 'false' : 'true');
    if (workspaceSheetOpen) {
      setAttachSheetOpen(false);
      renderWorkspaceSearch();
      requestAnimationFrame(() => {
        if (workspaceSearchInput) workspaceSearchInput.focus();
      });
    }
  }

  function requestWorkspaceSearch(query) {
    if (!socket || !socket.connected) return;
    const root = getWorkspaceRoot();
    if (!root) {
      workspaceSearchLoading = false;
      workspaceSearchResultsState = [];
      if (workspaceSearchStatus) workspaceSearchStatus.textContent = t('composer_workspace_unavailable');
      renderWorkspaceSearch();
      return;
    }
    workspaceSearchLoading = true;
    workspaceSearchResultsState = [];
    renderWorkspaceSearch();
    pendingWorkspaceSearchRequestId = emitSocketRequest('fuzzyFileSearch', {
      query,
      roots: [root],
      cancellationToken: null,
    });
  }

  function queueWorkspaceSearch() {
    if (!workspaceSearchInput) return;
    const query = workspaceSearchInput.value.trim();
    if (workspaceSearchTimer) clearTimeout(workspaceSearchTimer);
    if (!query) {
      workspaceSearchLoading = false;
      workspaceSearchResultsState = [];
      renderWorkspaceSearch();
      return;
    }
    workspaceSearchTimer = setTimeout(() => {
      workspaceSearchTimer = null;
      requestWorkspaceSearch(query);
    }, 140);
  }

  function attachWorkspaceFile(filePath) {
    if (!socket || !socket.connected || !filePath) return;
    pendingWorkspaceFilePath = filePath;
    if (workspaceSearchStatus) workspaceSearchStatus.textContent = t('composer_workspace_loading_file');
    pendingWorkspaceFileRequestId = emitSocketRequest('fs/readFile', { path: filePath });
  }

  function renderCommandSheet() {
    if (!commandSheetStatus || !commandSheetOutput || !commandRunBtn || !commandStopBtn || !commandClearBtn) return;
    const hasRunning = !!(commandExecState && commandExecState.running);
    if (commandSheetCwd) {
      const cwd = getWorkspaceRoot();
      commandSheetCwd.textContent = cwd ? t('composer_command_cwd') + ': ' + cwd : '';
    }
    commandRunBtn.disabled = hasRunning || !(commandSheetInput && commandSheetInput.value.trim());
    commandStopBtn.disabled = !hasRunning;
    commandClearBtn.disabled = hasRunning || !commandExecState;
    if (!commandExecState) {
      commandSheetStatus.textContent = t('composer_command_idle');
      commandSheetOutput.textContent = '';
      commandSheetOutput.dataset.empty = t('composer_command_output_empty');
      return;
    }
    if (commandExecState.running) {
      commandSheetStatus.textContent = t('composer_command_running') + ' · ' + formatElapsedLabel(Date.now() - commandExecState.startedAt);
    } else if (commandExecState.exitCode === 0) {
      commandSheetStatus.textContent = t('composer_command_done') + ' · exit 0';
    } else {
      commandSheetStatus.textContent = t('composer_command_failed') + ' · exit ' + commandExecState.exitCode;
    }
    commandSheetOutput.textContent = commandExecState.output || '';
    commandSheetOutput.dataset.empty = t('composer_command_output_empty');
  }

  function setCommandSheetOpen(open) {
    if (!commandSheetOverlay) return;
    commandSheetOpen = !!open;
    commandSheetOverlay.hidden = !commandSheetOpen;
    commandSheetOverlay.setAttribute('aria-hidden', commandSheetOpen ? 'false' : 'true');
    if (commandSheetOpen) {
      setComposerMenuOpen(false);
      if (commandSheetInput && !commandSheetInput.value.trim()) {
        commandSheetInput.value = '';
      }
      renderCommandSheet();
      requestAnimationFrame(() => {
        if (commandSheetInput) commandSheetInput.focus();
      });
    }
  }

  function appendCommandExecOutput(stream, text) {
    if (!commandExecState) return;
    const prefix = stream === 'stderr' ? '[stderr] ' : '';
    commandExecState.output += prefix + text;
    if (commandExecState.output.length > 12000) {
      commandExecState.output = commandExecState.output.slice(-12000);
    }
    renderCommandSheet();
  }

  function runCommandExec() {
    if (!socket || !socket.connected || !commandSheetInput) return;
    const raw = commandSheetInput.value.trim();
    const argv = buildCommandExecArgv(raw);
    if (!argv.length) return;
    const processId = makeRuntimeId('cmd');
    commandExecState = {
      processId,
      running: true,
      startedAt: Date.now(),
      output: '',
      exitCode: null,
      commandText: raw,
    };
    renderCommandSheet();
    commandExecState.requestId = emitSocketRequest('command/exec', {
      command: argv,
      processId,
      cwd: getWorkspaceRoot() || null,
      timeoutMs: 20_000,
    });
  }

  function stopCommandExec() {
    if (!socket || !socket.connected || !commandExecState || !commandExecState.running) return;
    commandExecState.terminateRequestId = emitSocketRequest('command/exec/terminate', {
      processId: commandExecState.processId,
    });
    if (commandSheetStatus) commandSheetStatus.textContent = t('composer_command_stopping');
  }

  function clearCommandExec() {
    commandExecState = null;
    renderCommandSheet();
  }

  function setupInstallPrompt() {
    if (isStandaloneDisplayMode()) {
      installCompleted = true;
      updateInstallState();
      return;
    }

    if (installBtn) {
      installBtn.addEventListener('click', () => {
        startInstallFlow();
      });
    }

    if (installDismissBtn) {
      installDismissBtn.addEventListener('click', () => {
        dismissInstallBanner();
      });
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installDeferredPrompt = event;
      installAvailable = true;
      updateInstallState();
    });

    window.addEventListener('appinstalled', () => {
      installCompleted = true;
      showToast(t('toast_installed'), 2500);
      updateInstallState();
    });

    updateInstallState();
  }

  // ── Markdown rendering ───────────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      const el = document.createElement('span');
      el.textContent = text;
      return el.outerHTML.replace(/\n/g, '<br>');
    }
    const raw = marked.parse(text || '');
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }

  // ── Copy buttons ─────────────────────────────────────────────────
  function makeCopyBtn(getText) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', t('aria_copy'));
    btn.title = t('ctx_copy');
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" fill="none"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
      '</svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = typeof getText === 'function' ? getText() : getText;
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('copied');
          btn.setAttribute('aria-label', t('aria_copied'));
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.setAttribute('aria-label', t('aria_copy'));
          }, 1500);
        }).catch(() => showToast(t('toast_copy_fail'), 2000));
      }
    });
    return btn;
  }

  function injectCodeEnhancements(container) {
    if (!container) return;
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const code = pre.querySelector('code');
      if (!code) return;
      pre.style.position = 'relative';
      // Language badge
      const langMatch = code.className.match(/language-(\S+)/);
      const lang = langMatch ? langMatch[1] : null;
      if (lang && !pre.querySelector('.code-lang-badge')) {
        const badge = document.createElement('span');
        badge.className = 'code-lang-badge';
        badge.textContent = lang;
        pre.appendChild(badge);
      }
      // Prism highlighting
      if (typeof Prism !== 'undefined' && !code.dataset.highlighted) {
        Prism.highlightElement(code);
      }
      // Copy button
      const btn = makeCopyBtn(() => code.textContent || '');
      btn.classList.add('copy-btn-code');
      pre.appendChild(btn);
    });
    // Check overflow for scroll gradient — defer until after Prism autoloader may have applied highlights
    requestAnimationFrame(() => {
      container.querySelectorAll('pre').forEach(pre => {
        if (pre.scrollWidth <= pre.clientWidth) {
          pre.classList.add('no-overflow');
        } else {
          pre.classList.remove('no-overflow');
        }
      });
    });
  }

  // ── Message creation ─────────────────────────────────────────────
  function addUserMessage(text, options) {
    options = options || {};
    const timestamp = options.timestamp || formatTime(Date.now());
    if (emptyState) emptyState.remove();

    const msg = document.createElement('div');
    msg.className = 'message message-user';
    msg.innerHTML = renderMessageLabel('You', timestamp) +
      '<div class="bubble">' + escapeHtml(text) + '</div>';
    messagesEl.appendChild(msg);
    addLongPressMenu(msg, () => [
      {
        label: t('ctx_copy'),
        action: () => {
          const b = msg.querySelector('.bubble');
          const text = b ? b.textContent : '';
          if (navigator.clipboard && text) navigator.clipboard.writeText(text).catch(() => {});
          showToast(t('toast_copy_ok'), 1500);
        },
      },
    ]);
    if (!isAtBottom()) markUnreadBelow();
    scrollToBottom();
    return msg;
  }

  function startAiMessage(options) {
    options = options || {};
    const timestamp = options.timestamp || formatTime(Date.now());
    if (emptyState) emptyState.remove();
    const stickToBottom = isAtBottom();
    sealTurnToolGroup();

    thinkingText = '';
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking-block is-live';
    thinkingEl.innerHTML =
      '<div class="thinking-header" role="button" aria-expanded="false" tabindex="0">' +
        svgIcon('zap', 16) +
        '<span class="thinking-label">' + escapeHtml(t('thinking_label')) + '</span>' +
        '<span class="thinking-live" aria-hidden="true"><span></span><span></span><span></span></span>' +
        '<svg class="thinking-chevron" viewBox="0 0 24 24" aria-hidden="true">' +
          '<polyline points="6 9 12 15 18 9"></polyline>' +
        '</svg>' +
      '</div>' +
      '<div class="thinking-content" role="region" aria-label="Reasoning">' +
        '<pre class="thinking-text"></pre>' +
      '</div>';

    const thinkingBlock = thinkingEl;
    const thinkHeader = thinkingEl.querySelector('.thinking-header');
    thinkHeader.addEventListener('click', () => toggleThinking(thinkingBlock, thinkHeader));
    thinkHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleThinking(thinkingBlock, thinkHeader);
      }
    });

    const msg = document.createElement('div');
    msg.className = 'message message-ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble streaming';
    bubble.setAttribute('aria-live', 'polite');
    bubble.innerHTML =
      '<div class="stream-placeholder">' +
        '<span class="stream-placeholder-label">' + escapeHtml(t('thinking_status_preparing')) + '</span>' +
        '<span class="thinking-live thinking-live-inline" aria-hidden="true"><span></span><span></span><span></span></span>' +
      '</div>';
    msg.innerHTML = renderMessageLabel(getMessageModelLabel(options), timestamp);

    // Copy button for the whole AI message
    const copyBtn = makeCopyBtn(() => bubble.dataset.raw || bubble.textContent || '');
    copyBtn.classList.add('copy-btn-bubble');
    msg.appendChild(copyBtn);
    msg.appendChild(bubble);

    messagesEl.appendChild(thinkingEl);
    messagesEl.appendChild(msg);
    currentAiEl = bubble;
    currentAiModelEl = msg.querySelector('.message-author');

    // Streaming cursor (removed by finalizeAiBubble / flushDelta)
    const cursor = document.createElement('span');
    cursor.id = 'stream-cursor';
    cursor.className = 'stream-cursor';
    cursor.textContent = '▋';
    bubble.appendChild(cursor);

    if (!stickToBottom) markUnreadBelow();
    if (stickToBottom) scrollToBottom();
    else updateScrollBottomButton();
    addLongPressMenu(msg, () => getAiMsgMenuOptions(bubble));
    return bubble;
  }

  function toggleThinking(block, header) {
    if (!block || !header) return;
    const isOpen = block.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
  }

  function addStaticAiMessage(text, options) {
    options = options || {};
    const timestamp = options.timestamp || formatTime(Date.now());
    if (emptyState) emptyState.remove();

    const msg = document.createElement('div');
    msg.className = 'message message-ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.dataset.raw = text || '';
    bubble.innerHTML = renderMarkdown(text || '');
    msg.innerHTML = renderMessageLabel(getMessageModelLabel(options), timestamp);
    const copyBtn = makeCopyBtn(() => bubble.dataset.raw || bubble.textContent || '');
    copyBtn.classList.add('copy-btn-bubble');
    msg.appendChild(copyBtn);
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    injectCodeEnhancements(bubble);
    addLongPressMenu(msg, () => getAiMsgMenuOptions(bubble));
    return msg;
  }

  function addHistoryArtifact(title, body, tone) {
    if (!title && !body) return;
    if (emptyState) emptyState.remove();

    const card = document.createElement('div');
    card.className = 'history-artifact' + (tone ? ' ' + tone : '');
    card.innerHTML =
      '<p class="history-artifact-title">' + escapeHtml(title || 'History') + '</p>' +
      '<div class="history-artifact-body">' + escapeHtml(body || '') + '</div>';
    messagesEl.appendChild(card);
  }

  function renderActivityCardContent(card, payload) {
    const files = Array.isArray(payload.files) ? payload.files.filter(Boolean).slice(0, 8) : [];
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const hasExpandable = !!(payload.summary || payload.fullContent || files.length || steps.length);
    card.dataset.tone = payload.tone || 'running';
    if (hasExpandable) {
      card.classList.add('is-expandable');
    } else {
      card.classList.remove('is-expandable');
      card.dataset.expand = '0';
    }

    const summaryHtml = payload.summary
      ? '<pre class="activity-card-preview">' + escapeHtml(String(payload.summary)) + '</pre>'
      : '';
    const filesHtml = files.length
      ? '<div class="activity-card-files">' + files.map((f) => '<span class="activity-card-file">' + escapeHtml(f) + '</span>').join('') + '</div>'
      : '';
    const stepsHtml = steps.length
      ? '<ul class="activity-card-steps">' +
          steps.map((s) => {
            const status = s.status || 'pending';
            const icon = status === 'completed' ? '✓' : status === 'inProgress' ? '▶' : '○';
            return '<li class="activity-card-step step-' + status + '">' +
              '<span class="step-icon" aria-hidden="true">' + icon + '</span>' +
              '<span class="step-text">' + escapeHtml(s.step || '') + '</span>' +
              '</li>';
          }).join('') +
        '</ul>'
      : '';
    const fullHtml = payload.fullContent
      ? '<pre class="activity-card-preview activity-card-preview--full">' + escapeHtml(String(payload.fullContent).trim()) + '</pre>'
      : '';

    card.innerHTML =
      '<div class="activity-card-head">' +
        '<div class="activity-card-copy">' +
          '<p class="activity-card-kicker">' + escapeHtml(payload.kicker || '') + '</p>' +
          '<p class="activity-card-title">' + escapeHtml(payload.title || '') + '</p>' +
          (payload.meta ? '<p class="activity-card-meta">' + escapeHtml(payload.meta) + '</p>' : '') +
        '</div>' +
        '<div class="activity-card-right">' +
          '<span class="activity-card-badge">' + escapeHtml(payload.badge || '') + '</span>' +
          (hasExpandable ? '<span class="activity-card-chevron" aria-hidden="true"></span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="activity-card-details">' + summaryHtml + filesHtml + stepsHtml + '</div>' +
      '<div class="activity-card-full">' + fullHtml + '</div>';
  }

  function ensureActivityCard(itemId, payload) {
    const stickToBottom = isAtBottom();
    let card = itemId ? _activityCards.get(itemId) : null;
    if (!card) {
      if (emptyState) emptyState.remove();
      card = document.createElement('div');
      card.className = 'activity-card';
      card.dataset.expand = '0';
      appendArtifactNode(card);
      if (itemId) _activityCards.set(itemId, card);
      // Progressive disclosure: tap cycles 0 → 1 → 2 → 0
      card.addEventListener('click', function () {
        if (!card.classList.contains('is-expandable')) return;
        const hasFull = !!(card.querySelector('.activity-card-full > *'));
        const maxLevel = hasFull ? 2 : 1;
        const curr = parseInt(card.dataset.expand || '0', 10);
        card.dataset.expand = String((curr + 1) % (maxLevel + 1));
      });
    }
    renderActivityCardContent(card, payload);
    if (stickToBottom) scrollToBottom();
    else updateScrollBottomButton();
    return card;
  }

  function extractSummaryLines(text, maxLines) {
    if (!text) return '';
    const n = maxLines || 4;
    const trimmed = String(text).trim();
    const lines = trimmed.split('\n');
    if (lines.length <= n) return trimmed;
    return lines.slice(-n).join('\n');
  }

  function compactCommandLabel(item) {
    const actions = item && Array.isArray(item.commandActions) ? item.commandActions : [];
    const firstAction = actions[0] || null;
    if (!firstAction) return t('activity_command_brief_shell');
    if (firstAction.type === 'read') {
      return t('activity_command_brief_read') + (firstAction.path ? ': ' + firstAction.path : '');
    }
    if (firstAction.type === 'listFiles') {
      return t('activity_command_brief_list') + (firstAction.path ? ': ' + firstAction.path : '');
    }
    if (firstAction.type === 'search') {
      return t('activity_command_brief_search') + (firstAction.query ? ': ' + firstAction.query : '');
    }
    return t('activity_command_brief_shell');
  }

  function getActivityBadgeForTone(tone) {
    if (tone === 'success') return t('activity_status_done');
    if (tone === 'error') return t('activity_status_error');
    if (tone === 'warning') return t('activity_status_warning');
    return t('activity_status_running');
  }

  function humanizeItemType(type) {
    const raw = String(type || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[._/-]+/g, ' ')
      .trim();
    if (!raw) return t('activity_operation_pending');
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  function stringifyActivityValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  function extractActivityFiles(item) {
    const values = [];
    const pushValue = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(pushValue);
        return;
      }
      if (typeof value === 'object') {
        pushValue(value.path || value.filePath || value.file_path || value.filename || value.target);
        return;
      }
      values.push(String(value));
    };
    if (item && Array.isArray(item.changes)) {
      item.changes.forEach((change) => {
        const kind = change && change.kind && change.kind.type;
        const prefix = kind === 'add' ? '+ ' : kind === 'delete' ? '− ' : '~ ';
        if (change && change.path) values.push(prefix + change.path);
      });
    }
    pushValue(item && item.files);
    pushValue(item && item.paths);
    pushValue(item && item.path);
    pushValue(item && item.filePath);
    pushValue(item && item.file_path);
    pushValue(item && item.filename);
    pushValue(item && item.sourcePath);
    return Array.from(new Set(values.filter(Boolean))).slice(0, 8);
  }

  function genericItemActivityPayload(item, accumulated, toneOverride) {
    const tone = toneOverride || (item && item.status === 'completed'
      ? (item.success !== false ? 'success' : 'error')
      : item && item.status === 'failed' ? 'error' : 'running');
    const files = extractActivityFiles(item);
    const title = [
      item && item.title,
      item && item.tool,
      item && item.command,
      files[0],
      humanizeItemType(item && item.type),
    ].filter(Boolean)[0] || t('activity_operation_pending');
    const meta = [
      item && item.type ? humanizeItemType(item.type) : '',
      item && item.cwd ? item.cwd : '',
      item && item.durationMs ? formatElapsedLabel(item.durationMs) : '',
    ].filter(Boolean).join(' · ');
    const parts = [
      item && item.arguments ? '# Arguments\n' + stringifyActivityValue(item.arguments) : '',
      item && item.result ? '# Result\n' + stringifyActivityValue(item.result) : '',
      item && item.contentItems ? '# Output\n' + stringifyActivityValue(item.contentItems) : '',
      item && item.error ? '# Error\n' + stringifyActivityValue(item.error) : '',
      accumulated ? stringifyActivityValue(accumulated) : '',
    ].filter(Boolean);
    const fullContent = parts.join('\n\n').trim().slice(0, 8000);
    return {
      kicker: t('activity_kicker_operation'),
      title,
      meta,
      summary: extractSummaryLines(fullContent, 4),
      fullContent,
      files,
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function isThreadItemShape(value) {
    return !!value && typeof value === 'object' && typeof value.type === 'string';
  }

  function getNotificationItem(params) {
    if (isThreadItemShape(params && params.item)) return params.item;
    if (isThreadItemShape(params && params.responseItem)) return params.responseItem;
    if (isThreadItemShape(params && params.threadItem)) return params.threadItem;
    if (isThreadItemShape(params)) return params;
    return null;
  }

  function ensureTurnArtifactState(params) {
    if (turnActive) return;
    currentTurnId = params && params.turnId ? params.turnId : currentTurnId;
    currentTurnModelLabel = currentTurnModelLabel || currentModelLabel;
    turnStats = { toolCount: 0, fileCount: 0, startMs: Date.now(), tokenCount: 0 };
    _planCard = null;
    resetTurnToolGroups();
    renderComposerContext();
    setTurnActive(true);
  }

  function commandActivityPayload(item, accumulated, toneOverride) {
    const tone = toneOverride || (item && item.status === 'completed'
      ? ((item.exitCode || 0) === 0 ? 'success' : 'error')
      : 'running');
    const meta = [
      item && item.cwd ? item.cwd : '',
      item && item.durationMs ? formatElapsedLabel(item.durationMs) : '',
      item && item.exitCode !== null && item.exitCode !== undefined ? 'exit ' + item.exitCode : '',
    ].filter(Boolean).join(' · ');
    const fullOutput = String(accumulated || (item && item.aggregatedOutput) || '').trim();
    const commandText = item && item.command ? item.command : '';
    const summary = fullOutput
      ? extractSummaryLines(fullOutput, 4)
      : (compactCommandCards && commandText ? '$ ' + commandText : '');
    const fullBundle = [
      commandText ? '$ ' + commandText : '',
      fullOutput,
    ].filter(Boolean).join('\n\n');
    return {
      kicker: t('activity_kicker_command'),
      title: compactCommandCards
        ? compactCommandLabel(item)
        : (commandText || t('activity_command_pending')),
      meta,
      summary,
      fullContent: fullBundle.length > summary.length ? fullBundle.slice(0, 8000) : '',
      files: [],
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function fileChangeActivityPayload(item, diffs, toneOverride) {
    const changes = item && Array.isArray(item.changes) ? item.changes : [];
    const files = changes.map((c) => {
      if (!c || !c.path) return '';
      const kind = (c.kind && c.kind.type) || '';
      const pfx = kind === 'add' ? '+ ' : kind === 'delete' ? '− ' : '~ ';
      return pfx + c.path;
    }).filter(Boolean);
    const tone = toneOverride || (changes.length ? 'success' : 'running');
    const meta = files.length ? files.length + ' ' + t('activity_files_suffix') : '';
    const allDiffs = String(diffs || changes.map((c) => c && c.diff || '').filter(Boolean).join('\n\n')).trim();
    return {
      kicker: t('activity_kicker_files'),
      title: files[0] || t('activity_files_pending'),
      meta,
      summary: extractSummaryLines(allDiffs, 4),
      fullContent: allDiffs.slice(0, 8000),
      files,
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function mcpCallActivityPayload(item, toneOverride) {
    const tone = toneOverride || (item && item.status === 'completed'
      ? 'success'
      : item && item.status === 'failed' ? 'error' : 'running');
    const title = item
      ? ([item.server, item.tool].filter(Boolean).join(' / ') || t('activity_mcp_pending'))
      : t('activity_mcp_pending');
    const meta = item && item.durationMs ? formatElapsedLabel(item.durationMs) : '';
    const argsStr = item && item.arguments ? JSON.stringify(item.arguments, null, 2) : '';
    const resultStr = item && item.result ? JSON.stringify(item.result, null, 2) : '';
    const errorStr = item && item.error ? (typeof item.error === 'string' ? item.error : JSON.stringify(item.error)) : '';
    const parts = [
      argsStr && ('# Arguments\n' + argsStr),
      resultStr && ('# Result\n' + resultStr),
      errorStr && ('# Error\n' + errorStr),
    ].filter(Boolean);
    return {
      kicker: t('activity_kicker_mcp'),
      title,
      meta,
      summary: extractSummaryLines(argsStr, 3),
      fullContent: parts.join('\n\n').slice(0, 4000),
      files: [],
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function dynamicToolActivityPayload(item, toneOverride) {
    const tone = toneOverride || (item && item.status === 'completed'
      ? (item.success !== false ? 'success' : 'error')
      : item && item.status === 'failed' ? 'error' : 'running');
    const title = item && item.tool ? item.tool : t('activity_tool_pending');
    const meta = item && item.durationMs ? formatElapsedLabel(item.durationMs) : '';
    const argsStr = item && item.arguments ? JSON.stringify(item.arguments, null, 2) : '';
    const contentStr = item && item.contentItems ? JSON.stringify(item.contentItems, null, 2) : '';
    const parts = [
      argsStr && ('# Arguments\n' + argsStr),
      contentStr && ('# Output\n' + contentStr),
    ].filter(Boolean);
    return {
      kicker: t('activity_kicker_tool'),
      title,
      meta,
      summary: extractSummaryLines(argsStr, 3),
      fullContent: parts.join('\n\n').slice(0, 4000),
      files: [],
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function planActivityPayload(planParams) {
    const steps = Array.isArray(planParams && planParams.plan) ? planParams.plan : [];
    const explanation = (planParams && planParams.explanation) || '';
    const doneCount = steps.filter((s) => s.status === 'completed').length;
    const inProgressStep = steps.find((s) => s.status === 'inProgress');
    const tone = (inProgressStep || doneCount < steps.length) ? 'running' : (steps.length > 0 ? 'success' : 'running');
    const title = inProgressStep
      ? inProgressStep.step
      : (explanation || t('activity_plan_thinking'));
    const meta = steps.length ? doneCount + '/' + steps.length + ' ' + t('activity_plan_steps') : '';
    return {
      kicker: t('activity_kicker_plan'),
      title,
      meta,
      summary: '',
      fullContent: '',
      files: [],
      steps,
      tone,
      badge: steps.length ? (doneCount + '/' + steps.length) : getActivityBadgeForTone(tone),
    };
  }

  function hookRunActivityPayload(run, toneOverride) {
    const entries = Array.isArray(run && run.entries) ? run.entries : [];
    const tone = toneOverride || (run && run.status === 'completed'
      ? 'success'
      : run && (run.status === 'failed' || run.status === 'blocked' || run.status === 'stopped')
        ? 'error'
        : 'running');
    const title = (run && (run.statusMessage || run.eventName || run.sourcePath)) || t('activity_hook_pending');
    const meta = [
      run && run.handlerType ? run.handlerType : '',
      run && run.scope ? run.scope : '',
      run && run.durationMs ? formatElapsedLabel(run.durationMs) : '',
    ].filter(Boolean).join(' · ');
    const fullContent = entries
      .map((entry) => entry && entry.text ? entry.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    return {
      kicker: t('activity_kicker_hook'),
      title,
      meta,
      summary: extractSummaryLines(fullContent, 3),
      fullContent: fullContent.slice(0, 4000),
      files: run && run.sourcePath ? [run.sourcePath] : [],
      steps: [],
      tone,
      badge: getActivityBadgeForTone(tone),
    };
  }

  function summarizeHistoryItem(item) {
    if (!item || !item.type) return;

    switch (item.type) {
      case 'userMessage': {
        const text = (item.content || [])
          .map((part) => {
            if (!part || typeof part !== 'object') return '';
            if (part.type === 'text') return part.text || '';
            if (part.type === 'image') return '[image]';
            if (part.type === 'localImage') return '[local image]';
            if (part.type === 'mention') return '@' + (part.name || 'mention');
            if (part.type === 'skill') return '[skill] ' + (part.name || '');
            return '';
          })
          .filter(Boolean)
          .join('\n');
        addUserMessage(text || '(empty message)');
        break;
      }

      case 'agentMessage':
        addStaticAiMessage(item.text || '', {
          label: item.phase === 'commentary' ? 'Codex Notes' : 'Codex',
          model: '',
        });
        break;

      case 'reasoning': {
        const summary = []
          .concat(item.summary || [])
          .concat(item.content || [])
          .filter(Boolean)
          .join('\n\n');
        if (summary) addHistoryArtifact('Thinking', summary, 'history-artifact-thinking');
        break;
      }

      case 'commandExecution': {
        ensureActivityCard(item.id, commandActivityPayload(item, item.aggregatedOutput || '', item.status === 'completed'
          ? ((item.exitCode || 0) === 0 ? 'success' : 'error')
          : 'running'));
        break;
      }

      case 'fileChange': {
        const histDiffs = (item.changes || []).map((c) => c && c.diff || '').filter(Boolean).join('\n\n');
        ensureActivityCard(item.id, fileChangeActivityPayload(item, histDiffs,
          item.status === 'applied' ? 'success' : 'warning'));
        break;
      }

      case 'mcpToolCall': {
        ensureActivityCard(item.id, mcpCallActivityPayload(item,
          item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : 'running'));
        break;
      }

      case 'dynamicToolCall': {
        ensureActivityCard(item.id, dynamicToolActivityPayload(item,
          item.status === 'completed' ? (item.success !== false ? 'success' : 'error') : item.status === 'failed' ? 'error' : 'running'));
        break;
      }

      case 'plan':
        addHistoryArtifact('Plan', item.text || '', 'history-artifact-plan');
        break;

      default:
        ensureActivityCard(item.id || ('history:' + (item.type || 'item')), genericItemActivityPayload(item, item.aggregatedOutput || ''));
        break;
    }
  }

  function renderThreadHistory(thread) {
    if (!thread || !Array.isArray(thread.turns)) return;
    clearConversation();

    const turns = thread.turns.filter((turn) => turn && Array.isArray(turn.items) && turn.items.length > 0);
    currentThreadTurnCount = thread.turns.length;
    if (turns.length === 0) {
      historyHydratedThreadId = thread.id;
      return;
    }

    turns.forEach((turn, index) => {
      addHistoryDivider('Turn ' + (index + 1));
      turn.items.forEach((item) => summarizeHistoryItem(item));
    });

    historyHydratedThreadId = thread.id;
    scrollToBottom();
  }

  function appendDelta(delta) {
    if (!currentAiEl) startAiMessage();
    // Transition to streaming state on first delta
    if (statusDot && statusDot.getAttribute('data-state') === 'thinking') {
      setStatus('streaming');
    }
    pendingDelta += delta;
    scheduleRender();
  }

  function scheduleRender() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flushDelta);
  }

  function flushDelta() {
    rafScheduled = false;
    if (!pendingDelta || !currentAiEl) {
      pendingDelta = '';
      return;
    }
    const raw = (currentAiEl.dataset.raw || '') + pendingDelta;
    pendingDelta = '';
    currentAiEl.dataset.raw = raw;
    currentAiEl.innerHTML = renderMarkdown(raw);
    currentAiEl.classList.add('streaming');
    injectCodeEnhancements(currentAiEl);
    // Re-append streaming cursor so it isn't wiped by innerHTML replacement
    const cursor = document.getElementById('stream-cursor');
    if (cursor) currentAiEl.appendChild(cursor);
    if (isAtBottom()) { scrollToBottom(); } else if (scrollBottomBtn) { scrollBottomBtn.hidden = false; scrollBottomBtn.classList.add('has-new'); }
  }

  function appendReasoning(delta) {
    if (!thinkingEl) startAiMessage();
    thinkingText += delta;
    const pre = thinkingEl.querySelector('.thinking-text');
    if (pre) pre.textContent = thinkingText;
    if (!thinkingEl.classList.contains('open')) {
      const header = thinkingEl.querySelector('.thinking-header');
      toggleThinking(thinkingEl, header);
    }
    if (isAtBottom()) { scrollToBottom(); } else if (scrollBottomBtn) { scrollBottomBtn.hidden = false; scrollBottomBtn.classList.add('has-new'); }
  }

  function finalizeAiBubble() {
    if (pendingDelta && currentAiEl) flushDelta();
    const aiBubble = currentAiEl;
    const aiMessage = aiBubble ? aiBubble.parentElement : null;
    const hasAiText = !!(aiBubble && String(aiBubble.dataset.raw || '').trim());
    const currentThinking = thinkingEl;
    const hasThinking = !!String(thinkingText || '').trim();
    if (aiBubble) {
      const cursor = document.getElementById('stream-cursor');
      if (cursor) cursor.remove();
      aiBubble.classList.remove('streaming');
      if (hasAiText) injectCodeEnhancements(aiBubble);
      currentAiEl = null;
      if (aiMessage && !hasAiText) aiMessage.remove();
    }
    currentAiModelEl = null;
    currentTurnModelLabel = '';
    if (currentThinking && !hasThinking) currentThinking.remove();
    if (thinkingEl) {
      thinkingEl.classList.replace('is-live', 'is-done');
    }
    thinkingEl = null;
    thinkingText = '';
    saveConversationCache();
  }

  function updateCurrentAiModelBadge(modelName) {
    currentTurnModelLabel = modelName || currentTurnModelLabel || currentModelLabel;
    if (currentAiModelEl && currentTurnModelLabel) {
      currentAiModelEl.textContent = currentTurnModelLabel;
    }
    refreshAiMessageLabels();
    renderSettings();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    scrollButtonHasUnread = false;
    updateScrollBottomButton();
  }

  function saveConversationCache() {
    if (!threadId || !messagesEl) return;
    try {
      // Save as HTML snapshot
      sessionStorage.setItem('pocketdex.chat.' + threadId, messagesEl.innerHTML);
    } catch (e) { /* storage full, ignore */ }
  }

  function restoreConversationCache(tid) {
    if (!tid || !messagesEl) return false;
    try {
      var cached = sessionStorage.getItem('pocketdex.chat.' + tid);
      if (!cached) return false;
      messagesEl.innerHTML = cached;
      scrollToBottom();
      return true;
    } catch (e) { return false; }
  }

  function isAtBottom() {
    if (!messagesEl) return true;
    return messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 20;
  }

  function hasScrollableMessages() {
    if (!messagesEl) return false;
    return messagesEl.scrollHeight > messagesEl.clientHeight + 24;
  }

  function updateScrollBottomButton() {
    if (!scrollBottomBtn) return;
    const shouldShow = hasScrollableMessages() && !isAtBottom();
    scrollBottomBtn.hidden = !shouldShow;
    scrollBottomBtn.classList.toggle('has-new', shouldShow && scrollButtonHasUnread);
  }

  function markUnreadBelow() {
    scrollButtonHasUnread = true;
    updateScrollBottomButton();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  function formatPlanType(planType) {
    if (!planType) return getUiCopy('status_unknown');
    return String(planType)
      .split(/[_-]/g)
      .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ');
  }

  function getCurrentUiLang() {
    return window.i18n ? window.i18n.lang : 'en';
  }

  function getIntlLocale() {
    const lang = getCurrentUiLang();
    if (lang === 'zh-Hans') return 'zh-CN';
    if (lang === 'zh-Hant') return 'zh-TW';
    return lang || 'en';
  }

  function getRateBucketLabel(minutes, fallbackKind) {
    const mins = Number(minutes);
    const normalizedMinutes = Number.isFinite(mins) && mins > 0
      ? mins
      : (fallbackKind === 'primary' ? 300 : fallbackKind === 'secondary' ? 10080 : 0);
    const lang = getCurrentUiLang();
    const packs = {
      en: { fiveHour: '5 hours', week: 'Week', day: '24 hours', credits: 'Credits' },
      ja: { fiveHour: '5時間', week: '週', day: '24時間', credits: 'クレジット' },
      'zh-Hans': { fiveHour: '5小时', week: '本周', day: '24小时', credits: '额度' },
      'zh-Hant': { fiveHour: '5小時', week: '本週', day: '24小時', credits: '額度' },
    };
    const pack = packs[lang] || packs.en;
    if (fallbackKind === 'credits') return pack.credits;
    if (normalizedMinutes >= 10080) return pack.week;
    if (normalizedMinutes >= 1440) return pack.day;
    if (normalizedMinutes >= 300) return pack.fiveHour;
    if (lang === 'ja') return normalizedMinutes + '分';
    if (lang === 'zh-Hant') return normalizedMinutes + ' 分鐘';
    if (lang === 'zh-Hans') return normalizedMinutes + ' 分钟';
    return normalizedMinutes + ' min';
  }

  function getUiCopy(key) {
    const lang = getCurrentUiLang();
    const copy = {
      en: {
        default_limit: 'Default limit',
        untitled_thread: 'Untitled thread',
        recent_thread: 'Recent thread',
        no_rate_snapshot: 'No rate-limit snapshot yet. Tap Refresh after Codex sign-in finishes.',
        credits_unlimited: 'Unlimited',
        credits_available: 'Available',
        credits_empty: 'Empty',
        credits_available_hint: 'Credits are available for this limit.',
        credits_none_hint: 'No extra credits attached to this limit.',
        remaining_unknown: 'Unknown',
        status_unknown: 'Unknown',
        status_starting: 'Starting…',
        status_disconnected: 'Disconnected',
        status_connected: 'Connected',
        status_connected_active: 'Connected · active turn',
        status_signing_in: 'Signing in…',
        status_signed_in: 'Signed in',
        status_api_key: 'API key',
        status_needs_sign_in: 'Needs sign-in',
        status_checking: 'Checking…',
        status_not_signed_in: 'Not signed in',
        status_api_key_session: 'API key session',
        status_waiting_codex: 'Waiting for Codex…',
        theme_status_auto_dark: 'Using your device setting right now: Dark.',
        theme_status_auto_light: 'Using your device setting right now: Light.',
        theme_status_locked_dark: 'PocketDex is locked to Dark mode.',
        theme_status_locked_light: 'PocketDex is locked to Light mode.',
        install_action_now: 'Install Now',
        install_action_how: 'Show How',
        install_action_unavailable: 'Unavailable',
        install_unavailable_hint: 'This browser does not expose installation support right now.',
      },
      ja: {
        default_limit: '標準の制限',
        untitled_thread: '無題のスレッド',
        recent_thread: '最近のスレッド',
        no_rate_snapshot: 'レート制限のスナップショットがまだありません。Codex のサインイン完了後に更新してください。',
        credits_unlimited: '無制限',
        credits_available: '利用可能',
        credits_empty: '空',
        credits_available_hint: 'この制限には追加クレジットがあります。',
        credits_none_hint: 'この制限には追加クレジットがありません。',
        remaining_unknown: '不明',
        status_unknown: '不明',
        status_starting: '起動中…',
        status_disconnected: '切断中',
        status_connected: '接続済み',
        status_connected_active: '接続済み・ターン進行中',
        status_signing_in: 'サインイン中…',
        status_signed_in: 'サインイン済み',
        status_api_key: 'APIキー',
        status_needs_sign_in: 'サインインが必要',
        status_checking: '確認中…',
        status_not_signed_in: '未サインイン',
        status_api_key_session: 'APIキーセッション',
        status_waiting_codex: 'Codexを待機中…',
        theme_status_auto_dark: 'いまは端末設定に合わせてダークです。',
        theme_status_auto_light: 'いまは端末設定に合わせてライトです。',
        theme_status_locked_dark: 'PocketDexはダークモードで固定されています。',
        theme_status_locked_light: 'PocketDexはライトモードで固定されています。',
        install_action_now: '今すぐインストール',
        install_action_how: '手順を見る',
        install_action_unavailable: '利用不可',
        install_unavailable_hint: 'このブラウザでは今はインストール機能を利用できません。',
      },
      'zh-Hans': {
        default_limit: '默认限制',
        untitled_thread: '未命名线程',
        recent_thread: '最近线程',
        no_rate_snapshot: '还没有请求限制快照。请在 Codex 登录完成后点击刷新。',
        credits_unlimited: '不限',
        credits_available: '可用',
        credits_empty: '空',
        credits_available_hint: '这个限制附带额外额度。',
        credits_none_hint: '这个限制没有额外额度。',
        remaining_unknown: '未知',
        status_unknown: '未知',
        status_starting: '启动中…',
        status_disconnected: '已断开',
        status_connected: '已连接',
        status_connected_active: '已连接 · 当前回合进行中',
        status_signing_in: '登录中…',
        status_signed_in: '已登录',
        status_api_key: 'API 密钥',
        status_needs_sign_in: '需要登录',
        status_checking: '检测中…',
        status_not_signed_in: '未登录',
        status_api_key_session: 'API 密钥会话',
        status_waiting_codex: '等待 Codex…',
        theme_status_auto_dark: '当前跟随设备设置：深色。',
        theme_status_auto_light: '当前跟随设备设置：浅色。',
        theme_status_locked_dark: 'PocketDex 已锁定为深色模式。',
        theme_status_locked_light: 'PocketDex 已锁定为浅色模式。',
        install_action_now: '立即安装',
        install_action_how: '查看方法',
        install_action_unavailable: '不可用',
        install_unavailable_hint: '当前浏览器暂不提供安装能力。',
      },
      'zh-Hant': {
        default_limit: '預設限制',
        untitled_thread: '未命名執行緒',
        recent_thread: '最近執行緒',
        no_rate_snapshot: '目前還沒有速率限制快照。請在 Codex 登入完成後點一下重新整理。',
        credits_unlimited: '不限',
        credits_available: '可用',
        credits_empty: '空',
        credits_available_hint: '這個限制附帶額外額度。',
        credits_none_hint: '這個限制沒有額外額度。',
        remaining_unknown: '未知',
        status_unknown: '未知',
        status_starting: '啟動中…',
        status_disconnected: '已中斷連線',
        status_connected: '已連線',
        status_connected_active: '已連線 · 目前回合進行中',
        status_signing_in: '登入中…',
        status_signed_in: '已登入',
        status_api_key: 'API 金鑰',
        status_needs_sign_in: '需要登入',
        status_checking: '檢查中…',
        status_not_signed_in: '未登入',
        status_api_key_session: 'API 金鑰工作階段',
        status_waiting_codex: '等待 Codex…',
        theme_status_auto_dark: '目前跟隨裝置設定：深色。',
        theme_status_auto_light: '目前跟隨裝置設定：淺色。',
        theme_status_locked_dark: 'PocketDex 已固定為深色模式。',
        theme_status_locked_light: 'PocketDex 已固定為淺色模式。',
        install_action_now: '立即安裝',
        install_action_how: '查看方式',
        install_action_unavailable: '不可用',
        install_unavailable_hint: '目前這個瀏覽器暫時不提供安裝能力。',
      },
    };
    const pack = copy[lang] || copy.en;
    return pack[key] || copy.en[key] || key;
  }

  function normalizeUsedPercent(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    const scaled = value <= 1 ? value * 100 : value;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }

  function normalizeRemainingPercent(value) {
    const normalized = normalizeUsedPercent(value);
    if (normalized === null) return null;
    return Math.max(0, 100 - normalized);
  }

  function formatRemainingPercent(value) {
    const normalized = normalizeRemainingPercent(value);
    if (normalized === null) {
      return getUiCopy('remaining_unknown');
    }
    return normalized + '%';
  }

  function formatResetLabel(value) {
    if (!value) return '';
    const formatted = formatDateTime(value);
    if (!formatted) return '';
    const lang = getCurrentUiLang();
    if (lang === 'ja') return 'リセット ' + formatted;
    if (lang === 'zh-Hant') return '重設 ' + formatted;
    if (lang === 'zh-Hans') return '重置 ' + formatted;
    return 'Resets ' + formatted;
  }

  function formatNextResetLabel(value) {
    if (!value) return '';
    const formatted = formatDateTime(value);
    if (!formatted) return '';
    const lang = getCurrentUiLang();
    if (lang === 'ja') return '次回 ' + formatted;
    if (lang === 'zh-Hant') return '下次重設 ' + formatted;
    if (lang === 'zh-Hans') return '下次重置 ' + formatted;
    return 'Next reset ' + formatted;
  }

  function formatTimeUntilReset(value) {
    if (!value) return '';
    const normalized = value < 1e12 ? value * 1000 : value;
    let remainingMs = normalized - Date.now();
    if (!Number.isFinite(remainingMs)) return '';
    if (remainingMs <= 0) {
      const lang = getCurrentUiLang();
      if (lang === 'ja') return 'まもなく';
      if (lang === 'zh-Hant') return '即將重設';
      if (lang === 'zh-Hans') return '即将重置';
      return 'Soon';
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const hourMs = 60 * 60 * 1000;
    const minuteMs = 60 * 1000;
    const days = Math.floor(remainingMs / dayMs);
    remainingMs -= days * dayMs;
    const hours = Math.floor(remainingMs / hourMs);
    remainingMs -= hours * hourMs;
    const minutes = Math.max(1, Math.ceil(remainingMs / minuteMs));
    const lang = getCurrentUiLang();

    if (lang === 'ja') {
      const parts = [];
      if (days) parts.push(days + '日');
      if (hours) parts.push(hours + '時間');
      if (minutes && parts.length < 2) parts.push(minutes + '分');
      return 'あと' + parts.join('');
    }
    if (lang === 'zh-Hant') {
      const parts = [];
      if (days) parts.push(days + '天');
      if (hours) parts.push(hours + '小時');
      if (minutes && parts.length < 2) parts.push(minutes + '分鐘');
      return parts.join('') + '後';
    }
    if (lang === 'zh-Hans') {
      const parts = [];
      if (days) parts.push(days + '天');
      if (hours) parts.push(hours + '小时');
      if (minutes && parts.length < 2) parts.push(minutes + '分钟');
      return parts.join('') + '后';
    }
    const parts = [];
    if (days) parts.push(days + 'd');
    if (hours) parts.push(hours + 'h');
    if (minutes && parts.length < 2) parts.push(minutes + 'm');
    return 'in ' + parts.join(' ');
  }

  function getUsageTone(value) {
    const normalized = normalizeUsedPercent(value);
    if (normalized === null) return 'unknown';
    if (normalized >= 90) return 'danger';
    if (normalized >= 70) return 'warning';
    return 'safe';
  }

  function getSnapshotTone(snapshot) {
    const values = [];
    if (snapshot && snapshot.primary) values.push(normalizeUsedPercent(snapshot.primary.usedPercent) || 0);
    if (snapshot && snapshot.secondary) values.push(normalizeUsedPercent(snapshot.secondary.usedPercent) || 0);
    if (!values.length) return 'unknown';
    return getUsageTone(Math.max.apply(null, values));
  }

  function getNextResetAt(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return '';
    if (snapshot.primary && snapshot.primary.resetsAt) return snapshot.primary.resetsAt;
    if (snapshot.secondary && snapshot.secondary.resetsAt) return snapshot.secondary.resetsAt;
    if (snapshot.credits && snapshot.credits.resetsAt) return snapshot.credits.resetsAt;
    return '';
  }

  function formatWindowMeta(windowInfo) {
    if (!windowInfo) return '';
    const parts = [];
    const duration = getRateBucketLabel(windowInfo.windowDurationMins);
    const reset = formatResetLabel(windowInfo.resetsAt);
    if (duration) parts.push(duration);
    if (reset) parts.push(reset);
    return parts.join(' · ');
  }

  function getRateLimitEntries(result) {
    if (!result) return [];

    const entries = [];
    const seen = new Set();

    function pushSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      const key = snapshot.limitId || snapshot.limitName || 'default';
      if (seen.has(key)) return;
      seen.add(key);
      entries.push(snapshot);
    }

    pushSnapshot(result.rateLimits);
    if (result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object') {
      Object.keys(result.rateLimitsByLimitId).forEach((key) => {
        pushSnapshot(result.rateLimitsByLimitId[key]);
      });
    }

    return entries.sort((a, b) => {
      const left = String(a.limitName || a.limitId || '');
      const right = String(b.limitName || b.limitId || '');
      return left.localeCompare(right);
    });
  }

  function getConnectionLabel() {
    if (!socket) return getUiCopy('status_starting');
    if (!socket.connected) return getUiCopy('status_disconnected');
    if (turnActive) return getUiCopy('status_connected_active');
    return getUiCopy('status_connected');
  }

  function shouldAutoRefreshRateLimits() {
    return !!(
      socket &&
      socket.connected &&
      accountInfo &&
      (settingsOpen || showRateSummary) &&
      document.visibilityState === 'visible'
    );
  }

  function syncRateLimitAutoRefresh() {
    if (rateLimitRefreshTimer) {
      clearInterval(rateLimitRefreshTimer);
      rateLimitRefreshTimer = null;
    }
    if (!shouldAutoRefreshRateLimits()) return;

    const isStale = !rateLimitsUpdatedAt || (Date.now() - rateLimitsUpdatedAt) >= RATE_LIMIT_AUTO_REFRESH_MS;
    if (isStale && !rateLimitsLoading) {
      requestRateLimits();
    }

    rateLimitRefreshTimer = setInterval(() => {
      if (!rateLimitsLoading) requestRateLimits();
    }, RATE_LIMIT_AUTO_REFRESH_MS);
  }

  function renderRateLimitCards() {
    if (!settingsRateLimits) return;

    const entries = getRateLimitEntries(rateLimitsResult);
    if (!entries.length) {
      settingsRateLimits.innerHTML =
        '<div class="settings-rate-empty">' + escapeHtml(getUiCopy('no_rate_snapshot')) + '</div>';
      return;
    }

    settingsRateLimits.innerHTML = entries.map((snapshot) => {
      const title = snapshot.limitName || snapshot.limitId || getUiCopy('default_limit');
      const badge = snapshot.planType ? '<span class="settings-rate-badge">' + escapeHtml(formatPlanType(snapshot.planType)) + '</span>' : '';
      const primary = snapshot.primary
        ? '<div class="settings-rate-window tone-' + getUsageTone(snapshot.primary.usedPercent) + '">' +
            '<span class="settings-rate-window-label">' + escapeHtml(getRateBucketLabel(snapshot.primary.windowDurationMins, 'primary')) + '</span>' +
            '<span class="settings-rate-meter ' + getUsageTone(snapshot.primary.usedPercent) + '">' +
              '<span class="settings-rate-meter-fill" style="width:' + (normalizeRemainingPercent(snapshot.primary.usedPercent) || 0) + '%"></span>' +
            '</span>' +
            '<span class="settings-rate-window-value">' + escapeHtml(formatRemainingPercent(snapshot.primary.usedPercent)) + '</span>' +
            (snapshot.primary.resetsAt ? '<span class="settings-rate-window-meta">' + escapeHtml(formatTimeUntilReset(snapshot.primary.resetsAt)) + '</span>' : '') +
            (snapshot.primary.resetsAt ? '<span class="settings-rate-window-reset">' + escapeHtml(formatResetLabel(snapshot.primary.resetsAt)) + '</span>' : '') +
          '</div>'
        : '';
      const secondary = snapshot.secondary
        ? '<div class="settings-rate-window tone-' + getUsageTone(snapshot.secondary.usedPercent) + '">' +
            '<span class="settings-rate-window-label">' + escapeHtml(getRateBucketLabel(snapshot.secondary.windowDurationMins, 'secondary')) + '</span>' +
            '<span class="settings-rate-meter ' + getUsageTone(snapshot.secondary.usedPercent) + '">' +
              '<span class="settings-rate-meter-fill" style="width:' + (normalizeRemainingPercent(snapshot.secondary.usedPercent) || 0) + '%"></span>' +
            '</span>' +
            '<span class="settings-rate-window-value">' + escapeHtml(formatRemainingPercent(snapshot.secondary.usedPercent)) + '</span>' +
            (snapshot.secondary.resetsAt ? '<span class="settings-rate-window-meta">' + escapeHtml(formatTimeUntilReset(snapshot.secondary.resetsAt)) + '</span>' : '') +
            (snapshot.secondary.resetsAt ? '<span class="settings-rate-window-reset">' + escapeHtml(formatResetLabel(snapshot.secondary.resetsAt)) + '</span>' : '') +
          '</div>'
        : '';
      const credits = snapshot.credits
        ? '<div class="settings-rate-window">' +
            '<span class="settings-rate-window-label">' + escapeHtml(getRateBucketLabel(0, 'credits')) + '</span>' +
            '<span class="settings-rate-window-value">' +
              escapeHtml(snapshot.credits.unlimited ? getUiCopy('credits_unlimited') : (snapshot.credits.balance || (snapshot.credits.hasCredits ? getUiCopy('credits_available') : getUiCopy('credits_empty')))) +
            '</span>' +
            '<span class="settings-rate-window-meta">' +
              escapeHtml(snapshot.credits.hasCredits ? getUiCopy('credits_available_hint') : getUiCopy('credits_none_hint')) +
            '</span>' +
          '</div>'
        : '';

      return '' +
        '<article class="settings-rate-card tone-' + getSnapshotTone(snapshot) + '">' +
          '<div class="settings-rate-card-head">' +
            '<p class="settings-rate-card-title">' + escapeHtml(title) + '</p>' +
            badge +
          '</div>' +
          '<div class="settings-rate-grid">' +
            primary +
            secondary +
            credits +
          '</div>' +
        '</article>';
    }).join('');
  }

  function ensureRateSummaryMetricCard(kind) {
    if (!rateSummaryCards) return null;
    let card = rateSummaryCards.querySelector('[data-rate-card="' + kind + '"]');
    if (card) return card;
    card = document.createElement('span');
    card.className = 'rate-summary-card';
    card.setAttribute('data-rate-card', kind);

    const label = document.createElement('span');
    label.className = 'rate-summary-card-label';
    const value = document.createElement('span');
    value.className = 'rate-summary-card-value';
    const meter = document.createElement('span');
    meter.className = 'rate-summary-meter';
    const fill = document.createElement('span');
    fill.className = 'rate-summary-meter-fill';
    meter.appendChild(fill);

    card.appendChild(label);
    card.appendChild(value);
    card.appendChild(meter);
    rateSummaryCards.appendChild(card);
    return card;
  }

  function updateRateSummaryMetricCard(kind, windowInfo, fallbackKind) {
    const existing = rateSummaryCards ? rateSummaryCards.querySelector('[data-rate-card="' + kind + '"]') : null;
    if (!windowInfo) {
      if (existing) existing.remove();
      return;
    }
    const card = ensureRateSummaryMetricCard(kind);
    if (!card) return;
    const tone = getUsageTone(windowInfo.usedPercent);
    const remaining = normalizeRemainingPercent(windowInfo.usedPercent) || 0;
    const label = card.querySelector('.rate-summary-card-label');
    const value = card.querySelector('.rate-summary-card-value');
    const meter = card.querySelector('.rate-summary-meter');
    const fill = card.querySelector('.rate-summary-meter-fill');
    if (label) label.textContent = getRateBucketLabel(windowInfo.windowDurationMins, fallbackKind);
    if (value) value.textContent = formatRemainingPercent(windowInfo.usedPercent);
    card.classList.remove('tone-warning', 'tone-danger');
    card.classList.toggle('tone-warning', tone === 'warning');
    card.classList.toggle('tone-danger', tone === 'danger');
    if (meter) {
      meter.classList.remove('warning', 'danger');
      meter.classList.toggle('warning', tone === 'warning');
      meter.classList.toggle('danger', tone === 'danger');
    }
    if (fill) fill.style.width = remaining + '%';
  }

  function renderRateSummaryBand() {
    if (!rateSummaryBar || !rateSummaryCards || !rateSummaryStatus) return;

    const entries = getRateLimitEntries(rateLimitsResult);
    const snapshot = entries[0] || null;
    const shouldShow = !!(showRateSummary && accountInfo && (rateLimitsLoading || snapshot));
    rateSummaryBar.hidden = !shouldShow;
    if (!shouldShow) {
      rateSummaryCards.innerHTML = '';
      updateHeaderInsightsVisibility();
      return;
    }

    if (rateLimitsLoading && !snapshot) {
      rateSummaryStatus.textContent = t('usage_loading');
      rateSummaryCards.innerHTML = '<div class="rate-summary-empty">' + escapeHtml(t('usage_refreshing')) + '</div>';
      rateSummaryBar.classList.remove('tone-warning', 'tone-danger');
      updateHeaderInsightsVisibility();
      return;
    }

    const tone = getSnapshotTone(snapshot);
    rateSummaryStatus.textContent = t('usage_remaining_title');
    rateSummaryBar.classList.toggle('tone-warning', tone === 'warning');
    rateSummaryBar.classList.toggle('tone-danger', tone === 'danger');
    const existingEmpty = rateSummaryCards.querySelector('.rate-summary-empty');
    if (existingEmpty) existingEmpty.remove();
    updateRateSummaryMetricCard('primary', snapshot.primary, 'primary');
    updateRateSummaryMetricCard('secondary', snapshot.secondary, 'secondary');
    updateHeaderInsightsVisibility();
  }

  function formatRelativeTime(valueSeconds) {
    if (!valueSeconds) return '';
    const deltaSeconds = Math.round(valueSeconds - (Date.now() / 1000));
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const ranges = [
      { unit: 'day', seconds: 86400 },
      { unit: 'hour', seconds: 3600 },
      { unit: 'minute', seconds: 60 },
    ];
    for (const range of ranges) {
      if (Math.abs(deltaSeconds) >= range.seconds || range.unit === 'minute') {
        return formatter.format(Math.round(deltaSeconds / range.seconds), range.unit);
      }
    }
    return formatter.format(deltaSeconds, 'second');
  }

  function getThreadStatusLabel(status) {
    if (!status || typeof status !== 'object') return t('thread_status_idle');
    if (status.type === 'active') return t('thread_status_active');
    if (status.type === 'systemError') return t('thread_status_error');
    if (status.type === 'notLoaded') return t('thread_status_stored');
    return t('thread_status_idle');
  }

  function matchesHistoryFilter(thread) {
    switch (historyFilterMode) {
      case 'current':
        return !!thread && thread.id === threadId;
      case 'active':
        return !!thread && thread.status && thread.status.type === 'active';
      case 'stored':
        return !!thread && thread.status && thread.status.type === 'notLoaded';
      default:
        return true;
    }
  }

  function renderHistoryFilters() {
    if (!historyFilterGroup) return;
    const buttons = historyFilterGroup.querySelectorAll('[data-filter]');
    buttons.forEach((button) => {
      const active = button.dataset.filter === historyFilterMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function updateHeaderInsightsVisibility() {
    if (!headerInsights) return;
    const hasVisibleSummary = !!(rateSummaryBar && !rateSummaryBar.hidden);
    headerInsights.hidden = !hasVisibleSummary;
  }

  function renderComposerContext() {
    if (!composerContextSummary) return;
    const parts = [];
    const workspace = getCurrentWorkspacePath();
    if (workspace) parts.push(getWorkspaceDisplay(workspace));
    if (currentTurnModelLabel || currentModelLabel) parts.push(currentTurnModelLabel || currentModelLabel);
    if (composerMode === 'plan') parts.push(t('composer_mode_plan'));
    if (composerSpeed && composerSpeed !== 'auto') {
      parts.push(composerSpeed === 'fast' ? t('composer_speed_fast') : t('composer_speed_flex'));
    }
    composerContextSummary.textContent = parts.length
      ? parts.join(' · ')
      : t('composer_context_idle');
  }

  function renderHistoryTabs() {
    if (!historyTabGroup) return;
    historyTabGroup.querySelectorAll('[data-tab]').forEach((button) => {
      const active = button.dataset.tab === historyTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (historyPanelRecent) historyPanelRecent.hidden = historyTab !== 'recent';
    if (historyPanelSearch) historyPanelSearch.hidden = historyTab !== 'search';
    if (historyPanelNew) historyPanelNew.hidden = historyTab !== 'new';
  }

  function renderWorkspaceChoices() {
    if (historyCurrentWorkspaceCopy) {
      const current = normalizeWorkspacePath(getCurrentWorkspacePath());
      historyCurrentWorkspaceCopy.textContent = current
        ? current
        : t('history_new_here_hint');
    }
    if (!historyWorkspaceList) return;
    const items = getWorkspaceCandidates();
    if (!items.length) {
      historyWorkspaceList.innerHTML = '<div class="settings-rate-empty">' + escapeHtml(t('history_workspace_none')) + '</div>';
      return;
    }
    historyWorkspaceList.innerHTML = items.map((cwd) => {
      return '<button class="history-workspace-card" type="button" data-workspace-action="start" data-workspace-path="' + escapeHtml(cwd) + '">' +
        '<span class="history-workspace-card-title">' + escapeHtml(getWorkspaceDisplay(cwd)) + '</span>' +
        '<span class="history-workspace-card-path">' + escapeHtml(cwd) + '</span>' +
      '</button>';
    }).join('');
  }

  function renderActiveTurnChip() {
    if (!activeTurnChip) return;
    activeTurnChip.hidden = !turnActive;
    if (activeTurnChipHint) {
      const parts = [];
      if (turnStats.toolCount > 0) parts.push('\u2699 ' + turnStats.toolCount);
      if (turnStats.fileCount > 0) parts.push('\uD83D\uDCC1 ' + turnStats.fileCount);
      activeTurnChipHint.textContent = [t('active_turn_chip_hint'), parts.join(' · ')].filter(Boolean).join(' · ');
    }
    if (chatStatusStack) chatStatusStack.hidden = !turnActive;
  }

  function renderThreadList() {
    if (!historyThreadList) return;

    const threads = threadsListResult && Array.isArray(threadsListResult.data)
      ? threadsListResult.data
      : [];
    const filteredThreads = threads.filter(matchesHistoryFilter);

    if (!filteredThreads.length) {
      historyThreadList.innerHTML = '<div class="settings-rate-empty">' + escapeHtml(threads.length ? t('history_filter_empty') : t('history_none')) + '</div>';
      return;
    }

    historyThreadList.innerHTML = filteredThreads.map((thread) => {
      const name = thread.name || thread.preview || getUiCopy('untitled_thread');
      const preview = thread.preview && thread.preview !== name ? thread.preview : '';
      const updated = thread.updatedAt ? formatRelativeTime(thread.updatedAt) : '';
      const status = getThreadStatusLabel(thread.status);
      const isCurrent = thread.id === threadId;
      return '<article class="settings-thread-card' + (isCurrent ? ' is-current' : '') + '">' +
        '<div class="settings-thread-head">' +
          '<div class="settings-thread-copy">' +
            '<p class="settings-thread-title">' + escapeHtml(name) + '</p>' +
            '<p class="settings-thread-meta">' +
              escapeHtml([status, updated].filter(Boolean).join(' · ') || getUiCopy('recent_thread')) +
            '</p>' +
          '</div>' +
          (isCurrent ? '<span class="settings-thread-badge">' + escapeHtml(t('history_filter_current')) + '</span>' : '') +
        '</div>' +
        (preview ? '<p class="settings-thread-preview">' + escapeHtml(preview) + '</p>' : '') +
        '<div class="settings-thread-actions">' +
          '<button class="settings-thread-btn" type="button" data-thread-action="resume" data-thread-id="' + escapeHtml(thread.id) + '"' + (isCurrent ? ' disabled' : '') + '>' + escapeHtml(t('history_action_resume')) + '</button>' +
          '<button class="settings-thread-btn" type="button" data-thread-action="fork" data-thread-id="' + escapeHtml(thread.id) + '">' + escapeHtml(t('history_action_fork')) + '</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderSettings() {
    const accountSummary = loginPending
      ? getUiCopy('status_signing_in')
      : accountInfo && accountInfo.type === 'chatgpt'
        ? getUiCopy('status_signed_in')
        : accountInfo && accountInfo.type === 'apiKey'
          ? getUiCopy('status_api_key')
          : authRequired
            ? getUiCopy('status_needs_sign_in')
            : getUiCopy('status_checking');

    if (settingsAccountStatus) {
      settingsAccountStatus.textContent = accountSummary;
    }

    if (settingsAccountEmail) {
      settingsAccountEmail.textContent = accountInfo && accountInfo.type === 'chatgpt'
        ? accountInfo.email
        : accountInfo && accountInfo.type === 'apiKey'
          ? getUiCopy('status_api_key_session')
          : getUiCopy('status_not_signed_in');
    }

    if (settingsAccountPlan) {
      const planType = accountInfo && accountInfo.type === 'chatgpt' ? accountInfo.planType : null;
      settingsAccountPlan.textContent = formatPlanType(planType);
    }

    if (settingsConnectionStatus) {
      settingsConnectionStatus.textContent = getConnectionLabel();
    }

    if (settingsCurrentModel) {
      settingsCurrentModel.textContent = currentTurnModelLabel || currentModelLabel || getUiCopy('status_checking');
    }

    if (settingsCwdValue) {
      settingsCwdValue.textContent = headerCwd && headerCwd.title
        ? headerCwd.title
        : getUiCopy('status_waiting_codex');
    }

    if (settingsRateRefresh) {
      settingsRateRefresh.disabled = rateLimitsLoading || !socket || !socket.connected || !accountInfo;
    }

    if (settingsRateStatus) {
      const nextReset = rateLimitsResult ? getNextResetAt(getRateLimitEntries(rateLimitsResult)[0]) : '';
      if (rateLimitsLoading) {
        settingsRateStatus.textContent = t('usage_refreshing');
      } else if (!accountInfo) {
        settingsRateStatus.textContent = t('usage_sign_in_first');
      } else if (rateLimitsResult) {
        settingsRateStatus.textContent = nextReset ? formatTimeUntilReset(nextReset) : t('usage_latest');
      } else {
        settingsRateStatus.textContent = t('usage_none');
      }
    }

    if (settingsRateSummaryToggle) {
      settingsRateSummaryToggle.checked = !!showRateSummary;
    }

    if (settingsCompactCommandsToggle) {
      settingsCompactCommandsToggle.checked = !!compactCommandCards;
    }

    if (settingsRateSummaryNote) {
      settingsRateSummaryNote.textContent = showRateSummary
        ? t('settings_usage_summary_hint')
        : t('settings_usage_summary_hint_off');
    }

    if (settingsThemeSelect) {
      settingsThemeSelect.value = themeMode;
    }

    if (settingsLanguageSelect && window.i18n) {
      settingsLanguageSelect.value = window.i18n.lang;
    }

    if (settingsThemeStatus) {
      const resolvedTheme = getResolvedTheme(themeMode);
      settingsThemeStatus.textContent = themeMode === 'auto'
        ? getUiCopy(resolvedTheme === 'dark' ? 'theme_status_auto_dark' : 'theme_status_auto_light')
        : getUiCopy(themeMode === 'dark' ? 'theme_status_locked_dark' : 'theme_status_locked_light');
    }

    if (historyRefreshBtn) {
      historyRefreshBtn.disabled = !socket || !socket.connected || threadsListLoading;
    }

    renderHistoryFilters();

    if (historyStatus) {
      if (threadsListLoading) {
        historyStatus.textContent = t('history_loading');
      } else if (threadsListResult && Array.isArray(threadsListResult.data) && threadsListResult.data.length && threadsListResult.data.filter(matchesHistoryFilter).length) {
        historyStatus.textContent = t('history_workspace');
      } else if (threadsListResult && Array.isArray(threadsListResult.data) && threadsListResult.data.length) {
        historyStatus.textContent = t('history_filter_empty');
      } else {
        historyStatus.textContent = t('history_none');
      }
    }

    // Always use live standalone check for display — don't rely on persisted
    // installCompleted flag alone, which can show "Installed" on devices/browsers
    // that never actually installed the PWA.
    const isCurrentlyStandalone = isStandaloneDisplayMode();
    if (settingsInstallStatus) {
      settingsInstallStatus.textContent = isCurrentlyStandalone
        ? t('install_status_installed')
        : installAvailable
          ? t('install_status_ready')
          : installSupported
            ? t('install_status_manual')
            : t('install_status_unavail');
    }

    if (settingsInstallHint) {
      settingsInstallHint.textContent = isCurrentlyStandalone
        ? t('install_desc_installed')
        : installAvailable
          ? t('install_desc_ready')
          : installSupported
            ? t('install_desc_manual')
            : getUiCopy('install_unavailable_hint');
    }

    if (settingsInstallAction) {
      settingsInstallAction.disabled = isCurrentlyStandalone || !installSupported;
      settingsInstallAction.textContent = isCurrentlyStandalone
        ? t('install_status_installed')
        : installAvailable
          ? getUiCopy('install_action_now')
          : installSupported
            ? getUiCopy('install_action_how')
            : getUiCopy('install_action_unavailable');
    }

    syncVoiceUI();
    renderRateLimitCards();
    renderRateSummaryBand();
    renderComposerContext();
    renderHistoryTabs();
    renderWorkspaceChoices();
    renderActiveTurnChip();
    renderThreadList();
  }

  function setSettingsOpen(open) {
    settingsOpen = !!open;
    if (!settingsOverlay) return;
    if (settingsOpen) closeSearch();

    settingsOverlay.hidden = !settingsOpen;
    settingsOverlay.setAttribute('aria-hidden', settingsOpen ? 'false' : 'true');
    renderSettings();

    syncRateLimitAutoRefresh();
  }

  function setHistoryTab(nextTab, options) {
    const allowed = nextTab === 'search' || nextTab === 'new' ? nextTab : 'recent';
    historyTab = allowed;
    searchActive = allowed === 'search';
    renderHistoryTabs();
    if (allowed !== 'search') {
      clearSearchHighlights();
      if (searchInput) searchInput.value = '';
      if (searchCount) searchCount.textContent = '';
    } else if (options && options.focus && searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function renderParentDirs() {
    const container = $('history-parent-dirs');
    if (!container) return;
    const cwd = normalizeWorkspacePath(getCurrentWorkspacePath());
    if (!cwd) {
      container.innerHTML = '<p class="history-parent-empty">No active workspace.</p>';
      return;
    }
    const normalized = cwd.replace(/\\/g, '/').replace(/\/$/, '');
    const parts = normalized.split('/').filter(Boolean);
    const dirs = [];
    let current = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === 0 && /^[A-Za-z]:$/.test(part)) {
        current = part.toUpperCase() + '/';
      } else {
        current = current ? (current.endsWith('/') ? current + part : current + '/' + part) : '/' + part;
      }
      if (current.replace(/\/$/, '') !== normalized) {
        dirs.push(current.replace(/\/$/, '') || '/');
      }
    }
    dirs.reverse(); // Closest parent first
    const topDirs = dirs.slice(0, 4);
    if (topDirs.length === 0) {
      container.innerHTML = '<p class="history-parent-empty">Already at root.</p>';
      return;
    }
    container.innerHTML = topDirs.map(function(dir) {
      var displayName = dir.split('/').filter(Boolean).pop() || dir;
      return '<button class="history-parent-dir-btn" data-path="' + escapeHtml(dir) + '">' +
        '<span class="history-parent-dir-name">' + escapeHtml(displayName) + '</span>' +
        '<span class="history-parent-dir-path">' + escapeHtml(dir) + '</span>' +
        '</button>';
    }).join('');
  }

  function setHistoryOpen(open) {
    historyOpen = !!open;
    if (!historyOverlay) return;
    historyOverlay.hidden = !historyOpen;
    historyOverlay.setAttribute('aria-hidden', historyOpen ? 'false' : 'true');
    if (historyOpen) {
      renderSettings(); // update historyRefreshBtn state
      renderThreadList();
      renderParentDirs();
      if (socket && socket.connected && !threadsListLoading && !threadsListResult) {
        requestThreadList();
      }
    } else {
      closeSearch();
    }
  }

  // ── SVG icon helper ──────────────────────────────────────────────
  function svgIcon(name, size) {
    size = size || 20;
    const icons = {
      zap:       '<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polyline>',
      terminal:  '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>',
      file:      '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline>',
      file_edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
      search:    '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
      globe:     '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
      code:      '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
      cpu:       '<rect x="4" y="4" width="16" height="16" rx="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line>',
      folder:    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
      check:     '<polyline points="20 6 9 17 4 12"></polyline>',
      cross:     '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
      chevron_d: '<polyline points="6 9 12 15 18 9"></polyline>',
    };
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24"' +
      ' stroke="currentColor" fill="none" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (icons[name] || '') + '</svg>';
  }

  // ── Tool icon by tool name ────────────────────────────────────────
  function toolIconName(toolName) {
    if (!toolName) return 'cpu';
    const n = toolName.toLowerCase();
    if (n.includes('bash') || n.includes('shell') || n.includes('exec') || n.includes('run')) return 'terminal';
    if (n.includes('write') || n.includes('create') || n.includes('edit'))  return 'file_edit';
    if (n.includes('read')  || n.includes('file')   || n.includes('open'))  return 'file';
    if (n.includes('search') || n.includes('find') || n.includes('grep'))   return 'search';
    if (n.includes('web')   || n.includes('fetch')  || n.includes('http'))  return 'globe';
    if (n.includes('list')  || n.includes('ls')     || n.includes('dir'))   return 'folder';
    if (n.includes('code')  || n.includes('patch')  || n.includes('diff'))  return 'code';
    return 'cpu';
  }

  // ── Tool cards ───────────────────────────────────────────────────
  const _toolCards = new Map();

  function addToolCard(params) {
    if (emptyState) emptyState.remove();

    const toolName  = params.name || params.tool_name || params.function || 'tool';
    const callId    = params.call_id || params.id || null;
    const iconName  = toolIconName(toolName);

    const card = document.createElement('div');
    card.className = 'tool-card running';

    const inputHtml = buildToolInputHtml(params);

    card.innerHTML =
      '<div class="tool-card-header">' +
        '<div class="tool-icon">' + svgIcon(iconName, 14) + '</div>' +
        '<span class="tool-card-name">' + escapeHtml(toolName) + '</span>' +
        '<div class="tool-status"><div class="tool-spinner"></div></div>' +
        '<svg class="tool-chevron" viewBox="0 0 24 24">' +
          '<polyline points="6 9 12 15 18 9"></polyline>' +
        '</svg>' +
      '</div>' +
      '<div class="tool-card-body">' +
        '<div class="tool-card-content">' + inputHtml + '</div>' +
      '</div>';

    const header = card.querySelector('.tool-card-header');
    header.addEventListener('click', () => {
      card.classList.toggle('open');
    });

    appendArtifactNode(card);
    scrollToBottom();

    if (callId !== null) {
      _toolCards.set(String(callId), card);
    }

    return card;
  }

  function buildToolInputHtml(params) {
    const input = params.input || params.arguments || params.args || null;
    if (!input) return '';

    let html = '<p class="tool-field-label">Input</p>';

    if (typeof input === 'string') {
      html += '<div class="tool-field-value">' + escapeHtml(input) + '</div>';
    } else if (Array.isArray(input)) {
      const joined = input.map((a) => escapeHtml(String(a))).join(' ');
      html += '<div class="tool-field-value">' + joined + '</div>';
    } else if (typeof input === 'object') {
      Object.keys(input).forEach((key) => {
        const val = input[key];
        const display = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        html +=
          '<p class="tool-field-label">' + escapeHtml(key) + '</p>' +
          '<div class="tool-field-value">' + escapeHtml(display) + '</div>';
      });
    }

    return html;
  }

  function updateToolCard(params) {
    const callId = String(params.call_id || params.id || '');
    let card = _toolCards.get(callId);
    if (!card && callId) {
      card = addToolCard(params);
    }
    if (!card) return;

    const isError = params.is_error || params.error || false;
    card.classList.remove('running');
    card.classList.add(isError ? 'error' : 'success');

    const statusEl = card.querySelector('.tool-status');
    if (statusEl) {
      if (isError) {
        statusEl.innerHTML =
          '<svg class="tool-done-icon fail" viewBox="0 0 24 24">' +
            '<line x1="18" y1="6" x2="6" y2="18"></line>' +
            '<line x1="6" y1="6" x2="18" y2="18"></line>' +
          '</svg>';
      } else {
        statusEl.innerHTML =
          '<svg class="tool-done-icon ok" viewBox="0 0 24 24">' +
            '<polyline points="20 6 9 17 4 12"></polyline>' +
          '</svg>';
      }
    }

    const content = card.querySelector('.tool-card-content');
    if (content) {
      const output = params.output || params.content || params.result || null;
      if (output !== null && output !== undefined) {
        const display = isError
          ? formatErrorDisplay(output, t('status_error'))
          : (typeof output === 'string' ? output : JSON.stringify(output, null, 2));
        const resultLabel = isError ? 'Error' : 'Output';
        content.insertAdjacentHTML('beforeend',
          '<p class="tool-field-label">' + resultLabel + '</p>' +
          '<div class="tool-result-value">' + escapeHtml(display.slice(0, 2000)) + '</div>'
        );
      }
    }

    _toolCards.delete(callId);
  }

  // ── Approval overlay ─────────────────────────────────────────────

  // ── Color diff renderer (Item 3) ─────────────────────────────────
  function renderColoredDiff(fileChanges) {
    const paths = Object.keys(fileChanges || {});
    if (!paths.length) return null;
    const container = document.createElement('div');
    container.className = 'approval-diff-container';
    paths.forEach((filePath) => {
      const change = fileChanges[filePath];
      if (!change) return;
      const header = document.createElement('div');
      header.className = 'diff-file-header';
      header.textContent = (change.type === 'add' ? '+ ' : change.type === 'delete' ? '\u2212 ' : '~ ') + filePath;
      container.appendChild(header);
      const text = change.type === 'update' ? (change.unified_diff || '') : (change.content || '');
      const pre = document.createElement('pre');
      pre.className = 'approval-diff';
      text.split('\n').forEach((line) => {
        const span = document.createElement('span');
        span.className = line.startsWith('+') ? 'diff-add'
          : line.startsWith('-') ? 'diff-del'
          : line.startsWith('@@') ? 'diff-hunk'
          : 'diff-ctx';
        span.textContent = line + '\n';
        pre.appendChild(span);
      });
      container.appendChild(pre);
    });
    return container;
  }

  // ── Long press context menu (Item 12) ─────────────────────────────
  function addLongPressMenu(el, getOptions) {
    let timer;
    let touchX = 0, touchY = 0;
    el.addEventListener('touchstart', (e) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      timer = setTimeout(() => showContextMenu(getOptions(), touchX, touchY), 500);
    }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
    el.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
  }

  function showContextMenu(options, x, y) {
    if (!ctxMenu) return;
    ctxMenu.innerHTML = '';
    options.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'ctx-menu-item';
      div.textContent = item.label;
      div.setAttribute('role', 'menuitem');
      div.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        ctxMenu.hidden = true;
        item.action();
      }, { passive: true });
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        ctxMenu.hidden = true;
        item.action();
      });
      ctxMenu.appendChild(div);
    });
    const menuW = 180;
    ctxMenu.style.left = Math.min(x, window.innerWidth - menuW - 8) + 'px';
    ctxMenu.style.top = Math.min(y - 8, window.innerHeight - options.length * 44 - 16) + 'px';
    ctxMenu.hidden = false;
    const closeCtx = () => {
      ctxMenu.hidden = true;
      document.removeEventListener('touchstart', closeCtx);
      document.removeEventListener('mousedown', closeCtx);
    };
    setTimeout(() => {
      document.addEventListener('touchstart', closeCtx, { passive: true });
      document.addEventListener('mousedown', closeCtx);
    }, 100);
  }

  function getAiMsgMenuOptions(bubble) {
    return [
      {
        label: t('ctx_copy'),
        action: () => {
          const text = bubble.dataset.raw || bubble.textContent || '';
          if (navigator.clipboard && text) navigator.clipboard.writeText(text).catch(() => {});
          showToast(t('toast_copy_ok'), 1500);
        },
      },
      {
        label: 'Rollback 1 turn',
        action: () => {
          if (!threadId) return;
          socket.emit('request', { method: 'thread/rollback', params: { threadId, numTurns: 1 } });
          showToast(t('toast_rollback'), 2500);
        },
      },
      {
        label: 'Quote reply',
        action: () => {
          const text = bubble.dataset.raw || bubble.textContent || '';
          const firstLine = text.split('\n')[0].slice(0, 80);
          userInput.value = '> ' + firstLine + '\n\n';
          userInput.focus();
          autoGrow();
        },
      },
    ];
  }

  function getApprovalChoices(req) {
    if (approvalProtocol && typeof approvalProtocol.getDecisionSet === 'function') {
      return approvalProtocol.getDecisionSet(req);
    }
    return {
      approve: 'accept',
      approveForSession: 'acceptForSession',
      deny: 'decline',
      cancel: 'cancel',
    };
  }

  function getDismissDecision(req) {
    if (approvalProtocol && typeof approvalProtocol.getDismissDecision === 'function') {
      return approvalProtocol.getDismissDecision(req);
    }
    const choices = getApprovalChoices(req);
    return choices.deny || choices.cancel || 'decline';
  }

  function setApprovalButtonState(button, visible, label) {
    if (!button) return;
    button.hidden = !visible;
    button.disabled = !visible;
    if (label) button.textContent = label;
  }

  function showApproval(req) {
    pendingApprovalId = req.id;
    pendingApprovalRequest = req;
    pendingApprovalChoices = getApprovalChoices(req);
    vibrate([100, 50, 100]);
    const isFileChange = req.method === 'item/fileChange/requestApproval';
    const isPatchApproval = req.method === 'applyPatchApproval';
    const params = req.params || {};
    const allowAlways = !!pendingApprovalChoices.approveForSession;
    const allowApprove = !!pendingApprovalChoices.approve;
    const allowDeny = !!pendingApprovalChoices.deny || !!pendingApprovalChoices.cancel;

    if (isPatchApproval) {
      approvalBadge.textContent = t('approval_patch_badge');
      approvalBadge.className = 'approval-badge file';
      approvalTitle.textContent = t('approval_patch_title');
      approvalDetailLabel.textContent = 'Changes';
      const fc = params.fileChanges || {};
      const diffNode = renderColoredDiff(fc);
      approvalDetail.replaceChildren();
      if (diffNode) {
        approvalDetail.appendChild(diffNode);
      }
    } else if (isFileChange) {
      approvalBadge.textContent = t('approval_file_badge');
      approvalBadge.className = 'approval-badge file';
      approvalTitle.textContent = t('approval_file_title');
      approvalDetailLabel.textContent = 'Details';

      const op = (params.operation || params.op || '').toLowerCase();
      const opClass = op === 'create' ? 'create' : op === 'delete' ? 'delete' : op === 'update' ? 'update' : 'unknown';
      const opLabel = opClass === 'unknown' ? (op || 'Modify') : op.charAt(0).toUpperCase() + op.slice(1);
      const filePath = params.path || params.file_path || params.filename || params.grantRoot || '(unknown)';
      const diffContent = params.diff || params.patch || params.content || null;
      const reasonHtml = params.reason
        ? '<div class="approval-file-row"><span class="file-key">Reason</span><span class="file-val">' +
          escapeHtml(String(params.reason)) + '</span></div>'
        : '';
      const diffHtml = diffContent
        ? '<pre class="approval-diff">' + escapeHtml(String(diffContent).slice(0, 2000)) + '</pre>'
        : '';

      approvalDetail.innerHTML =
        '<div class="approval-file-info">' +
          '<div class="approval-file-row">' +
            '<span class="file-key">Op</span>' +
            '<span class="file-val"><span class="approval-op-badge ' + opClass + '">' + escapeHtml(opLabel) + '</span></span>' +
          '</div>' +
          '<div class="approval-file-row">' +
            '<span class="file-key">Path</span>' +
            '<span class="file-val">' + escapeHtml(filePath) + '</span>' +
          '</div>' +
          reasonHtml +
        '</div>' + diffHtml;
    } else {
      approvalBadge.textContent = t('approval_cmd_badge');
      approvalBadge.className = 'approval-badge cmd';
      approvalTitle.textContent = t('approval_cmd_title');
      approvalDetailLabel.textContent = 'Command';

      const args = params.args || params.cmd_args || params.command_args || null;
      const cmd  = params.command || params.cmd || params.executable || null;
      const cwd = params.cwd || null;
      const reason = params.reason || null;

      if (Array.isArray(args) && args.length > 0) {
        let argsHtml = '<div class="approval-args-list">';
        if (cmd) {
          argsHtml += '<div class="arg-item"><span class="arg-index">\u25b6</span><span class="arg-value">' + escapeHtml(cmd) + '</span></div>';
        }
        args.forEach((arg, i) => {
          argsHtml += '<div class="arg-item"><span class="arg-index">[' + i + ']</span><span class="arg-value">' + escapeHtml(String(arg)) + '</span></div>';
        });
        if (cwd) {
          argsHtml += '<div class="arg-item"><span class="arg-index">cwd</span><span class="arg-value">' + escapeHtml(String(cwd)) + '</span></div>';
        }
        if (reason) {
          argsHtml += '<div class="arg-item"><span class="arg-index">why</span><span class="arg-value">' + escapeHtml(String(reason)) + '</span></div>';
        }
        argsHtml += '</div>';
        approvalDetail.innerHTML = argsHtml;
      } else {
        const fullCmd = cmd ||
          (Array.isArray(params.args) ? params.args.join(' ') : '') ||
          params.command_line || '(unknown)';
        approvalDetail.innerHTML =
          '<div class="approval-args-list">' +
            '<div class="arg-item"><span class="arg-index">\u25b6</span><span class="arg-value">' + escapeHtml(fullCmd) + '</span></div>' +
            (cwd ? '<div class="arg-item"><span class="arg-index">cwd</span><span class="arg-value">' + escapeHtml(String(cwd)) + '</span></div>' : '') +
            (reason ? '<div class="arg-item"><span class="arg-index">why</span><span class="arg-value">' + escapeHtml(String(reason)) + '</span></div>' : '') +
          '</div>';
      }
    }

    setApprovalButtonState(approvalApprove, allowApprove, 'Approve');
    setApprovalButtonState(approvalApproveAll, allowAlways, 'Always');
    setApprovalButtonState(approvalDeny, allowDeny, pendingApprovalChoices.deny ? 'Deny' : 'Cancel');

    var approvalTimeoutMs = Math.max(1000, Number(req && req.timeoutMs) || APPROVAL_TIMEOUT_MS);

    // Start countdown timer bar (server timeout is the source of truth)
    if (approvalTimerFill) {
      clearTimeout(approvalUrgentTimer);
      approvalTimerFill.classList.remove('urgent');
      approvalTimerFill.style.transition = 'none';
      approvalTimerFill.style.width = '100%';
      requestAnimationFrame(() => {
        approvalTimerFill.style.transition = 'width ' + approvalTimeoutMs + 'ms linear';
        requestAnimationFrame(() => {
          approvalTimerFill.style.width = '0%';
        });
      });
      approvalUrgentTimer = setTimeout(() => {
        if (approvalTimerFill) approvalTimerFill.classList.add('urgent');
      }, Math.max(0, approvalTimeoutMs - 10_000));
    }

    approvalOverlay.classList.add('open');
    approvalOverlay.setAttribute('aria-hidden', 'false');
    setStatus('approval');

    // Swipe to approve/deny (Item 2)
    const sheet = approvalOverlay.querySelector('.approval-sheet');
    if (sheet) {
      let swipeStartX = 0, swipeStartY = 0, swipeDx = 0, swipeStartTime = 0;
      let swipeActive = false, swipeThresholdCrossed = false;
      const onTouchStart = (e) => {
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swipeStartTime = e.timeStamp;
        swipeDx = 0;
        swipeActive = true;
        swipeThresholdCrossed = false;
      };
      const onTouchMove = (e) => {
        if (!swipeActive) return;
        const dx = e.touches[0].clientX - swipeStartX;
        const dy = e.touches[0].clientY - swipeStartY;
        if (Math.abs(dy) > Math.abs(dx)) {
          swipeActive = false;
          sheet.style.transform = '';
          sheet.style.transition = '';
          sheet.classList.remove('swipe-approve', 'swipe-deny');
          return;
        }
        swipeDx = dx;
        sheet.style.transition = 'none';
        sheet.style.transform = 'translateX(' + dx + 'px)';
        if (Math.abs(dx) > 40) {
          if (!swipeThresholdCrossed) { swipeThresholdCrossed = true; vibrate([30]); }
          sheet.classList.toggle('swipe-approve', dx > 0);
          sheet.classList.toggle('swipe-deny', dx < 0);
        } else {
          sheet.classList.remove('swipe-approve', 'swipe-deny');
        }
      };
      const onTouchEnd = (e) => {
        if (!swipeActive) return;
        swipeActive = false;
        const elapsed = e.timeStamp - swipeStartTime;
        const velocity = elapsed > 0 ? Math.abs(swipeDx) / elapsed : 0;
        const confirmed = Math.abs(swipeDx) >= 80 || (velocity >= 0.5 && Math.abs(swipeDx) >= 40);
        sheet.classList.remove('swipe-approve', 'swipe-deny');
        sheet.style.transition = 'transform 0.25s ease';
        sheet.style.transform = '';
        if (confirmed) {
          if (swipeDx > 0) approvalApprove.click();
          else approvalDeny.click();
        }
      };
      sheet.addEventListener('touchstart', onTouchStart, { passive: true });
      sheet.addEventListener('touchmove', onTouchMove, { passive: true });
      sheet.addEventListener('touchend', onTouchEnd, { passive: true });
      _swipeHandlers = { sheet, onTouchStart, onTouchMove, onTouchEnd };
    }
    setTimeout(() => {
      if (!approvalApprove.hidden) {
        approvalApprove.focus();
      } else if (!approvalDeny.hidden) {
        approvalDeny.focus();
      }
    }, 300);
    if (_approvalKeyHandler) {
      document.removeEventListener('keydown', _approvalKeyHandler);
      _approvalKeyHandler = null;
    }
    _approvalKeyHandler = function(e) {
      var tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (approvalApprove && !approvalApprove.hidden) approvalApprove.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (approvalDeny && !approvalDeny.hidden) approvalDeny.click(); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (approvalApproveAll && !approvalApproveAll.hidden) approvalApproveAll.click(); }
    };
    document.addEventListener('keydown', _approvalKeyHandler);
  }

  function hideApproval() {
    if (_approvalKeyHandler) { document.removeEventListener('keydown', _approvalKeyHandler); _approvalKeyHandler = null; }
    clearTimeout(approvalUrgentTimer);
    approvalUrgentTimer = null;
    if (approvalTimerFill) {
      approvalTimerFill.style.transition = 'none';
      approvalTimerFill.style.width = '100%';
      approvalTimerFill.classList.remove('urgent');
    }
    if (_swipeHandlers) {
      const { sheet, onTouchStart, onTouchMove, onTouchEnd } = _swipeHandlers;
      sheet.removeEventListener('touchstart', onTouchStart);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('touchend', onTouchEnd);
      sheet.style.transform = '';
      sheet.style.transition = '';
      sheet.classList.remove('swipe-approve', 'swipe-deny');
      _swipeHandlers = null;
    }
    approvalOverlay.classList.remove('open');
    approvalOverlay.setAttribute('aria-hidden', 'true');
    pendingApprovalId = null;
    pendingApprovalRequest = null;
    pendingApprovalChoices = null;
    setStatus(turnActive ? 'thinking' : 'connected');
  }

  function updateApprovalQueueBadge() {
    var count = pendingApprovalMap.size;
    if (approvalQueueCount) approvalQueueCount.textContent = count;
    if (approvalQueueBtn) approvalQueueBtn.classList.toggle('visible', count > 0);
  }

  function openApprovalQueue() {
    if (!approvalQueueDrawer || !approvalQueueList) return;
    approvalQueueList.innerHTML = '';
    pendingApprovalMap.forEach(function(req, id) {
      var item = document.createElement('div');
      item.className = 'approval-queue-item';
      var isFile = req.method === 'applyPatchApproval' || req.method === 'item/fileChange/requestApproval';
      var label = isFile ? '📄 File change' : '⚡ Command';
      var params = req.params || {};
      var detail = params.command || params.cmd || (params.path || params.file_path || '') || req.method;
      var labelEl = document.createElement('div');
      labelEl.className = 'approval-queue-item-label';
      labelEl.textContent = label + ': ' + (detail || '(unknown)');
      var actions = document.createElement('div');
      actions.className = 'approval-queue-item-actions';
      var approveBtn = document.createElement('button');
      approveBtn.className = 'btn btn-approve';
      approveBtn.textContent = 'Approve';
      var denyBtn = document.createElement('button');
      denyBtn.className = 'btn btn-deny';
      denyBtn.textContent = 'Deny';
      var choices = getApprovalChoices(req);
      approveBtn.addEventListener('click', function() {
        if (choices.approve) { socket.emit('approval_response', { id: id, result: { decision: choices.approve } }); }
        pendingApprovalMap.delete(id);
        item.remove();
        updateApprovalQueueBadge();
      });
      denyBtn.addEventListener('click', function() {
        var denyDecision = choices.deny || choices.cancel || 'deny';
        socket.emit('approval_response', { id: id, result: { decision: denyDecision } });
        pendingApprovalMap.delete(id);
        item.remove();
        updateApprovalQueueBadge();
      });
      actions.appendChild(denyBtn);
      actions.appendChild(approveBtn);
      item.appendChild(labelEl);
      item.appendChild(actions);
      approvalQueueList.appendChild(item);
    });
    approvalQueueDrawer.hidden = false;
    approvalQueueDrawer.setAttribute('aria-hidden', 'false');
    approvalQueueDrawer.classList.add('open');
  }

  function closeApprovalQueue() {
    if (!approvalQueueDrawer) return;
    approvalQueueDrawer.classList.remove('open');
    approvalQueueDrawer.hidden = true;
    approvalQueueDrawer.setAttribute('aria-hidden', 'true');
  }

  function sendApproval(decision) {
    if (pendingApprovalId === null) return;
    socket.emit('approval_response', { id: pendingApprovalId, result: { decision } });
    pendingApprovalMap.delete(pendingApprovalId); // ← remove from queue
    updateApprovalQueueBadge(); // ← update badge
    hideApproval();
  }

  approvalApprove.addEventListener('click', () => {
    if (pendingApprovalChoices && pendingApprovalChoices.approve) {
      sendApproval(pendingApprovalChoices.approve);
    }
  });
  approvalApproveAll.addEventListener('click', () => {
    if (pendingApprovalChoices && pendingApprovalChoices.approveForSession) {
      sendApproval(pendingApprovalChoices.approveForSession);
    }
  });
  approvalDeny.addEventListener('click', () => {
    if (!pendingApprovalRequest) return;
    sendApproval(getDismissDecision(pendingApprovalRequest));
  });
  $('approval-scrim').addEventListener('click', () => {
    if (!pendingApprovalRequest) return;
    sendApproval(getDismissDecision(pendingApprovalRequest));
  });

  // ── Thread lifecycle ─────────────────────────────────────────────
  function maybeStartThread() {
    if (!socket || !socket.connected || !sessionStateReady || !accountReady || authRequired || threadId) {
      return;
    }
    startThread({ cwd: getCurrentWorkspacePath() || null });
  }

  function requestThreadHistory() {
    if (!socket || !socket.connected || !threadId) return;
    if (historyHydratedThreadId === threadId) return;
    if (historyUnavailableUntilFirstTurn) return;
    pendingThreadReadRequestId = emitSocketRequest('thread/read', {
      threadId,
      includeTurns: true,
    });
  }

  function scheduleAccountRefresh(forceRefreshToken) {
    if (!socket || !socket.connected) return;
    updateAccountBanner();
    requestAccountState(!!forceRefreshToken);
  }

  function syncAuthWatch() {
    if (accountPollTimer) {
      clearInterval(accountPollTimer);
      accountPollTimer = null;
    }

    if (!socket || !socket.connected) return;
    if (!(authRequired || loginPending)) return;

    accountPollTimer = setInterval(() => {
      scheduleAccountRefresh(true);
    }, 3000);
  }

  function requestRateLimits() {
    if (!socket || !socket.connected || !accountInfo || rateLimitsLoading) return;
    rateLimitsLoading = true;
    renderSettings();
    emitSocketRequest('account/rateLimits/read');
  }

  function buildThreadStartParams(options) {
    options = options || {};
    const params = { experimentalRawEvents: false };
    if (useExtendedHistory) {
      params.persistExtendedHistory = true;
    }
    const workspace = typeof options.cwd === 'string' ? options.cwd.trim() : '';
    if (workspace) {
      params.cwd = workspace;
    }
    const model = (options.model || currentModelId || '').trim();
    if (model) {
      params.model = model;
    }
    return params;
  }

  function startThread(options) {
    if (!socket || !socket.connected || authRequired) return;
    const params = buildThreadStartParams(options);
    pendingThreadStartOptions = params;
    pendingThreadStartRequestId = emitSocketRequest('thread/start', params);
  }

  function loadModels() {
    emitSocketRequest('model/list', {});
  }

  function requestAccountState(refreshToken) {
    if (!socket || !socket.connected) return;
    socket.emit('request', {
      method: 'account/read',
      params: { refreshToken: !!refreshToken },
    });
  }

  function requestThreadList() {
    if (!socket || !socket.connected) return;
    threadsListLoading = true;
    renderSettings();
    emitSocketRequest('thread/list', {
      limit: 12,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: ['appServer', 'cli', 'vscode', 'exec', 'custom', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'],
    });
  }

  function startNewSessionAtWorkspace(cwd) {
    if (!socket || !socket.connected) return;
    const nextCwd = normalizeWorkspacePath(cwd) || normalizeWorkspacePath(getCurrentWorkspacePath());
    startThread({ cwd: nextCwd || null });
    setHistoryOpen(false);
    closeSearch();
    if (historyWorkspaceInput) historyWorkspaceInput.value = '';
    showToast(t('history_new_started'), 1800);
  }

  function syncThreadFromResponse(thread, options) {
    if (!thread || !thread.id) return;
    options = options || {};
    threadId = thread.id;
    historyHydratedThreadId = null;
    currentThreadTurnCount = Array.isArray(thread.turns) ? thread.turns.length : currentThreadTurnCount;
    currentTurnId = '';
    currentAiEl = null;
    currentAiModelEl = null;
    if (thinkingEl) {
      thinkingEl.classList.replace('is-live', 'is-done');
    }
    thinkingEl = null;
    thinkingText = '';
    if (thread.cwd) setCwd(thread.cwd);
    clearConversation();
    if (Array.isArray(thread.turns) && thread.turns.length) {
      renderThreadHistory(thread);
    }
    if (!options.skipListRefresh) {
      requestThreadList();
    }
  }

  function resumeThread(nextThreadId) {
    if (!socket || !socket.connected || !nextThreadId) return;
    pendingResumeThreadId = nextThreadId;
    const params = {
      threadId: nextThreadId,
    };
    if (useExtendedHistory) {
      params.persistExtendedHistory = true;
    }
    socket.emit('request', {
      method: 'thread/resume',
      params,
    });
  }

  function forkThread(nextThreadId) {
    if (!socket || !socket.connected || !nextThreadId) return;
    pendingForkThreadId = nextThreadId;
    const params = {
      threadId: nextThreadId,
    };
    if (useExtendedHistory) {
      params.persistExtendedHistory = true;
    }
    socket.emit('request', {
      method: 'thread/fork',
      params,
    });
  }

  function exportConversation() {
    if (!messagesEl) return;
    var lines = ['# PocketDex Conversation\n'];
    var timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    lines.push('_Exported: ' + timestamp + '_\n');
    messagesEl.querySelectorAll('.message, .thinking-block').forEach(function(el) {
      if (el.classList.contains('message-user')) {
        var text = el.querySelector('.bubble') ? el.querySelector('.bubble').textContent.trim() : '';
        if (text) lines.push('\n## You\n\n' + text + '\n');
      } else if (el.classList.contains('message-ai')) {
        var bubble = el.querySelector('.bubble');
        var raw = bubble ? (bubble.dataset.raw || bubble.textContent.trim()) : '';
        if (raw) lines.push('\n## Codex\n\n' + raw + '\n');
      }
    });
    var content = lines.join('\n');
    var blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pocketdex-chat-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t('toast_chat_exported'), 3000);
  }

  function openSearch() {
    setHistoryOpen(true);
    setHistoryTab('search');
    searchActive = true;
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
      performSearch(searchInput.value);
    }
  }

  function closeSearch() {
    searchActive = false;
    clearSearchHighlights();
    if (searchInput) searchInput.value = '';
    if (searchCount) searchCount.textContent = '';
    if (historyTab === 'search') {
      setHistoryTab('recent');
    }
  }

  function clearSearchHighlights() {
    searchResults.forEach(function(span) {
      var parent = span.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(span.textContent), span);
    });
    // Normalize text nodes back
    if (messagesEl) messagesEl.normalize();
    searchResults = [];
    searchIndex = -1;
  }

  function performSearch(query) {
    clearSearchHighlights();
    if (!query || !messagesEl) {
      if (searchCount) searchCount.textContent = '';
      return;
    }
    var q = query.toLowerCase();
    var walker = document.createTreeWalker(messagesEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        // Skip script, style, search-bar itself
        var p = node.parentElement;
        while (p) {
          if (p.id === 'history-overlay' || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return node.textContent.toLowerCase().indexOf(q) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var textNode, newResults = [];
    while ((textNode = walker.nextNode())) {
      var text = textNode.textContent;
      var lower = text.toLowerCase();
      var idx = 0, pos;
      var frag = document.createDocumentFragment();
      while ((pos = lower.indexOf(q, idx)) !== -1) {
        if (pos > idx) frag.appendChild(document.createTextNode(text.slice(idx, pos)));
        var span = document.createElement('mark');
        span.className = 'search-highlight';
        span.textContent = text.slice(pos, pos + q.length);
        frag.appendChild(span);
        newResults.push(span);
        idx = pos + q.length;
      }
      if (idx < text.length) frag.appendChild(document.createTextNode(text.slice(idx)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
    searchResults = newResults;
    searchIndex = searchResults.length > 0 ? 0 : -1;
    updateSearchCurrent();
    if (searchCount) searchCount.textContent = searchResults.length > 0 ? '1 / ' + searchResults.length : t('search_no_results');
  }

  function updateSearchCurrent() {
    searchResults.forEach(function(el, i) { el.classList.toggle('current', i === searchIndex); });
    if (searchIndex >= 0 && searchResults[searchIndex]) {
      searchResults[searchIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (searchCount && searchResults.length > 0) {
      searchCount.textContent = (searchIndex + 1) + ' / ' + searchResults.length;
    }
  }

  function searchNavigate(dir) {
    if (!searchResults.length) return;
    searchIndex = (searchIndex + dir + searchResults.length) % searchResults.length;
    updateSearchCurrent();
  }

  function rollbackCurrentThread() {
    if (!socket || !socket.connected || !threadId || currentThreadTurnCount < 1) return;
    socket.emit('request', {
      method: 'thread/rollback',
      params: {
        threadId,
        numTurns: 1,
      },
    });
  }

  function buildTurnInputItems(text) {
    const trimmedText = String(text || '').trim();
    const inputItems = [];
    if (pendingImageDataUrl) {
      inputItems.push({ type: 'image', url: pendingImageDataUrl });
    }
    const textParts = [];
    if (trimmedText) textParts.push(trimmedText);
    if (pendingFileAttachment) textParts.push(buildPendingFileText(pendingFileAttachment));
    if (textParts.length) {
      inputItems.push({ type: 'text', text: textParts.join('\n\n'), text_elements: [] });
    }
    return inputItems;
  }

  function clearPendingAttachments() {
    pendingImageDataUrl = '';
    pendingFileAttachment = null;
    if (imageInput) imageInput.value = '';
    if (fileInput) fileInput.value = '';
    renderAttachmentPreview();
  }

  function buildTurnStartParams(inputItems) {
    const params = { threadId, input: inputItems };
    const activeModelForTurn = modelPicker && modelPicker.value ? modelPicker.value : currentModelId;
    if (activeModelForTurn) {
      params.model = activeModelForTurn;
    }
    if (composerSpeed && composerSpeed !== 'auto') {
      params.serviceTier = composerSpeed;
    }
    if (composerMode === 'plan' && activeModelForTurn) {
      params.collaborationMode = {
        mode: 'plan',
        settings: {
          model: activeModelForTurn,
          reasoning_effort: null,
          developer_instructions: null,
        },
      };
    }
    return params;
  }

  function steerTurn(text) {
    if (!socket || !socket.connected || !threadId || !currentTurnId) return;
    const inputItems = buildTurnInputItems(text);
    if (!inputItems.length) return;
    clearPendingAttachments();
    socket.emit('request', {
      method: 'turn/steer',
      params: {
        threadId,
        expectedTurnId: currentTurnId,
        input: inputItems,
      },
    });
  }

  function applyRateLimitsResult(result) {
    rateLimitsLoading = false;
    rateLimitsResult = result || null;
    rateLimitsUpdatedAt = Date.now();
    renderSettings();
    syncRateLimitAutoRefresh();
  }

  function applyRateLimitSnapshotUpdate(snapshot) {
    if (!snapshot) return;
    const next = rateLimitsResult ? {
      rateLimits: rateLimitsResult.rateLimits || null,
      rateLimitsByLimitId: Object.assign({}, rateLimitsResult.rateLimitsByLimitId || {}),
    } : {
      rateLimits: null,
      rateLimitsByLimitId: {},
    };
    const key = snapshot.limitId || snapshot.limitName || 'default';
    next.rateLimitsByLimitId[key] = snapshot;
    if (!next.rateLimits) next.rateLimits = snapshot;
    rateLimitsResult = next;
    rateLimitsLoading = false;
    rateLimitsUpdatedAt = Date.now();
    renderSettings();
    syncRateLimitAutoRefresh();
  }

  function applyAccountState(result) {
    const nextAccount = result && result.account ? result.account : null;
    const requiresOpenaiAuth = !!(result && result.requiresOpenaiAuth);
    accountStateSeen = true;

    if (nextAccount) {
      accountInfo = nextAccount;
      authFailureStreak = 0;
      clearAuthBannerDismissal();
    } else if (requiresOpenaiAuth) {
      authFailureStreak += 1;
      if (!accountInfo || authFailureStreak >= AUTH_FAILURE_THRESHOLD) {
        accountInfo = null;
      }
    } else {
      accountInfo = null;
      authFailureStreak = 0;
      clearAuthBannerDismissal();
    }

    authRequired = !!(loginPending || (requiresOpenaiAuth && authFailureStreak >= AUTH_FAILURE_THRESHOLD));

    accountReady = !!accountInfo || !authRequired;
    if (!accountInfo && authRequired) {
      rateLimitsResult = null;
      rateLimitsUpdatedAt = 0;
    }

    updateAccountBanner();
    syncComposerState();
    syncAuthWatch();
    renderSettings();
    syncRateLimitAutoRefresh();
    if (accountReady) requestThreadHistory();
    maybeStartThread();
  }

  function startAccountLogin() {
    if (!socket || !socket.connected || loginPending) return;

    loginPending = true;
    updateAccountBanner();
    syncAuthWatch();

    try {
      loginWindow = window.open('', '_blank');
    } catch {
      loginWindow = null;
    }

    socket.emit('request', {
      method: 'account/login/start',
      params: { type: 'chatgpt' },
    });
  }

  function sendMessage(text) {
    if (!isInteractive()) {
      showToast(t('toast_signin_required'), 3000);
      return;
    }
    lastUserMessageText = text;
    const inputItems = buildTurnInputItems(text);
    if (!inputItems.length) return;
    if (!currentAiEl) startAiMessage({ model: currentModelLabel });
    if (!threadId) {
      pendingDraft = { text };
      maybeStartThread();
      return;
    }
    clearPendingAttachments();
    socket.emit('request', {
      method: 'turn/start',
      params: buildTurnStartParams(inputItems),
    });
  }

  // ── Web Push helpers (Item 6) ─────────────────────────────────────
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
    return output;
  }

  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        socket.emit('push_subscribe', existing.toJSON());
        return;
      }
      const res = await fetch('/push/vapid-key');
      if (!res.ok) return;
      const { publicKey } = await res.json();
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      socket.emit('push_subscribe', sub.toJSON());
    } catch (err) {
      // Push not available or denied — not critical
    }
  }

  // ── Notification handler ─────────────────────────────────────────
  function handleNotification(msg) {
    const method = msg.method;
    const params = msg.params || {};

    switch (method) {
      case 'thread/started':
        threadId = (params.thread && params.thread.id) || params.threadId || null;
        historyHydratedThreadId = null;
        historyUnavailableUntilFirstTurn = false;
        if (params.thread && params.thread.cwd) setCwd(params.thread.cwd);
        if (pendingDraft) {
          const draft = pendingDraft;
          pendingDraft = null;
          sendMessage(draft.text || '');
        }
        break;

      case 'turn/started':
        currentTurnModelLabel = currentModelLabel;
        currentTurnId = params.turn && params.turn.id ? params.turn.id : currentTurnId;
        turnStats = { toolCount: 0, fileCount: 0, startMs: Date.now(), tokenCount: 0 };
        _planCard = null;
        resetTurnToolGroups();
        renderComposerContext();
        setTurnActive(true);
        if (!currentAiEl) startAiMessage({ model: currentTurnModelLabel });
        else updateCurrentAiModelBadge(currentTurnModelLabel);
        break;

      case 'turn/completed':
        currentTurnId = '';
        currentThreadTurnCount += 1;
        finalizeTurnToolGroups(true);
        var turnAiEl = currentAiEl;
        setTurnActive(false);
        // Try to get token count from completion params
        var completionParams = params || {};
        var usage = completionParams.usage || completionParams.tokenUsage || completionParams.stats || {};
        var tokens = usage.total_tokens || usage.totalTokens || usage.output_tokens || 0;
        if (tokens > 0) turnStats.tokenCount = tokens;
        if (turnAiEl) {
          const parts = [];
          parts.push(t('turn_summary_time') + ' ' + formatElapsedLabel(Date.now() - turnStats.startMs));
          if (turnStats.toolCount > 0) parts.push(t('turn_summary_tools') + ' ' + turnStats.toolCount);
          if (turnStats.fileCount > 0) parts.push(t('turn_summary_files') + ' ' + turnStats.fileCount);
          if (turnStats.tokenCount > 0) parts.push('\ud83d\udd22 ' + turnStats.tokenCount.toLocaleString() + ' tok');
          const summary = document.createElement('div');
          summary.className = 'turn-summary';
          parts.forEach((part) => {
            const chip = document.createElement('span');
            chip.className = 'turn-summary-chip';
            chip.textContent = part;
            summary.appendChild(chip);
          });
          turnAiEl.appendChild(summary);
        }
        currentTurnModelLabel = '';
        renderComposerContext();
        // Retry button
        if (lastUserMessageText && turnAiEl) {
          var msgEl = turnAiEl.parentElement;
          if (msgEl) {
            var retryBtn = document.createElement('button');
            retryBtn.className = 'btn-retry';
            retryBtn.textContent = '\u21ba Retry';
            retryBtn.setAttribute('aria-label', 'Retry last message');
            var retryText = lastUserMessageText; // capture
            retryBtn.addEventListener('click', function() {
              retryBtn.remove();
              sendMessage(retryText);
            });
            msgEl.appendChild(retryBtn);
          }
        }
        if (historyUnavailableUntilFirstTurn && threadId) {
          historyUnavailableUntilFirstTurn = false;
          requestThreadHistory();
        }
        saveConversationCache();
        break;

      case 'item/agentMessage/delta':
        appendDelta(params.delta || '');
        break;

      case 'item/reasoning/summaryTextDelta':
        appendReasoning(params.delta || '');
        break;

      case 'item/userMessage':
        break;

      case 'item/started': {
        ensureTurnArtifactState(params);
        const startedItem = getNotificationItem(params);
        let handled = false;
        if (startedItem && startedItem.type === 'commandExecution') {
          _activityItems.set(startedItem.id, startedItem);
          _activityOutputs.set(startedItem.id, '');
          ensureActivityCard(startedItem.id, commandActivityPayload(startedItem, '', 'running'));
          turnStats.toolCount += 1;
          updateTurnStatsBadge();
          handled = true;
        }
        if (startedItem && startedItem.type === 'fileChange') {
          _activityItems.set(startedItem.id, startedItem);
          _activityOutputs.set(startedItem.id, '');
          ensureActivityCard(startedItem.id, fileChangeActivityPayload(startedItem, '', 'running'));
          handled = true;
        }
        if (startedItem && startedItem.type === 'mcpToolCall') {
          _activityItems.set(startedItem.id, startedItem);
          ensureActivityCard(startedItem.id, mcpCallActivityPayload(startedItem, 'running'));
          turnStats.toolCount += 1;
          updateTurnStatsBadge();
          handled = true;
        }
        if (startedItem && startedItem.type === 'dynamicToolCall') {
          _activityItems.set(startedItem.id, startedItem);
          ensureActivityCard(startedItem.id, dynamicToolActivityPayload(startedItem, 'running'));
          turnStats.toolCount += 1;
          updateTurnStatsBadge();
          handled = true;
        }
        if (startedItem && !handled && startedItem.id) {
          _activityItems.set(startedItem.id, startedItem);
          _activityOutputs.set(startedItem.id, '');
          ensureActivityCard(startedItem.id, genericItemActivityPayload(startedItem, '', 'running'));
        }
        break;
      }

      case 'item/completed': {
        ensureTurnArtifactState(params);
        const completedItem = getNotificationItem(params);
        let handled = false;
        if (completedItem && completedItem.type === 'commandExecution') {
          _activityItems.set(completedItem.id, completedItem);
          const preview = _activityOutputs.get(completedItem.id) || completedItem.aggregatedOutput || '';
          ensureActivityCard(completedItem.id, commandActivityPayload(completedItem, preview));
          handled = true;
        }
        if (completedItem && completedItem.type === 'fileChange') {
          _activityItems.set(completedItem.id, completedItem);
          const diffs = (completedItem.changes || []).map((c) => c && c.diff || '').filter(Boolean).join('\n\n');
          turnStats.fileCount += Array.isArray(completedItem.changes) ? completedItem.changes.length : 0;
          updateTurnStatsBadge();
          ensureActivityCard(completedItem.id, fileChangeActivityPayload(completedItem, diffs, 'success'));
          handled = true;
        }
        if (completedItem && completedItem.type === 'mcpToolCall') {
          _activityItems.set(completedItem.id, completedItem);
          ensureActivityCard(completedItem.id, mcpCallActivityPayload(completedItem));
          handled = true;
        }
        if (completedItem && completedItem.type === 'dynamicToolCall') {
          _activityItems.set(completedItem.id, completedItem);
          ensureActivityCard(completedItem.id, dynamicToolActivityPayload(completedItem));
          handled = true;
        }
        if (completedItem && !handled && completedItem.id) {
          _activityItems.set(completedItem.id, completedItem);
          const preview = _activityOutputs.get(completedItem.id) || '';
          ensureActivityCard(completedItem.id, genericItemActivityPayload(completedItem, preview));
        }
        break;
      }

      case 'item/toolUse':
        ensureTurnArtifactState(params);
        turnStats.toolCount += 1;
        updateTurnStatsBadge();
        addToolCard(params);
        break;

      case 'item/toolResult':
        ensureTurnArtifactState(params);
        updateToolCard(params);
        break;

      case 'item/commandExecution/outputDelta': {
        ensureTurnArtifactState(params);
        const itemId = params.itemId || '';
        const nextOutput = ((_activityOutputs.get(itemId) || '') + (params.delta || '')).slice(-8000);
        _activityOutputs.set(itemId, nextOutput);
        const card = _activityCards.get(itemId);
        if (card) {
          const titleEl = card.querySelector('.activity-card-title');
          const metaEl = card.querySelector('.activity-card-meta');
          ensureActivityCard(itemId, {
            kicker: t('activity_kicker_command'),
            title: titleEl ? titleEl.textContent : t('activity_command_pending'),
            meta: metaEl ? metaEl.textContent : '',
            summary: extractSummaryLines(nextOutput, 4),
            fullContent: nextOutput,
            files: [],
            steps: [],
            tone: 'running',
            badge: getActivityBadgeForTone('running'),
          });
        } else if (itemId) {
          ensureActivityCard(itemId, {
            kicker: t('activity_kicker_command'),
            title: t('activity_command_pending'),
            meta: '',
            summary: extractSummaryLines(nextOutput, 4),
            fullContent: nextOutput,
            files: [],
            steps: [],
            tone: 'running',
            badge: getActivityBadgeForTone('running'),
          });
        }
        break;
      }

      case 'item/fileChange/outputDelta': {
        ensureTurnArtifactState(params);
        const itemId = params.itemId || '';
        const nextOutput = ((_activityOutputs.get(itemId) || '') + (params.delta || '')).slice(-8000);
        _activityOutputs.set(itemId, nextOutput);
        const card = _activityCards.get(itemId);
        if (card) {
          const titleEl = card.querySelector('.activity-card-title');
          const metaEl = card.querySelector('.activity-card-meta');
          const existingFiles = Array.from(card.querySelectorAll('.activity-card-file')).map((el) => el.textContent).filter(Boolean);
          ensureActivityCard(itemId, {
            kicker: t('activity_kicker_files'),
            title: titleEl ? titleEl.textContent : t('activity_files_pending'),
            meta: metaEl ? metaEl.textContent : '',
            summary: '',
            fullContent: nextOutput,
            files: existingFiles,
            steps: [],
            tone: 'running',
            badge: getActivityBadgeForTone('running'),
          });
        } else if (itemId) {
          ensureActivityCard(itemId, {
            kicker: t('activity_kicker_files'),
            title: t('activity_files_pending'),
            meta: '',
            summary: '',
            fullContent: nextOutput,
            files: [],
            steps: [],
            tone: 'running',
            badge: getActivityBadgeForTone('running'),
          });
        }
        break;
      }

      case 'hook/started': {
        ensureTurnArtifactState(params);
        const run = params.run || null;
        if (run && run.id) {
          ensureActivityCard('__hook__:' + run.id, hookRunActivityPayload(run, 'running'));
        }
        break;
      }

      case 'hook/completed': {
        ensureTurnArtifactState(params);
        const run = params.run || null;
        if (run && run.id) {
          ensureActivityCard('__hook__:' + run.id, hookRunActivityPayload(run));
        }
        break;
      }

      case 'command/exec/outputDelta':
        if (commandExecState && params.processId === commandExecState.processId) {
          appendCommandExecOutput(params.stream, decodeBase64ToText(params.deltaBase64 || ''));
        }
        break;

      case 'serverRequest/resolved': {
        var resolvedId = params && params.requestId;
        if (resolvedId !== undefined) {
          pendingApprovalMap.delete(resolvedId);
          updateApprovalQueueBadge();
        }
        if (pendingApprovalId !== null && String(params.requestId) === String(pendingApprovalId)) {
          hideApproval();
        }
        break;
      }

      case 'account/login/completed':
        loginPending = false;
        if (loginWindow && !loginWindow.closed) {
          loginWindow.close();
        }
        loginWindow = null;
        pendingLoginId = null;
        updateAccountBanner();
        syncAuthWatch();
        if (params.success) {
          showToast(t('toast_signin_complete'), 3000);
          requestAccountState(true);
          if (settingsOpen || showRateSummary) requestRateLimits();
        } else {
          showToast(getUserFacingErrorText(params.error, t('toast_signin_failed')), 5000);
        }
        break;

      case 'account/updated':
        requestAccountState(true);
        break;

      case 'account/rateLimits/updated':
        applyRateLimitSnapshotUpdate(params.rateLimits || null);
        break;

      case 'model/rerouted':
        currentTurnModelLabel = getModelLabel(params.toModel);
        updateCurrentAiModelBadge(currentTurnModelLabel);
        showToast(formatUiText(t('toast_model_rerouted'), { model: humanizeModelIdentifier(currentTurnModelLabel) }), 3000);
        break;

      case 'turn/plan/updated': {
        ensureTurnArtifactState(params);
        if (_planCard) {
          renderActivityCardContent(_planCard, planActivityPayload(params));
        } else {
          _planCard = ensureActivityCard('__plan__', planActivityPayload(params));
        }
        break;
      }

      case 'item/mcpToolCall/progress': {
        ensureTurnArtifactState(params);
        const progCard = _activityCards.get(params.itemId || '');
        if (progCard && params.message) {
          const metaEl = progCard.querySelector('.activity-card-meta');
          if (metaEl) metaEl.textContent = params.message;
        } else if (params.itemId) {
          ensureActivityCard(params.itemId, {
            kicker: t('activity_kicker_mcp'),
            title: t('activity_mcp_pending'),
            meta: params.message || '',
            summary: '',
            fullContent: '',
            files: [],
            steps: [],
            tone: 'running',
            badge: getActivityBadgeForTone('running'),
          });
        }
        break;
      }

      default:
        if (/^item\/.+\/outputDelta$/.test(method)) {
          ensureTurnArtifactState(params);
          const itemId = params.itemId || '';
          const nextOutput = ((_activityOutputs.get(itemId) || '') + (params.delta || '')).slice(-8000);
          _activityOutputs.set(itemId, nextOutput);
          const item = _activityItems.get(itemId) || { id: itemId, type: method.replace(/^item\//, '').replace(/\/outputDelta$/, '') };
          if (itemId) {
            ensureActivityCard(itemId, genericItemActivityPayload(item, nextOutput, 'running'));
          }
          break;
        }
        if (/^item\/.+\/progress$/.test(method)) {
          ensureTurnArtifactState(params);
          const itemId = params.itemId || '';
          const item = _activityItems.get(itemId) || { id: itemId, type: method.replace(/^item\//, '').replace(/\/progress$/, '') };
          const card = itemId ? _activityCards.get(itemId) : null;
          const prior = card ? (card.querySelector('.activity-card-full') || {}).textContent || '' : '';
          const next = [prior.trim(), params.message || ''].filter(Boolean).join('\n').trim();
          if (itemId) {
            ensureActivityCard(itemId, genericItemActivityPayload(item, next, 'running'));
          }
          break;
        }
        break;
    }
  }

  // ── request_result handler ───────────────────────────────────────
  function handleRequestResult(data) {
    if (data.method === 'model/list') {
      populateModels(data.result);
    }
    if (data.method === 'thread/list') {
      threadsListLoading = false;
      threadsListResult = data.result || { data: [], nextCursor: null };
      renderSettings();
      if (historyOpen) renderThreadList();
    }
    if (data.method === 'thread/start' && data.result && data.result.thread) {
      if (pendingThreadStartRequestId && data.clientRequestId &&
          data.clientRequestId !== pendingThreadStartRequestId) {
        return;
      }
      pendingThreadStartRequestId = '';
      pendingThreadStartOptions = null;
      syncThreadFromResponse(data.result.thread);
      currentThreadTurnCount = 0;
    }
    if (data.method === 'thread/resume' && data.result && data.result.thread) {
      pendingResumeThreadId = '';
      syncThreadFromResponse(data.result.thread);
      if (data.result.model) {
        setCurrentModel(data.result.model, getModelLabel(data.result.model) || data.result.model);
      }
      showToast(t('toast_thread_resumed'), 2500);
    }
    if (data.method === 'thread/fork' && data.result && data.result.thread) {
      pendingForkThreadId = '';
      syncThreadFromResponse(data.result.thread);
      if (data.result.model) {
        setCurrentModel(data.result.model, getModelLabel(data.result.model) || data.result.model);
      }
      showToast(t('toast_thread_forked'), 2500);
    }
    if (data.method === 'thread/rollback' && data.result && data.result.thread) {
      syncThreadFromResponse(data.result.thread);
      showToast(t('toast_rollback'), 2500);
    }
    if (data.method === 'turn/steer' && data.result) {
      showToast(t('toast_steering_sent'), 1800);
    }
    if (data.method === 'review/start' && data.result) {
      if (data.result.reviewThreadId) {
        threadId = data.result.reviewThreadId;
      }
      setTurnActive(true);
      showToast(t('toast_review_started'), 2500);
    }
    if (data.method === 'fuzzyFileSearch') {
      if (pendingWorkspaceSearchRequestId && data.clientRequestId &&
          data.clientRequestId !== pendingWorkspaceSearchRequestId) {
        return;
      }
      pendingWorkspaceSearchRequestId = '';
      workspaceSearchLoading = false;
      workspaceSearchResultsState = data.result && Array.isArray(data.result.files) ? data.result.files : [];
      renderWorkspaceSearch();
    }
    if (data.method === 'fs/readFile') {
      if (pendingWorkspaceFileRequestId && data.clientRequestId &&
          data.clientRequestId !== pendingWorkspaceFileRequestId) {
        return;
      }
      pendingWorkspaceFileRequestId = '';
      const decoded = decodeBase64ToText(data.result && data.result.dataBase64);
      const filePath = pendingWorkspaceFilePath;
      pendingWorkspaceFilePath = '';
      if (!decoded || !filePath) {
        showToast(t('composer_workspace_file_error'), 2800);
      } else if (decoded.indexOf('\u0000') !== -1) {
        showToast(t('composer_attach_file_unsupported'), 2800);
      } else if (decoded.length > FILE_ATTACHMENT_MAX_BYTES) {
        showToast(t('composer_attach_file_large'), 2800);
      } else {
        pendingFileAttachment = {
          name: filePath.split(/[\\/]/).pop() || 'workspace.txt',
          path: filePath,
          text: decoded,
          size: decoded.length,
          type: 'text/plain',
          origin: 'workspace',
        };
        renderAttachmentPreview();
        setWorkspaceSheetOpen(false);
        showToast(t('composer_workspace_attached'), 1800);
      }
    }
    if (data.method === 'command/exec') {
      if (commandExecState && commandExecState.requestId && data.clientRequestId &&
          data.clientRequestId !== commandExecState.requestId) {
        return;
      }
      if (commandExecState) {
        commandExecState.running = false;
        commandExecState.requestId = '';
        commandExecState.exitCode = data.result ? data.result.exitCode : 1;
        const stdout = data.result && data.result.stdout ? data.result.stdout : '';
        const stderr = data.result && data.result.stderr ? data.result.stderr : '';
        const output = [commandExecState.output, stdout, stderr ? '[stderr] ' + stderr : '']
          .filter(Boolean)
          .join('');
        commandExecState.output = output.slice(-12000);
      }
      renderCommandSheet();
    }
    if (data.method === 'command/exec/terminate') {
      if (commandExecState && commandExecState.terminateRequestId && data.clientRequestId &&
          data.clientRequestId !== commandExecState.terminateRequestId) {
        return;
      }
      if (commandExecState) commandExecState.terminateRequestId = '';
      if (commandSheetStatus) commandSheetStatus.textContent = t('composer_command_stopping');
    }
    if (data.method === 'account/read') {
      applyAccountState(data.result);
    }
    if (data.method === 'account/rateLimits/read') {
      applyRateLimitsResult(data.result);
    }
    if (data.method === 'thread/read' && data.result && data.result.thread) {
      if (pendingThreadReadRequestId && data.clientRequestId &&
          data.clientRequestId !== pendingThreadReadRequestId) {
        return;
      }
      pendingThreadReadRequestId = '';
      renderThreadHistory(data.result.thread);
    }
    if (data.method === 'account/login/start') {
      if (!data.result || data.result.type !== 'chatgpt' || !data.result.authUrl) {
        loginPending = false;
        updateAccountBanner();
        syncAuthWatch();
        showToast(t('toast_signin_start_failed'), 4000);
        return;
      }

      pendingLoginId = data.result.loginId || null;

      try {
        if (loginWindow && !loginWindow.closed) {
          loginWindow.location = data.result.authUrl;
          loginWindow.focus();
        } else {
          loginWindow = window.open(data.result.authUrl, '_blank');
        }
      } catch {
        loginWindow = null;
      }

      if (!loginWindow) {
        window.location.assign(data.result.authUrl);
        return;
      }

      showToast(t('toast_signin_opened'), 3000);
    }
  }

  function populateModels(result) {
    if (!modelPicker || !result || !Array.isArray(result.data)) return;
    const currentVal = modelPicker.value;
    let defaultModelId = currentModelId;
    modelCatalog = Object.create(null);
    modelPicker.innerHTML = '';
    result.data.forEach((m) => {
      const opt = document.createElement('option');
      const descriptor = rememberModelDescriptor(m);
      opt.value = descriptor.id;
      opt.textContent = descriptor.label || descriptor.id;
      modelCatalog[opt.value] = opt.textContent;
      if (!defaultModelId && m.isDefault) {
        defaultModelId = opt.value;
      }
      modelPicker.appendChild(opt);
    });
    const nextModelId = currentVal || currentModelId || defaultModelId || modelPicker.value || '';
    if (nextModelId) {
      modelPicker.value = nextModelId;
      setCurrentModel(nextModelId, modelCatalog[nextModelId]);
    }
  }

  // ── Model switching ───────────────────────────────────────────────
  if (modelPicker) {
    modelPicker.addEventListener('change', () => {
      const model = modelPicker.value;
      if (!model || !socket) return;
      setCurrentModel(model, getModelLabel(model));
      const label = currentModelLabel || getModelLabel(model);
      if (label && label !== getUiCopy('status_checking')) {
        showToast(formatUiText(t('toast_model_updated'), { model: label }), 2000);
      }
    });
  }

  if (accountLoginBtn) {
    accountLoginBtn.addEventListener('click', startAccountLogin);
  }

  if (accountBannerClose) {
    const handleBannerDismiss = (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissAuthBanner();
    };
    accountBannerClose.addEventListener('click', handleBannerDismiss);
  }

  // ── History drawer controls ───────────────────────────────────────
  if (historyBtn) {
    historyBtn.addEventListener('click', () => {
      setHistoryTab('recent');
      setHistoryOpen(true);
    });
  }
  if (historyCloseBtn) {
    historyCloseBtn.addEventListener('click', () => setHistoryOpen(false));
  }
  if (historyBackdrop) {
    historyBackdrop.addEventListener('click', () => setHistoryOpen(false));
  }
  if (historyRefreshBtn) {
    historyRefreshBtn.addEventListener('click', requestThreadList);
  }
  if (historyTabGroup) {
    historyTabGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      setHistoryTab(button.dataset.tab, { focus: button.dataset.tab === 'search' });
    });
  }
  if (historyFilterGroup) {
    historyFilterGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      historyFilterMode = button.dataset.filter || 'all';
      renderSettings();
    });
  }
  if (historyThreadList) {
    historyThreadList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-thread-action]');
      if (!button) return;
      const action = button.getAttribute('data-thread-action');
      const targetThreadId = button.getAttribute('data-thread-id');
      if (action === 'resume') {
        setHistoryOpen(false);
        resumeThread(targetThreadId);
      } else if (action === 'fork') {
        setHistoryOpen(false);
        forkThread(targetThreadId);
      }
    });
  }
  if (historyNewCurrentBtn) {
    historyNewCurrentBtn.addEventListener('click', () => {
      startNewSessionAtWorkspace(getCurrentWorkspacePath());
    });
  }
  if (historyWorkspaceList) {
    historyWorkspaceList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-workspace-action="start"]');
      if (!button) return;
      startNewSessionAtWorkspace(button.getAttribute('data-workspace-path') || '');
    });
  }
  const historyParentDirs = $('history-parent-dirs');
  if (historyParentDirs) {
    historyParentDirs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-path]');
      if (!button) return;
      startNewSessionAtWorkspace(button.getAttribute('data-path') || '');
    });
  }
  if (historyWorkspaceStartBtn) {
    historyWorkspaceStartBtn.addEventListener('click', () => {
      const path = historyWorkspaceInput ? historyWorkspaceInput.value.trim() : '';
      if (!path) {
        showToast(t('history_workspace_input_empty'), 2200);
        return;
      }
      startNewSessionAtWorkspace(path);
    });
  }
  if (historyWorkspaceInput) {
    historyWorkspaceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (historyWorkspaceStartBtn) historyWorkspaceStartBtn.click();
      }
    });
  }

  if (approvalQueueBtn) approvalQueueBtn.addEventListener('click', openApprovalQueue);
  if (approvalQueueClose) approvalQueueClose.addEventListener('click', closeApprovalQueue);
  if (approvalQueueBackdrop) approvalQueueBackdrop.addEventListener('click', closeApprovalQueue);

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => setSettingsOpen(true));
  }

  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => setSettingsOpen(false));
  }

  if (settingsBackdrop) {
    settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
  }

  if (settingsRateRefresh) {
    settingsRateRefresh.addEventListener('click', requestRateLimits);
  }

  if (settingsInstallAction) {
    settingsInstallAction.addEventListener('click', () => {
      startInstallFlow();
    });
  }

  if (settingsQrRefreshBtn) {
    settingsQrRefreshBtn.addEventListener('click', function() {
      if (socket) socket.emit('token_refresh');
      showToast(t('toast_qr_refreshed'), 3000);
    });
  }

  if (settingsVoiceToggle) {
    settingsVoiceToggle.addEventListener('change', () => {
      setVoiceEnabled(settingsVoiceToggle.checked);
    });
  }

  if (settingsEnterToggle) {
    settingsEnterToggle.addEventListener('change', function() {
      sendOnEnter = settingsEnterToggle.checked;
      storeValue(SEND_ON_ENTER_KEY, sendOnEnter ? 'true' : 'false');
    });
  }

  if (settingsCompactCommandsToggle) {
    settingsCompactCommandsToggle.addEventListener('change', function() {
      compactCommandCards = settingsCompactCommandsToggle.checked;
      storeValue(COMPACT_COMMAND_CARDS_KEY, compactCommandCards ? 'true' : 'false');
      _activityItems.forEach(function(item, itemId) {
        if (!item || item.type !== 'commandExecution') return;
        const output = _activityOutputs.get(itemId) || item.aggregatedOutput || '';
        ensureActivityCard(itemId, commandActivityPayload(item, output));
      });
      renderSettings();
    });
  }

  if (settingsRateSummaryToggle) {
    settingsRateSummaryToggle.addEventListener('change', () => {
      setRateSummaryVisible(settingsRateSummaryToggle.checked);
    });
  }

  if (settingsThemeSelect) {
    settingsThemeSelect.addEventListener('change', () => {
      applyTheme(settingsThemeSelect.value);
    });
  }

  if (settingsLanguageSelect && window.i18n) {
    settingsLanguageSelect.addEventListener('change', () => {
      window.i18n.setLanguage(settingsLanguageSelect.value);
      renderAttachmentPreview();
      renderComposerToolStates();
      renderWorkspaceSearch();
      renderCommandSheet();
      renderSettings();
    });
  }

  if (activeTurnChip) {
    activeTurnChip.addEventListener('click', () => {
      scrollToBottom();
      if (userInput && !userInput.disabled) userInput.focus();
    });
  }

  // ── Input events ─────────────────────────────────────────────────
  if (attachBtn) {
    attachBtn.addEventListener('click', (event) => {
      event.preventDefault();
      setComposerMenuOpen(!composerMenuOpen);
    });
  }

  if (composerOpenAttachBtn) {
    composerOpenAttachBtn.addEventListener('click', () => {
      setAttachSheetOpen(true);
    });
  }

  if (composerOpenCommandBtn) {
    composerOpenCommandBtn.addEventListener('click', () => {
      setCommandSheetOpen(true);
    });
  }

  if (composerModeGroup) {
    composerModeGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mode]');
      if (!button) return;
      setComposerMode(button.getAttribute('data-mode'));
    });
  }

  if (composerSpeedGroup) {
    composerSpeedGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-speed]');
      if (!button) return;
      setComposerSpeed(button.getAttribute('data-speed'));
    });
  }

  if (imageInput) {
    imageInput.addEventListener('change', () => {
      const file = imageInput.files[0];
      if (!file) return;
      handleSelectedFile(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      handleSelectedFile(file);
    });
  }

  if (attachSheetBackdrop) attachSheetBackdrop.addEventListener('click', () => setAttachSheetOpen(false));
  if (attachSheetCloseBtn) attachSheetCloseBtn.addEventListener('click', () => setAttachSheetOpen(false));
  if (attachDeviceBtn && fileInput) {
    attachDeviceBtn.addEventListener('click', () => {
      setAttachSheetOpen(false);
      fileInput.click();
    });
  }
  if (attachWorkspaceBtn) {
    attachWorkspaceBtn.addEventListener('click', () => {
      setWorkspaceSheetOpen(true);
    });
  }

  if (workspaceSheetBackdrop) workspaceSheetBackdrop.addEventListener('click', () => setWorkspaceSheetOpen(false));
  if (workspaceSheetCloseBtn) workspaceSheetCloseBtn.addEventListener('click', () => setWorkspaceSheetOpen(false));
  if (workspaceSearchInput) {
    workspaceSearchInput.addEventListener('input', queueWorkspaceSearch);
  }
  if (workspaceSearchResults) {
    workspaceSearchResults.addEventListener('click', (event) => {
      const button = event.target.closest('.workspace-search-result');
      if (!button) return;
      attachWorkspaceFile(button.dataset.path || '');
    });
  }

  if (commandSheetBackdrop) commandSheetBackdrop.addEventListener('click', () => setCommandSheetOpen(false));
  if (commandSheetCloseBtn) commandSheetCloseBtn.addEventListener('click', () => setCommandSheetOpen(false));
  if (commandSheetInput) {
    commandSheetInput.addEventListener('input', renderCommandSheet);
    commandSheetInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runCommandExec();
      }
    });
  }
  if (commandRunBtn) commandRunBtn.addEventListener('click', runCommandExec);
  if (commandStopBtn) commandStopBtn.addEventListener('click', stopCommandExec);
  if (commandClearBtn) commandClearBtn.addEventListener('click', clearCommandExec);

  if (searchClose) searchClose.addEventListener('click', closeSearch);
  if (searchPrev) searchPrev.addEventListener('click', function() { searchNavigate(-1); });
  if (searchNext) searchNext.addEventListener('click', function() { searchNavigate(1); });
  if (searchInput) {
    searchInput.addEventListener('input', function() { performSearch(searchInput.value); });
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); searchNavigate(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { closeSearch(); }
    });
  }
  // Cmd+F / Ctrl+F to open search
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      if (document.getElementById('screen-main') && !document.getElementById('screen-main').hidden) {
        e.preventDefault();
        if (searchActive) { closeSearch(); } else { openSearch(); }
      }
    }
  });

  userInput.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = (ev) => showImagePreview(ev.target.result);
        reader.readAsDataURL(blob);
        break;
      }
    }
  });
  userInput.addEventListener('input', () => { autoGrow(); updateSlashMenu(); });

  userInput.addEventListener('keydown', (e) => {
    // Slash menu navigation
    if (!slashMenu.hidden && slashMenu._matches && slashMenu._matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _slashSelectedIndex = Math.min(_slashSelectedIndex + 1, slashMenu._matches.length - 1);
        updateSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        _slashSelectedIndex = Math.max(_slashSelectedIndex - 1, 0);
        updateSlashMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const idx = _slashSelectedIndex >= 0 ? _slashSelectedIndex : 0;
        executeSlashCommand(slashMenu._matches[idx]);
        return;
      }
      if (e.key === 'Escape') {
        slashMenu.hidden = true;
        _slashSelectedIndex = -1;
        return;
      }
    }
    const wantsNewline = (!sendOnEnter && !(e.ctrlKey || e.metaKey)) || (sendOnEnter && e.shiftKey);
    if (e.key === 'Enter' && !wantsNewline && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  if (stopBtn) stopBtn.addEventListener('click', () => {
    if (threadId) {
      socket.emit('request', { method: 'turn/interrupt', params: { threadId } });
    }
  });

  // ── Slash commands (Item 7) ────────────────────────────────────────
  const SLASH_COMMANDS = [
    { cmd: '/stop',     desc: 'Stop current turn',    action: () => { if (threadId) socket.emit('request', { method: 'turn/interrupt', params: { threadId } }); } },
    { cmd: '/new',      desc: 'New thread',            action: () => startThread() },
    { cmd: '/fork',     desc: 'Fork thread',           action: () => { if (threadId) forkThread(threadId); } },
    { cmd: '/rollback', desc: 'Rollback last turn',    action: rollbackCurrentThread },
    { cmd: '/model',    desc: 'Change model',          action: () => { const m = $('model-picker'); if (m) m.focus(); } },
  ];

  function updateSlashMenu() {
    const val = userInput.value;
    if (!val.startsWith('/')) {
      slashMenu.hidden = true;
      _slashSelectedIndex = -1;
      return;
    }
    const query = val.toLowerCase();
    const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
    if (!matches.length) {
      slashMenu.hidden = true;
      _slashSelectedIndex = -1;
      return;
    }
    slashMenu.innerHTML = '';
    matches.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'slash-menu-item' + (i === _slashSelectedIndex ? ' selected' : '');
      el.innerHTML = '<span class="slash-cmd">' + escapeHtml(item.cmd) + '</span>' +
                     '<span class="slash-desc">' + escapeHtml(item.desc) + '</span>';
      el.addEventListener('mousedown', (e) => { e.preventDefault(); executeSlashCommand(item); });
      slashMenu.appendChild(el);
    });
    slashMenu.hidden = false;
    slashMenu._matches = matches;
  }

  function executeSlashCommand(item) {
    userInput.value = '';
    autoGrow();
    slashMenu.hidden = true;
    _slashSelectedIndex = -1;
    item.action();
  }

  // ── Attachment helpers ────────────────────────────────────────────
  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    if (size >= 1024) return Math.round(size / 1024) + ' KB';
    return size + ' B';
  }

  function isTextLikeFile(file) {
    if (!file) return false;
    if (file.type && (
      file.type.startsWith('text/') ||
      /json|javascript|typescript|xml|csv|yaml|toml|sql|svg/.test(file.type)
    )) {
      return true;
    }
    return /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|log|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|php|html?|css|scss|less|sql|sh|ps1|bat|cmd|xml|csv|tsv|env)$/i.test(file.name || '');
  }

  function getFileFenceLang(fileName) {
    const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!match) return '';
    const ext = match[1];
    const map = {
      js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
      ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby', rs: 'rust',
      java: 'java', kt: 'kotlin', swift: 'swift', php: 'php', html: 'html',
      htm: 'html', css: 'css', scss: 'scss', less: 'less', json: 'json',
      md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml',
      sh: 'bash', ps1: 'powershell', sql: 'sql',
    };
    return map[ext] || ext;
  }

  function buildPendingFileText(fileAttachment) {
    if (!fileAttachment || !fileAttachment.text) return '';
    const lang = getFileFenceLang(fileAttachment.name);
    return [
      (fileAttachment.origin === 'workspace' ? 'Attached workspace file: ' : 'Attached file: ') + (fileAttachment.path || fileAttachment.name),
      '```' + lang,
      fileAttachment.text,
      '```',
    ].join('\n');
  }

  function renderAttachmentPreview() {
    if (!imagePreviewArea) return;
    imagePreviewArea.innerHTML = '';

    if (pendingImageDataUrl) {
      const wrap = document.createElement('div');
      wrap.className = 'image-preview-thumb';
      const img = document.createElement('img');
      img.src = pendingImageDataUrl;
      img.alt = t('composer_add_photo');
      const rm = document.createElement('button');
      rm.textContent = '\u2715';
      rm.className = 'image-preview-remove';
      rm.setAttribute('aria-label', t('composer_attachment_remove_aria'));
      rm.addEventListener('click', clearImagePreview);
      wrap.appendChild(img);
      wrap.appendChild(rm);
      imagePreviewArea.appendChild(wrap);
    }

    if (pendingFileAttachment) {
      const fileChip = document.createElement('div');
      fileChip.className = 'image-preview-file';
      fileChip.innerHTML =
        '<span class="image-preview-file-name">' + escapeHtml(pendingFileAttachment.name) + '</span>' +
        '<span class="image-preview-file-meta">' + escapeHtml(
          [pendingFileAttachment.origin === 'workspace' ? t('composer_attach_workspace_short') : '', formatFileSize(pendingFileAttachment.size)]
            .filter(Boolean)
            .join(' · ')
        ) + '</span>';
      if (pendingFileAttachment.path) {
        fileChip.title = pendingFileAttachment.path;
      }
      const rm = document.createElement('button');
      rm.textContent = '\u2715';
      rm.className = 'image-preview-remove';
      rm.setAttribute('aria-label', t('composer_attachment_remove_aria'));
      rm.addEventListener('click', clearPendingFileAttachment);
      fileChip.appendChild(rm);
      imagePreviewArea.appendChild(fileChip);
    }

    imagePreviewArea.hidden = !hasPendingAttachments();
    syncComposerState();
  }

  function showImagePreview(dataUrl) {
    pendingImageDataUrl = dataUrl;
    renderAttachmentPreview();
  }

  function clearImagePreview() {
    pendingImageDataUrl = '';
    if (imageInput) imageInput.value = '';
    renderAttachmentPreview();
  }

  function clearPendingFileAttachment() {
    pendingFileAttachment = null;
    if (fileInput) fileInput.value = '';
    renderAttachmentPreview();
  }

  async function handleSelectedFile(file) {
    if (!file) return;
    if (file.type && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        showImagePreview(ev.target.result);
        showToast(t('composer_attach_image_ready'), 1800);
      };
      reader.readAsDataURL(file);
      return;
    }
    if (!isTextLikeFile(file)) {
      showToast(t('composer_attach_file_unsupported'), 2600);
      if (fileInput) fileInput.value = '';
      return;
    }
    if (file.size > FILE_ATTACHMENT_MAX_BYTES) {
      showToast(t('composer_attach_file_large'), 2600);
      if (fileInput) fileInput.value = '';
      return;
    }
    try {
      pendingFileAttachment = {
        name: file.name || 'attachment.txt',
        text: await file.text(),
        size: file.size || 0,
        type: file.type || '',
        origin: 'device',
      };
      renderAttachmentPreview();
      showToast(t('composer_attach_file_ready'), 1800);
    } catch {
      pendingFileAttachment = null;
      showToast(t('composer_attach_file_error'), 2200);
    }
  }

  function describePendingAttachments() {
    const parts = [];
    if (pendingImageDataUrl) parts.push(t('composer_add_photo'));
    if (pendingFileAttachment) parts.push(pendingFileAttachment.name);
    return parts.join(' + ');
  }

  function handleSend() {
    // If send button is in stop mode, interrupt the current turn
    if (sendBtn && sendBtn.classList.contains('stop-mode')) {
      if (threadId) {
        socket.emit('request', { method: 'turn/interrupt', params: { threadId } });
      }
      return;
    }
    const text = userInput.value.trim();
    const attachmentLabel = describePendingAttachments();
    if ((!text && !attachmentLabel) || !isInteractive()) return;
    if (turnActive && !currentTurnId) {
      showToast(t('toast_turn_not_ready'), 2500);
      return;
    }
    addUserMessage(text || attachmentLabel || t('composer_attachment_only'));
    userInput.value = '';
    userInput.style.height = '';
    autoGrow();
    sendBtn.disabled = true;
    if (turnActive && currentTurnId) {
      steerTurn(text);
    } else {
      sendMessage(text);
    }
  }

  // ── Voice input ───────────────────────────────────────────────────
  (function setupVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceSupported = !!(SpeechRecognition && voiceBtn);
    if (!voiceSupported) {
      syncVoiceUI();
      return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = navigator.language || 'en-US';

    voiceRecognition.onstart = () => {
      voiceListening = true;
      voiceBaseText = userInput.value;
      voiceBtn.classList.add('listening');
      voiceBtn.setAttribute('aria-label', 'Listening…');
      showToast(t('toast_listening'), 30000);
      syncVoiceUI();
    };

    voiceRecognition.onresult = (event) => {
      let interim = '';
      let finalAppend = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalAppend += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (finalAppend) voiceBaseText += finalAppend;
      userInput.value = voiceBaseText + interim;
      autoGrow();
    };

    voiceRecognition.onend = () => {
      voiceListening = false;
      voiceBtn.classList.remove('listening');
      voiceBtn.setAttribute('aria-label', 'Voice Input');
      if (toastEl) toastEl.classList.remove('show');
      syncVoiceUI();
    };

    voiceRecognition.onerror = (e) => {
      voiceListening = false;
      voiceBtn.classList.remove('listening');
      voiceBtn.setAttribute('aria-label', 'Voice Input');
      if (e.error !== 'aborted') showToast(formatUiText(t('toast_voice_error'), { error: e.error }), 3000);
      syncVoiceUI();
    };

    voiceBtn.addEventListener('click', () => {
      if (!voiceEnabled) return;
      if (voiceListening) {
        voiceRecognition.stop();
      } else {
        voiceRecognition.start();
      }
    });

    syncVoiceUI();
  })();

  // ── Socket.IO connection ─────────────────────────────────────────
  function init() {
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    initialPairingToken = hashParams.get('token') || searchParams.get('token') || '';
    if (searchParams.get('token') || hashParams.get('token')) {
      removePairingTokenFromUrl();
    }
    activeCredential = loadStoredSessionToken() || initialPairingToken;
    voiceEnabled = loadBooleanSetting(VOICE_INPUT_ENABLED_KEY, true);
    sendOnEnter = loadBooleanSetting(SEND_ON_ENTER_KEY, true);
    compactCommandCards = loadBooleanSetting(COMPACT_COMMAND_CARDS_KEY, false);
    showRateSummary = loadRateSummaryVisible();
    composerMode = loadComposerMode();
    composerSpeed = loadComposerSpeed();
    loadInstallState();
    themeMode = loadThemeMode();
    applyTheme(themeMode);
    if (window.i18n) window.i18n.applyI18n();
    setupInstallPrompt();
    syncViewportMetrics();

    if (window.matchMedia) {
      colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
      if (typeof colorSchemeQuery.addEventListener === 'function') {
        colorSchemeQuery.addEventListener('change', () => {
          if (themeMode === 'auto') applyTheme('auto');
        });
      } else if (typeof colorSchemeQuery.addListener === 'function') {
        colorSchemeQuery.addListener(() => {
          if (themeMode === 'auto') applyTheme('auto');
        });
      }
    }

    syncVoiceUI();
    if (attachBtn) attachBtn.setAttribute('aria-expanded', 'false');
    renderComposerToolStates();
    renderAttachmentPreview();
    renderWorkspaceSearch();
    renderCommandSheet();
    renderSettings();

    // Scroll-to-bottom button
    if (messagesEl && scrollBottomBtn) {
      messagesEl.addEventListener('scroll', () => {
        if (isAtBottom()) {
          scrollButtonHasUnread = false;
        }
        updateScrollBottomButton();
      }, { passive: true });
      scrollBottomBtn.addEventListener('click', () => {
        scrollToBottom();
      });
      window.addEventListener('resize', updateScrollBottomButton);
    }

    window.addEventListener('resize', syncViewportMetrics, { passive: true });
    window.addEventListener('orientationchange', syncViewportMetrics);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportMetrics);
      window.visualViewport.addEventListener('scroll', syncViewportMetrics);
    }

    if (!activeCredential) {
      showError('No saved session found. Please scan the PocketDex terminal QR code.');
      return;
    }

    showScreen('connecting');

    socket = io({
      auth: function (cb) {
        const credential = getSocketCredential();
        lastSocketCredential = credential;
        cb({ token: credential });
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      pairingFallbackAttempted = false;
      clearAuthBannerDismissal();
      showScreen('main');
      setStatus('connected');
      disconnectedBanner.classList.remove('visible');
      loadModels();
      scheduleAccountRefresh(true);
      updateAccountBanner();
      syncAuthWatch();
      syncRateLimitAutoRefresh();
      renderSettings();
      subscribePush();
    });

    socket.on('auth/session', (data) => {
      if (!data || !data.token) return;
      storeSessionToken(data.token);
      pairingFallbackAttempted = false;
      clearPairingCredential();
    });

    // Session state from server — resume thread or start fresh
    socket.on('session_state', (state) => {
      sessionStateReady = true;
      if (state.cwd) setCwd(state.cwd);
      if (state.threadId) {
        threadId = state.threadId;
        historyHydratedThreadId = null;
        // Try to restore conversation from sessionStorage cache
        var restored = restoreConversationCache(state.threadId);
        if (restored) {
          // Cache restored — mark history as hydrated so we don't duplicate it
          historyHydratedThreadId = state.threadId;
          maybeStartThread();
          return;
        }
      }
      if (accountReady) requestThreadHistory();
      maybeStartThread();
    });

    socket.on('connect_error', (err) => {
      const message = err && err.message ? err.message : 'Unknown error. Is PocketDex running?';
      setStatus('error');
      updateAccountBanner();
      syncComposerState();

      if (/Auth failed|No saved session/i.test(message)) {
        const storedToken = loadStoredSessionToken();
        const usedStoredSession = !!storedToken && lastSocketCredential === storedToken;
        const usedPairingToken = !!initialPairingToken && lastSocketCredential === initialPairingToken;

        if (usedStoredSession && initialPairingToken && !pairingFallbackAttempted) {
          pairingFallbackAttempted = true;
          activeCredential = initialPairingToken;
          socket.connect();
          return;
        }

        if (usedStoredSession) clearStoredSessionToken();
        if (usedPairingToken) clearPairingCredential();
        loginPending = false;
        if (loginWindow && !loginWindow.closed) loginWindow.close();
        loginWindow = null;
        pendingLoginId = null;
        rateLimitsResult = null;
        rateLimitsUpdatedAt = 0;
        updateAccountBanner();
        syncAuthWatch();
        syncRateLimitAutoRefresh();
        renderSettings();
        showError('Could not connect: ' + message + ' Scan a fresh PocketDex QR code to sign in again.');
        return;
      }

      showError('Could not connect: ' + message);
    });

    socket.on('disconnect', (reason) => {
      setStatus('error');
      disconnectedBanner.classList.add('visible');
      finalizeTurnToolGroups(false);
      finalizeAiBubble();
      setTurnActive(false);
      updateAccountBanner();
      syncComposerState();
      syncAuthWatch();
      syncRateLimitAutoRefresh();
      renderSettings();

      if (reason === 'io server disconnect' && socket && getSocketCredential()) {
        socket.connect();
      }
    });

    socket.on('codex_disconnected', () => {
      setStatus('error');
      disconnectedBanner.classList.add('visible');
      showToast(t('toast_codex_disconnected'), 5000);
      updateAccountBanner();
      syncComposerState();
      syncRateLimitAutoRefresh();
      renderSettings();
    });

    socket.on('codex_restarting', (data) => {
      setStatus('thinking');
      const attempt = data && data.attempt ? ' (' + data.attempt + '/' + data.max + ')' : '';
      showToast(formatUiText(t('toast_codex_restarting'), { attempt }), 5000);
    });

    socket.on('codex_reconnected', () => {
      clearAuthBannerDismissal();
      setStatus('connected');
      disconnectedBanner.classList.remove('visible');
      showToast(t('toast_codex_reconnected'), 3000);
      scheduleAccountRefresh(true);
      updateAccountBanner();
      syncRateLimitAutoRefresh();
      maybeStartThread();
      renderSettings();
    });

    socket.on('notification', handleNotification);
    socket.on('request_result', handleRequestResult);
    socket.on('request_error', (data) => {
      const errorText = String(data.error || '');
      if (data.method === 'thread/start' && useExtendedHistory &&
          /persistFullHistory|persistExtendedHistory|experimentalApi/i.test(errorText)) {
        useExtendedHistory = false;
        startThread(pendingThreadStartOptions || {});
        return;
      }
      if (data.method === 'thread/resume' && useExtendedHistory &&
          /persistFullHistory|persistExtendedHistory|experimentalApi/i.test(errorText) &&
          pendingResumeThreadId) {
        useExtendedHistory = false;
        resumeThread(pendingResumeThreadId);
        return;
      }
      if (data.method === 'thread/start') {
        pendingThreadStartRequestId = '';
        pendingThreadStartOptions = null;
      }
      if (data.method === 'thread/fork' && useExtendedHistory &&
          /persistFullHistory|persistExtendedHistory|experimentalApi/i.test(errorText) &&
          pendingForkThreadId) {
        useExtendedHistory = false;
        forkThread(pendingForkThreadId);
        return;
      }
      if (data.method === 'thread/read' &&
          /not materialized yet|includeTurns is unavailable before first user message/i.test(errorText)) {
        historyUnavailableUntilFirstTurn = true;
        return;
      }
      console.warn('[pocketdex] request error:', data.method, data.error);
      if (data.method === 'account/login/start') {
        loginPending = false;
        if (loginWindow && !loginWindow.closed) {
          loginWindow.close();
        }
        loginWindow = null;
        pendingLoginId = null;
        updateAccountBanner();
        syncAuthWatch();
      }
      if (data.method === 'account/rateLimits/read') {
        rateLimitsLoading = false;
        syncRateLimitAutoRefresh();
        renderSettings();
      }
      if (data.method === 'fuzzyFileSearch') {
        if (pendingWorkspaceSearchRequestId && data.clientRequestId &&
            data.clientRequestId !== pendingWorkspaceSearchRequestId) {
          return;
        }
        pendingWorkspaceSearchRequestId = '';
        workspaceSearchLoading = false;
        workspaceSearchResultsState = [];
        if (workspaceSearchStatus) workspaceSearchStatus.textContent = t('composer_workspace_error');
        renderWorkspaceSearch();
      }
      if (data.method === 'fs/readFile') {
        if (pendingWorkspaceFileRequestId && data.clientRequestId &&
            data.clientRequestId !== pendingWorkspaceFileRequestId) {
          return;
        }
        pendingWorkspaceFileRequestId = '';
        pendingWorkspaceFilePath = '';
      }
      if (data.method === 'command/exec') {
        if (commandExecState && commandExecState.requestId && data.clientRequestId &&
            data.clientRequestId !== commandExecState.requestId) {
          return;
        }
        if (commandExecState) {
          commandExecState.running = false;
          commandExecState.requestId = '';
          commandExecState.exitCode = 1;
          commandExecState.output += '\n' + formatErrorDisplay(data.error, errorText);
          renderCommandSheet();
        }
      }
      if (data.method === 'command/exec/terminate' && commandExecState) {
        if (commandExecState.terminateRequestId && data.clientRequestId &&
            data.clientRequestId !== commandExecState.terminateRequestId) {
          return;
        }
        commandExecState.terminateRequestId = '';
      }
      if (data.method === 'thread/list') {
        threadsListLoading = false;
        renderSettings();
      }
      if (data.method === 'thread/read') {
        if (pendingThreadReadRequestId && data.clientRequestId &&
            data.clientRequestId !== pendingThreadReadRequestId) {
          return;
        }
        pendingThreadReadRequestId = '';
      }
      if (data.method === 'turn/steer') {
        const foundMatch = errorText.match(/found `([^`]+)`/i);
        if (foundMatch && foundMatch[1]) {
          currentTurnId = foundMatch[1];
        }
      }
      showToast(formatUiText(t('toast_generic_error'), {
        error: getUserFacingErrorText(data.error, errorText),
      }), 4000);
    });

    socket.on('approval_request', function(req) {
      pendingApprovalMap.set(req.id, req);
      updateApprovalQueueBadge();
      showApproval(req);
    });

    socket.on('approval_timeout', function(data) {
      var id = data && data.id;
      if (id === undefined || id === null) return;
      pendingApprovalMap.delete(id);
      updateApprovalQueueBadge();
      if (pendingApprovalId !== null && String(id) === String(pendingApprovalId)) {
        hideApproval();
      }
      showToast(t('toast_approval_timeout'), 4000);
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────
  window.addEventListener('focus', () => {
    scheduleAccountRefresh(true);
    syncRateLimitAutoRefresh();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleAccountRefresh(true);
    }
    syncRateLimitAutoRefresh();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && composerMenuOpen) {
      setComposerMenuOpen(false);
    }
    if (event.key === 'Escape' && attachSheetOpen) {
      setAttachSheetOpen(false);
    }
    if (event.key === 'Escape' && workspaceSheetOpen) {
      setWorkspaceSheetOpen(false);
    }
    if (event.key === 'Escape' && commandSheetOpen) {
      setCommandSheetOpen(false);
    }
    if (event.key === 'Escape' && settingsOpen) {
      setSettingsOpen(false);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!composerMenuOpen || !composerToolsMenu || !attachBtn) return;
    const target = event.target;
    if (composerToolsMenu.contains(target) || attachBtn.contains(target)) return;
    setComposerMenuOpen(false);
  });

  // ── Drag & drop image attachment ─────────────────────────────────
  document.addEventListener('dragover', function(e) {
    if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some(function(i) { return i.kind === 'file'; })) {
      e.preventDefault();
      document.body.classList.add('drop-zone-active');
    }
  });
  document.addEventListener('dragleave', function(e) {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      document.body.classList.remove('drop-zone-active');
    }
  });
  document.addEventListener('drop', function(e) {
    document.body.classList.remove('drop-zone-active');
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    Array.from(e.dataTransfer.files).forEach(function(f) {
      if (f.type.startsWith('image/')) handleSelectedFile(f);
    });
  });

  init();

})();
