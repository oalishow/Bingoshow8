// Teste de fumaça do painel do apresentador (index.html).
//
// Percorre o roteiro de um evento com o navegador e compara o estado salvo
// com a referência em tests/smoke/baseline.json. Serve para garantir que a
// refatoração do index.tsx em módulos não muda o comportamento do app.
//
// Uso:
//   npm run test:smoke             -> compila, roda o roteiro e compara
//   npm run test:smoke -- --update -> regrava a referência (só quando a mudança for intencional)
//
// Variáveis opcionais:
//   CHROME_PATH  caminho de um Chrome/Chromium já instalado
//   SMOKE_SHOTS  pasta onde salvar screenshots de cada passo
//
// O teste bloqueia toda rede externa (Tailwind, Firebase, fontes) para ser
// determinístico e rodar offline. Por isso o layout fica sem estilo e os
// cliques são feitos direto no DOM.

import { preview } from 'vite';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const baselinePath = path.join(here, 'baseline.json');
const updateBaseline = process.argv.includes('--update');
const shotsDir = process.env.SMOKE_SHOTS;

// Erros esperados porque a rede externa está bloqueada de propósito.
const EXPECTED_ERRORS = [
    /tailwind is not defined/,
    /Failed to load resource/,
    /ERR_FAILED/,
    /Could not reach Cloud Firestore backend/,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await preview({ root, preview: { port: 4317, strictPort: true, open: false }, logLevel: 'warn' });
const baseUrl = 'http://localhost:4317/';

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const unexpectedErrors = [];
const steps = [];
const dialogs = [];
let page;

async function newPage(context = browser.defaultBrowserContext()) {
    const p = await context.newPage();
    await p.setViewport({ width: 1400, height: 900 });
    await p.setRequestInterception(true);
    p.on('request', (req) => {
        const u = new URL(req.url());
        const local = u.hostname === 'localhost' || ['data', 'blob'].includes(u.protocol.replace(/\W/g, ''));
        if (local) req.continue();
        else req.abort();
    });
    const record = (text) => {
        if (!EXPECTED_ERRORS.some((re) => re.test(text))) unexpectedErrors.push(text);
    };
    // Janelas nativas (confirm/alert) travam a página: registra e aceita.
    p.on('dialog', async (d) => { dialogs.push(d.message().split('\n')[0]); await d.accept(); });
    p.on('pageerror', (err) => record('pageerror: ' + err.message));
    p.on('console', (msg) => { if (msg.type() === 'error') record('console: ' + msg.text()); });

    // Torna o app determinístico e captura downloads/pop-ups.
    await p.evaluateOnNewDocument(() => {
        // Sorteios com semente fixa. A semente é reiniciada antes de cada
        // sorteio, porque animações também consomem Math.random() em
        // quantidades que variam com o tempo.
        let seed = 12345;
        window.__reseed = (n) => { seed = n; };
        Math.random = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };
        // Sem pop-up: o app cai no caminho de download, que capturamos abaixo.
        window.open = () => null;
        window.print = () => {};
        window.__downloads = [];
        const origCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (obj) => {
            if (obj instanceof Blob) obj.text().then((t) => window.__downloads.push(t));
            return origCreate(obj);
        };
    });
    return p;
}

async function step(name, fn) {
    process.stdout.write(`- ${name} ... `);
    try {
        await fn();
        steps.push(name);
        console.log('ok');
        if (shotsDir) {
            fs.mkdirSync(shotsDir, { recursive: true });
            await page.screenshot({ path: path.join(shotsDir, `${String(steps.length).padStart(2, '0')}.png`) });
        }
    } catch (err) {
        console.log('FALHOU');
        throw new Error(`Passo "${name}" falhou: ${err.message}`);
    }
}

const click = (selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`elemento não encontrado: ${s}`);
    el.click();
}, selector);

const isVisible = (selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && !el.classList.contains('hidden');
}, selector);

