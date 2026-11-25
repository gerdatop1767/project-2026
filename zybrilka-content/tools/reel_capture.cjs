// App-only reels: frame-by-frame recording of the REAL zybrilka.ru mobile site (no mascot).
// node reel_capture.cjs <reel_dir>    — reads <reel_dir>/reel.json "clips", writes
//   <reel_dir>/frames/*.jpg (780x1560 = 390x780 @2x) and <reel_dir>/frames/timeline.json
//
// Every clip is a list of actions on ONE page that persists across clips (clip 2 continues where clip 1 ended):
//   {"open": "/games/nn", "wait_text": "Н и НН"}       load a page (cookie banner auto-dismissed)
//   {"hold": 1.2}                                       keep the current picture N seconds
//   {"scroll": 600, "sec": 1.5}                         smooth eased scroll by N css px (negative = up)
//   {"scroll_to": "Мини-игры", "sec": 1.2}              smooth scroll until that text is ~1/3 from the top
//   {"tap": "Играть", "nth": 0, "exact": false, "after": 0.8}   show a finger tap on the element, click it, wait, hold
//   {"tap_css": "button.answer", "nth": 0, "after": 0.8}
//   {"type": "0,56", "into": "textarea", "after": 0.5}  focus a field and type char by char (visible typing)
//   {"wait": 0.8}                                       wait without recording (network/animations)
// timeline.json: {"fps":30, "clips":[{"frames":[["000123.jpg", n_frames, [tap_x,tap_y]|null], ...]}]}
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const FPS = 30, BASE = 'https://zybrilka.ru';
const rd = process.argv[2];
const reel = JSON.parse(fs.readFileSync(path.join(rd, 'reel.json'), 'utf8'));
const OUT = path.join(rd, 'frames'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let shot = 0;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await ctx.newPage();
  const snap = async () => { const f = String(++shot).padStart(6, '0') + '.jpg'; await p.screenshot({ path: path.join(OUT, f), type: 'jpeg', quality: 92 }); return f; };
  let last = null;
  const tl = { fps: FPS, clips: [] };

  async function open(url, waitText) {
    for (let i = 0; i < 5; i++) {
      await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      const x = p.getByText('Отклонить необязательные');
      try { await x.first().waitFor({ timeout: 3000 }); await x.first().click(); } catch {}
      await p.waitForTimeout(1200);
      const t = await p.innerText('body').catch(() => '');
      if (!t.includes('Не удалось загрузить') && (!waitText || t.includes(waitText))) return;
      console.log('retry', url, i);
    }
    throw new Error('site did not load: ' + url);
  }
  // the site scrolls an inner container on mobile, so scroll with real wheel steps (works for any scroller)
  async function smooth(dy, sec, frames) {
    const n = Math.max(2, Math.round(sec * FPS)); let done = 0;
    await p.mouse.move(195, 420);
    for (let i = 1; i <= n; i++) {
      const target = Math.round(dy * ease(i / n)); const step = target - done; done = target;
      if (step) { await p.mouse.wheel(0, step); await p.waitForTimeout(30); }
      last = await snap(); frames.push([last, 1, null]);
    }
  }
  async function locate(a) {
    let loc = a.tap_css ? p.locator(a.tap_css) : p.getByText(a.tap, { exact: !!a.exact });
    loc = loc.nth(a.nth || 0);
    await loc.waitFor({ timeout: 15000 });
    return loc;
  }

  for (const clip of reel.clips) {
    const frames = [];
    for (const a of clip.actions || []) {
      if (a.open) { await open(a.open, a.wait_text); last = await snap(); }
      else if (a.wait) { await p.waitForTimeout(a.wait * 1000); last = await snap(); }
      else if (a.hold) { if (!last) last = await snap(); frames.push([last, Math.round(a.hold * FPS), null]); }
      else if (a.scroll) { await smooth(a.scroll, a.sec || 1.2, frames); }
      else if (a.scroll_to) {
        const loc = p.getByText(a.scroll_to, { exact: !!a.exact }).nth(a.nth || 0); await loc.waitFor({ timeout: 15000 });
        const box = await loc.boundingBox(); await smooth(box.y - 260, a.sec || 1.2, frames);
      } else if (a.tap || a.tap_css) {
        const loc = await locate(a);
        await loc.scrollIntoViewIfNeeded(); let box = await loc.boundingBox();
        if (box.y < 90 || box.y + box.height > 700) { await smooth(box.y - 330, 0.6, frames); box = await loc.boundingBox(); }
        last = await snap();
        const pt = [Math.round((box.x + box.width / 2) * 2), Math.round((box.y + box.height / 2) * 2)];
        frames.push([last, Math.round(0.45 * FPS), pt]);                 // finger appears and presses
        await loc.click(); await p.waitForTimeout((a.settle || 0.7) * 1000);
        last = await snap(); frames.push([last, Math.round((a.after ?? 0.8) * FPS), null]);
      } else if (a.type) {
        const f = p.locator(a.into || 'textarea, input').first(); await f.scrollIntoViewIfNeeded(); await f.click();
        for (const ch of a.type) { await p.keyboard.type(ch); await p.waitForTimeout(40); last = await snap(); frames.push([last, 4, null]); }
        frames.push([last, Math.round((a.after ?? 0.5) * FPS), null]);
      }
    }
    if (!frames.length) { last = last || await snap(); frames.push([last, FPS, null]); }
    tl.clips.push({ frames });
    console.log('clip', tl.clips.length, 'frames', frames.reduce((s, f) => s + f[1], 0));
  }
  const txt = (await p.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 600);
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(tl));
  console.log('LAST PAGE TEXT:', txt);
  await b.close();
})().catch(e => { console.error('CAPTURE ERROR:', e.message); process.exit(1); });
