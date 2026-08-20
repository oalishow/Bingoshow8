import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  const content = `
  <html>
    <body>
      <h1>Outer frame</h1>
      <iframe src="http://localhost:3000" width="100%" height="800px" id="myframe"></iframe>
    </body>
  </html>`;
  
  await page.setContent(content, { waitUntil: 'networkidle0', timeout: 15000 });
  console.log("Iframe loaded");
  await new Promise(resolve => setTimeout(resolve, 3000));
  await browser.close();
})();
