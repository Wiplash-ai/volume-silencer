import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(projectRoot, "artifacts");

await run(process.execPath, [path.join(projectRoot, "scripts/build.mjs")], projectRoot);
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });
await zipDirectory(path.join(projectRoot, "dist/chrome"), path.join(artifacts, "volume-silencer-chrome-edge-opera-3.0.0.zip"));
await zipDirectory(path.join(projectRoot, "dist/firefox"), path.join(artifacts, "volume-silencer-firefox-3.0.0.xpi"));

console.log("Created store archives in artifacts/.");

function zipDirectory(source, destination) {
  return run("zip", ["-qr", destination, "."], source);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
