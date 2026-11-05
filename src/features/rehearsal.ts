// Modo Ensaio: permite treinar a equipe com um evento simulado sem tocar no evento real.
//
// Como funciona:
// - Ao entrar, os dados do evento real (localStorage e IndexedDB) são COPIADOS para
//   um espaço separado, com prefixo próprio. O evento real fica intacto.
// - Enquanto o ensaio está ligado, todo o app lê e grava só nessa cópia, e nada é
//   enviado ao Firebase (o Painel do Público continua mostrando o evento real).
// - Ao sair, a cópia é apagada e o app volta exatamente ao evento real.
import { setDoc as firestoreSetDoc, writeBatch as firestoreWriteBatch } from 'firebase/firestore';

const FLAG_KEY = 'premioShowModoEnsaio';
const PREFIX = 'ensaio__';
export const REAL_DB_NAME = 'BingoShowDB';
const REHEARSAL_DB_NAME = 'BingoShowDB_ensaio';
const DB_VERSION = 2;
const STORES: { name: string; keyPath: string }[] = [
    { name: 'sponsorImages', keyPath: 'id' },
    { name: 'cards', keyPath: 'uuid' },
];

function readFlag(): boolean {
    try {
        return window.localStorage.getItem(FLAG_KEY) === '1';
    } catch {
        return false;
    }
}

/** Lido uma vez ao abrir a página; entrar ou sair do ensaio sempre recarrega a página. */
export const isRehearsal = readFlag();

/** Nome real da chave no localStorage, separado quando o ensaio está ligado. */
export function storageKey(key: string): string {
    return isRehearsal ? PREFIX + key : key;
}

/** Banco IndexedDB usado pelo app (cópia separada durante o ensaio). */
export const activeDbName = isRehearsal ? REHEARSAL_DB_NAME : REAL_DB_NAME;

// --- Bloqueio de gravações no Firebase durante o ensaio ---

export const setDoc: typeof firestoreSetDoc = ((...args: any[]) => {
    if (isRehearsal) return Promise.resolve();
    return (firestoreSetDoc as any)(...args);
}) as any;

export const writeBatch: typeof firestoreWriteBatch = ((...args: any[]) => {
    if (isRehearsal) {
        const fake: any = {
            set: () => fake,
            update: () => fake,
            delete: () => fake,
            commit: () => Promise.resolve(),
        };
        return fake;
    }
    return (firestoreWriteBatch as any)(...args);
}) as any;

// --- Cópia e limpeza dos dados ---

function openDb(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const s of STORES) {
                if (!db.objectStoreNames.contains(s.name)) db.createObjectStore(s.name, { keyPath: s.keyPath });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB bloqueado'));
    });
}

function deleteDb(name: string): Promise<void> {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        } catch {
            resolve();
        }
    });
}

