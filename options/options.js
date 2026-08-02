"use strict";

const form = document.getElementById("settingsForm");
const defaultVolume = document.getElementById("defaultVolume");
const defaultVolumeValue = document.getElementById("defaultVolumeValue");
const savedSiteSummary = document.getElementById("savedSiteSummary");
const clearSavedSites = document.getElementById("clearSavedSites");
const toast = document.getElementById("toast");
let settings = null;
let toastTimer = 0;
let saveTimer = 0;

init();

async function init() {
  const response = await sendMessage({ type: "GET_SETTINGS" });
  if (!response || !response.ok) return;
  settings = response.settings;
  render();
}

form.addEventListener("input", () => {
  defaultVolumeValue.textContent = `${defaultVolume.value}%`;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 120);
});

form.addEventListener("change", save);

clearSavedSites.addEventListener("click", async () => {
  const response = await sendMessage({ type: "CLEAR_SAVED_SITES" });
  if (!response || !response.ok) return;
  settings = response.settings;
  renderSavedSiteSummary();
  showToast("Saved website levels cleared");
});

async function save() {
  const patch = {
    defaultVolume: Number(defaultVolume.value),
    rememberBySite: document.getElementById("rememberBySite").checked,
    showMediaCount: document.getElementById("showMediaCount").checked,
    resetOnClose: document.getElementById("resetOnClose").checked,
    widgetSide: form.elements.widgetSide.value,
    widgetPosition: null
  };
  const response = await sendMessage({ type: "SAVE_SETTINGS", settings: patch });
  if (!response || !response.ok) return;
  settings = response.settings;
  showToast("Settings saved");
}

function render() {
  defaultVolume.value = String(settings.defaultVolume);
  defaultVolumeValue.textContent = `${settings.defaultVolume}%`;
  document.getElementById("rememberBySite").checked = settings.rememberBySite;
  document.getElementById("showMediaCount").checked = settings.showMediaCount;
  document.getElementById("resetOnClose").checked = settings.resetOnClose;
  form.elements.widgetSide.value = settings.widgetSide;
  renderSavedSiteSummary();
}

function renderSavedSiteSummary() {
  const count = settings && settings.siteVolumes ? Object.keys(settings.siteVolumes).length : 0;
  savedSiteSummary.textContent = count === 0
    ? "No websites saved."
    : `${count} ${count === 1 ? "website has" : "websites have"} a locally saved volume level.`;
  clearSavedSites.disabled = count === 0 && settings.visibleHosts.length === 0;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1600);
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}
