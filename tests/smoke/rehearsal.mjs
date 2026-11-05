// Teste do Modo Ensaio: garante que o ensaio não altera o evento real.
//
// Roteiro: anuncia um número no evento real, entra no ensaio, confere que a
// cópia chegou, anuncia outro número e usa "Novo Jogo" dentro do ensaio, sai
// do ensaio e confere que o evento real voltou exatamente como estava.
//
// Uso: npm run test:ensaio (precisa de `npm run build` antes; o test:smoke já compila)

import { preview } from 'vite';
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await preview({ root, preview: { port: 4318, strictPort: true, open: false }, logLevel: 'warn' });
const baseUrl = 'http://localhost:4318/';
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.setRequestInterception(true);
page.on('request', (req) => (new URL(req.url()).hostname === 'localhost' || req.url().startsWith('data:') ? req.continue() : req.abort()));
page.on('dialog', (d) => d.accept());
const pageErrors = [];
page.on('pageerror', (err) => { if (!/tailwind is not defined/.test(err.message)) pageErrors.push(err.message); });

const click = (s) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`elemento não encontrado: ${s}`);
    el.click();
}, s);
const isVisible = (s) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden'); }, s);
async function waitFor(fn, what, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try { if (await fn()) return; } catch { /* página recarregando */ }
        await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${what}`);
}
const ls = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
const flush = () => page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const called = (st) => st?.gamesData?.['1']?.calledNumbers ?? [];
const waitPanel = () => waitFor(() => page.evaluate(() => document.querySelectorAll('[id^="master-cell-"]').length === 75), 'painel carregado');

async function announce(n) {
    await page.evaluate((n) => {
        document.getElementById('number-input').value = String(n);
        document.getElementById('manual-input-form').requestSubmit();
    }, n);
    await waitFor(() => isVisible('#floating-number-modal'), 'modal do número');
    await click('#confirm-floating-btn');
    await waitFor(async () => !(await isVisible('#floating-number-modal')), 'modal fechado');
}

async function step(name, fn) {
    process.stdout.write(`- ${name} ... `);
    await fn();
    console.log('ok');
}

let failed = false;
try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await waitPanel();

    await step('evento real: escolhe a Rodada 1 e anuncia o 7', async () => {
        await click('.game-item[data-game-number="1"] .play-btn');
        await waitFor(async () => { await flush(); return (await ls('bingoShowState'))?.activeGameNumber === '1'; }, 'rodada 1 ativa');
        await announce(7);
        await flush();
        assert.deepEqual(called(await ls('bingoShowState')), [7]);
    });

    await step('entra no Modo Ensaio', async () => {
        assert.equal(await isVisible('#rehearsal-banner'), false);
        await click('#rehearsal-mode-btn');
        await waitFor(() => page.$('#rehearsal-confirm-modal [data-action="confirm"]'), 'confirmação do ensaio');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }),
            click('#rehearsal-confirm-modal [data-action="confirm"]'),
        ]);
        await waitPanel();
        await waitFor(() => page.$('#rehearsal-banner'), 'faixa do ensaio');
        assert.match(await page.title(), /^\[ENSAIO\]/);
    });

    await step('o ensaio começa com a cópia do evento real', async () => {
        await flush();
        assert.deepEqual(called(await ls('ensaio__bingoShowState')), [7]);
    });

    await step('anuncia o 40 no ensaio sem mexer no evento real', async () => {
        await announce(40);
        await flush();
        assert.deepEqual(called(await ls('ensaio__bingoShowState')), [7, 40]);
        assert.deepEqual(called(await ls('bingoShowState')), [7]);
    });

    await step('"Novo Jogo" no ensaio não apaga o evento real', async () => {
        await click('#reset-event-btn');
        await waitFor(() => page.$('#confirm-reset-btn'), 'confirmação do Novo Jogo');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => {}),
            click('#confirm-reset-btn'),
        ]);
        await waitPanel();
        await waitFor(() => page.$('#rehearsal-banner'), 'continua no ensaio');
        assert.deepEqual(called(await ls('bingoShowState')), [7]);
    });

    await step('sai do ensaio e o evento real volta como estava', async () => {
        await click('#rehearsal-mode-btn');
        await waitFor(() => page.$('#rehearsal-confirm-modal [data-action="confirm"]'), 'confirmação de saída');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }),
            click('#rehearsal-confirm-modal [data-action="confirm"]'),
        ]);
        await waitPanel();
        assert.equal(await page.$('#rehearsal-banner'), null);
        await flush();
        const real = await ls('bingoShowState');
        assert.deepEqual(called(real), [7]);
        assert.equal(real.activeGameNumber, '1');
        const leftovers = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ensaio__') || k === 'premioShowModoEnsaio'));
        assert.deepEqual(leftovers, []);
    });

    assert.deepEqual(pageErrors, [], 'erros na página');
    console.log('\nModo Ensaio OK.');
} catch (err) {
    failed = true;
    console.error('\nFALHOU:', err.message);
} finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