async function copyIndexedDb(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    await deleteDb(REHEARSAL_DB_NAME);
    const src = await openDb(REAL_DB_NAME);
    const dst = await openDb(REHEARSAL_DB_NAME);
    try {
        for (const s of STORES) {
            if (!src.objectStoreNames.contains(s.name)) continue;
            const items: any[] = await new Promise((resolve, reject) => {
                const req = src.transaction(s.name, 'readonly').objectStore(s.name).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
            if (items.length === 0) continue;
            await new Promise<void>((resolve, reject) => {
                const tx = dst.transaction(s.name, 'readwrite');
                const store = tx.objectStore(s.name);
                items.forEach((item) => store.put(item));
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
    } finally {
        src.close();
        dst.close();
    }
}

function removeRehearsalKeys(): void {
    const ls = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => ls.removeItem(k));
}

function copyLocalStorage(): void {
    const ls = window.localStorage;
    removeRehearsalKeys();
    const entries: [string, string][] = [];
    for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k || k === FLAG_KEY || k.startsWith(PREFIX)) continue;
        const v = ls.getItem(k);
        if (v !== null) entries.push([k, v]);
    }
    entries.forEach(([k, v]) => ls.setItem(PREFIX + k, v));
}

export async function enterRehearsal(): Promise<void> {
    // Garante que o último estado do evento real foi salvo antes de copiar.
    window.dispatchEvent(new Event('pagehide'));
    copyLocalStorage();
    try {
        await copyIndexedDb();
    } catch (e) {
        // Sem a cópia das imagens o ensaio funciona igual, só sem as fotos dos patrocinadores.
        console.warn('[Ensaio] Não foi possível copiar imagens e cartelas:', e);
    }
    window.localStorage.setItem(FLAG_KEY, '1');
    window.location.reload();
}

export async function exitRehearsal(): Promise<void> {
    try {
        window.localStorage.removeItem(FLAG_KEY);
        removeRehearsalKeys();
    } catch (e) {
        console.warn('[Ensaio] Erro ao limpar dados do ensaio:', e);
    }
    await deleteDb(REHEARSAL_DB_NAME);
    window.location.reload();
}

// O app ainda salva o estado ao fechar a página, então algo pode ser gravado na cópia
// depois da limpeza de "Sair do ensaio". Fora do ensaio, essas sobras são apagadas aqui.
if (!isRehearsal) {
    try {
        if (window.localStorage.getItem(PREFIX + 'bingoShowState') !== null || window.localStorage.getItem(PREFIX + 'bingoShowState_backup') !== null) {
            removeRehearsalKeys();
            deleteDb(REHEARSAL_DB_NAME);
        }
    } catch {
        // localStorage indisponível: não há cópia de ensaio para limpar.
    }
}

// --- Interface ---

function showConfirm(title: string, html: string, confirmLabel: string, confirmClass: string, onConfirm: () => Promise<void>): void {
    const overlay = document.createElement('div');
    overlay.id = 'rehearsal-confirm-modal';
    overlay.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[200]';
    overlay.innerHTML = `
        <div class="bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 class="text-xl font-bold mb-3">${title}</h2>
            <div class="text-sm leading-relaxed space-y-2 mb-5">${html}</div>
            <div class="flex gap-2 justify-end">
                <button type="button" data-action="cancel" class="px-4 py-2 min-h-[44px] rounded-lg bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 font-bold">Cancelar</button>
                <button type="button" data-action="confirm" class="px-4 py-2 min-h-[44px] rounded-lg text-white font-bold ${confirmClass}">${confirmLabel}</button>
            </div>
        </div>`;
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('[data-action="cancel"]')!.addEventListener('click', close);
    const confirmBtn = overlay.querySelector('[data-action="confirm"]') as HTMLButtonElement;
    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Aguarde...';
        await onConfirm();
    });
    document.body.appendChild(overlay);
}

export function confirmEnterRehearsal(): void {
    showConfirm(
        '🎭 Entrar no Modo Ensaio',
        `<p>O ensaio começa com uma <b>cópia</b> do evento atual (rodadas, prêmios, patrocinadores e cartelas), para a equipe treinar à vontade.</p>
         <p>Durante o ensaio <b>nada é salvo no evento real</b> e <b>nada é enviado ao Painel do Público</b>. Pode sortear, registrar ganhadores e até usar "Novo Jogo".</p>
         <p>Ao sair do ensaio, tudo o que foi feito nele é descartado e o evento real volta exatamente como estava.</p>`,
        'Começar ensaio',
        'bg-violet-600 hover:bg-violet-700',
        enterRehearsal,
    );
}

export function confirmExitRehearsal(): void {
    showConfirm(
        'Sair do Modo Ensaio',
        `<p>Tudo o que foi feito no ensaio será <b>descartado</b> e o painel volta ao evento real, exatamente como estava antes do ensaio.</p>`,
        'Sair do ensaio',
        'bg-red-600 hover:bg-red-700',
        exitRehearsal,
    );
}

/** Liga o botão do menu lateral e, durante o ensaio, mostra a faixa de aviso no topo. */
export function setupRehearsalUI(): void {
    const btn = document.getElementById('rehearsal-mode-btn');
    if (btn) {
        if (isRehearsal) {
            btn.innerHTML = '🚪 Sair do Ensaio';
            btn.classList.remove('bg-violet-600', 'hover:bg-violet-700');
            btn.classList.add('bg-red-600', 'hover:bg-red-700');
        }
        btn.addEventListener('click', () => (isRehearsal ? confirmExitRehearsal() : confirmEnterRehearsal()));
    }

    if (!isRehearsal) return;
    document.body.classList.add('rehearsal-mode');
    const banner = document.createElement('div');
    banner.id = 'rehearsal-banner';
    banner.className = 'fixed top-0 inset-x-0 z-[60] bg-violet-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-3 px-4 py-1 shadow-lg';
    banner.innerHTML = `<span>🎭 MODO ENSAIO: nada do que for feito aqui altera o evento real nem o Painel do Público.</span>
        <button type="button" class="underline whitespace-nowrap hover:text-violet-200">Sair do ensaio</button>`;
    banner.querySelector('button')!.addEventListener('click', confirmExitRehearsal);
    document.body.appendChild(banner);
    document.body.style.paddingTop = banner.offsetHeight + 'px';
    document.title = '[ENSAIO] ' + document.title;
}
