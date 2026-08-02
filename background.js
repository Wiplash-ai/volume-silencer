"use strict";

const SETTINGS_KEY = "volumeSilencerSettings";
const SESSION_KEY = "volumeSilencerWindowSessions";
const DEFAULT_SETTINGS = Object.freeze({
  defaultVolume: 100,
  rememberBySite: true,
  showMediaCount: true,
  resetOnClose: false,
  widgetSide: "right",
  visibleHosts: [],
  siteVolumes: {},
  widgetPosition: null
});

const memorySession = {};

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  ensureSettings();
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !Number.isInteger(tab.id)) {
    return;
  }

  sendTabMessage(tab.id, { type: "TOGGLE_WIDGET" }, { frameId: 0 })
    .then(() => clearActionError(tab.id))
    .catch(() => showActionError(tab.id));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "VolumeSilencer could not complete that action."
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  const type = message && message.type;

  switch (type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await ensureSettings() };
    case "SAVE_SETTINGS":
      return { ok: true, settings: await saveSettings(message.settings || {}) };
    case "CLEAR_SAVED_SITES":
      return { ok: true, settings: await clearSavedSites() };
    case "GET_TAB_CONTEXT":
      return getTabContext(requireSenderTab(sender));
    case "SET_TAB_MUTED":
      return setTabMuted(requireSenderTab(sender), Boolean(message.muted));
    case "APPLY_MEDIA_STATE_TO_TAB":
      return applyMediaStateToTab(requireSenderTab(sender), message.payload || {});
    case "SET_WINDOW_MODE":
      return setWindowMode(requireSenderTab(sender), message.mode);
    case "OPEN_OPTIONS":
      await openOptionsPage();
      return { ok: true };
    default:
      return { ok: false, error: "Unknown VolumeSilencer message." };
  }
}

async function ensureSettings() {
  const stored = await storageGet("local", { [SETTINGS_KEY]: null });
  const settings = sanitizeSettings(stored[SETTINGS_KEY]);

  if (!stored[SETTINGS_KEY] || JSON.stringify(stored[SETTINGS_KEY]) !== JSON.stringify(settings)) {
    await storageSet("local", { [SETTINGS_KEY]: settings });
  }

  return settings;
}

async function saveSettings(patch) {
  const current = await ensureSettings();
  const settings = sanitizeSettings({ ...current, ...patch });
  await storageSet("local", { [SETTINGS_KEY]: settings });
  return settings;
}

async function clearSavedSites() {
  const current = await ensureSettings();
  const settings = sanitizeSettings({ ...current, siteVolumes: {}, visibleHosts: [] });
  await storageSet("local", { [SETTINGS_KEY]: settings });
  return settings;
}

function sanitizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const visibleHosts = Array.isArray(source.visibleHosts)
    ? [...new Set(source.visibleHosts.filter(isSafeHostname))].slice(0, 200)
    : [];
  const siteVolumes = {};

  if (source.siteVolumes && typeof source.siteVolumes === "object") {
    Object.entries(source.siteVolumes).slice(0, 200).forEach(([host, volume]) => {
      if (isSafeHostname(host)) {
        siteVolumes[host] = clampVolume(volume);
      }
    });
  }

  const position = source.widgetPosition && typeof source.widgetPosition === "object"
    ? {
        left: finiteNumberOrNull(source.widgetPosition.left),
        top: finiteNumberOrNull(source.widgetPosition.top)
      }
    : null;

  return {
    defaultVolume: clampVolume(source.defaultVolume ?? DEFAULT_SETTINGS.defaultVolume),
    rememberBySite: source.rememberBySite !== false,
    showMediaCount: source.showMediaCount !== false,
    resetOnClose: source.resetOnClose === true,
    widgetSide: source.widgetSide === "left" ? "left" : "right",
    visibleHosts,
    siteVolumes,
    widgetPosition: position && position.left !== null && position.top !== null ? position : null
  };
}

async function getTabContext(tab) {
  const sessions = await getWindowSessions();
  const windowTabs = await queryTabs({ windowId: tab.windowId });
  const session = sessions[String(tab.windowId)] || null;

  return {
    ok: true,
    tab: publicTab(tab),
    window: {
      tabCount: windowTabs.length,
      audibleCount: windowTabs.filter((item) => item.audible).length,
      mode: session ? session.mode : "none"
    }
  };
}

async function setTabMuted(tab, muted) {
  const updated = await updateTab(tab.id, { muted });
  return { ok: true, tab: publicTab(updated) };
}

