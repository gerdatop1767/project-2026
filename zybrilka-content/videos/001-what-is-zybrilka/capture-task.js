const { chromium } = require('playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:780}, deviceScaleFactor:3, isMobile:true, hasTouch:true, locale:'ru-RU'});
  const p = await ctx.newPage();
  const tv=p.getByText('Теория вероятностей').first();
  for (let i=0;i<5;i++){ await p.goto('https://zybrilka.ru/subjects/math',{waitUntil:'networkidle',timeout:60000}).catch(()=>{});
    const x=p.getByText('Отклонить необязательные'); try{ await x.first().waitFor({timeout:4000}); await x.first().click(); }catch{}
    try { await tv.waitFor({timeout:15000}); break; } catch { console.log('retry', i); } }
  await tv.click();
  await p.getByText('Начать тренировку').last().click(); await p.waitForTimeout(3500);
  await p.screenshot({path:`${OUT}/t1_condition.png`});
  console.log((await p.innerText('body')).replace(/\s+/g,' ').match(/#\w+ (.{0,260})/)?.[1]);
  const ed=p.locator('textarea').first(); await ed.scrollIntoViewIfNeeded(); await ed.click(); await p.keyboard.type('0,5'); await p.waitForTimeout(400);
  await p.screenshot({path:`${OUT}/t2_typed.png`});
  await p.getByRole('button',{name:'Проверить ответ'}).click(); await p.waitForTimeout(2500);
  await p.screenshot({path:`${OUT}/t3_checked.png`});
  const sol=p.getByText('Показать решение'); if (await sol.count()) { await sol.first().click(); await p.waitForTimeout(1200); }
  await p.mouse.move(195,400); await p.mouse.wheel(0,450); await p.waitForTimeout(900);
  await p.screenshot({path:`${OUT}/t4_solution.png`});
  console.log((await p.innerText('body')).replace(/\s+/g,' ').match(/Правильный ответ.{0,300}/)?.[0]);
  await b.close();
})();
