import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
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
  
  const styles = await frame.evaluate(() => {
    return {
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      htmlOverflow: window.getComputedStyle(document.documentElement).overflow
    };
  });
  console.log("Overflow:", styles);
  
  await browser.close();
})();