async function applyMediaStateToTab(tab, payload) {
  const volume = clampVolume(payload.volume);
  await sendTabMessage(tab.id, {
    type: "APPLY_MEDIA_STATE",
    payload: { volume }
  }).catch(() => undefined);

  return { ok: true, volume };
}

async function setWindowMode(tab, requestedMode) {
  const mode = ["quiet-others", "mute-window"].includes(requestedMode) ? requestedMode : "none";
  const key = String(tab.windowId);
  const sessions = await getWindowSessions();
  const existing = sessions[key];

  if (existing) {
    await restoreWindowSession(existing);
    delete sessions[key];
  }

  if (mode === "none" || (existing && existing.mode === mode)) {
    await setWindowSessions(sessions);
    return {
      ok: true,
      activeMode: "none",
      changedCount: existing ? Object.keys(existing.tabStates || {}).length : 0
    };
  }

  const tabs = await queryTabs({ windowId: tab.windowId });
  const targets = mode === "quiet-others" ? tabs.filter((item) => item.id !== tab.id) : tabs;
  const tabStates = {};

  targets.forEach((item) => {
    if (Number.isInteger(item.id)) {
      tabStates[String(item.id)] = Boolean(item.mutedInfo && item.mutedInfo.muted);
    }
  });

  await Promise.all(targets.map((item) => updateTab(item.id, { muted: true }).catch(() => undefined)));
  sessions[key] = {
    mode,
    tabStates,
    createdAt: Date.now()
  };
  await setWindowSessions(sessions);

  return { ok: true, activeMode: mode, changedCount: targets.length };
}

async function restoreWindowSession(session) {
  const entries = Object.entries(session && session.tabStates ? session.tabStates : {});
  await Promise.all(entries.map(([tabId, muted]) => {
    return updateTab(Number(tabId), { muted: Boolean(muted) }).catch(() => undefined);
  }));
}

async function getWindowSessions() {
  const stored = await storageGet("session", { [SESSION_KEY]: memorySession });
  const sessions = stored[SESSION_KEY];
  return sessions && typeof sessions === "object" ? sessions : {};
}

async function setWindowSessions(value) {
  Object.keys(memorySession).forEach((key) => delete memorySession[key]);
  Object.assign(memorySession, value);
  await storageSet("session", { [SESSION_KEY]: value });
}

function requireSenderTab(sender) {
  if (!sender || !sender.tab || !Number.isInteger(sender.tab.id)) {
    throw new Error("This action must come from a browser tab.");
  }

  return sender.tab;
}

function publicTab(tab) {
  let hostname = "This page";

  try {
    hostname = new URL(tab.url || "").hostname || hostname;
  } catch (_error) {
    // Restricted browser pages do not always expose a normal URL.
  }

  return {
    id: tab.id,
    windowId: tab.windowId,
    title: typeof tab.title === "string" ? tab.title : hostname,
    hostname,
    muted: Boolean(tab.mutedInfo && tab.mutedInfo.muted),
    audible: Boolean(tab.audible)
  };
}

function isSafeHostname(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 253 && /^[a-z0-9.-]+$/i.test(value);
}

function clampVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 100;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function sendTabMessage(tabId, message, options) {
  return new Promise((resolve, reject) => {
    const callback = (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    };

    if (options) chrome.tabs.sendMessage(tabId, message, options, callback);
    else chrome.tabs.sendMessage(tabId, message, callback);
  });
}

function storageGet(area, defaults) {
  if (area === "session" && !chrome.storage.session) {
    return Promise.resolve({ ...defaults, [SESSION_KEY]: { ...memorySession } });
  }
  const target = area === "session" ? chrome.storage.session : chrome.storage.local;
  return new Promise((resolve) => target.get(defaults, resolve));
}

function storageSet(area, values) {
  if (area === "session" && !chrome.storage.session) {
    Object.assign(memorySession, values[SESSION_KEY] || {});
    return Promise.resolve();
  }
  const target = area === "session" ? chrome.storage.session : chrome.storage.local;
  return new Promise((resolve) => target.set(values, resolve));
}

function openOptionsPage() {
  return new Promise((resolve) => chrome.runtime.openOptionsPage(resolve));
}

function showActionError(tabId) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#111111" });
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setTitle({ tabId, title: "VolumeSilencer cannot run on this browser page" });
}

function clearActionError(tabId) {
  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.action.setTitle({ tabId, title: "Toggle VolumeSilencer" });
}
