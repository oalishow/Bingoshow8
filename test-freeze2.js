import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  const content = `
  <html>
    <body>
      <iframe src="http://localhost:3000" width="1024px" height="800px" id="myframe"></iframe>
    </body>
  </html>`;
  
  await page.setContent(content, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const frameHandle = await page.$('#myframe');
  const frame = await frameHandle.contentFrame();
  
  const clickResult = await frame.evaluate(() => {
    try {
        const btn = document.getElementById('add-extra-game-btn');
        if(btn) {
           btn.click();
           return "Clicked add extra game btn";
        }
        return "Btn not found";
    } catch(e) { return e.toString(); }
  });
  console.log("Result:", clickResult);
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await browser.close();
})();
