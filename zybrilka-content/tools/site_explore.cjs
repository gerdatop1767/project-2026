// Look at the LIVE mobile zybrilka.ru before writing an app reel: page text, buttons, links, optional screenshot.
// node site_explore.cjs /games /games/nn /training   [--shots <dir>]
// Prints for every path: visible text (trimmed), clickable labels and internal links — use the exact labels in reel.json
// "tap" actions and take every number/fact for captions from here (never from memory: counts change).
const { chromium } = require('playwright');
const args = process.argv.slice(2); const si = args.indexOf('--shots');
const shots = si >= 0 ? args.splice(si, 2)[1] : null;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' })).newPage();
  for (const path of args.length ? args : ['/']) {
    await p.goto('https://zybrilka.ru' + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    try { const x = p.getByText('Отклонить необязательные'); await x.first().waitFor({ timeout: 3000 }); await x.first().click(); } catch {}
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500),
      buttons: [...new Set([...document.querySelectorAll('button,[role=button]')].map(e => e.innerText.trim()).filter(Boolean))].slice(0, 60),
      links: [...new Set([...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href') + ' — ' + a.innerText.trim().replace(/\s+/g, ' ').slice(0, 50)))].slice(0, 80),
    }));
    console.log(`\n===== ${path}\nTEXT: ${info.text}\nBUTTONS: ${info.buttons.join(' | ')}\nLINKS:\n  ${info.links.join('\n  ')}`);
    if (shots) { require('fs').mkdirSync(shots, { recursive: true }); await p.screenshot({ path: `${shots}/${path.replace(/\W+/g, '_') || 'home'}.png` }); }
  }
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
