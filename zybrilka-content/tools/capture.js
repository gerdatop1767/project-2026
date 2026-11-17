// Real zybrilka.ru screenshots (iPhone-like 390x780 @3x -> 1170x2340) for a video.
// node capture.js <video_dir>   — reads storyboard.json "captures":
//   [{"name": "home", "path": "/", "scroll": 0},
//    {"preset": "task_flow", "subject": "math", "topic": "Теория вероятностей", "answer": "0,5", "prefix": "t"}]
// task_flow saves <prefix>1_condition, <prefix>2_typed, <prefix>3_checked, <prefix>4_solution (+ prints the real task & answer).
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const vd = process.argv[2];
const sb = JSON.parse(fs.readFileSync(path.join(vd, 'storyboard.json'), 'utf8'));
const OUT = path.join(vd, 'source/screens'); fs.mkdirSync(OUT, { recursive: true });
const BASE = 'https://zybrilka.ru';

async function open(p, url, waitText) {
  for (let i = 0; i < 5; i++) {
    await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    const x = p.getByText('Отклонить необязательные');
    try { await x.first().waitFor({ timeout: 4000 }); await x.first().click(); } catch {}
    await p.waitForTimeout(1500);
    const t = await p.innerText('body').catch(() => '');
    if (!t.includes('Не удалось загрузить') && (!waitText || t.includes(waitText))) return;
    console.log('retry', url, i);
  }
  throw new Error('site did not load: ' + url);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ru-RU' });
  const p = await ctx.newPage();
  for (const c of sb.captures || []) {
    if (c.preset === 'task_flow') {
      const pre = c.prefix || 't';
      await open(p, '/subjects/' + (c.subject || 'math'), c.topic);
      await p.getByText(c.topic).first().click();
      await p.getByText('Начать тренировку').last().click(); await p.waitForTimeout(3500);
      await p.screenshot({ path: `${OUT}/${pre}1_condition.png` });
      const body = (await p.innerText('body')).replace(/\s+/g, ' ');
      console.log('TASK:', (body.match(/#\w+ (.{0,400})/) || [])[1]);
      const ed = p.locator('textarea').first(); await ed.scrollIntoViewIfNeeded(); await ed.click();
      await p.keyboard.type(c.answer || '0'); await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/${pre}2_typed.png` });
      await p.getByRole('button', { name: 'Проверить ответ' }).click(); await p.waitForTimeout(2500);
      await p.screenshot({ path: `${OUT}/${pre}3_checked.png` });
      const sol = p.getByText('Показать решение'); if (await sol.count()) { await sol.first().click(); await p.waitForTimeout(1200); }
      await p.mouse.move(195, 400); await p.mouse.wheel(0, 450); await p.waitForTimeout(900);
      await p.screenshot({ path: `${OUT}/${pre}4_solution.png` });
      console.log('RESULT:', ((await p.innerText('body')).replace(/\s+/g, ' ').match(/(Правильно|Неправильно).{0,300}/) || [])[0]);
    } else {
      await open(p, c.path || '/', c.wait_text);
      if (c.scroll) { await p.mouse.move(195, 400); await p.mouse.wheel(0, c.scroll); await p.waitForTimeout(900); }
      await p.screenshot({ path: `${OUT}/${c.name}.png` });
    }
    console.log('saved', c.name || c.prefix || c.preset);
  }
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