async function waitFor(fn, what, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await fn()) return;
        await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${what}`);
}

const waitVisible = (selector) => waitFor(() => isVisible(selector), `${selector} visível`);
const waitHidden = (selector) => waitFor(async () => !(await isVisible(selector)), `${selector} oculto`);

async function savedState() {
    // Força o salvamento imediato e lê o que foi para o localStorage.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    return page.evaluate(() => JSON.parse(localStorage.getItem('bingoShowState') || 'null'));
}

async function closeAlertIfOpen() {
    if (await isVisible('#custom-alert-modal')) {
        await click('#custom-alert-close-btn');
        await waitHidden('#custom-alert-modal');
    }
}

async function announceManual(number) {
    await page.evaluate((n) => {
        const input = document.getElementById('number-input');
        input.value = String(n);
        document.getElementById('manual-input-form').requestSubmit();
    }, number);
    await waitVisible('#floating-number-modal');
    await click('#confirm-floating-btn');
    await waitHidden('#floating-number-modal');
}

async function calledNumbers(game = '1') {
    const s = await savedState();
    return s?.gamesData?.[game]?.calledNumbers ?? [];
}

let result;
try {
    page = await newPage();
    await page.goto(baseUrl, { waitUntil: 'load' });

    await step('abre o painel com 6 rodadas', async () => {
        await waitFor(() => page.evaluate(() => document.querySelectorAll('.game-item').length === 6), '6 rodadas na lista');
        await waitFor(() => page.evaluate(() => document.querySelectorAll('[id^="master-cell-"]').length === 75), 'painel com 75 números');
    });

    await step('escolhe a Rodada 1', async () => {
        await click('.game-item[data-game-number="1"] .play-btn');
        await waitFor(async () => (await savedState())?.activeGameNumber === '1', 'rodada 1 ativa');
    });

    await step('anuncia números manualmente (5, 20, 33)', async () => {
        for (const n of [5, 20, 33]) await announceManual(n);
        assert.deepEqual(await calledNumbers(), [5, 20, 33]);
    });

    await step('recusa número repetido', async () => {
        await page.evaluate(() => {
            document.getElementById('number-input').value = '20';
            document.getElementById('manual-input-form').requestSubmit();
        });
        await sleep(300);
        assert.equal(await isVisible('#floating-number-modal'), false);
        assert.deepEqual(await calledNumbers(), [5, 20, 33]);
    });

    await step('sorteio automático', async () => {
        await page.evaluate(() => window.__reseed(1));
        await click('#auto-draw-btn-top');
        await waitVisible('#spinning-wheel-modal');
        await click('#skip-animation-btn');
        await click('#close-drawn-btn');
        await waitVisible('#floating-number-modal');
        await click('#confirm-floating-btn');
        await waitHidden('#floating-number-modal');
        assert.equal((await calledNumbers()).length, 4);
    });

    await step('cancela um número clicando no painel', async () => {
        await click('#master-cell-20');
        await closeAlertIfOpen();
        await waitFor(async () => !(await calledNumbers()).includes(20), 'número 20 removido');
        assert.equal((await calledNumbers()).length, 3);
    });

    await step('confere bingo e registra ganhador', async () => {
        await click('#verify-btn-top');
        await waitVisible('#verification-modal');
        await click('#confirm-prize1-btn');
        await waitVisible('#winner-modal');
        await page.evaluate(() => { document.getElementById('winner-name-input').value = 'Maria Teste'; });
        await click('#register-winner-btn');
        await waitHidden('#winner-modal');
        await closeAlertIfOpen();
        if (await isVisible('#congrats-modal')) await click('#close-congrats-modal-btn');
        await waitFor(async () => {
            const s = await savedState();
            return JSON.stringify(s?.gamesData?.['1'] ?? {}).includes('Maria Teste');
        }, 'ganhador salvo na rodada 1');
    });

    await step('sorteia um brinde', async () => {
        await page.evaluate(() => window.__reseed(2));
        await click('#prize-draw-random-btn');
        await waitFor(async () => ((await savedState())?.drawnPrizeNumbers ?? []).length === 1, 'brinde registrado');
        // Fecha o que o sorteio de brinde tiver aberto.
        await sleep(300);
        for (const sel of ['#close-prize-sponsor-display-btn', '#close-drawn-btn', '#custom-alert-close-btn']) {
            await page.evaluate((s) => document.querySelector(s)?.click(), sel);
        }
    });

    await step('abre e fecha o intervalo', async () => {
        await click('#interval-btn');
        await waitVisible('#event-break-modal');
        await click('#close-break-modal-btn');
        await waitHidden('#event-break-modal');
    });

    await step('abre e fecha as configurações', async () => {
        await click('#show-settings-btn');
        await waitVisible('#settings-modal');
        await click('#close-settings-btn');
        await waitHidden('#settings-modal');
    });

    await step('gera 12 cartelas para impressão', async () => {
        await click('#show-card-generator-btn');
        await waitVisible('#card-generator-modal');
        await page.evaluate(() => {
            document.getElementById('card-quantity').value = '12';
            window.__downloads.length = 0;
        });
        await click('#generate-and-print-cards-btn');
        await sleep(20);
        await page.evaluate(() => window.__reseed(3));
        await waitFor(() => page.evaluate(() => window.__downloads.some((d) => d.includes('Bingo Amigos'))), 'HTML das cartelas');
        await closeAlertIfOpen();
        await waitHidden('#card-generator-modal');
    });

    let backup;
    await step('salva o backup em arquivo', async () => {
        await page.evaluate(() => { window.__downloads.length = 0; });
        await click('#save-to-file-btn');
        await waitFor(() => page.evaluate(() => window.__downloads.length > 0), 'arquivo de backup');
        backup = JSON.parse(await page.evaluate(() => window.__downloads[0]));
        await closeAlertIfOpen();
        assert.ok(backup.gamesData?.['1'], 'backup tem a rodada 1');
        assert.equal(Object.keys(backup.cardsData ?? {}).length, 12, 'backup tem as 12 cartelas');
    });

    const before = await savedState();

    // "Novo Jogo" não entra no roteiro: sem internet ele espera o Firestore
    // responder antes de recarregar e fica parado. Em vez disso, o backup é
    // carregado num navegador limpo, que cobre o mesmo caminho de restauração.
    await step('abre um painel limpo em outro navegador', async () => {
        const context = await browser.createBrowserContext();
        page = await newPage(context);
        await page.goto(baseUrl, { waitUntil: 'load' });
        await waitFor(() => page.evaluate(() => document.querySelectorAll('.game-item').length === 6), 'painel limpo');
        const s = await savedState();
        assert.equal(JSON.stringify(s?.gamesData ?? {}).includes('Maria Teste'), false);
    });

    await step('carrega o backup do arquivo', async () => {
        const file = path.join(root, 'node_modules', '.smoke-backup.json');
        fs.writeFileSync(file, JSON.stringify(backup));
        const input = await page.$('#load-from-file-input');
        dialogs.length = 0;
        await input.uploadFile(file);
        await waitFor(async () => JSON.stringify((await savedState())?.gamesData ?? {}).includes('Maria Teste'), 'estado restaurado');
        await closeAlertIfOpen();
        fs.rmSync(file, { force: true });
        // Backup de outro painel: o app pergunta se mantém o link atual.
        assert.deepEqual(dialogs, ['Este backup pertence a um evento/painel diferente.']);
    });

    const after = await savedState();
    result = { backup: normalize(backup), before: normalize(before), restored: normalize(after) };
} finally {
    await browser.close();
    await new Promise((r) => server.httpServer.close(r));
}

function digest(text) {
    return `[texto ${text.length} caracteres ${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}]`;
}

// Remove valores que mudam a cada execução (datas, ids aleatórios).
function normalize(state) {
    const VOLATILE = /timestamp|Timestamp|^eventId$|^lastUpdated$|^updatedAt$|^createdAt$|^date$|^time$|^drawnAt$|^wonAt$/;
    const walk = (v) => {
        if (Array.isArray(v)) return v.map(walk);
        // Números com cara de data em milissegundos (ids gerados com Date.now()).
        if (typeof v === 'number' && v > 1e12 && v < 1e13) return '[data]';
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return '[data]';
        // Textos longos (histórico de versões, imagens) viram um resumo curto.
        if (typeof v === 'string' && v.length > 200) {
            return digest(v);
        }
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) {
                if (VOLATILE.test(k)) continue;
                out[k] = walk(v[k]);
            }
            return out;
        }
        return v;
    };
    const s = walk(state);
    // Os rótulos são só textos da tela: um resumo basta para notar mudanças.
    if (s && s.appLabels) s.appLabels = digest(JSON.stringify(s.appLabels));
    // As cartelas usam UUIDs: guardamos só a quantidade e as séries.
    if (s && s.cardsData) {
        s.cardsData = Object.values(s.cardsData).map((c) => c.series).sort((a, b) => a - b);
    }
    return s;
}

if (unexpectedErrors.length) {
    console.error('\nErros inesperados no navegador:');
    for (const e of unexpectedErrors) console.error('  ' + e);
    process.exit(1);
}

if (updateBaseline || !fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, JSON.stringify(result, null, 2) + '\n');
    console.log(`\nReferência gravada em ${path.relative(root, baselinePath)} (${steps.length} passos).`);
} else {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    try {
        assert.deepEqual(result, baseline);
    } catch (err) {
        console.error('\nO estado final é diferente da referência:\n' + err.message.slice(0, 4000));
        process.exit(1);
    }
    console.log(`\nTudo certo: ${steps.length} passos e estado igual à referência.`);
}
