// Renders the bot images from the HTML sources in this folder:
//   node render.mjs [path/to/apps/worker/assets/source]
// Needs Playwright with Chromium (not a project dependency): copy this file
// next to a Playwright install and pass this folder's path. Output:
// apps/worker/assets/welcome.png and apps/worker/assets/ios-install.png.
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
for (const [source, out, width, height] of [
  ['welcome.html', 'welcome.png', 1280, 720],
  ['ios-install.html', 'ios-install.png', 1080, 1600],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(here, source)).href);
  // Runs in the page, where `document` exists.
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: join(here, '..', out) });
  await page.close();
  console.log('rendered', out);
}
await browser.close();
