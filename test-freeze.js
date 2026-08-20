import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  const content = `
  <html>
    <body>
      <iframe src="http://localhost:3000" width="100%" height="800px" id="myframe"></iframe>
    </body>
  </html>`;
  
  await page.setContent(content, { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const frameHandle = await page.$('#myframe');
  const frame = await frameHandle.contentFrame();
  
  // Find elements covering the whole screen
  const visibleModals = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('.fixed:not(.hidden)'))
      .map(el => ({
        id: el.id,
        className: el.className,
        text: el.innerText.substring(0, 50)
      }));
  });
  
  console.log("Visible fixed elements:", visibleModals);
  
  await browser.close();
})();
