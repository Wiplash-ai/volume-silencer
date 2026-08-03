import { execFile } from "node:child_process";
import http from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(root, "site", "volume-silencer");
const outputRoot = path.join(root, "store-assets", "screenshots", "hero");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filePath = path.resolve(siteRoot, relativePath);
  if (!filePath.startsWith(`${siteRoot}${path.sep}`) && filePath !== siteRoot) {
    response.writeHead(403).end();
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

await mkdir(outputRoot, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 800 }
});
const page = await context.newPage();

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: `
    html, body { width: 1280px !important; height: 800px !important; overflow: hidden !important; background: #070707 !important; }
    .site-header, .hero-copy, main > section:not(.hero), .site-footer { display: none !important; }
    .hero { position: relative !important; width: 1280px !important; height: 800px !important; min-height: 800px !important; padding: 0 !important; display: block !important; overflow: hidden !important; border: 0 !important; }
    .hero::before { position: absolute; inset: 0; content: ""; background: radial-gradient(circle at 50% 44%, rgba(255,255,255,.075), transparent 45%); }
    .hero-visual { position: absolute !important; inset: 0 !important; width: 100% !important; }
    .demo-tabs { position: absolute !important; z-index: 3; top: 28px; left: 50%; margin: 0 !important; transform: translateX(-50%) scale(1.32); transform-origin: center; }
    .demo-tabs button { font-size: 11px !important; }
    .demo-browser { position: absolute !important; top: 89px; left: 50%; width: 860px !important; min-height: 488px !important; transform: translateX(-50%) scale(1.36); transform-origin: top center; box-shadow: 0 38px 110px rgba(0,0,0,.72) !important; }
    .demo-progress i { animation: none !important; width: 52% !important; }
  ` });

  for (const platform of ["youtube", "instagram", "tiktok"]) {
    await page.locator(`button[data-platform="${platform}"]`).click();
    await page.waitForTimeout(250);
    const highResolutionPath = path.join(outputRoot, `${platform}@2x.png`);
    const outputPath = path.join(outputRoot, `${platform}.png`);
    await page.screenshot({ path: highResolutionPath, fullPage: false });
    await execFileAsync("convert", [highResolutionPath, "-filter", "Lanczos", "-resize", "1280x800!", outputPath]);
    await rm(highResolutionPath);
  }
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`Captured hero screenshots in ${path.relative(root, outputRoot)}/.`);
