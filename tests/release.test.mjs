import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest uses MV3 and only required extension permissions", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["storage", "tabs"]);
  assert.deepEqual(manifest.host_permissions.sort(), ["http://*/*", "https://*/*"]);
  assert.equal(manifest.browser_specific_settings.gecko.data_collection_permissions.required[0], "none");
});

test("runtime source contains no analytics or remote network clients", async () => {
  const files = ["background.js", "content/content-script.js", "options/options.js"];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))).join("\n").toLowerCase();
  const forbidden = ["mixpanel", "google-analytics", "segment.io", "amplitude", "sentry", "xmlhttprequest", "fetch(", "websocket"];
  forbidden.forEach((token) => assert.equal(source.includes(token), false, `Unexpected runtime token: ${token}`));
});

test("widget exposes precise attenuation and bounded local amplification", async () => {
  const source = await readFile(path.join(root, "content/content-script.js"), "utf8");
  assert.match(source, /stealth:.*max: 1.*step: 0\.05/);
  assert.match(source, /blunt:.*max: MAX_VOLUME/);
  assert.match(source, /createMediaElementSource/);
  assert.match(source, /createGain/);
  assert.match(source, /const MAX_VOLUME = 500/);
});

test("browser action refreshes the small drawer icons at runtime", async () => {
  const source = await readFile(path.join(root, "background.js"), "utf8");
  assert.match(source, /chrome\.action\.setIcon\(\{ path: ACTION_ICONS \}/);
  assert.match(source, /16: "assets\/icons\/icon16\.png"/);
  assert.match(source, /32: "assets\/icons\/icon32\.png"/);
});

test("store builds produce browser-specific background configuration", async () => {
  await execFileAsync(process.execPath, [path.join(root, "scripts/build.mjs")], { cwd: root });
  const chromeManifest = JSON.parse(await readFile(path.join(root, "dist/chrome/manifest.json"), "utf8"));
  const operaManifest = JSON.parse(await readFile(path.join(root, "dist/opera/manifest.json"), "utf8"));
  const firefoxManifest = JSON.parse(await readFile(path.join(root, "dist/firefox/manifest.json"), "utf8"));
  assert.equal(chromeManifest.background.service_worker, "background.js");
  assert.equal("scripts" in chromeManifest.background, false);
  assert.equal(operaManifest.short_name, "VolSilencer");
  assert.equal(operaManifest.background.service_worker, "background.js");
  assert.equal("scripts" in operaManifest.background, false);
  assert.deepEqual(firefoxManifest.background.scripts, ["background.js"]);
  assert.equal("service_worker" in firefoxManifest.background, false);
});
