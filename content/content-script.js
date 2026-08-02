"use strict";

(() => {
  if (globalThis.__volumeSilencerLoaded) {
    return;
  }

  globalThis.__volumeSilencerLoaded = true;

  const IS_TOP_FRAME = window.top === window;
  const SETTINGS_KEY = "volumeSilencerSettings";
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
  const hostName = location.hostname.toLowerCase();
  const mediaOriginals = new WeakMap();
  let selectedVolume = 100;
  let settings = { ...DEFAULT_SETTINGS };
  let widgetHost = null;
  let widgetRoot = null;
  let widgetVisible = false;
  let tabContext = null;
  let activeWindowMode = "none";
  let mediaObserver = null;
  let statusTimer = 0;
  let volumeFrame = 0;
  let dragState = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return undefined;
    }

    if (message.type === "APPLY_MEDIA_STATE") {
      selectedVolume = clampVolume(message.payload && message.payload.volume);
      const result = applyVolumeToFrame(selectedVolume);
      if (IS_TOP_FRAME && widgetVisible) updateWidget();
      sendResponse({ ok: true, ...result });
      return undefined;
    }

    if (message.type === "GET_MEDIA_STATE") {
      sendResponse({ ok: true, ...readMediaState() });
      return undefined;
    }

    if (message.type === "TOGGLE_WIDGET" && IS_TOP_FRAME) {
      toggleWidget()
        .then(() => sendResponse({ ok: true, visible: widgetVisible }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    return undefined;
  });

  observeMedia();

  if (IS_TOP_FRAME) {
    initTopFrame();
  }

  async function initTopFrame() {
    const response = await callRuntime({ type: "GET_SETTINGS" });
    settings = normalizeSettings(response && response.settings);
    selectedVolume = settings.rememberBySite && Number.isFinite(settings.siteVolumes[hostName])
      ? clampVolume(settings.siteVolumes[hostName])
      : settings.defaultVolume;

    if (settings.rememberBySite && Object.prototype.hasOwnProperty.call(settings.siteVolumes, hostName)) {
      await applyVolumeToTab(selectedVolume);
    }

    if (settings.visibleHosts.includes(hostName)) {
      await showWidget();
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener("resize", handleWindowResize, { passive: true });
  }

  function observeMedia() {
    mediaObserver = new MutationObserver((mutations) => {
      const hasNewMedia = mutations.some((mutation) => {
        return [...mutation.addedNodes].some((node) => {
          return node instanceof HTMLMediaElement || (node instanceof Element && node.querySelector("video, audio"));
        });
      });

      if (!hasNewMedia) {
        return;
      }

      applyVolumeToFrame(selectedVolume);
      if (IS_TOP_FRAME && widgetVisible) updateWidget();
    });

    mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function applyVolumeToFrame(volume) {
    const normalized = clampVolume(volume);
    const media = getMediaElements();

    media.forEach((element) => {
      if (!mediaOriginals.has(element)) {
        mediaOriginals.set(element, { volume: element.volume, muted: element.muted });
      }

      element.volume = normalized / 100;
    });

    return {
      volume: normalized,
      mediaCount: media.length,
      videoCount: media.filter((element) => element.tagName === "VIDEO").length,
      audioCount: media.filter((element) => element.tagName === "AUDIO").length
    };
  }

  function restoreMediaInFrame() {
    getMediaElements().forEach((element) => {
      const original = mediaOriginals.get(element);
      if (!original) return;
      element.volume = original.volume;
      element.muted = original.muted;
      mediaOriginals.delete(element);
    });

    selectedVolume = 100;
  }

  function readMediaState() {
    const media = getMediaElements();
    const first = media[0];
    return {
      mediaCount: media.length,
      videoCount: media.filter((element) => element.tagName === "VIDEO").length,
      audioCount: media.filter((element) => element.tagName === "AUDIO").length,
      volume: first ? Math.round(first.volume * 100) : selectedVolume
    };
  }

  function getMediaElements() {
    return Array.from(document.querySelectorAll("video, audio"));
  }

  async function toggleWidget() {
    if (widgetVisible) await hideWidget();
    else await showWidget();
  }

  async function showWidget() {
    if (!widgetHost) buildWidget();
    widgetVisible = true;
    widgetHost.hidden = false;
    await setHostVisibility(true);
    await refreshContext();
    updateWidget();
  }

  async function hideWidget() {
    widgetVisible = false;
    if (widgetHost) widgetHost.hidden = true;

    if (settings.resetOnClose) {
      restoreMediaInFrame();
      await applyVolumeToTab(100);
    }

    await setHostVisibility(false);
  }

  function buildWidget() {
    widgetHost = document.createElement("div");
    widgetHost.id = "volume-silencer-widget-host";
    widgetHost.style.position = "fixed";
    widgetHost.style.zIndex = "2147483647";
    widgetHost.style.width = "318px";
    widgetHost.style.maxWidth = "calc(100vw - 24px)";
    widgetHost.style.colorScheme = "dark";
    widgetHost.style.contain = "layout style";
    document.documentElement.appendChild(widgetHost);
    widgetRoot = widgetHost.attachShadow({ mode: "closed" });

    const styleElement = document.createElement("style");
    styleElement.textContent = widgetStyles();
    widgetRoot.appendChild(styleElement);

    const parsedWidget = new DOMParser().parseFromString(`
      <section class="panel" aria-label="VolumeSilencer controls">
        <header class="panel-header" id="dragHandle">
          <div class="brand">
            <img class="brand-mark" data-asset="assets/brand-mark.svg" alt="">
            <div class="brand-copy">
              <strong>VolumeSilencer</strong>
              <span id="hostLabel"></span>
            </div>
          </div>
          <div class="header-actions">
            <button class="icon-button" id="settingsButton" type="button" title="Settings" aria-label="Open VolumeSilencer settings"><img data-asset="assets/ui/settings.svg" alt=""></button>
            <button class="icon-button" id="closeButton" type="button" title="Close widget" aria-label="Close VolumeSilencer"><img data-asset="assets/ui/x.svg" alt=""></button>
          </div>
        </header>

        <div class="volume-block">
          <div class="volume-heading">
            <span>Page volume</span>
            <output id="volumeValue" for="volumeRange">100%</output>
          </div>
          <div class="range-shell">
            <div class="range-track"><span id="rangeFill"></span></div>
            <input id="volumeRange" type="range" min="0" max="100" step="1" value="100" aria-label="Page media volume">
          </div>
          <div class="quick-levels" aria-label="Quick volume levels">
            <button type="button" data-volume="0">0</button>
            <button type="button" data-volume="25">25</button>
            <button type="button" data-volume="50">50</button>
            <button type="button" data-volume="75">75</button>
            <button type="button" data-volume="100">100</button>
          </div>
        </div>

        <div class="primary-actions">
          <button class="control-button" id="muteTabButton" type="button">
            <img id="muteTabIcon" data-asset="assets/ui/volume-x.svg" alt="">
            <span id="muteTabLabel">Mute tab</span>
          </button>
          <button class="control-button secondary" id="resetButton" type="button" title="Restore this page to full volume">
            <img data-asset="assets/ui/rotate-ccw.svg" alt="">
            <span>Reset</span>
          </button>
        </div>

        <div class="window-section">
          <div class="section-heading">
            <span>Current window</span>
            <span id="tabCount">0 tabs</span>
          </div>
          <button class="wide-control" id="quietOthersButton" type="button">
            <img data-asset="assets/ui/panels-top-left.svg" alt="">
            <span><strong>Quiet other tabs</strong><small>Keep this tab audible</small></span>
            <i class="switch" aria-hidden="true"></i>
          </button>
          <button class="wide-control" id="muteWindowButton" type="button">
            <img data-asset="assets/ui/panel-top.svg" alt="">
            <span><strong>Mute this window</strong><small>Silence every tab here</small></span>
            <i class="switch" aria-hidden="true"></i>
          </button>
        </div>

        <footer class="panel-footer">
          <span id="mediaStatus">Checking this page...</span>
          <a href="https://wiplash.ai/" target="_blank" rel="noreferrer">Produced by Wiplash.ai</a>
        </footer>
        <div class="toast" id="statusToast" role="status" aria-live="polite"></div>
      </section>
    `, "text/html");
    const panelElement = parsedWidget.body.firstElementChild;
    widgetRoot.appendChild(document.importNode(panelElement, true));
    widgetRoot.querySelectorAll("[data-asset]").forEach((image) => {
      image.src = assetUrl(image.dataset.asset);
    });
    getWidgetElement("hostLabel").textContent = hostName;
    updateVolumeDisplay();

    positionWidget();
    bindWidgetEvents();
  }

  function bindWidgetEvents() {
    const volumeRange = getWidgetElement("volumeRange");
    volumeRange.addEventListener("input", (event) => {
      const volume = clampVolume(event.target.value);
      selectedVolume = volume;
      updateVolumeDisplay();
      scheduleVolumeChange(volume);
    });

    widgetRoot.querySelectorAll("[data-volume]").forEach((button) => {
      button.addEventListener("click", () => setVolume(Number(button.dataset.volume)));
    });

    getWidgetElement("muteTabButton").addEventListener("click", toggleCurrentTabMute);
    getWidgetElement("resetButton").addEventListener("click", resetCurrentPage);
    getWidgetElement("quietOthersButton").addEventListener("click", () => toggleWindowMode("quiet-others"));
    getWidgetElement("muteWindowButton").addEventListener("click", () => toggleWindowMode("mute-window"));
    getWidgetElement("settingsButton").addEventListener("click", () => callRuntime({ type: "OPEN_OPTIONS" }));
    getWidgetElement("closeButton").addEventListener("click", hideWidget);
    getWidgetElement("dragHandle").addEventListener("pointerdown", startDragging);
  }

  async function setVolume(volume) {
    selectedVolume = clampVolume(volume);
    updateVolumeDisplay();
    await applyVolumeToTab(selectedVolume);
    await rememberVolume();
    showStatus(`Page volume set to ${selectedVolume}%`);
  }

  function scheduleVolumeChange(volume) {
    if (volumeFrame) cancelAnimationFrame(volumeFrame);
    volumeFrame = requestAnimationFrame(async () => {
      volumeFrame = 0;
      await applyVolumeToTab(volume);
      await rememberVolume();
    });
  }

  async function applyVolumeToTab(volume) {
    applyVolumeToFrame(volume);
    return callRuntime({
      type: "APPLY_MEDIA_STATE_TO_TAB",
      payload: { volume }
    });
  }

  async function toggleCurrentTabMute() {
    const muted = !(tabContext && tabContext.tab && tabContext.tab.muted);
    const response = await callRuntime({ type: "SET_TAB_MUTED", muted });

    if (response && response.ok) {
      tabContext.tab = response.tab;
      updateWidget();
      showStatus(muted ? "Current tab muted" : "Current tab audible");
    }
  }

  async function resetCurrentPage() {
    selectedVolume = 100;
    await applyVolumeToTab(100);
    await callRuntime({ type: "SET_TAB_MUTED", muted: false });
    await rememberVolume();
    await refreshContext();
    updateWidget();
    showStatus("Page volume restored");
  }

  async function toggleWindowMode(mode) {
    const response = await callRuntime({ type: "SET_WINDOW_MODE", mode });

    if (response && response.ok) {
      activeWindowMode = response.activeMode;
      await refreshContext();
      updateWidget();
      const label = activeWindowMode === "none"
        ? "Window audio restored"
        : activeWindowMode === "quiet-others"
          ? "Other tabs muted"
          : "Window muted";
      showStatus(label);
    }
  }

  async function refreshContext() {
    const response = await callRuntime({ type: "GET_TAB_CONTEXT" });
    if (response && response.ok) {
      tabContext = response;
      activeWindowMode = response.window.mode;
    }
  }

  function updateWidget() {
    if (!widgetRoot || !tabContext) return;
    const media = readMediaState();
    const tab = tabContext.tab;
    const currentMuted = Boolean(tab.muted);
    getWidgetElement("hostLabel").textContent = tab.hostname || hostName;
    getWidgetElement("muteTabLabel").textContent = currentMuted ? "Unmute tab" : "Mute tab";
    getWidgetElement("muteTabButton").classList.toggle("is-active", currentMuted);
    getWidgetElement("tabCount").textContent = `${tabContext.window.tabCount} ${tabContext.window.tabCount === 1 ? "tab" : "tabs"}`;
    getWidgetElement("quietOthersButton").classList.toggle("is-active", activeWindowMode === "quiet-others");
    getWidgetElement("muteWindowButton").classList.toggle("is-active", activeWindowMode === "mute-window");
    getWidgetElement("mediaStatus").textContent = settings.showMediaCount
      ? `${media.mediaCount} ${media.mediaCount === 1 ? "media player" : "media players"} found`
      : currentMuted
        ? "Current tab muted"
        : "Current tab ready";
    updateVolumeDisplay();
  }

  function updateVolumeDisplay() {
    if (!widgetRoot) return;
    getWidgetElement("volumeValue").textContent = `${selectedVolume}%`;
    getWidgetElement("volumeRange").value = String(selectedVolume);
    getWidgetElement("rangeFill").style.width = `${selectedVolume}%`;
    widgetRoot.querySelectorAll("[data-volume]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.volume) === selectedVolume);
    });
  }

  async function rememberVolume() {
    if (!settings.rememberBySite || !hostName) return;
    settings = {
      ...settings,
      siteVolumes: {
        ...settings.siteVolumes,
        [hostName]: selectedVolume
      }
    };
    await saveSettings({ siteVolumes: settings.siteVolumes });
  }

  async function setHostVisibility(visible) {
    const set = new Set(settings.visibleHosts);
    if (visible) set.add(hostName);
    else set.delete(hostName);
    settings = { ...settings, visibleHosts: [...set] };
    await saveSettings({ visibleHosts: settings.visibleHosts });
  }

  async function saveSettings(patch) {
    const response = await callRuntime({ type: "SAVE_SETTINGS", settings: patch });
    if (response && response.ok) settings = normalizeSettings(response.settings);
    return settings;
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    if (widgetVisible) {
      positionWidget();
      updateWidget();
    }
  }

  function positionWidget() {
    if (!widgetHost) return;
    const width = Math.min(318, window.innerWidth - 24);
    const height = widgetHost.offsetHeight || 520;
    const saved = settings.widgetPosition;

    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      widgetHost.style.left = `${clamp(saved.left, 12, Math.max(12, window.innerWidth - width - 12))}px`;
      widgetHost.style.top = `${clamp(saved.top, 12, Math.max(12, window.innerHeight - height - 12))}px`;
      widgetHost.style.right = "auto";
      widgetHost.style.bottom = "auto";
      return;
    }

    widgetHost.style.top = "auto";
    widgetHost.style.bottom = "18px";
    widgetHost.style.left = settings.widgetSide === "left" ? "18px" : "auto";
    widgetHost.style.right = settings.widgetSide === "right" ? "18px" : "auto";
  }

  function startDragging(event) {
    if (event.button !== 0 || event.target.closest("button, a")) return;
    const rect = widgetHost.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener("pointermove", dragWidget);
    event.currentTarget.addEventListener("pointerup", stopDragging, { once: true });
    event.currentTarget.addEventListener("pointercancel", stopDragging, { once: true });
  }

  function dragWidget(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const rect = widgetHost.getBoundingClientRect();
    const left = clamp(dragState.left + event.clientX - dragState.startX, 12, Math.max(12, innerWidth - rect.width - 12));
    const top = clamp(dragState.top + event.clientY - dragState.startY, 12, Math.max(12, innerHeight - rect.height - 12));
    widgetHost.style.left = `${left}px`;
    widgetHost.style.top = `${top}px`;
    widgetHost.style.right = "auto";
    widgetHost.style.bottom = "auto";
  }

  async function stopDragging(event) {
    if (!dragState) return;
    event.currentTarget.removeEventListener("pointermove", dragWidget);
    dragState = null;
    const rect = widgetHost.getBoundingClientRect();
    settings = await saveSettings({ widgetPosition: { left: rect.left, top: rect.top } });
  }

  function handleWindowResize() {
    if (widgetVisible) positionWidget();
  }

  function showStatus(message) {
    if (!widgetRoot) return;
    const toast = getWidgetElement("statusToast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function normalizeSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      visibleHosts: Array.isArray(source.visibleHosts) ? source.visibleHosts : [],
      siteVolumes: source.siteVolumes && typeof source.siteVolumes === "object" ? source.siteVolumes : {}
    };
  }

  function getWidgetElement(id) {
    return widgetRoot.getElementById(id);
  }

  function callRuntime(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  function assetUrl(path) {
    return chrome.runtime.getURL(path);
  }

  function clampVolume(value) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(Math.round(number), 0, 100) : 100;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function widgetStyles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, output { font: inherit; }
      button { color: inherit; }
      .panel {
        position: relative;
        overflow: hidden;
        width: 100%;
        color: #f7f7f7;
        background: #080808;
        border: 1px solid #363636;
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, .42);
        font-family: "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
        font-size: 13px;
        letter-spacing: 0;
      }
      .panel-header, .volume-heading, .section-heading, .panel-footer, .primary-actions, .brand, .header-actions, .wide-control { display: flex; align-items: center; }
      .panel-header { justify-content: space-between; min-height: 58px; padding: 10px 12px; border-bottom: 1px solid #282828; cursor: grab; user-select: none; }
      .panel-header:active { cursor: grabbing; }
      .brand { gap: 9px; min-width: 0; }
      .brand-mark { width: 34px; height: 34px; flex: 0 0 auto; }
      .brand-copy { min-width: 0; display: grid; gap: 2px; }
      .brand-copy strong { font-size: 13px; line-height: 1.2; font-weight: 750; }
      .brand-copy span { overflow: hidden; max-width: 180px; color: #9d9d9d; font-size: 11px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
      .header-actions { gap: 4px; }
      .icon-button { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; cursor: pointer; }
      .icon-button:hover, .icon-button:focus-visible { border-color: #484848; background: #181818; outline: none; }
      .icon-button img { width: 16px; height: 16px; filter: invert(1); opacity: .86; }
      .volume-block { padding: 17px 16px 14px; }
      .volume-heading { justify-content: space-between; margin-bottom: 12px; color: #b7b7b7; font-weight: 650; }
      .volume-heading output { color: #fff; font-size: 23px; font-weight: 780; font-variant-numeric: tabular-nums; }
      .range-shell { position: relative; height: 24px; }
      .range-track { position: absolute; top: 10px; right: 0; left: 0; overflow: hidden; height: 4px; border-radius: 2px; background: #3a3a3a; }
      .range-track span { display: block; width: 100%; height: 100%; background: #fff; }
      input[type="range"] { position: absolute; inset: 0; width: 100%; height: 24px; margin: 0; appearance: none; background: transparent; cursor: pointer; }
      input[type="range"]::-webkit-slider-runnable-track { height: 4px; background: transparent; }
      input[type="range"]::-webkit-slider-thumb { width: 17px; height: 17px; margin-top: -6.5px; appearance: none; border: 3px solid #080808; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px #fff; }
      input[type="range"]::-moz-range-track { height: 4px; background: transparent; }
      input[type="range"]::-moz-range-thumb { width: 12px; height: 12px; border: 3px solid #080808; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px #fff; }
      .quick-levels { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-top: 9px; }
      .quick-levels button { min-height: 27px; padding: 0; border: 1px solid #343434; border-radius: 5px; color: #a9a9a9; background: #101010; font-size: 11px; cursor: pointer; }
      .quick-levels button:hover, .quick-levels button.is-active { color: #070707; border-color: #fff; background: #fff; }
      .primary-actions { gap: 8px; padding: 0 16px 16px; }
      .control-button { display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 0 12px; border: 1px solid #f2f2f2; border-radius: 6px; color: #090909; background: #f2f2f2; font-weight: 720; cursor: pointer; }
      .control-button.secondary { flex: 0 0 96px; color: #e8e8e8; border-color: #3d3d3d; background: #111; }
      .control-button:hover { background: #d8d8d8; }
      .control-button.secondary:hover { border-color: #737373; background: #1c1c1c; }
      .control-button.is-active { color: #fff; border-color: #6b6b6b; background: #202020; }
      .control-button img { width: 16px; height: 16px; }
      .control-button:not(.secondary) img { filter: none; }
      .control-button.secondary img, .control-button.is-active img { filter: invert(1); }
      .window-section { display: grid; gap: 7px; padding: 14px 16px 15px; border-top: 1px solid #282828; background: #0c0c0c; }
      .section-heading { justify-content: space-between; margin-bottom: 2px; color: #f0f0f0; font-size: 11px; font-weight: 750; text-transform: uppercase; }
      .section-heading span:last-child { color: #777; font-weight: 600; text-transform: none; }
      .wide-control { width: 100%; min-height: 48px; gap: 10px; padding: 7px 10px; text-align: left; border: 1px solid #303030; border-radius: 6px; background: #111; cursor: pointer; }
      .wide-control:hover, .wide-control.is-active { border-color: #626262; background: #181818; }
      .wide-control > img { width: 17px; height: 17px; filter: invert(1); opacity: .88; }
      .wide-control > span { display: grid; flex: 1; gap: 2px; }
      .wide-control strong { font-size: 12px; }
      .wide-control small { color: #8d8d8d; font-size: 10px; }
      .switch { position: relative; width: 28px; height: 16px; border: 1px solid #555; border-radius: 9px; background: #222; }
      .switch::after { position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; content: ""; border-radius: 50%; background: #888; transition: transform 120ms ease, background 120ms ease; }
      .wide-control.is-active .switch { border-color: #fff; background: #fff; }
      .wide-control.is-active .switch::after { background: #080808; transform: translateX(12px); }
      .panel-footer { justify-content: space-between; gap: 10px; min-height: 38px; padding: 9px 16px; color: #777; border-top: 1px solid #252525; font-size: 10px; }
      .panel-footer a { color: #aaa; text-decoration: none; white-space: nowrap; }
      .panel-footer a:hover { color: #fff; text-decoration: underline; }
      .toast { position: absolute; right: 12px; bottom: 44px; left: 12px; padding: 9px 12px; color: #080808; border-radius: 5px; background: #fff; font-size: 11px; font-weight: 700; text-align: center; opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity 120ms ease, transform 120ms ease; }
      .toast.is-visible { opacity: 1; transform: translateY(0); }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
    `;
  }
})();
