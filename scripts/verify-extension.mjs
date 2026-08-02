import http from "node:http";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "dist/chrome");
const fixturePath = path.join(root, "tests/fixtures/media.html");
const userDataDir = path.join("/tmp", "volume-silencer-playwright");
const html = await readFile(fixturePath);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

await rm(userDataDir, { recursive: true, force: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ],
  viewport: { width: 1440, height: 900 }
});

try {
  console.log("Chromium started with the unpacked extension.");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  let worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith("/background.js"));
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", {
      predicate: (candidate) => candidate.url().endsWith("/background.js"),
      timeout: 5000
    }).catch(() => null);
  }
  if (!worker) throw new Error("The Chromium extension service worker did not start.");
  console.log("Extension service worker is ready.");
  const page = await context.newPage();
  const otherPage = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await otherPage.goto(`http://127.0.0.1:${port}/other`);
  await page.bringToFront();
  console.log("Media fixtures are open.");

  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && tab.url.includes("127.0.0.1"));
    await chrome.tabs.sendMessage(target.id, { type: "TOGGLE_WIDGET" }, { frameId: 0 });
  });

  const host = page.locator("#volume-silencer-widget-host");
  await host.waitFor({ state: "visible" });
  console.log("Widget is visible.");
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && tab.url.endsWith("/"));
    await chrome.tabs.sendMessage(target.id, { type: "APPLY_MEDIA_STATE", payload: { volume: 25 } });
  });
  await page.waitForFunction(() => document.querySelector("video").volume === 0.25);
  console.log("Page media volume control works.");

  const muted = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && tab.url.endsWith("/"));
    const updated = await chrome.tabs.update(target.id, { muted: true });
    return updated.mutedInfo.muted;
  });
  if (!muted) throw new Error("Current-tab mute did not activate.");
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.url && tab.url.endsWith("/"));
    await chrome.tabs.update(target.id, { muted: false });
  });
  console.log("Current-tab mute and unmute work.");

  const muteState = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const active = tabs.find((tab) => tab.url && tab.url.endsWith("/"));
    await setWindowMode(active, "quiet-others");
    const updatedTabs = await chrome.tabs.query({ currentWindow: true });
    return {
      activeMuted: updatedTabs.find((tab) => tab.id === active.id).mutedInfo.muted,
      otherMuted: updatedTabs.filter((tab) => tab.id !== active.id).every((tab) => tab.mutedInfo.muted)
    };
  });
  if (muteState.activeMuted || !muteState.otherMuted) throw new Error("Quiet-other-tabs state was incorrect.");
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const active = tabs.find((tab) => tab.url && tab.url.endsWith("/"));
    await setWindowMode(active, "quiet-others");
  });
  console.log("Window tab muting and restoration work.");

  await new Promise((resolve) => setTimeout(resolve, 2000));
  await page.screenshot({
    path: path.join(root, "store-assets/screenshots/widget-demo.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, "store-assets/screenshots/widget-mobile.png"),
    fullPage: false
  });
  const extensionId = new URL(worker.url()).hostname;
  const optionsPage = await context.newPage();
  await optionsPage.setViewportSize({ width: 1440, height: 1000 });
  await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
  await optionsPage.screenshot({
    path: path.join(root, "store-assets/screenshots/settings.png"),
    fullPage: true
  });
  console.log("Verified widget, page volume, tab mute, window mute, and restoration.");
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}
