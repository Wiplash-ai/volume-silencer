import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const sharedEntries = ["background.js", "content", "options", "assets", "LICENSE", "PRIVACY.md", "THIRD_PARTY_NOTICES.md"];
const baseManifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));

await rm(distRoot, { recursive: true, force: true });
await Promise.all([buildChromium(), buildOpera(), buildFirefox()]);

async function buildChromium() {
  const target = path.join(distRoot, "chrome");
  await copyShared(target);
  const manifest = structuredClone(baseManifest);
  delete manifest.browser_specific_settings;
  delete manifest.background.scripts;
  await writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function buildOpera() {
  const target = path.join(distRoot, "opera");
  await copyShared(target);
  const manifest = structuredClone(baseManifest);
  manifest.short_name = "VolSilencer";
  delete manifest.browser_specific_settings;
  delete manifest.background.scripts;
  await writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function buildFirefox() {
  const target = path.join(distRoot, "firefox");
  await copyShared(target);
  const manifest = structuredClone(baseManifest);
  delete manifest.background.service_worker;
  await writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyShared(target) {
  await mkdir(target, { recursive: true });
  await Promise.all(sharedEntries.map((entry) => cp(
    path.join(projectRoot, entry),
    path.join(target, entry),
    { recursive: true }
  )));
}

console.log("Built Chrome/Edge, Opera, and Firefox packages in dist/.");
