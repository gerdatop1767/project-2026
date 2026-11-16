// Captures real zybrilka.ru screens (mobile, 3x) for video 001.
const { chromium } = require('playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:780}, deviceScaleFactor:3, isMobile:true, hasTouch:true, locale:'ru-RU'});
  const p = await ctx.newPage();
  const go = async (u) => { await p.goto('https://zybrilka.ru'+u,{waitUntil:'networkidle',timeout:60000});
    const x=p.getByText('Отклонить необязательные'); try{ await x.first().waitFor({timeout:4000}); await x.first().click(); await p.waitForTimeout(600);}catch{} await p.waitForTimeout(1200); };
  const shot = async (n, full=false) => { await p.screenshot({path:`${OUT}/${n}.png`, fullPage:full}); console.log('saved',n); };
  await go('/'); await shot('home', true);
  await go('/subjects'); await shot('subjects');
  await go('/training'); await shot('training', true);
  await go('/games'); await shot('games');
  await go('/learning'); await shot('learning');
  await go('/subjects/math');
  const tv=p.getByText('Теория вероятностей').first(); await tv.waitFor({timeout:60000}); await tv.click();
  await p.getByText('Начать тренировку').last().click(); await p.waitForTimeout(3500);
  await shot('task', true);
  const ed=p.locator('textarea').first(); await ed.scrollIntoViewIfNeeded(); await ed.click(); await p.keyboard.type('0,5'); await p.waitForTimeout(400);
  await shot('task_typed');
  await p.getByRole('button',{name:'Проверить ответ'}).click(); await p.waitForTimeout(2500);
  await shot('task_checked', true);
  await b.close();
})();
