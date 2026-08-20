

        // FIX: Added declaration for the 'confetti' library function to resolve "Cannot find name 'confetti'" errors.
        declare var confetti: any;
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { registerSW } from 'virtual:pwa-register';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, FacebookAuthProvider, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { sounds } from './audio';

let firebaseApp: any;
let auth: any;
let db: any;

try {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
} catch (error) {
    console.error("Failed to initialize Firebase:", error);
    // Continue execution so the offline app still works
}

let firebaseUser: any = null;
let syncEnabled = false;
let eventId = '';

// Memória temporária para quando localStorage ou IndexedDB falharem/forem bloqueados pelo navegador
const memoryLocalStorage: Record<string, string> = {};

// Wrapper seguro para o localStorage que cai para a memória caso haja bloqueio de cookies de terceiros no iframe
const safeLocalStorage = {
    getItem(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            console.warn(`[Storage] localStorage.getItem indisponível para a chave '${key}'. Usando memória temporária.`, e);
            return memoryLocalStorage[key] || null;
        }
    },
    setItem(key: string, value: string): void {
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {
            console.warn(`[Storage] localStorage.setItem indisponível para a chave '${key}'. Usando memória temporária.`, e);
            memoryLocalStorage[key] = value;
        }
    },
    removeItem(key: string): void {
        try {
            window.localStorage.removeItem(key);
        } catch (e) {
            console.warn(`[Storage] localStorage.removeItem indisponível para a chave '${key}'. Usando memória temporária.`, e);
            delete memoryLocalStorage[key];
        }
    }
};

const LOCAL_STORAGE_KEY = 'bingoShowState';
const DONATION_SETTINGS_KEY = 'bingoShowDonationSettings';

function getStoredDonationSettings(): {
    pixKey?: string;
    pixTitle?: string;
    pixQrCodeUrl?: string;
    devPixKey?: string;
    devPixQrCodeUrl?: string;
    paypalLink?: string;
} | null {
    try {
        const raw = safeLocalStorage.getItem(DONATION_SETTINGS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) {
        console.warn("Erro ao ler configurações de doação:", e);
    }
    return null;
}

function saveDonationSettings(config: any) {
    try {
        if (!config) return;
        const current = getStoredDonationSettings() || {};
        const updated = {
            pixKey: config.pixKey !== undefined && config.pixKey !== '' ? config.pixKey : (current.pixKey || 'paroquiadelutecia@gmail.com'),
            pixTitle: config.pixTitle !== undefined && config.pixTitle !== '' ? config.pixTitle : (current.pixTitle || 'Apoie nossa Instituição com PIX'),
            pixQrCodeUrl: config.pixQrCodeUrl !== undefined ? config.pixQrCodeUrl : (current.pixQrCodeUrl || ''),
            devPixKey: config.devPixKey !== undefined && config.devPixKey !== '' ? config.devPixKey : (current.devPixKey || '1e8e4af0-4d23-440c-9f3d-b4e527f65911'),
            devPixQrCodeUrl: config.devPixQrCodeUrl !== undefined ? config.devPixQrCodeUrl : (current.devPixQrCodeUrl || ''),
            paypalLink: config.paypalLink !== undefined && config.paypalLink !== '' ? config.paypalLink : (current.paypalLink || 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW'),
        };
        safeLocalStorage.setItem(DONATION_SETTINGS_KEY, JSON.stringify(updated));
    } catch (e) {
        console.warn("Erro ao salvar configurações de doação:", e);
    }
}

// --- Refactoring: Central Application Store ---
// All application state and data logic is encapsulated in this object.
// This separates data management from UI rendering and event handling, making the code more robust and maintainable.
const appStore = {
    isInitialized: false,
    isResetting: false,
    saveTimeout: null as any,
    state: {
        gamesData: {} as { [key: string]: any },
        cardsData: {} as { [uuid: string]: { series: number, numbers: number[][] } },
        activeGameNumber: null as string | null,
        currentBingoType: '',
        pendingNumber: null as number | null,
        isVerifying: false,
        latestBingoTimestamp: 0,
        latestRoundTimestamp: 0,
        gameCount: 6,
        menuItems: [
            "Refrigerante - R$ 5,00", "Cerveja - R$ 7,00", "Água - R$ 3,00", 
            "Espetinho - R$ 8,00", "Pastel - R$ 6,00", "Porção de Fritas - R$ 15,00"
        ],
        drawnPrizeNumbers: [] as number[],
        blockedUsers: [] as string[],
        versionHistory: `**v8.0 (Atual)**
- **NOVO JOGO TOTAL & REINICIALIZAÇÃO LIMPA:** Ao iniciar um Novo Jogo, todos os dados da partida anterior (números sorteados, ganhadores, cartelas, histórico e patrocinadores) são completamente apagados de maneira segura, garantindo um novo início 100% limpo.
- **ESTADO INICIAL SEM RODADA SELECIONADA:** Ao resetar ou iniciar uma nova partida, a Rodada 1 não fica mais marcada como "Jogando..." por padrão. O painel inicia no estado neutro "Selecione uma Rodada", permitindo ao operador escolher e iniciar a rodada desejada manualmente.

**v7.9**
- **NOVO JOGO & PROTEÇÃO DE DADOS:** O botão "Reiniciar Evento" foi renomeado para "Novo Jogo". O modal de confirmação agora inclui aviso enfático de segurança e botão de atalho imediato para download do Backup (Salvar no PC) antes de apagar qualquer dado.
- **ATUALIZAÇÃO AUTOMÁTICA OBRIGATÓRIA:** O sistema detecta e notifica atualizações em tempo real com recarregamento imediato, garantindo que o programa nunca execute versões antigas ou desatualizadas.
- **INDICADOR DE PATROCINADORES NO PAINEL:** Corrigida a persistência da bolinha indicadora nos números com patrocinador, garantindo que seja reexibida com precisão após recarregar a página, alternar rodadas ou atualizar o sistema.

**v7.8**
- **PAINEL SIMPLES:** O painel de números no controlador simples foi atualizado para utilizar o mesmo estilo em grade do painel público, facilitando o acompanhamento e visualização pelo celular.
- **ESTABILIDADE:** Correção de loops e bugs no sistema de atualização do PWA em aparelhos móveis.
- **PERSONALIZAÇÃO DE PATROCINADORES:** Adicionados controles de posicionamento (horizontal/vertical) e escala de tamanho da fonte no gerador de imagens de patrocinadores.\n- **BUG DO PAINEL MOBILE CORRIGIDO:** O painel mobile agora atualiza em tempo real a exibição de cada número sorteado.\n- **PREMIAÇÕES NO MOBILE:** Adicionado um bloco de acompanhamento das premiações na visualização mobile, que agora conta com seu próprio botão embutido para verificar os ganhadores sem precisar sair do modo.\n- **MODO MOBILE DEDICADO:** O 'Painel Simples' agora se comporta como um modo de visualização nativo e não apenas uma janela flutuante, melhorando a experiência em celulares e garantindo o retorno perfeito ao painel tradicional.\n- **NAVEGAÇÃO SIMPLES:** Adicionados botões de navegação rápida entre rodadas no Painel Simples e otimização do scroll em telas pequenas.

**v7.6.0**
- **MODO CLARO:** Melhoria no contraste de cores para os nomes de patrocinadores e itens do cardápio no modo claro.
- **PRIVACIDADE DE EVENTO:** O ID do evento online foi ocultado do status por padrão, sendo revelado apenas ao clicar no indicador "Modo Online".
- **ATUALIZAÇÃO DE CRÉDITOS:** Atualização da Inteligência Artificial para Gemini 3.1 PRO.

**v7.5.0**
- Melhorias gerais e atualizações de design.

**v7.3.0**
- **NOVO LOGOTIPO:** Atualização do logotipo principal para um design mais colorido e moderno com gradientes e efeito 3D.
- **DESIGN DO PAINEL:** Reformulação completa do painel de rodada ativa para o Modo Claro, utilizando bordas suaves, sombras e fundo branco para maior contraste e profissionalismo.
- **LEGIBILIDADE DE PRÊMIOS:** Aumento significativo no tamanho da fonte dos prêmios e aplicação de contorno preto (text-stroke) nos valores, garantindo visibilidade máxima em projetores e ambientes iluminados.
- **INTERFACE DE CONTROLE:** Botões de "Intervalo" e "Cardápio" agora organizados em grade no painel lateral para melhor ergonomia.
- **SISTEMA DE BUILD:** Adição de rodapé técnico discreto com data da compilação no formato DD/MM/AAAA e identificação da versão.
- **ESTÉTICA:** Refinamento dos estados hover e transições no painel de números.

**v7.2.0**
- **LEITOR DE QR CODE:** Adição de scanner de QR Code para verificação instantânea de cartelas via câmera.
- **VERIFICAÇÃO MANUAL:** Novo campo para digitar o número da cartela manualmente quando a câmera não estiver disponível.
- **MELHORIAS VISUAIS (V7.2):** Inclusão de ícones nos botões para melhor identificação visual. Atualização do logotipo principal do programa. Ajuste de contraste no painel de rodadas para o tema claro.
- **ESTABILIDADE:** Correções no sistema de renderização de cartelas e melhorias de performance.

**v7.1.0**
- **REMARCA E FOCO LOCAL:** O programa foi renomeado para "Bingo Show". Toda a funcionalidade online e de sincronização com a nuvem (Firebase) foi removida. O aplicativo agora opera em um modo 100% local, salvando todos os dados (incluindo imagens de patrocinadores) diretamente no navegador para máxima confiabilidade e simplicidade em eventos presenciais.
- **NOVO LOGOTIPO:** O aplicativo agora apresenta um novo logotipo para refletir a marca "Bingo Show".
- **PATROCINADOR GLOBAL:** Adicionada uma nova seção nas configurações para cadastrar um "Patrocinador Global". Uma única imagem e nome podem ser definidos para aparecer em todos os números que não possuam um patrocinador individual, garantindo que a tela de sorteio sempre exiba um apoio.
- **INTERFACE SIMPLIFICADA:** Removidos os indicadores de status de conexão e a tela de seleção de modo (Online/Local), tornando a inicialização do programa mais direta.
- **MELHORIA NO BACKUP:** A função "Salvar no Computador" agora é o método principal de backup, garantindo que 100% dos dados, incluindo todas as imagens de patrocinadores (individuais e global), sejam salvas no arquivo .json.

**v6.8.0**
- **REFORMULAÇÃO DA INTERFACE DE INTERVALO:** A tela de intervalo foi redesenhada para projetores, exibindo em tela cheia o cardápio e os patrocinadores (ou vencedores) em um ciclo contínuo e com letras grandes, com uma animação constante de confetes ao fundo.
- **FLUXO DE VENCEDOR UNIFICADO:** O modal de parabéns e o de registro de nome foram unificados em uma única tela. O modal se fecha automaticamente após 20 segundos ou ao pressionar Enter (para salvar) ou Esc.
- **GESTÃO DE RODADAS APRIMORADA:** Rodadas extras agora são adicionadas no topo da lista com uma animação "fade-in". Rodadas concluídas agora podem ser reabertas com um clique, facilitando correções.
- **GERENCIAMENTO DE BRINDES FACILITADO:** No modal de conferência de brindes, agora é possível excluir números sorteados por engano. O último número sorteado é destacado visualmente.
- **MELHORIAS DE USABILIDADE E VISUAIS:** O tempo de exibição padrão do modal de número sorteado foi aumentado para 5 segundos. Os controles de zoom nos modais foram ajustados para não serem sobrepostos por animações. O rodapé agora exibe "última atualização do aplicativo". O sorteio de brinde agora tem uma animação pulsante.

**v6.6.0**
- **SALVAMENTO LOCAL NO COMPUTADOR:** Adicionada a funcionalidade para "Salvar no Computador" e "Carregar do Computador". Os usuários agora podem exportar todo o estado do evento (rodadas, vencedores, configurações, etc.) para um arquivo .json e importá-lo posteriormente. Isso cria um backup seguro e confiável, independente da conexão com a internet ou do cache do navegador.
- **CORREÇÃO DE DIAGNÓSTICO:** Aprimorada a explicação sobre o motivo do não salvamento em nuvem, direcionando o usuário para a solução de backup local como alternativa principal à configuração do Firebase.

**v6.5.0**
- **SORTEIO DE BRINDES EM DESTAQUE:** O número da cartela sorteada no sorteio de brindes agora é exibido no painel principal, utilizando o mesmo espaço do número de bingo para máximo destaque. A exibição inclui uma animação de "caça-níquel" e utiliza a cor da rodada ativa.
- **MODAL DE PATROCINADOR CORRIGIDO:** O painel de fundo do modal de patrocinador agora acompanha o zoom corretamente, garantindo uma aparência consistente e profissional em qualquer nível de escala. O modal também foi ampliado para maior impacto.
- **INCREMENTO DE VERSÃO:** O versionamento do aplicativo é atualizado a cada nova implementação.

**v6.4.0**
- **LOGO PADRÃO:** O programa agora inicia com a logomarca oficial do Bingo Cloud, que pode ser removida ou substituída pelo usuário nas configurações. O tamanho da logo no cabeçalho também foi aumentado.
- **GESTÃO DE RODADAS:** Adicionado um ícone de lixeira (🗑️) em cada rodada, permitindo sua exclusão mediante confirmação.
- **CORES DINÂMICAS E CONSISTENTES:** O número sorteado no painel principal agora é pintado com a cor exata da rodada ativa. O cabeçalho do modal de "Brindes Sorteados" também adota a cor da rodada.
- **FEEDBACK VISUAL APRIMORADO:** O botão da rodada ativa agora fica verde e exibe o texto "Jogando...", facilitando a identificação.
- **CONTROLE DE MODAIS:** Adicionada uma nova seção nas configurações para desativar o fechamento automático dos modais de sorteio ou ajustar seu tempo de exibição (de 3 a 15 segundos).`,
        appConfig: {
            isDarkMode: true,
            onlineSyncEnabled: true,
            showSponsorsOnMobile: true,
            eventId: '',
            eventPassword: '',
            pixKey: 'paroquiadelutecia@gmail.com',
            pixTitle: 'Apoie nossa Instituição com PIX',
            pixQrCodeUrl: '',
            devPixKey: '1e8e4af0-4d23-440c-9f3d-b4e527f65911',
            devPixQrCodeUrl: '',
            paypalLink: 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW',
            tutorialVideoLink: 'https://youtu.be/8iOOW-CR-WQ?si=Jolrp2qR38xhY5EZ', 
            bingoTitle: 'BINGO',
                    boardColor: 'default',
                    auctionBid: '0',
                    auctionItemName: '',
                    auctionWinnerName: '',
                    boardScale: 90,
                    displayScale: 100,
                    auctionScale: 100,
                    verificationPanelZoom: 100,
                    floatingNumberZoom: 100,
                    sponsorDisplayZoom: 100,
                    sponsorNumberZoom: 100,
                    drawnTextColor: '#FFFFFF',
                    drawnTextStrokeColor: '#000000',
                    drawnTextStrokeWidth: 2,
                    isEventClosed: false,
                    appName: 'Bingo Show',
                    customLogoBase64: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj4KICAgIDxkZWZzPgogICAgICAgIDwhLS0gQmFja2dyb3VuZCBHcmFkaWVudCAtLT4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMxZTFiNGIiLz4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMzMTJlODEiLz4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNDMzOGNhIi8+CiAgICAgICAgPC9saW5lYXJHcmFkaWVudD4KICAgICAgICAKICAgICAgICA8IS0tIEdvbGRlbiBUZXh0IEdyYWRpZW50IC0tPgogICAgICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ29sZEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMCUiIHkyPSIxMDAlIj4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2ZlZjA4YSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjQwJSIgc3RvcC1jb2xvcj0iI2ZiYmYyNCIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjYwJSIgc3RvcC1jb2xvcj0iI2Q5NzcwNiIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNiNDUzMDkiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgoKICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9InJlZEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZWY0NDQ0Ii8+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzk5MWIxYiIvPgogICAgICAgIDwvbGluZWFyR3JhZGllbnQ+CgogICAgICAgIDwhLS0gRHJvcCBTaGFkb3dzIC0tPgogICAgICAgIDxmaWx0ZXIgaWQ9ImRyb3BTaGFkb3ciIHg9Ii0yMCUiIHk9Ii0yMCUiIHdpZHRoPSIxNDAlIiBoZWlnaHQ9IjE0MCUiPgogICAgICAgICAgICA8ZmVEcm9wU2hhZG93IGR4PSIwIiBkeT0iMTIiIHN0ZERldmlhdGlvbj0iMTAiIGZsb29kLW9wYWNpdHk9IjAuOCIgZmxvb2QtY29sb3I9IiMwMDAiLz4KICAgICAgICA8L2ZpbHRlcj4KICAgICAgICA8ZmlsdGVyIGlkPSJnbG93IiB4PSItNTAlIiB5PSItNTAlIiB3aWR0aD0iMjAwJSIgaGVpZ2h0PSIyMDAlIj4KICAgICAgICAgICAgPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iOCIgcmVzdWx0PSJibHVyIi8+CiAgICAgICAgICAgIDxmZU1lcmdlPgogICAgICAgICAgICAgICAgPGZlTWVyZ2VOb2RlIGluPSJibHVyIi8+CiAgICAgICAgICAgICAgICA8ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz4KICAgICAgICAgICAgPC9mZU1lcmdlPgogICAgICAgIDwvZmlsdGVyPgogICAgICAgIDxmaWx0ZXIgaWQ9InRleHRHbG93IiB4PSItNTAlIiB5PSItNTAlIiB3aWR0aD0iMjAwJSIgaGVpZ2h0PSIyMDAlIj4KICAgICAgICAgICAgPGZlRHJvcFNoYWRvdyBkeD0iMCIgZHk9IjgiIHN0ZERldmlhdGlvbj0iNiIgZmxvb2Qtb3BhY2l0eT0iMC45IiBmbG9vZC1jb2xvcj0iIzAwMCIvPgogICAgICAgIDwvZmlsdGVyPgogICAgPC9kZWZzPgoKICAgIDwhLS0gQmFja2dyb3VuZCBCYXNlIC0tPgogICAgPHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMDAiIGZpbGw9InVybCgjYmdHcmFkKSIgZmlsdGVyPSJ1cmwoI2Ryb3BTaGFkb3cpIi8+CiAgICAKICAgIDwhLS0gRGVjb3JhdGl2ZSBPdXRsaW5lIC0tPgogICAgPHJlY3Qgd2lkdGg9IjQ3MiIgaGVpZ2h0PSI0NzIiIHg9IjIwIiB5PSIyMCIgcng9IjgwIiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ29sZEdyYWQpIiBzdHJva2Utd2lkdGg9IjgiIHN0cm9rZS1kYXNoYXJyYXk9IjIwIDEwIiBvcGFjaXR5PSIwLjYiLz4KCiAgICA8IS0tIExpZ2h0IFJheXMgLyBTdGFyYnVyc3QgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyNTYsIDIyMCkiPgogICAgICAgIDxwYXRoIGQ9Ik0wIC0xNTAgTDEwIDAgTDAgMTUwIEwtMTAgMCBaIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjEiIHRyYW5zZm9ybT0icm90YXRlKDApIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoNDUpIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoOTApIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoMTM1KSIvPgogICAgPC9nPgoKICAgIDwhLS0gQ2VudGVyIEJpbmdvIEJhbGwgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjEzMCIgZmlsbD0idXJsKCNyZWRHcmFkKSIgZmlsdGVyPSJ1cmwoI2Ryb3BTaGFkb3cpIi8+CiAgICAKICAgIDwhLS0gQmFsbCBJbm5lciBoaWdobGlnaHQgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjEzMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjQiIG9wYWNpdHk9IjAuMyIvPgogICAgCiAgICA8IS0tIFdoaXRlIENpcmNsZSBjZW50ZXIgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjgwIiBmaWxsPSIjZmZmZmZmIiBmaWx0ZXI9InVybCgjZHJvcFNoYWRvdykiLz4KICAgIAogICAgPCEtLSBTdGFyIERldGFpbHMgb24gdGhlIGJhbGwgLS0+CiAgICA8cGF0aCBkPSJNIDE3MCAxNTAgTCAxODAgMTcwIEwgMjAwIDE3MCBMIDE4MCAxODUgTCAxODUgMjA1IEwgMTcwIDE5MCBMIDE1NSAyMDUgTCAxNjAgMTg1IEwgMTQwIDE3MCBMIDE2MCAxNzAgWiIgZmlsbD0idXJsKCNnb2xkR3JhZCkiIC8+CiAgICA8cGF0aCBkPSJNIDM0MCAxNTAgTCAzNTAgMTcwIEwgMzcwIDE3MCBMIDM1MCAxODUgTCAzNTUgMjA1IEwgMzQwIDE5MCBMIDMyNSAyMDUgTCAzMzAgMTg1IEwgMzEwIDE3MCBMIDMzMCAxNzAgWiIgZmlsbD0idXJsKCNnb2xkR3JhZCkiIC8+CgogICAgPCEtLSBCaWcgTnVtYmVyIG9yIEIgLS0+CiAgICA8dGV4dCB4PSIyNTYiIHk9IjI3MCIgZm9udC1mYW1pbHk9IidJbXBhY3QnLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0MCIgZm9udC13ZWlnaHQ9IjkwMCIgZmlsbD0iI2I5MWMxYyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zdHlsZT0iaXRhbGljIj5CPC90ZXh0PgoKICAgIDwhLS0gQklOR08gVGV4dCAtLT4KICAgIDx0ZXh0IHg9IjI1NiIgeT0iNDQwIiBmb250LWZhbWlseT0iJ0FyaWFsIEJsYWNrJywgSW1wYWN0LCBzYW5zLXNlcmlmIiBmb250LXNpemU9Ijg1IiBmb250LXdlaWdodD0iOTAwIiBmb250LXN0eWxlPSJpdGFsaWMiIGZpbGw9InVybCgjZ29sZEdyYWQpIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWx0ZXI9InVybCgjdGV4dEdsb3cpIiBzdHJva2U9IiM3ODM1MGYiIHN0cm9rZS13aWR0aD0iNCIgbGV0dGVyLXNwYWNpbmc9IjQiPkJJTkdPPC90ZXh0PgogICAgCiAgICA8IS0tIFNIT1cgVGV4dCAtLT4KICAgIDx0ZXh0IHg9IjI1NiIgeT0iNDkwIiBmb250LWZhbWlseT0iJ0FyaWFsIEJsYWNrJywgSW1wYWN0LCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjQ1IiBmb250LXdlaWdodD0iOTAwIiBmb250LXN0eWxlPSJpdGFsaWMiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbHRlcj0idXJsKCN0ZXh0R2xvdykiIGxldHRlci1zcGFjaW5nPSIxMiI+U0hPVzwvdGV4dD4KCjwvc3ZnPg==',
                    enableSponsorsByNumber: false,
                    enableSoundEffects: true,
                    enableModalAutoclose: true,
                    modalAutocloseSeconds: 3,
                    sponsorDisplaySeconds: 10,
                    showSponsorCountdown: true,
                    sponsorTransitionEffect: 'fade',
                    showMenuInBreak: true,
                    sponsorEditorReusableBg: '',
                    sponsorEditorReusableBgOpacity: 100,
                    sponsorsByNumber: {} as Record<number, {name: string, image: string}>,
                    globalSponsor: { name: '', image: '' },
                    extraCardSponsor: { name: '', image: '' },
                    prizeDrawSponsor: { name: '', image: '' },
                    generalSponsors: [] as Array<{ id: string, name: string, image: string }>,
                    shortcuts: {
                        autoDraw: 'Control+Enter',
                        verify: 'Control+Space',
                        clearRound: 'Control+Delete',
                        drawPrize: 'Control+B',
                        registerPrize: 'Control+S',
                        sellAuction: 'Control+L',
                        showInterval: 'Control+I',
                    }
                },
                appLabels: {
                    howToUseTitle: "🎬 Como Usar?",
                    howToUseButton: "Em Breve!",
                    versionHistoryButton: "Histórico de Versões",
                    customizeButton: "🎨 Personalizar",
                    intervalButton: "⏱️ Intervalo",
                    generateProofButton: "🧾 Gerar Prova",
                    endEventButton: "🛑 Encerrar Evento",
                    resetEventButton: "🔄 Novo Jogo",
                    saveToFileButton: "💾 Salvar (PC)",
                    loadFromFileButton: "📂 Carregar",
                    winnersTitle: "Vencedores",
                    bingoBoardTitle: "Painel de Números",
                    activeRoundIndicatorDefault: "Selecione uma Rodada",
                    activeRoundIndicatorLabel: "Rodada Ativa:",
                    controlsPanelTitle: "Controles",
                    boardScaleLabel: "Escala Painel Números",
                    displayScaleLabel: "Escala Número Anunciado",
                    manualAnnounceButton: "📢 Anunciar Manual",
                    autoDrawButton: "🎰 Sorteio Automático",
                    verifyButton: "✅ Verificar",
                    clearRoundButton: "🧹 Limpar Rodada Atual",
                    announcedNumberLabel: "Número Anunciado",
                    lastNumbersLabel: "Últimos 5 Números",
                    prizeDrawTitle: "Sorteio de Brindes",
                    checkDrawnPrizesButton: "🧐 Conferir Sorteados",
                    prizeDrawFromLabel: "De:",
                    prizeDrawToLabel: "Até:",
                    noRepeatCheckboxLabel: "Não repetir sorteados",
                    prizeDrawRandomButton: "🎁 Sortear",
                    prizeDrawTicketNumberPlaceholder: "Nº Cartela",
                    prizeDrawNamePlaceholder: "Nome (Opcional)",
                    prizeDrawDescriptionPlaceholder: "Brinde (Opcional)",
                    registerPrizeButton: "📝 Registrar Brinde",
                    supportTitle: "Apoie a Instituição 🤝",
                    supportButton: "🤝 Faça sua Doação",
                    roundsAndPrizesTitle: "Rodadas e Prêmios",
                    addExtraRoundButton: "➕ Adicionar Rodada Extra",
                    subscribeTitle: "Inscreva-se no Canal",
                    subscribeButton: "📺 Inscrever-se no Canal",
                    prize1Label: "Quina",
                    prize2Label: "Cartela Cheia",
                    prize3Label: "Azarão",
                    intervalModalTitle: "Intervalo",
                    intervalModalSubtitle: "Voltamos em breve!",
                    verificationModalTitle: "Verificando Números",
                    verificationModalBackButton: "Voltar ao App",
                    auctionTitle: "Leilão",
                    sellItemButton: "💎 Vender Item",
                    clearRoundConfirmTitle: "Confirmar Limpeza",
                    clearRoundConfirmMessage: "Tem certeza que deseja limpar todos os números sorteados da rodada atual?",
                    clearRoundConfirmButton: "Limpar",
                    clearRoundCancelButton: "Cancelar",
                    modalBackButton: "Voltar ao App",
                    announceButton: "Anunciar Número",
                    winnerModalNamePlaceholder: "Nome do Ganhador",
                    winnerModalRegisterButton: "Registrar Ganhador",
                    alertModalTitle: "Atenção",
                    alertModalOkButton: "OK",
                    congratsModalTitle: "Parabéns!",
                    congratsModalPrizeLabel: "Ganhou:",
                    congratsModalMessage: "Parabéns e muita sorte!",
                    congratsModalCloseButton: "Fechar",
                    menuEditModalTitle: "Editar Cardápio",
                    menuEditModalDescription: "Digite cada item em uma nova linha.",
                    modalCancelButton: "❌ Cancelar",
                    modalSaveButton: "💾 Salvar",
                    winnerEditModalTitle: "Editar Vencedor",
                    winnerEditModalNamePlaceholder: "Nome do Ganhador",
                    winnerEditModalPrizePlaceholder: "Prêmio",
                    winnerEditModalRemoveButton: "🗑️ Remover",
                    deleteConfirmModalTitle: "Confirmar Exclusão",
                    deleteConfirmModalDeleteButton: "🗑️ Excluir",
                    proofOptionsModalTitle: "Gerar Prova",
                    proofOptionsModalDescription: "Selecione quais rodadas e brindes incluir no documento.",
                    proofOptionsModalGenerateButton: "🧾 Gerar Prova",
                    spinningWheelSkipButton: "⏭️ Pular Animação",
                    resetConfirmModalTitle: "Novo Jogo",
                    resetConfirmModalMessage: "Ao iniciar um Novo Jogo, você perderá TODOS os dados atuais do evento (números sorteados, rodadas, prêmios e vencedores). Faça o backup antes de continuar caso não queira perder os dados!",
                    resetConfirmModalConfirmButton: "🗑️ Sim, Apagar Tudo e Iniciar Novo Jogo",
                    drawnPrizesModalTitle: "Cartelas de Brinde Já Sorteadas",
                    modalCloseButton: "Fechar",
                    donationModalTitle: "Apoio à Instituição",
                    donationModalDescription: "Sua doação ajuda a manter este projeto ativo. Agradecemos imensamente!",
                    donationModalPaypalLabel: "Doação via PayPal",
                    donationModalPixLabel: "PIX (Chave Aleatória)",
                    donationModalCopyButton: "📋 Copiar Chave PIX",
                    finalWinnersModalTitle: "Vencedores do Evento",
                    finalWinnersModalProofButton: "🧾 Gerar Prova Final",
                    finalWinnersModalSupportButton: "🤝 Apoie a Instituição (PIX/PayPal)",
                    changelogModalTitle: "📜 Histórico de Versões",
                    changelogModalCurrentVersionLabel: "Versão Atual:",
                    settingsModalTitle: "Configurações de Personalização",
                    settingsTabAppearance: "Aparência",
                    settingsTabLabels: "Textos e Rótulos",
                    settingsTabShortcuts: "Atalhos",
                    settingsTabSponsors: "Patrocinadores",
                    quickShortcutsTitle: "Atalhos Rápidos",
                    shortcutsEditTitle: "Personalizar Atalhos",
                    shortcutsEditDescription: "Clique em um campo e pressione a nova combinação de teclas. As alterações são salvas automaticamente.",
                    shortcutLabelAutoDraw: "Sorteio Automático",
                    shortcutLabelVerify: "Verificar Números",
                    shortcutLabelClearRound: "Limpar Rodada",
                    shortcutLabelDrawPrize: "Sortear Brinde",
                    shortcutLabelRegisterPrize: "Registrar Brinde",
                    shortcutLabelSellAuction: "Vender Leilão",
                    shortcutLabelShowInterval: "Abrir Intervalo",
                    settingsLogoTitle: "Logo do Evento",
                    settingsLogoDescription: "Selecione uma imagem (PNG, JPG) para ser o logotipo do seu evento. A imagem será redimensionada para se ajustar ao cabeçalho.",
                    settingsLogoRemoveButton: "🗑️ Remover Logo",
                    settingsGlobalSponsorTitle: "Patrocinador Global",
                    settingsGlobalSponsorDescription: "Defina um nome e imagem que aparecerão para qualquer número sorteado que não tenha um patrocinador específico.",
                    removeGlobalSponsorButton: "🗑️ Remover Patrocinador Global",
                    settingsSponsorsByNumberTitle: "Patrocinadores por Número",
                    settingsSponsorsByNumberEnable: "Habilitar exibição de patrocinador ao sortear número",
                    settingsSponsorsByNumberDescription: "Cadastre um patrocinador para números específicos (de 1 a 75). O nome e a imagem aparecerão em destaque quando o número for sorteado.",
                    settingsSponsorNumberLabel: "Nº",
                    settingsSponsorNameLabel: "Nome do Patrocinador",
                    settingsSponsorImageLabel: "Imagem do Patrocinador",
                    settingsBingoTitleLabel: "Título do Grito de Vitória",
                    settingsBingoTitleDescription: "Personalize o 'grito de vitória'. Mudar para 'AJUDE!' também altera as letras do painel (A-J-U-D-E), ideal para bingos beneficentes.",
                    settingsBoardColorLabel: "Cor de Fundo da Cartela",
                    settingsSoundEffectsLabel: "Habilitar Efeitos Sonoros",
                    settingsBoardColorDescription: "Escolha a cor de fundo para os números que ainda não foram sorteados no painel principal.",
                    settingsBoardColorResetButton: "🧼 Limpar Cor",
                    settingsDrawnNumberTitle: "Aparência do Número Sorteado",
                    settingsDrawnTextColorLabel: "Cor do Texto (Letra e Número)",
                    settingsDrawnStrokeColorLabel: "Cor da Borda (Contorno)",
                    settingsDrawnStrokeWidthLabel: "Largura da Borda",
                    settingsModalAutocloseTitle: "Fechamento Automático do Modal",
                    settingsModalAutocloseEnable: "Fechar modais de sorteio automaticamente",
                    settingsModalAutocloseTimeLabel: "Tempo de Exibição",
                    settingsTestDataButton: "🧪 Gerar Vencedores de Teste",
                    settingsCloseSaveButton: "💾 Fechar e Salvar"
                },
            },

            // --- State Mutation Methods (Actions) ---
            setActiveGame(gameNumber: string | null) {
                this.state.activeGameNumber = gameNumber;
                this.state.latestRoundTimestamp = Date.now();
                this.debouncedSave(true);
            },

            addExtraGame() {
                this.state.gameCount++;
                this.state.gamesData[this.state.gameCount] = {
                    name: `Rodada ${this.state.gameCount}`,
                    prizes: { prize1: '', prize2: '', prize3: '' },
                    description: '',
                    calledNumbers: [],
                    winners: [],
                    isComplete: false,
                    color: roundColors[(this.state.gameCount - 1) % roundColors.length]
                };
                this.debouncedSave(true);
                return this.state.gameCount;
            },
            
            addCalledNumber(number: number) {
                if (this.state.activeGameNumber) {
                    const game = this.state.gamesData[this.state.activeGameNumber];
                    if (game && !game.calledNumbers.includes(number)) {
                        game.calledNumbers.push(number);
                        this.debouncedSave(true);
                    }
                }
            },
            
            removeCalledNumber(number: number) {
                 if (this.state.activeGameNumber) {
                    const game = this.state.gamesData[this.state.activeGameNumber];
                    if (game) {
                        const index = game.calledNumbers.indexOf(number);
                        if (index > -1) {
                            game.calledNumbers.splice(index, 1);
                            this.debouncedSave(true);
                        }
                    }
                }
            },
            
            clearActiveRound() {
                if (this.state.activeGameNumber) {
                    const game = this.state.gamesData[this.state.activeGameNumber];
                    if (game) {
                        game.calledNumbers = [];
                        this.debouncedSave(true);
                    }
                }
            },

            addWinner(prizeType: string, winnerName: string) {
                if (this.state.activeGameNumber) {
                    const game = this.state.gamesData[this.state.activeGameNumber];
                    if (game) {
                        const winnerData = {
                            id: Date.now(),
                            name: winnerName || "Ganhador Anônimo",
                            prize: game.prizes[prizeType],
                            gameNumber: this.state.activeGameNumber,
                            bingoType: prizeType,
                            numbers: [...game.calledNumbers].sort((a,b) => a-b)
                        };
                        game.winners.push(winnerData);
                        this.state.latestBingoTimestamp = Date.now();
                        this.state.isVerifying = false;
                        this.debouncedSave(true);
                        return winnerData;
                    }
                }
                return null;
            },

            // --- Persistence Logic ---
            getAppStateForSaving(includeCards = false) {
                const state: any = {
                    gamesData: this.state.gamesData,
                    gameCount: this.state.gameCount,
                    activeGameNumber: this.state.activeGameNumber,
                    menuItems: this.state.menuItems,
                    drawnPrizeNumbers: this.state.drawnPrizeNumbers,
                    blockedUsers: this.state.blockedUsers,
                    versionText: currentVersion,
                    versionHistory: this.state.versionHistory,
                    appConfig: this.state.appConfig,
                    isVerifying: this.state.isVerifying,
                    latestBingoTimestamp: this.state.latestBingoTimestamp,
                    latestRoundTimestamp: this.state.latestRoundTimestamp,
                    appLabels: this.state.appLabels,
                    pendingNumber: this.state.pendingNumber,
                };
                if (includeCards) {
                    state.cardsData = this.state.cardsData;
                }
                return state;
            },

            loadStateFromObject(state: any) {
                this.state.gamesData = state.gamesData || {};
                if (state.cardsData) {
                    this.state.cardsData = state.cardsData;
                }
                this.state.gameCount = state.gameCount || 6;
                this.state.activeGameNumber = state.activeGameNumber || null;
                this.state.menuItems = state.menuItems || [ "Refrigerante - R$ 5,00", "Cerveja - R$ 7,00", "Água - R$ 3,00", "Espetinho - R$ 8,00", "Pastel - R$ 6,00", "Porção de Fritas - R$ 15,00" ];
                this.state.drawnPrizeNumbers = state.drawnPrizeNumbers || [];
                this.state.blockedUsers = state.blockedUsers || [];
                this.state.versionHistory = state.versionHistory || this.state.versionHistory;
                const loadedConfig = state.appConfig || {};
                
                // Força o tempo de exibição do número para 3 segundos se estiver em 5 (atendendo ao pedido)
                if (loadedConfig.modalAutocloseSeconds === 5) {
                    loadedConfig.modalAutocloseSeconds = 3;
                }

                
                // Migração: Se existir customLogo mas não customLogoBase64, promove para o novo campo
                if (loadedConfig.customLogo && !loadedConfig.customLogoBase64) {
                    console.log("Migrando logo customizado antigo para customLogoBase64");
                    loadedConfig.customLogoBase64 = loadedConfig.customLogo;
                }
                
                if (loadedConfig.boardColor === undefined || loadedConfig.boardColor === '') {
                    loadedConfig.boardColor = 'default';
                }
                
                // Preserve local images since they are not synced to Firebase
                if (this.state.appConfig) {
                    if (this.state.appConfig.sponsorsByNumber && loadedConfig.sponsorsByNumber) {
                        for (const num in loadedConfig.sponsorsByNumber) {
                            if (this.state.appConfig.sponsorsByNumber[num]?.image && !loadedConfig.sponsorsByNumber[num].image) {
                                loadedConfig.sponsorsByNumber[num].image = this.state.appConfig.sponsorsByNumber[num].image;
                            }
                        }
                    }
                    if (this.state.appConfig.globalSponsor?.image && loadedConfig.globalSponsor && !loadedConfig.globalSponsor.image) {
                        loadedConfig.globalSponsor.image = this.state.appConfig.globalSponsor.image;
                    }
                    if (this.state.appConfig.extraCardSponsor?.image && loadedConfig.extraCardSponsor && !loadedConfig.extraCardSponsor.image) {
                        loadedConfig.extraCardSponsor.image = this.state.appConfig.extraCardSponsor.image;
                    }
                    if (this.state.appConfig.prizeDrawSponsor?.image && loadedConfig.prizeDrawSponsor && !loadedConfig.prizeDrawSponsor.image) {
                        loadedConfig.prizeDrawSponsor.image = this.state.appConfig.prizeDrawSponsor.image;
                    }
                    if (this.state.appConfig.generalSponsors && loadedConfig.generalSponsors) {
                        loadedConfig.generalSponsors.forEach((s: any) => {
                            const existing = this.state.appConfig.generalSponsors.find((g: any) => g.id === s.id);
                            if (existing?.image && !s.image) {
                                s.image = existing.image;
                            }
                        });
                    }
                    if (this.state.appConfig.customLogoBase64 && !loadedConfig.customLogoBase64) {
                        loadedConfig.customLogoBase64 = this.state.appConfig.customLogoBase64;
                    }
                    if (this.state.appConfig.sponsorEditorReusableBg && !loadedConfig.sponsorEditorReusableBg) {
                        loadedConfig.sponsorEditorReusableBg = this.state.appConfig.sponsorEditorReusableBg;
                    }
                }

                // Preserva configurações persistentes de doação
                const storedDonations = getStoredDonationSettings();
                if (storedDonations) {
                    if ((!loadedConfig.pixKey || loadedConfig.pixKey === '1e8e4af0-4d23-440c-9f3d-b4e527f65911') && storedDonations.pixKey) {
                        loadedConfig.pixKey = storedDonations.pixKey;
                    }
                    if (!loadedConfig.pixQrCodeUrl && storedDonations.pixQrCodeUrl) loadedConfig.pixQrCodeUrl = storedDonations.pixQrCodeUrl;
                    if (!loadedConfig.pixTitle && storedDonations.pixTitle) loadedConfig.pixTitle = storedDonations.pixTitle;
                    if (!loadedConfig.devPixKey && storedDonations.devPixKey) loadedConfig.devPixKey = storedDonations.devPixKey;
                    if (!loadedConfig.devPixQrCodeUrl && storedDonations.devPixQrCodeUrl) loadedConfig.devPixQrCodeUrl = storedDonations.devPixQrCodeUrl;
                    if (!loadedConfig.paypalLink && storedDonations.paypalLink) loadedConfig.paypalLink = storedDonations.paypalLink;
                }
                if (!loadedConfig.pixKey) loadedConfig.pixKey = 'paroquiadelutecia@gmail.com';
                if (!loadedConfig.devPixKey) loadedConfig.devPixKey = '1e8e4af0-4d23-440c-9f3d-b4e527f65911';
                if (!loadedConfig.paypalLink) loadedConfig.paypalLink = 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW';

                this.state.appConfig = { ...this.state.appConfig, ...loadedConfig };
                const loadedLabels = { ...(state.appLabels || {}) };
                if (!loadedLabels.resetEventButton || loadedLabels.resetEventButton.includes('Reiniciar') || loadedLabels.resetEventButton.toLowerCase().includes('novo jogo')) {
                    loadedLabels.resetEventButton = '🔄 Novo Jogo';
                }
                this.state.appLabels = { ...this.state.appLabels, ...loadedLabels };
            },

            debouncedSave(immediate = false) {
                if (!this.isInitialized || this.isResetting) return;
                clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this.saveStateToLocalStorage();
                }, immediate ? 10 : 300);
                if (typeof (this as any).debouncedFirebaseSync === 'function') {
                    (this as any).debouncedFirebaseSync(immediate);
                }
            },

            debouncedFirebaseSync(immediate = false) {
                if (!this.state.appConfig.onlineSyncEnabled || !eventId || !firebaseUser || this.isResetting) return;
                clearTimeout((this as any).firebaseSyncTimeout);
                (this as any).firebaseSyncTimeout = setTimeout(async () => {
                   if ((this as any).isSyncingFirebase) {
                       this.debouncedFirebaseSync(immediate);
                       return;
                   }
                   (this as any).isSyncingFirebase = true;
                   try {
                       const eventData: any = {
                           hostId: firebaseUser.uid,
                           activeGameNumber: this.state.activeGameNumber || '',
                           appName: this.state.appConfig.appName || '',
                           bingoTitle: this.state.appConfig.bingoTitle || '',
                           updatedAt: Date.now(),
                           createdAt: this.state.appConfig.createdAt || Date.now(),
                       };
                       
                       const stateToStore = JSON.parse(JSON.stringify(this.getAppStateForSaving(false)));
                       
                       if (stateToStore.appConfig) {
                           if (stateToStore.appConfig.sponsorsByNumber) {
                               for (const num in stateToStore.appConfig.sponsorsByNumber) {
                                   if (stateToStore.appConfig.sponsorsByNumber[num].image) {
                                        delete stateToStore.appConfig.sponsorsByNumber[num].image;
                                   }
                               }
                           }
                           if (stateToStore.appConfig.globalSponsor && stateToStore.appConfig.globalSponsor.image) {
                               delete stateToStore.appConfig.globalSponsor.image;
                           }
                           if (stateToStore.appConfig.customLogoBase64) {
                               delete stateToStore.appConfig.customLogoBase64;
                           }
                           if (stateToStore.appConfig.sponsorEditorReusableBg) {
                               delete stateToStore.appConfig.sponsorEditorReusableBg;
                           }
                       }
                       
                       eventData.fullStateJSON = JSON.stringify(stateToStore);

                       const stateStr = JSON.stringify(stateToStore);
                       let mainStateChanged = false;
                       if ((this as any)._lastSyncedState !== stateStr) {
                           (this as any)._lastSyncedState = stateStr;
                           mainStateChanged = true;
                       }

                       // Sync games using a writeBatch and only syncing modified games
                       if (!(this as any)._lastSyncedGames) (this as any)._lastSyncedGames = {};
                       const gamesKeys = Object.keys(this.state.gamesData);
                       const gamesToSync = gamesKeys.filter(gameId => {
                           const game = this.state.gamesData[gameId];
                           const currentGameStr = JSON.stringify({
                               name: game.name,
                               color: game.color,
                               calledNumbers: game.calledNumbers
                           });
                           if ((this as any)._lastSyncedGames[gameId] !== currentGameStr) {
                               (this as any)._lastSyncedGames[gameId] = currentGameStr;
                               return true;
                           }
                           return false;
                       });
                       
                       if (mainStateChanged) {
                           await setDoc(doc(db, "events", eventId), eventData, { merge: true });
                       }

                       for (let i = 0; i < gamesToSync.length; i += 100) {
                           const batch = writeBatch(db);
                           const chunk = gamesToSync.slice(i, i + 100);
                           for (const gameId of chunk) {
                               const game = this.state.gamesData[gameId];
                               const gameRef = doc(db, `events/${eventId}/games`, gameId);
                               batch.set(gameRef, {
                                   name: game.name || `Rodada ${gameId}`,
                                   color: game.color || '',
                                   calledNumbers: game.calledNumbers || [],
                                   updatedAt: Date.now()
                               }, { merge: true });
                           }
                           await batch.commit();
                           if (i + 100 < gamesToSync.length) await new Promise(r => setTimeout(r, 2000));
                       }
                   } catch (e) {
                       console.error("Firebase sync error:", e);
                   } finally {
                       (this as any).isSyncingFirebase = false;
                   }
                }, immediate ? 100 : 2000);
            },

            saveStateToLocalStorage() {
                if (!this.isInitialized || this.isResetting) return;
                try {
                    const appState = this.getAppStateForSaving(false); // Excluir cartelas do localStorage
                    const stateToStore = JSON.parse(JSON.stringify(appState));
                    const imageSavePromises: Promise<void>[] = [];
                    if (stateToStore.appConfig && stateToStore.appConfig.sponsorsByNumber) {
                        for (const num in stateToStore.appConfig.sponsorsByNumber) {
                            const sponsor = stateToStore.appConfig.sponsorsByNumber[num];
                            if (sponsor.image && sponsor.image.startsWith('data:image')) {
                                imageSavePromises.push(saveSponsorImage(num, sponsor.image));
                                delete sponsor.image;
                            }
                        }
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.globalSponsor) {
                        const globalSponsor = stateToStore.appConfig.globalSponsor;
                        if (globalSponsor.image && globalSponsor.image.startsWith('data:image')) {
                             imageSavePromises.push(saveSponsorImage('global', globalSponsor.image));
                             delete globalSponsor.image;
                        }
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.extraCardSponsor) {
                        const extraSponsor = stateToStore.appConfig.extraCardSponsor;
                        if (extraSponsor.image && extraSponsor.image.startsWith('data:image')) {
                             imageSavePromises.push(saveSponsorImage('extraCard', extraSponsor.image));
                             delete extraSponsor.image;
                        }
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.prizeDrawSponsor) {
                        const prizeSponsor = stateToStore.appConfig.prizeDrawSponsor;
                        if (prizeSponsor.image && prizeSponsor.image.startsWith('data:image')) {
                             imageSavePromises.push(saveSponsorImage('prizeDraw', prizeSponsor.image));
                             delete prizeSponsor.image;
                        }
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.generalSponsors && Array.isArray(stateToStore.appConfig.generalSponsors)) {
                        stateToStore.appConfig.generalSponsors.forEach((s: any) => {
                            if (s.image && s.image.startsWith('data:image')) {
                                imageSavePromises.push(saveSponsorImage('generalSponsor_' + s.id, s.image));
                                delete s.image;
                            }
                        });
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.customLogoBase64) {
                        if (stateToStore.appConfig.customLogoBase64.startsWith('data:image')) {
                             imageSavePromises.push(saveSponsorImage('customLogo', stateToStore.appConfig.customLogoBase64));
                             delete stateToStore.appConfig.customLogoBase64;
                        }
                    }
                    if (stateToStore.appConfig && stateToStore.appConfig.sponsorEditorReusableBg) {
                        if (stateToStore.appConfig.sponsorEditorReusableBg.startsWith('data:image')) {
                             imageSavePromises.push(saveSponsorImage('sponsorEditorBg', stateToStore.appConfig.sponsorEditorReusableBg));
                             delete stateToStore.appConfig.sponsorEditorReusableBg;
                        }
                    }
                    
                    const jsonStr = JSON.stringify(stateToStore);
                    safeLocalStorage.setItem(LOCAL_STORAGE_KEY, jsonStr);
                    safeLocalStorage.setItem(LOCAL_STORAGE_KEY + '_backup', jsonStr);
                    saveDonationSettings(this.state.appConfig);
                    renderUpdateInfo();

                    if (imageSavePromises.length > 0) {
                        Promise.all(imageSavePromises).catch(err => {
                            console.warn("[Storage] Erro ao salvar imagens em background:", err);
                        });
                    }
                } catch (error) {
                    console.error("Falha ao salvar estado no localStorage:", error);
                }
            },

            async loadStateFromLocalStorage(): Promise<boolean> {
                try {
                    let savedState = safeLocalStorage.getItem(LOCAL_STORAGE_KEY);
                    if (!savedState) {
                        savedState = safeLocalStorage.getItem(LOCAL_STORAGE_KEY + '_backup');
                    }
                    if (savedState) {
                        const appState = JSON.parse(savedState);
                        if (appState && typeof appState === 'object' && appState.gamesData && Object.keys(appState.gamesData).length > 0) {
                            this.loadStateFromObject(appState);
                            // Carrega patrocinadores e cartelas em segundo plano sem bloquear a interface
                            loadSponsorImages().catch(e => console.warn("[Storage] Imagens em segundo plano:", e));
                            loadAllCardsFromDB().then(cards => {
                                if (cards && Object.keys(cards).length > 0) {
                                    appStore.state.cardsData = Object.assign(appStore.state.cardsData, cards);
                                }
                            }).catch(e => console.warn("[Storage] Cartelas em segundo plano:", e));
                            return true;
                        }
                    }
                    return false;
                } catch (error) {
                    console.error("Falha ao carregar estado do localStorage:", error);
                    try {
                        const backupState = safeLocalStorage.getItem(LOCAL_STORAGE_KEY + '_backup');
                        if (backupState) {
                            const appState = JSON.parse(backupState);
                            if (appState && typeof appState === 'object' && appState.gamesData && Object.keys(appState.gamesData).length > 0) {
                                this.loadStateFromObject(appState);
                                return true;
                            }
                        }
                    } catch (e) {
                        console.error("Falha ao carregar backup do localStorage:", e);
                    }
                    return false;
                }
            },
            
            async loadInitialState() {
                let stateLoaded = false;
                let forceSave = false;
                
                try {
                    stateLoaded = await this.loadStateFromLocalStorage();
                } catch (err) {
                    console.error("Erro no carregamento local:", err);
                }
                
                if (!stateLoaded || Object.keys(this.state.gamesData).length === 0) {
                    console.log("Nenhum estado salvo encontrado. Inicializando com dados padrão.");
                    this.state.gameCount = 6;
                    this.state.gamesData = {};
                    for (let i = 1; i <= this.state.gameCount; i++) {
                        this.state.gamesData[i] = {
                            name: `Rodada ${i}`,
                            prizes: {
                                prize1: predefinedPrizes[i - 1]?.prize1 || '',
                                prize2: predefinedPrizes[i - 1]?.prize2 || '',
                                prize3: predefinedPrizes[i - 1]?.prize3 || ''
                            },
                            description: '',
                            calledNumbers: [],
                            winners: [],
                            isComplete: false,
                            color: roundColors[(i-1) % roundColors.length],
                        };
                    }
                    forceSave = true;
                }
                
                const storedDonations = getStoredDonationSettings();
                this.state.appConfig.tutorialVideoLink = 'https://youtu.be/8iOOW-CR-WQ?si=Jolrp2qR38xhY5EZ';
                this.state.appConfig.paypalLink = storedDonations?.paypalLink || this.state.appConfig.paypalLink || 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW';
                this.state.appConfig.pixKey = storedDonations?.pixKey || this.state.appConfig.pixKey || 'paroquiadelutecia@gmail.com';
                this.state.appConfig.pixTitle = storedDonations?.pixTitle || this.state.appConfig.pixTitle || 'Apoie nossa Instituição com PIX';
                this.state.appConfig.pixQrCodeUrl = storedDonations?.pixQrCodeUrl || this.state.appConfig.pixQrCodeUrl || '';
                this.state.appConfig.devPixKey = storedDonations?.devPixKey || this.state.appConfig.devPixKey || '1e8e4af0-4d23-440c-9f3d-b4e527f65911';
                this.state.appConfig.devPixQrCodeUrl = storedDonations?.devPixQrCodeUrl || this.state.appConfig.devPixQrCodeUrl || '';
                saveDonationSettings(this.state.appConfig);
                
                this.isInitialized = true;

                applyLabels();
                updateProgramTitle();
                try {
                    renderUIFromState();
                } catch (e) {
                    console.error("Erro ao renderizar interface inicial:", e);
                }
                
                if (forceSave) {
                    this.saveStateToLocalStorage();
                }
            }
        };

        // --- Transient UI State (not persisted) ---
        let floatingNumberTimeout: ReturnType<typeof setTimeout> | null = null;
        let intervalContentInterval: any;
        let intervalClockInterval: any;
        let breakConfettiInterval: any;
        let finalConfettiInterval: any; let finalSponsorsInterval: any;
        
        let clockInterval: any;
        let confettiAnimationId: number;
        let spinTimeout: any;
        let cycloneInterval: any;
        let winnerDisplayTimeout: any; 

        // --- Virtualization State for Large Datasets (2000+ attendees/winners) ---
        let winnerSearchFilter = '';
        let winnersVisibleCount = 30;
        const WINNERS_BATCH_SIZE = 30;
        let isWinnersScrollBound = false;

        // --- Constants ---
        const currentVersion = "8.0";
        const buildInfo = "Build: 20/08/2026 - 10:00"; // Data e hora em formato DD/MM/AAAA 
        const DYNAMIC_LETTERS = ['B', 'I', 'N', 'G', 'O'];
        const DYNAMIC_LETTERS_AJUDE = ['A', 'J', 'U', 'D', 'E'];
        const BINGO_CONFIG: { [key: string]: { min: number; max: number } } = { B: { min: 1, max: 15 }, I: { min: 16, max: 30 }, N: { min: 31, max: 45 }, G: { min: 46, max: 60 }, O: { min: 61, max: 75 },
                               A: { min: 1, max: 15 }, J: { min: 16, max: 30 }, U: { min: 31, max: 45 }, D: { min: 46, max: 60 }, E: { min: 61, max: 75 } };
        const roundColors = ['#16a34a', '#ca8a04', '#c2410c', '#0e7490', '#be185d', '#6d28d9', '#059669', '#b45309'];
        const predefinedPrizes = [ { prize1: 'R$ 100,00', prize2: '', prize3: '' }, { prize1: 'R$ 100,00', prize2: 'R$ 200,00', prize3: '' }, { prize1: 'R$ 200,00', prize2: '', prize3: '' }, { prize1: 'R$ 100,00', prize2: 'R$ 300,00', prize3: '' }, { prize1: 'R$ 300,00', prize2: '', prize3: 'R$ 300,00' }, { prize1: 'R$ 200,00', prize2: 'R$ 2.000,00', prize3: '' } ];
        const winnerDisplayDuration = 5000;

        // --- Seletores de Elementos Reativos (Lazy Getters com Fallback Seguro) ---
        const DOMElements = {
            get mainTitle() { return document.getElementById('main-title') || document.createElement('div'); },
            get version() { return document.getElementById('version') || document.createElement('span'); },
            get lastUpdated() { return document.getElementById('last-updated') || document.createElement('span'); },
            get clearRoundBtnTop() { return document.getElementById('clear-round-btn-top') || document.createElement('button'); },
            get clearRoundBtnBottom() { return document.getElementById('clear-round-btn-bottom') || document.createElement('button'); },
            get currentNumberEl() { return document.getElementById('current-number') || document.createElement('div'); },
            get prizeDrawDisplayContainer() { return document.getElementById('prize-draw-display-container') || document.createElement('div'); },
            get mainDisplayLabel() { return document.getElementById('main-display-label') || document.createElement('p'); },
            get bingoBoardEl() { return document.getElementById('bingo-board') || document.createElement('div'); },
            get bingoBoardWrapper() { return document.getElementById('bingo-board-wrapper') || document.createElement('div'); },
            get manualInputForm() { return (document.getElementById('manual-input-form') as HTMLFormElement) || document.createElement('form'); },
            get letterInput() { return (document.getElementById('letter-input') as HTMLInputElement) || document.createElement('input'); },
            get numberInput() { return (document.getElementById('number-input') as HTMLInputElement) || document.createElement('input'); },
            get errorMessageEl() { return document.getElementById('error-message') || document.createElement('p'); },
            get winnersContainer() { return document.getElementById('winners-container') || document.createElement('div'); },
            get shareBtn() { return document.getElementById('share-btn') || document.createElement('button'); },
            get endEventBtn() { return document.getElementById('end-event-btn') || document.createElement('button'); },
            get resetEventBtn() { return document.getElementById('reset-event-btn') || document.createElement('button'); },
            get intervalBtn() { return document.getElementById('interval-btn') || document.createElement('button'); },
            get editMenuBtn() { return document.getElementById('edit-menu-btn') || document.createElement('button'); },
            get lastNumbersDisplay() { return document.getElementById('last-numbers-display') || document.createElement('div'); },
            get lastPrizesDisplay() { return document.getElementById('last-prizes-display') || document.createElement('div'); },
            get lastPrizesContainer() { return document.getElementById('last-prizes-container') || document.createElement('div'); },
            get gamesListEl() { return document.getElementById('games-list') || document.createElement('div'); },
            get addExtraGameBtn() { return document.getElementById('add-extra-game-btn') || document.createElement('button'); },
            get prizeDrawForm() { return (document.getElementById('prize-draw-form') as HTMLFormElement) || document.createElement('form'); },
            get checkDrawnPrizesBtn() { return document.getElementById('check-drawn-prizes-btn') || document.createElement('button'); },
            get noRepeatPrizeDrawCheckbox() { return (document.getElementById('no-repeat-prize-draw') as HTMLInputElement) || ({ checked: true } as any); },
            get confettiCanvas() { return (document.getElementById('confetti-canvas') as HTMLCanvasElement) || document.createElement('canvas'); },
            get verificationModal() { return document.getElementById('verification-modal') || document.createElement('div'); },
            get floatingNumberModal() { return document.getElementById('floating-number-modal') || document.createElement('div'); },
            get sponsorDisplayModal() { return document.getElementById('sponsor-display-modal') || document.createElement('div'); },
            get winnerModal() { return document.getElementById('winner-modal') || document.createElement('div'); },
            get customAlertModal() { return document.getElementById('custom-alert-modal') || document.createElement('div'); },
            get congratsModal() { return document.getElementById('congrats-modal') || document.createElement('div'); },
            get eventBreakModal() { return document.getElementById('event-break-modal') || document.createElement('div'); },
            get menuEditModal() { return document.getElementById('menu-edit-modal') || document.createElement('div'); },
            get winnerEditModal() { return document.getElementById('winner-edit-modal') || document.createElement('div'); },
            get deleteConfirmModal() { return document.getElementById('delete-confirm-modal') || document.createElement('div'); },
            get clearRoundConfirmModal() { return document.getElementById('clear-round-confirm-modal') || document.createElement('div'); },
            get proofOptionsModal() { return document.getElementById('proof-options-modal') || document.createElement('div'); },
            get spinningWheelModal() { return document.getElementById('spinning-wheel-modal') || document.createElement('div'); },
            get resetConfirmModal() { return document.getElementById('reset-confirm-modal') || document.createElement('div'); },
            get drawnPrizesModal() { return document.getElementById('drawn-prizes-modal') || document.createElement('div'); },
            get donationModal() { return document.getElementById('donation-modal') || document.createElement('div'); },
            get finalWinnersModal() { return document.getElementById('final-winners-modal') || document.createElement('div'); },
            get changelogModal() { return document.getElementById('changelog-modal') || document.createElement('div'); },
            get loadOptionsModal() { return document.getElementById('load-options-modal') || document.createElement('div'); },
            get showDonationModalBtn() { return document.getElementById('show-donation-modal-btn') || document.createElement('button'); },
            get showChangelogBtn() { return document.getElementById('show-changelog-btn') || document.createElement('button'); },
            get showSettingsBtn() { return document.getElementById('show-settings-btn') || document.createElement('button'); },
            get settingsModal() { return document.getElementById('settings-modal') || document.createElement('div'); },
            get activeRoundPanel() { return document.getElementById('active-round-panel') || document.createElement('div'); },
            get noActiveRoundPanel() { return document.getElementById('no-active-round-panel') || document.createElement('div'); },
            get currentNumberWrapper() { return document.getElementById('current-number-wrapper') || document.createElement('div'); },
            get auctionForm() { return (document.getElementById('auction-form') as HTMLFormElement) || document.createElement('form'); },
            get roundEditModal() { return document.getElementById('round-edit-modal') || document.createElement('div'); },
            get nextRoundModal() { return document.getElementById('next-round-modal') || document.createElement('div'); },
            get showCardGeneratorBtn() { return document.getElementById('show-card-generator-btn') || document.createElement('button'); },
            get cardGeneratorModal() { return document.getElementById('card-generator-modal') || document.createElement('div'); },
            get cardScannerModal() { return document.getElementById('card-scanner-modal') || document.createElement('div'); },
            get sponsorImageEditorModal() { return document.getElementById('sponsor-image-editor-modal') || document.createElement('div'); },
            get intervalQrModal() { return document.getElementById('interval-qr-modal') || document.createElement('div'); },
            get simpleControllerBtn() { return document.getElementById('simple-controller-btn') || document.createElement('button'); },
            get scOverlay() { return document.getElementById('simple-controller-overlay') || document.createElement('div'); },
            get scCloseBtn() { return document.getElementById('sc-close-btn') || document.createElement('button'); },
            get scDrawBtn() { return document.getElementById('sc-draw-btn') || document.createElement('button'); },
            get scClaimsBtn() { return document.getElementById('sc-claims-btn') || document.createElement('button'); },
            get scGameName() { return document.getElementById('sc-game-name') || document.createElement('span'); },
            get scLastNumber() { return document.getElementById('sc-last-number') || document.createElement('span'); },
            get scDrawnCount() { return document.getElementById('sc-drawn-count') || document.createElement('span'); },
        };

function renderCustomLogo() {
    console.log("Renderizando logo do programa...");
    const headerLogoContainer = document.getElementById('app-logo');
    if (!headerLogoContainer) {
        console.warn("Aviso: Container #app-logo não encontrado no DOM ainda.");
        return;
    }

    // Design v7.4: Logo moderno e adaptável (Limpo, Vibrante e Funcional)
    const fixedDefaultLogo = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj4KICAgIDxkZWZzPgogICAgICAgIDwhLS0gQmFja2dyb3VuZCBHcmFkaWVudCAtLT4KICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnR3JhZCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiMxZTFiNGIiLz4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSI1MCUiIHN0b3AtY29sb3I9IiMzMTJlODEiLz4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjNDMzOGNhIi8+CiAgICAgICAgPC9saW5lYXJHcmFkaWVudD4KICAgICAgICAKICAgICAgICA8IS0tIEdvbGRlbiBUZXh0IEdyYWRpZW50IC0tPgogICAgICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZ29sZEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMCUiIHkyPSIxMDAlIj4KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2ZlZjA4YSIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjQwJSIgc3RvcC1jb2xvcj0iI2ZiYmYyNCIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjYwJSIgc3RvcC1jb2xvcj0iI2Q5NzcwNiIvPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNiNDUzMDkiLz4KICAgICAgICA8L2xpbmVhckdyYWRpZW50PgoKICAgICAgICA8bGluZWFyR3JhZGllbnQgaWQ9InJlZEdyYWQiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICAgICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZWY0NDQ0Ii8+CiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzk5MWIxYiIvPgogICAgICAgIDwvbGluZWFyR3JhZGllbnQ+CgogICAgICAgIDwhLS0gRHJvcCBTaGFkb3dzIC0tPgogICAgICAgIDxmaWx0ZXIgaWQ9ImRyb3BTaGFkb3ciIHg9Ii0yMCUiIHk9Ii0yMCUiIHdpZHRoPSIxNDAlIiBoZWlnaHQ9IjE0MCUiPgogICAgICAgICAgICA8ZmVEcm9wU2hhZG93IGR4PSIwIiBkeT0iMTIiIHN0ZERldmlhdGlvbj0iMTAiIGZsb29kLW9wYWNpdHk9IjAuOCIgZmxvb2QtY29sb3I9IiMwMDAiLz4KICAgICAgICA8L2ZpbHRlcj4KICAgICAgICA8ZmlsdGVyIGlkPSJnbG93IiB4PSItNTAlIiB5PSItNTAlIiB3aWR0aD0iMjAwJSIgaGVpZ2h0PSIyMDAlIj4KICAgICAgICAgICAgPGZlR2F1c3NpYW5CbHVyIHN0ZERldmlhdGlvbj0iOCIgcmVzdWx0PSJibHVyIi8+CiAgICAgICAgICAgIDxmZU1lcmdlPgogICAgICAgICAgICAgICAgPGZlTWVyZ2VOb2RlIGluPSJibHVyIi8+CiAgICAgICAgICAgICAgICA8ZmVNZXJnZU5vZGUgaW49IlNvdXJjZUdyYXBoaWMiLz4KICAgICAgICAgICAgPC9mZU1lcmdlPgogICAgICAgIDwvZmlsdGVyPgogICAgICAgIDxmaWx0ZXIgaWQ9InRleHRHbG93IiB4PSItNTAlIiB5PSItNTAlIiB3aWR0aD0iMjAwJSIgaGVpZ2h0PSIyMDAlIj4KICAgICAgICAgICAgPGZlRHJvcFNoYWRvdyBkeD0iMCIgZHk9IjgiIHN0ZERldmlhdGlvbj0iNiIgZmxvb2Qtb3BhY2l0eT0iMC45IiBmbG9vZC1jb2xvcj0iIzAwMCIvPgogICAgICAgIDwvZmlsdGVyPgogICAgPC9kZWZzPgoKICAgIDwhLS0gQmFja2dyb3VuZCBCYXNlIC0tPgogICAgPHJlY3Qgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHJ4PSIxMDAiIGZpbGw9InVybCgjYmdHcmFkKSIgZmlsdGVyPSJ1cmwoI2Ryb3BTaGFkb3cpIi8+CiAgICAKICAgIDwhLS0gRGVjb3JhdGl2ZSBPdXRsaW5lIC0tPgogICAgPHJlY3Qgd2lkdGg9IjQ3MiIgaGVpZ2h0PSI0NzIiIHg9IjIwIiB5PSIyMCIgcng9IjgwIiBmaWxsPSJub25lIiBzdHJva2U9InVybCgjZ29sZEdyYWQpIiBzdHJva2Utd2lkdGg9IjgiIHN0cm9rZS1kYXNoYXJyYXk9IjIwIDEwIiBvcGFjaXR5PSIwLjYiLz4KCiAgICA8IS0tIExpZ2h0IFJheXMgLyBTdGFyYnVyc3QgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyNTYsIDIyMCkiPgogICAgICAgIDxwYXRoIGQ9Ik0wIC0xNTAgTDEwIDAgTDAgMTUwIEwtMTAgMCBaIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjEiIHRyYW5zZm9ybT0icm90YXRlKDApIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoNDUpIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoOTApIi8+CiAgICAgICAgPHBhdGggZD0iTTAgLTE1MCBMMTAgMCBMMCAxNTAgTC0xMCAwIFoiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMSIgdHJhbnNmb3JtPSJyb3RhdGUoMTM1KSIvPgogICAgPC9nPgoKICAgIDwhLS0gQ2VudGVyIEJpbmdvIEJhbGwgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjEzMCIgZmlsbD0idXJsKCNyZWRHcmFkKSIgZmlsdGVyPSJ1cmwoI2Ryb3BTaGFkb3cpIi8+CiAgICAKICAgIDwhLS0gQmFsbCBJbm5lciBoaWdobGlnaHQgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjEzMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjQiIG9wYWNpdHk9IjAuMyIvPgogICAgCiAgICA8IS0tIFdoaXRlIENpcmNsZSBjZW50ZXIgLS0+CiAgICA8Y2lyY2xlIGN4PSIyNTYiIGN5PSIyMjAiIHI9IjgwIiBmaWxsPSIjZmZmZmZmIiBmaWx0ZXI9InVybCgjZHJvcFNoYWRvdykiLz4KICAgIAogICAgPCEtLSBTdGFyIERldGFpbHMgb24gdGhlIGJhbGwgLS0+CiAgICA8cGF0aCBkPSJNIDE3MCAxNTAgTCAxODAgMTcwIEwgMjAwIDE3MCBMIDE4MCAxODUgTCAxODUgMjA1IEwgMTcwIDE5MCBMIDE1NSAyMDUgTCAxNjAgMTg1IEwgMTQwIDE3MCBMIDE2MCAxNzAgWiIgZmlsbD0idXJsKCNnb2xkR3JhZCkiIC8+CiAgICA8cGF0aCBkPSJNIDM0MCAxNTAgTCAzNTAgMTcwIEwgMzcwIDE3MCBMIDM1MCAxODUgTCAzNTUgMjA1IEwgMzQwIDE5MCBMIDMyNSAyMDUgTCAzMzAgMTg1IEwgMzEwIDE3MCBMIDMzMCAxNzAgWiIgZmlsbD0idXJsKCNnb2xkR3JhZCkiIC8+CgogICAgPCEtLSBCaWcgTnVtYmVyIG9yIEIgLS0+CiAgICA8dGV4dCB4PSIyNTYiIHk9IjI3MCIgZm9udC1mYW1pbHk9IidJbXBhY3QnLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0MCIgZm9udC13ZWlnaHQ9IjkwMCIgZmlsbD0iI2I5MWMxYyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zdHlsZT0iaXRhbGljIj5CPC90ZXh0PgoKICAgIDwhLS0gQklOR08gVGV4dCAtLT4KICAgIDx0ZXh0IHg9IjI1NiIgeT0iNDQwIiBmb250LWZhbWlseT0iJ0FyaWFsIEJsYWNrJywgSW1wYWN0LCBzYW5zLXNlcmlmIiBmb250LXNpemU9Ijg1IiBmb250LXdlaWdodD0iOTAwIiBmb250LXN0eWxlPSJpdGFsaWMiIGZpbGw9InVybCgjZ29sZEdyYWQpIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWx0ZXI9InVybCgjdGV4dEdsb3cpIiBzdHJva2U9IiM3ODM1MGYiIHN0cm9rZS13aWR0aD0iNCIgbGV0dGVyLXNwYWNpbmc9IjQiPkJJTkdPPC90ZXh0PgogICAgCiAgICA8IS0tIFNIT1cgVGV4dCAtLT4KICAgIDx0ZXh0IHg9IjI1NiIgeT0iNDkwIiBmb250LWZhbWlseT0iJ0FyaWFsIEJsYWNrJywgSW1wYWN0LCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjQ1IiBmb250LXdlaWdodD0iOTAwIiBmb250LXN0eWxlPSJpdGFsaWMiIGZpbGw9IiNmZmZmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbHRlcj0idXJsKCN0ZXh0R2xvdykiIGxldHRlci1zcGFjaW5nPSIxMiI+U0hPVzwvdGV4dD4KCjwvc3ZnPg==';
    
    let currentLogo = appStore.state.appConfig.customLogoBase64;
    
    // Validação robusta: se não houver logo, ou se não começar com data:, ou se for muito curto (corrompido)
    if (!currentLogo || !currentLogo.startsWith('data:image') || currentLogo.length < 100) {
        console.log("Usando logo padrão fixo.");
        currentLogo = fixedDefaultLogo;
    } else {
        console.log("Usando logo customizado de comprimento:", currentLogo.length);
    }

    // Inserção no DOM
    headerLogoContainer.innerHTML = `<img id="header-logo" src="${currentLogo}" alt="Bingo Show Logo" class="w-full h-full object-contain filter drop-shadow-lg scale-110 active:scale-95 transition-transform duration-300">`;
    
    // Atualização do preview nas configurações (se aberto)
    const settingsPreview = document.getElementById('custom-logo-preview') as HTMLImageElement;
    if (settingsPreview) {
        settingsPreview.src = currentLogo;
    }
}

function renderShortcutsLegend() {
    const container = document.getElementById('shortcuts-legend-list');
    if (!container) return;

    container.innerHTML = ''; 

    const shortcutMap: { [key in keyof typeof appStore.state.appConfig.shortcuts]: keyof typeof appStore.state.appLabels } = {
        autoDraw: 'shortcutLabelAutoDraw',
        verify: 'shortcutLabelVerify',
        clearRound: 'shortcutLabelClearRound',
        drawPrize: 'shortcutLabelDrawPrize',
        registerPrize: 'shortcutLabelRegisterPrize',
        sellAuction: 'shortcutLabelSellAuction',
        showInterval: 'shortcutLabelShowInterval',
    };

    for (const key in appStore.state.appConfig.shortcuts) {
        const shortcutKey = key as keyof typeof appStore.state.appConfig.shortcuts;
        const labelKey = shortcutMap[shortcutKey];
        if (labelKey && appStore.state.appLabels[labelKey]) {
            const legendItem = document.createElement('li');
            legendItem.className = 'flex justify-between items-center';
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = `${appStore.state.appLabels[labelKey]}:`;

            const keySpan = document.createElement('span');
            keySpan.className = 'font-mono bg-gray-700 text-sky-300 rounded px-2 py-1';
            keySpan.textContent = appStore.state.appConfig.shortcuts[shortcutKey];

            legendItem.appendChild(labelSpan);
            legendItem.appendChild(keySpan);
            container.appendChild(legendItem);
        }
    }
}


function updateAuctionBidDisplay(bid: number) {
    const displayEl = document.getElementById('auction-current-bid-display');
    if (displayEl) {
        displayEl.textContent = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(bid);
        displayEl.classList.remove('animate-bid-flash');
        void displayEl.offsetWidth; 
        displayEl.classList.add('animate-bid-flash');
    }
}

function incrementAuctionBid(amount: number) {
    if (appStore.state.appConfig.enableSoundEffects) sounds.playBid();
    const bidInput = document.getElementById('auction-item-current-bid') as HTMLInputElement;
    if (bidInput) {
        const currentBid = parseInt(bidInput.value, 10) || 0;
        let newBid = currentBid + amount;
        if (newBid < 0) newBid = 0;
        bidInput.value = newBid.toString();
        appStore.state.appConfig.auctionBid = newBid.toString();
        appStore.debouncedSave();
        updateAuctionBidDisplay(newBid);

        const actualAmountAdded = newBid - currentBid;

        const feedbackContainer = document.getElementById('bid-feedback-container');
        if (feedbackContainer && actualAmountAdded !== 0) {
            const feedbackEl = document.createElement('span');
            const isPositive = actualAmountAdded > 0;
            feedbackEl.textContent = `${isPositive ? '+' : ''} ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(actualAmountAdded)}`;
            feedbackEl.className = `bid-feedback-animation ${isPositive ? 'text-green-400' : 'text-red-500'}`;
            feedbackContainer.appendChild(feedbackEl);
            setTimeout(() => feedbackEl.remove(), 1000); 
        }
    }
}


function populateSettingsLabelsTab() {
    const container = document.getElementById('labels-form-container');
    if (!container) return;

    container.innerHTML = '';

    const keysToExclude = ['prize1Label', 'prize2Label', 'prize3Label'];

    Object.keys(appStore.state.appLabels).forEach(key => {
        if (keysToExclude.includes(key)) return;

        const labelKey = key as keyof typeof appStore.state.appLabels;

        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col';

        const label = document.createElement('label');
        label.htmlFor = `label-input-${labelKey}`;
        label.className = 'text-sm font-bold text-slate-600 dark:text-slate-400 mb-1';
        label.textContent = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `label-input-${labelKey}`;
        input.value = appStore.state.appLabels[labelKey];
        input.className = 'bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm focus:ring-sky-500 focus:border-sky-500';

        input.addEventListener('change', (e) => {
            appStore.state.appLabels[labelKey] = (e.target as HTMLInputElement).value;
            appStore.debouncedSave();
        });

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        container.appendChild(wrapper);
    });
}

function populateSettingsShortcutsTab() {
    const container = document.getElementById('shortcuts-form-container');
    if (!container) return;

    container.innerHTML = '';

    const shortcutMap: { [key in keyof typeof appStore.state.appConfig.shortcuts]: keyof typeof appStore.state.appLabels } = {
        autoDraw: 'shortcutLabelAutoDraw',
        verify: 'shortcutLabelVerify',
        clearRound: 'shortcutLabelClearRound',
        drawPrize: 'shortcutLabelDrawPrize',
        registerPrize: 'shortcutLabelRegisterPrize',
        sellAuction: 'shortcutLabelSellAuction',
        showInterval: 'shortcutLabelShowInterval',
    };

    Object.keys(appStore.state.appConfig.shortcuts).forEach(key => {
        const shortcutKey = key as keyof typeof appStore.state.appConfig.shortcuts;
        const labelKey = shortcutMap[shortcutKey];

        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between';

        const label = document.createElement('label');
        label.htmlFor = `shortcut-input-${shortcutKey}`;
        label.className = 'text-base font-medium text-slate-700 dark:text-slate-300 mb-1 sm:mb-0';
        label.textContent = appStore.state.appLabels[labelKey];

        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = true;
        input.id = `shortcut-input-${shortcutKey}`;
        input.value = appStore.state.appConfig.shortcuts[shortcutKey];
        input.className = 'bg-gray-900 text-center text-sky-300 font-mono p-2 rounded-lg text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none cursor-pointer w-full sm:w-auto';

        input.addEventListener('focus', () => {
            input.value = 'Pressione a nova tecla...';
        });
        input.addEventListener('blur', () => {
            input.value = appStore.state.appConfig.shortcuts[shortcutKey];
        });

        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                return;
            }

            let shortcutString = '';
            if (e.ctrlKey) shortcutString += 'Control+';
            if (e.altKey) shortcutString += 'Alt+';
            if (e.shiftKey) shortcutString += 'Shift+';
            
            let key = e.key;
            if (key === ' ') {
                key = 'Space';
            } else if (key.length === 1) {
                key = key.toUpperCase();
            } else {
                key = key.charAt(0).toUpperCase() + key.slice(1);
            }
            
            shortcutString += key;
            
            input.value = shortcutString;
            appStore.state.appConfig.shortcuts[shortcutKey] = shortcutString;
            renderShortcutsLegend();
            appStore.debouncedSave();
            input.blur(); 
        });


        wrapper.appendChild(label);
        wrapper.appendChild(input);
        container.appendChild(wrapper);
    });
}
        // --- Funções de Template HTML ---
        function getModalTemplates() {
            const { appLabels } = appStore.state;
            return {
                verification: `<div id="verification-modal-content" class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-7xl w-full text-center flex flex-col h-[90vh]">
                                   <div class="flex-shrink-0 flex justify-between items-center mb-2">
                                       <h2 class="text-3xl font-bold text-gray-900 dark:text-white" data-label-key="verificationModalTitle">${appLabels.verificationModalTitle}</h2>
                                       <div class="flex items-center gap-2">
                                           <button id="zoom-out-btn-verification" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">-</button>
                                           <span id="verification-zoom-value" class="font-bold text-lg w-16 text-center">100%</span>
                                           <button id="zoom-in-btn-verification" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">+</button>
                                       </div>
                                   </div>
                                   <div class="flex-grow overflow-hidden -mx-4">
                                       <div id="verification-numbers-wrapper" class="h-full overflow-y-auto px-4">
                                           <div id="verification-numbers" class="flex flex-wrap gap-4 justify-center items-start content-start"></div>
                                       </div>
                                   </div>
                                   <div class="flex justify-center gap-4 flex-wrap mt-6 flex-shrink-0">
                                       <button id="confirm-prize1-btn" class="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-8 rounded-full text-lg disabled:opacity-50 disabled:cursor-not-allowed">1: ${appLabels.prize1Label}</button>
                                       <button id="confirm-prize2-btn" class="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-full text-lg disabled:opacity-50 disabled:cursor-not-allowed">2: ${appLabels.prize2Label}</button>
                                       <button id="confirm-prize3-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-full text-lg disabled:opacity-50 disabled:cursor-not-allowed">3: ${appLabels.prize3Label}</button>
                                       <button id="reject-bingo-btn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full text-lg mt-2 sm:mt-0" data-label-key="verificationModalBackButton">${appLabels.verificationModalBackButton}</button>
                                   </div>
                               </div>`,
                floatingNumber: `<div class="modal-content text-center flex flex-col items-center justify-center p-4">
                                    <div id="floating-number-display-wrapper" class="transition-transform duration-300 flex items-center justify-center" style="width: 420px; height: 420px;">
                                        <div id="floating-number-display" class="font-black text-gray-900 dark:text-white flex justify-center items-center w-full h-full gap-x-2 sm:gap-x-4 mx-auto rounded-full shadow-inner my-4 animate-bounce-in" style="font-size: 240px; line-height: 1; text-shadow: 2px 2px 5px #000;"></div>
                                    </div>
                                    <div class="flex-shrink-0 mt-4 flex flex-col items-center z-10">
                                        <div class="my-2 max-w-xs mx-auto w-full flex items-center justify-center gap-2">
                                           <button id="zoom-out-btn-floating" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">-</button>
                                           <span id="floating-number-zoom-value" class="font-bold text-lg w-16 text-center">100%</span>
                                           <button id="zoom-in-btn-floating" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">+</button>
                                       </div>
                                        <div class="flex items-center justify-center gap-4 mt-2">
                                           <button id="cancel-floating-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-full text-base">${appLabels.modalBackButton}</button>
                                           <button id="confirm-floating-btn" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-full text-base">${appLabels.announceButton}</button>
                                       </div>
                                    </div>
                                </div>`,
                sponsorDisplay: `<div class="modal-content text-center flex flex-col items-center justify-center p-4 m-auto w-full">
                                    <div id="sponsor-display-content-wrapper" class="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl transition-transform duration-300 w-full max-w-7xl relative">
                                        <div id="sponsor-display-content" class="flex flex-col items-center justify-center h-full relative">
                                            <div id="sponsor-info-display" class="flex flex-col items-center justify-center animate-fade-in-up p-4 w-full h-full min-h-[50vh]">
                                                <img id="sponsor-image" src="" class="w-full max-w-[1200px] max-h-[70vh] object-contain rounded-lg shadow-lg mb-6">
                                                <p id="sponsor-name" class="font-bold text-amber-400 text-[52px]"></p>
                                            </div>
                                            <div id="sponsor-number-zoom-wrapper" class="absolute top-4 left-4 origin-top-left">
                                                <div id="sponsor-number-display" class="font-black text-gray-900 dark:text-white flex justify-center items-center gap-x-2 rounded-full shadow-lg animate-bounce-in w-[150px] h-[150px] text-[80px]"></div>
                                            </div>
                                            <div id="sponsor-countdown-wrapper" class="absolute top-4 right-4 hidden">
                                                <div class="relative w-[100px] h-[100px] flex items-center justify-center">
                                                    <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                                                        <circle cx="50" cy="50" r="45" class="text-gray-200 dark:text-gray-700 stroke-current" stroke-width="10" fill="transparent"></circle>
                                                        <circle id="sponsor-countdown-circle" cx="50" cy="50" r="45" class="text-amber-500 stroke-current transition-all duration-1000 ease-linear" stroke-width="10" fill="transparent" stroke-dasharray="283" stroke-dashoffset="0"></circle>
                                                    </svg>
                                                    <span id="sponsor-countdown-text" class="absolute text-3xl font-bold text-gray-700 dark:text-white"></span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex-shrink-0 mt-4 flex flex-col items-center z-10">
                                         <div class="my-2 mx-auto w-full flex flex-row flex-wrap items-center justify-center gap-6">
                                           <div class="flex items-center gap-2">
                                               <span class="text-sm font-bold text-slate-400 text-right">Geral:</span>
                                               <button id="zoom-out-btn-sponsor" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">-</button>
                                               <span id="sponsor-display-zoom-value" class="font-bold text-lg w-16 text-center">100%</span>
                                               <button id="zoom-in-btn-sponsor" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">+</button>
                                           </div>
                                           <div class="flex items-center gap-2">
                                               <span class="text-sm font-bold text-slate-400 text-right">Número:</span>
                                               <button id="zoom-out-btn-sponsor-number" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">-</button>
                                               <span id="sponsor-number-zoom-value" class="font-bold text-lg w-16 text-center">100%</span>
                                               <button id="zoom-in-btn-sponsor-number" class="bg-gray-200 dark:bg-gray-700 w-10 h-10 rounded-full font-bold text-2xl">+</button>
                                           </div>
                                           <div class="flex items-center gap-2">
                                               <span class="text-sm font-bold text-slate-400">Tempo:</span>
                                               <button class="sponsor-speed-btn bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors" data-speed="5">5s</button>
                                               <button class="sponsor-speed-btn bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors" data-speed="8">8s</button>
                                               <button class="sponsor-speed-btn bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors" data-speed="10">10s</button>
                                               <button class="sponsor-speed-btn bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors" data-speed="15">15s</button>
                                           </div>
                                       </div>
                                        <div class="flex items-center justify-center gap-4 mt-2">
                                           <button id="cancel-sponsor-display-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-full text-base">${appLabels.modalBackButton}</button>
                                           <button id="confirm-sponsor-display-btn" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-full text-base">${appLabels.announceButton}</button>
                                       </div>
                                    </div>
                                </div>`,
                winner: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full text-center relative">
                            <div id="winner-countdown-timer" class="absolute top-4 right-4 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-full w-12 h-12 flex items-center justify-center font-bold text-xl border-2 border-sky-500">20</div>
                            <h1 id="winner-title-display" class="text-7xl sm:text-8xl font-black text-amber-400" style="text-shadow: 0 0 20px #f59e0b;"></h1>
                            <div id="winner-prize-display" class="my-6">
                                <p id="game-text-winner" class="text-2xl font-bold text-sky-400"></p>
                                <p id="prize-text-winner" class="text-3xl font-bold text-yellow-400 mt-1"></p>
                            </div>
                            <input type="text" id="winner-name-input" placeholder="${appLabels.winnerModalNamePlaceholder}" class="w-full text-center text-2xl font-bold p-4 border-2 border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                            <button id="register-winner-btn" class="mt-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 px-10 rounded-full text-xl">${appLabels.winnerModalRegisterButton}</button>
                            <p class="text-xs text-slate-600 dark:text-slate-400 mt-4">Pressione ENTER para registrar ou ESC para cancelar</p>
                         </div>`,
                alert: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center"><h2 class="text-2xl font-bold text-red-500 mb-4">${appLabels.alertModalTitle}</h2><p id="custom-alert-message" class="text-slate-700 dark:text-slate-300 text-lg"></p><button id="custom-alert-close-btn" class="mt-8 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.alertModalOkButton}</button></div>`,
                congrats: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full text-center"><h2 class="text-5xl font-black text-yellow-400">${appLabels.congratsModalTitle}</h2><div id="congrats-winner-name" contenteditable="true" class="text-4xl font-bold text-gray-900 dark:text-white my-4 focus:outline-none focus:ring-2 ring-amber-500 rounded-lg px-2"></div><div id="congrats-prize-value" contenteditable="true" class="text-2xl text-slate-700 dark:text-slate-300 mb-6 focus:outline-none focus:ring-2 ring-amber-500 rounded-lg px-2"></div><p class="text-2xl text-sky-300 mt-4">${appLabels.congratsModalMessage}</p><button id="close-congrats-modal-btn" class="mt-8 bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-8 rounded-full text-lg">${appLabels.congratsModalCloseButton}</button></div>`,
                eventBreak: `<div class="modal-content bg-white dark:bg-gray-800/90 backdrop-blur-sm p-8 rounded-2xl shadow-2xl w-full h-full text-center flex flex-col justify-between">
                                <header class="flex-shrink-0">
                                    <h2 id="event-break-title" class="text-6xl font-black text-sky-600 dark:text-sky-400">${appLabels.intervalModalTitle}</h2>
                                </header>
                                <main class="flex-grow my-8 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-hidden relative z-10 min-h-0">
                                    <div id="break-left-column" class="flex flex-col items-center bg-black/5 dark:bg-black/20 p-6 rounded-xl h-full overflow-hidden min-h-0">
                                        <h3 id="break-left-title" class="text-5xl font-bold text-amber-600 dark:text-amber-400 mb-6 flex-shrink-0">Cardápio</h3>
                                        <div id="break-left-content" class="flex-grow w-full h-full flex items-center justify-center text-7xl font-black text-slate-800 dark:text-white text-center transition-opacity duration-500 opacity-0 min-h-0"></div>
                                    </div>
                                    <div id="break-right-column" class="flex flex-col items-center bg-black/5 dark:bg-black/20 p-6 rounded-xl h-full overflow-hidden relative min-h-0">
                                        <div class="flex items-center justify-between w-full mb-6 flex-shrink-0">
                                            <div class="w-12"></div>
                                            <h3 id="break-right-title" class="text-5xl font-bold text-amber-600 dark:text-amber-400">Apoio</h3>
                                            <button id="toggle-sponsors-fullscreen-btn" class="w-12 h-12 bg-slate-700 hover:bg-slate-600 rounded-full flex items-center justify-center text-white cursor-pointer z-20 transition-colors" title="Tela Cheia">
                                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-6 h-6">
                                                   <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                                                 </svg>
                                             </button>
                                        </div>
                                        <div id="break-right-content" class="flex-grow w-full h-full flex items-center justify-center transition-opacity duration-500 opacity-0 min-h-0"></div>
                                    </div>
                                </main>
                                <footer class="flex-shrink-0 flex justify-between items-center w-full relative z-10">
                                    <div id="break-clock" class="text-4xl font-bold text-slate-700 dark:text-slate-300"></div>
                                    <div class="flex items-center gap-3">
                                        <button id="open-interval-qr-btn" class="bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 px-6 rounded-full text-lg flex items-center gap-2 shadow-lg transition-all hover:scale-105 cursor-pointer">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                            </svg>
                                            <span>📱 QR Code (Ao Vivo / PIX)</span>
                                        </button>
                                        <button id="close-break-modal-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-8 rounded-full text-lg cursor-pointer">${appLabels.modalBackButton}</button>
                                    </div>
                                </footer>
                             </div>`,
                intervalQr: `<div class="modal-content bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-2xl shadow-2xl max-w-4xl w-full text-center relative border border-slate-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
    <div class="flex items-center justify-between border-b border-slate-200 dark:border-gray-700 pb-4 mb-6">
        <div class="text-left">
            <h2 class="text-2xl sm:text-3xl font-black text-amber-500 dark:text-amber-400">📱 Interatividade no Intervalo</h2>
            <p class="text-xs sm:text-sm text-slate-500 dark:text-slate-400">Acompanhe pelo celular ou ajude a instituição com doações</p>
        </div>
        <button id="close-interval-qr-x-btn" class="text-slate-400 hover:text-slate-600 dark:hover:text-white text-3xl font-bold cursor-pointer px-2 leading-none">&times;</button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
        <!-- CARD 1: ACOMPANHAR AO VIVO -->
        <div class="bg-indigo-50 dark:bg-gray-900/60 p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 flex flex-col items-center text-center shadow-sm">
            <span class="inline-block bg-indigo-600 text-white font-bold text-xs px-3 py-1 rounded-full mb-3">AO VIVO NO CELULAR</span>
            <h3 class="text-xl font-bold text-slate-800 dark:text-white mb-2">Acompanhar o Evento</h3>
            <p class="text-xs text-slate-600 dark:text-slate-300 mb-4">Aponte a câmera do celular para ver o painel e sorteios em tempo real:</p>
            
            <div id="interval-live-qr-box" class="bg-white p-3 rounded-xl shadow-md border border-slate-200 dark:border-gray-700 mb-3 flex items-center justify-center min-h-[190px] w-[200px]">
                <img id="interval-live-qr-img" src="" alt="QR Code Ao Vivo" class="w-44 h-44 object-contain hidden" />
                <div id="interval-live-qr-loading" class="text-xs text-indigo-600 dark:text-indigo-400 font-semibold flex flex-col items-center gap-2">
                    <span class="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                    Gerando QR Code...
                </div>
            </div>

            <p id="interval-live-url-text" class="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 truncate max-w-full px-2 mb-3 bg-white dark:bg-gray-800 py-1.5 rounded w-full border border-indigo-200 dark:border-indigo-900 select-all cursor-text">
                ...
            </p>

            <button id="interval-copy-live-url-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow">
                📋 Copiar Link Ao Vivo
            </button>
        </div>

        <!-- CARD 2: DOAÇÃO PIX -->
        <div class="bg-emerald-50 dark:bg-gray-900/60 p-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 flex flex-col items-center text-center shadow-sm">
            <span class="inline-block bg-emerald-600 text-white font-bold text-xs px-3 py-1 rounded-full mb-3">DOAÇÃO INSTITUIÇÃO</span>
            <h3 id="interval-pix-title-display" class="text-xl font-bold text-slate-800 dark:text-white mb-2">Doação via PIX</h3>
            <p class="text-xs text-slate-600 dark:text-slate-300 mb-4">Ajude nossa instituição escaneando o QR Code abaixo com seu aplicativo do banco:</p>
            
            <div id="interval-pix-qr-box" class="bg-white p-3 rounded-xl shadow-md border border-slate-200 dark:border-gray-700 mb-3 flex items-center justify-center min-h-[190px] w-[200px]">
                <img id="interval-pix-qr-img" src="" alt="QR Code PIX" class="w-44 h-44 object-contain hidden" />
                <div id="interval-pix-qr-placeholder" class="text-xs text-slate-500 dark:text-slate-400 text-center p-2 hidden">
                    Nenhum QR Code do PIX cadastrado nas configurações.
                </div>
            </div>

            <div class="w-full space-y-2">
                <div id="interval-pix-key-box" class="text-xs font-mono bg-white dark:bg-gray-800 text-slate-800 dark:text-emerald-300 p-2 rounded-lg border border-slate-200 dark:border-gray-700 truncate select-all cursor-text text-center">
                </div>

                <button id="interval-copy-pix-key-btn" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow">
                    📋 Copiar Chave PIX
                </button>
            </div>
        </div>
    </div>

    <div class="mt-6 text-center">
        <button id="close-interval-qr-footer-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2.5 px-8 rounded-full text-sm cursor-pointer shadow transition-all">
            Voltar ao Intervalo
        </button>
    </div>
</div>`,
                menuEdit: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full"><h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-4">${appLabels.menuEditModalTitle}</h2><p class="text-slate-600 dark:text-slate-400 mb-4">${appLabels.menuEditModalDescription}</p><textarea id="menu-textarea" class="w-full h-48 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-3 border border-slate-300 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"></textarea><div class="flex justify-end gap-4 mt-4"><button id="cancel-menu-edit-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalCancelButton}</button><button id="save-menu-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalSaveButton}</button></div></div>`,
                winnerEdit: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full"><h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">${appLabels.winnerEditModalTitle}</h2><div class="space-y-4"><input type="text" id="edit-winner-name" placeholder="${appLabels.winnerEditModalNamePlaceholder}" class="w-full text-center text-xl font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"><input type="text" id="edit-winner-prize" placeholder="${appLabels.winnerEditModalPrizePlaceholder}" class="w-full text-center text-xl font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"></div><div class="flex justify-between items-center mt-8 gap-4"><button id="remove-winner-btn" class="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-6 rounded-full">${appLabels.winnerEditModalRemoveButton}</button><div><button id="cancel-winner-edit-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalCancelButton}</button><button id="save-winner-changes-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-full ml-2">${appLabels.modalSaveButton}</button></div></div></div>`,
                deleteConfirm: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center"><h2 class="text-2xl font-bold text-yellow-400 mb-4">${appLabels.deleteConfirmModalTitle}</h2><p id="delete-confirm-message" class="text-slate-700 dark:text-slate-300 text-lg mb-8"></p><div class="flex justify-center gap-4"><button id="cancel-delete-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.modalCancelButton}</button><button id="confirm-delete-btn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.deleteConfirmModalDeleteButton}</button></div></div>`,
                clearRoundConfirm: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
                                       <h2 class="text-2xl font-bold text-yellow-400 mb-4" data-label-key="clearRoundConfirmTitle">${appLabels.clearRoundConfirmTitle}</h2>
                                       <p class="text-slate-700 dark:text-slate-300 text-lg mb-8" data-label-key="clearRoundConfirmMessage">${appLabels.clearRoundConfirmMessage}</p>
                                       <div class="flex justify-center gap-4">
                                           <button id="cancel-clear-round-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-lg" data-label-key="clearRoundCancelButton">${appLabels.clearRoundCancelButton}</button>
                                           <button id="confirm-clear-round-btn" class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-6 rounded-full text-lg" data-label-key="clearRoundConfirmButton">${appLabels.clearRoundConfirmButton}</button>
                                       </div>
                                   </div>`,
                proofOptions: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full"><h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-6">${appLabels.proofOptionsModalTitle}</h2><p class="text-slate-600 dark:text-slate-400 mb-4">${appLabels.proofOptionsModalDescription}</p><div id="proof-options-list" class="space-y-2 max-h-60 overflow-y-auto mb-4"></div><div class="mb-6"><label for="proof-signer-name" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Responsável pela Assinatura</label><input type="text" id="proof-signer-name" placeholder="Ex: João da Silva" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500 outline-none"></div><div class="flex justify-end gap-4 mt-6"><button id="cancel-proof-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalCancelButton}</button><button id="generate-selected-proof-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.proofOptionsModalGenerateButton}</button></div></div>`,
                spinningWheel: `<div class="w-full h-full max-w-3xl max-h-[40rem] relative flex items-center justify-center"><div id="bingo-cage" class="w-full h-full absolute spinning-cage"><div id="number-cyclone" class="absolute w-full h-full transform-gpu"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(0deg) translateZ(0px);"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(30deg) translateZ(0px);"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(60deg) translateZ(0px);"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(90deg) translateZ(0px);"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(120deg) translateZ(0px);"></div><div class="absolute w-full h-full border-8 border-gray-500 rounded-full" style="transform: rotateY(150deg) translateZ(0px);"></div></div><div id="drawn-ball-container" class="z-10 opacity-0"></div></div><div class="absolute bottom-10 flex gap-4"><button id="skip-animation-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.spinningWheelSkipButton}</button><button id="close-drawn-btn" class="hidden bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.modalBackButton}</button></div>`,
                resetConfirm: `<div class="modal-content bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-3xl shadow-2xl max-w-md w-full text-center border-2 border-red-500/30"><div class="w-16 h-16 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-inner">⚠️</div><h2 class="text-2xl font-black text-red-600 dark:text-red-400 mb-2">${appLabels.resetConfirmModalTitle}</h2><p class="text-slate-700 dark:text-slate-300 text-sm sm:text-base mb-4 leading-relaxed">${appLabels.resetConfirmModalMessage}</p><div class="bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/60 rounded-2xl p-4 mb-6 text-left shadow-sm"><div class="flex items-start gap-2.5"><span class="text-xl leading-none">🛡️</span><div><h4 class="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300 mb-1">Aviso Importante: Faça um Backup</h4><p class="text-xs text-amber-800 dark:text-amber-400 leading-snug">Para não perder suas configurações, rodadas e patrocinadores, salve uma cópia de segurança antes de apagar tudo.</p><button type="button" id="backup-before-reset-btn" class="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg shadow transition cursor-pointer">💾 Baixar Backup (Salvar no PC)</button></div></div></div><div class="flex flex-col sm:flex-row justify-center gap-3"><button id="cancel-reset-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm transition cursor-pointer">${appLabels.modalCancelButton}</button><button id="confirm-reset-btn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm transition shadow-lg cursor-pointer">${appLabels.resetConfirmModalConfirmButton}</button></div></div>`,
                drawnPrizes: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full text-center flex flex-col h-[70vh]">
                                <h2 id="drawn-prizes-title" class="text-3xl font-bold text-gray-900 dark:text-white flex-shrink-0">${appLabels.drawnPrizesModalTitle}</h2>
                                <p id="drawn-prizes-subtitle" class="text-xl font-bold text-amber-400 mb-4 flex-shrink-0"></p>
                                
                                <div class="mb-6 flex-shrink-0">
                                    <h3 class="text-lg font-semibold text-sky-400 mb-2">Última Cartela Sorteada</h3>
                                    <div id="last-drawn-prize-display" class="flex justify-center items-center">
                                        <!-- O último número sorteado será inserido aqui -->
                                    </div>
                                </div>

                                <div class="flex-grow flex flex-col min-h-0">
                                    <h3 class="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2 flex-shrink-0">Histórico de Sorteios</h3>
                                    <div id="drawn-prizes-history-list" class="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 flex-grow overflow-y-auto flex flex-wrap gap-3 justify-center content-start">
                                        <!-- O histórico de números será inserido aqui -->
                                    </div>
                                </div>
                                
                                <button id="close-drawn-prizes-btn" class="mt-6 bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-8 rounded-full text-lg flex-shrink-0">${appLabels.modalCloseButton}</button>
                             </div>`,
                donation: `<div class="modal-content bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
                                <div class="w-12 h-12 bg-amber-100 dark:bg-amber-900/40 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">🤝</div>
                                <h2 id="institution-pix-title" class="text-2xl sm:text-3xl font-black text-amber-500 dark:text-amber-400 mb-2">${appLabels.donationModalTitle}</h2>
                                <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mb-4">${appLabels.donationModalDescription}</p>
                                <div class="space-y-4 text-left">
                                    <div class="pt-2 border-t border-slate-200 dark:border-gray-700">
                                        <p class="text-xs sm:text-sm font-bold text-gray-900 dark:text-white mb-2 text-center">${appLabels.donationModalPixLabel}</p>
                                        <div class="flex flex-col items-center">
                                            <div class="bg-white p-2 rounded-xl shadow border border-slate-200 dark:border-gray-700 mb-3 flex items-center justify-center min-h-[140px] w-[150px]">
                                                <img id="institution-pix-qr-img" src="" alt="QR Code PIX" class="w-32 h-32 object-contain hidden" />
                                                <div id="institution-pix-qr-placeholder" class="text-xs text-slate-400 text-center p-2 hidden">
                                                    Carregando QR Code...
                                                </div>
                                            </div>
                                            <div id="pix-key-display" contenteditable="false" class="w-full bg-slate-100 dark:bg-gray-700 text-slate-800 dark:text-white p-2.5 rounded-lg text-center text-xs font-mono select-all cursor-text border border-slate-200 dark:border-gray-600 truncate mb-2"></div>
                                            <button id="copy-pix-btn" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-lg text-xs transition-all shadow flex items-center justify-center gap-1.5 cursor-pointer">${appLabels.donationModalCopyButton}</button>
                                        </div>
                                    </div>
                                </div>
                                <button id="close-donation-btn" class="mt-6 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-base cursor-pointer shadow">${appLabels.modalCloseButton}</button>
                             </div>`,
                finalWinners: `<div class="modal-content bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-2xl shadow-2xl max-w-5xl w-full text-center h-[95vh] flex flex-col justify-between overflow-y-auto">
                                <h2 id="end-title" class="text-4xl sm:text-5xl font-black text-yellow-400 mb-3 flex-shrink-0 [-webkit-text-stroke:2px_#b45309] drop-shadow-md">${appLabels.finalWinnersModalTitle}</h2>
                                <div id="end-winner-display" class="flex-grow flex items-center justify-center p-2 min-h-[140px]">
                                    <div id="current-winner-card" class="bg-gray-200 dark:bg-gray-700 p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-2xl text-center transform scale-90 opacity-0 transition-all duration-500"></div>
                                </div>
                                <!-- Seção de Patrocinadores e QR Code PIX da Instituição -->
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 flex-shrink-0 my-3 min-h-0 text-left">
                                    <div id="final-sponsors-section" class="flex flex-col items-center bg-gray-100 dark:bg-gray-900/50 p-4 rounded-xl border border-slate-200 dark:border-gray-700/50 shadow-inner">
                                        <h3 class="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">Agradecimento aos Patrocinadores</h3>
                                        <div id="final-sponsors-list" class="h-44 md:h-52 w-full flex flex-col items-center justify-center transition-all duration-500 overflow-hidden"></div>
                                    </div>
                                    <div id="final-pix-section" class="flex flex-col items-center justify-center bg-emerald-50 dark:bg-gray-900/60 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 text-center shadow-sm">
                                        <span class="inline-block bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full mb-1">Apoio com PIX</span>
                                        <h3 id="final-pix-title" class="text-lg font-bold text-slate-800 dark:text-white mb-1">Apoie a Instituição</h3>
                                        <p class="text-xs text-slate-600 dark:text-slate-300 mb-2">Escaneie o QR Code no seu aplicativo do banco para contribuir:</p>
                                        <div class="bg-white p-2 rounded-xl shadow border border-slate-200 dark:border-gray-700 mb-2 flex items-center justify-center min-h-[130px] w-[140px]">
                                            <img id="final-pix-qr-img" src="" alt="QR Code PIX Instituição" class="w-28 h-28 object-contain hidden" />
                                            <div id="final-pix-qr-placeholder" class="text-xs text-slate-500 dark:text-slate-400 p-2 hidden">
                                                Carregando QR Code...
                                            </div>
                                        </div>
                                        <div id="final-pix-key-box" class="text-xs font-mono bg-white dark:bg-gray-800 text-slate-800 dark:text-emerald-300 px-3 py-1 rounded-lg border border-slate-200 dark:border-gray-700 truncate max-w-full select-all cursor-text mb-2 hidden">
                                        </div>
                                        <button id="final-copy-pix-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 px-4 rounded-lg text-xs transition-all shadow hidden cursor-pointer flex items-center justify-center gap-1">
                                            📋 Copiar Chave PIX
                                        </button>
                                    </div>
                                </div>
                                <div class="mt-2 flex flex-col items-center gap-2 flex-shrink-0">
                                    <div class="flex justify-center gap-4 w-full max-w-md">
                                        <button id="generate-proof-final-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-8 rounded-full text-base cursor-pointer shadow">${appLabels.finalWinnersModalProofButton}</button>
                                        <button id="close-final-modal-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-8 rounded-full text-base cursor-pointer shadow">${appLabels.modalCloseButton}</button>
                                    </div>
                                    <button id="donation-final-btn" class="mt-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg text-xs transition-all shadow w-full max-w-xs cursor-pointer">${appLabels.finalWinnersModalSupportButton}</button>
                                </div>
                               </div>`,
                changelog: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col h-[90vh]">
                               <h2 class="text-3xl font-black text-gray-900 dark:text-white mb-2 flex-shrink-0">${appLabels.changelogModalTitle}</h2>
                               <p class="text-xl font-bold text-sky-400 mb-4 flex-shrink-0">${appLabels.changelogModalCurrentVersionLabel} ${currentVersion}</p>
                               <div id="version-history-content" class="flex-grow w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-4 rounded-lg overflow-y-auto text-sm leading-snug"></div>
                               <div class="flex justify-end gap-4 mt-4 flex-shrink-0">
                                   <button id="close-changelog-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalCloseButton}</button>
                               </div>
                           </div>`,
                loadOptions: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">Opções de Carregamento</h2>
                    <div class="flex flex-col gap-4">
                        <label for="load-from-file-input" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-4 rounded-xl text-lg shadow-lg transition-all text-center cursor-pointer">
                            📂 Carregar Arquivo JSON
                        </label>
                        <button id="show-load-cloud-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl text-lg shadow-lg transition-all text-center">
                            ☁️ Carregar da Nuvem (ID)
                        </button>
                    </div>
                    <button id="close-load-options-btn" class="mt-8 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full text-lg">${appLabels.modalCloseButton}</button>
                </div>`,
                loadCloudPrompt: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">Carregar Evento</h2>
                    <p class="text-sm text-slate-600 dark:text-slate-400 mb-6">Digite o ID do evento para carregar os dados da nuvem.</p>
                    <input type="text" id="cloud-event-id-input" placeholder="ID do Evento" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-3 rounded-lg text-center font-mono font-bold mb-4 border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <input type="password" id="cloud-event-password-input" placeholder="Senha (se houver)" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-3 rounded-lg text-center font-bold mb-6 border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500 outline-none">
                    <div class="flex justify-between gap-2">
                        <button id="cancel-load-cloud-btn" class="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg">Cancelar</button>
                        <button id="confirm-load-cloud-btn" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2"><span id="cloud-load-spinner" class="hidden w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Carregar</button>
                    </div>
                </div>`,
                settings: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-4xl w-full">
                    <h2 class="text-3xl font-black text-amber-400 mb-4">${appLabels.settingsModalTitle}</h2>
                    
                    <div class="border-b border-gray-700 mb-4">
                        <nav class="-mb-px flex space-x-8" aria-label="Tabs">
                            <button id="tab-appearance" class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg border-sky-500 text-sky-400">${appLabels.settingsTabAppearance}</button>
                            <button id="tab-sponsors" class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500">${appLabels.settingsTabSponsors}</button>
                            <button id="tab-labels" class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500">${appLabels.settingsTabLabels}</button>
                            <button id="tab-shortcuts" class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500">${appLabels.settingsTabShortcuts}</button>
                            <button id="tab-security" class="whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500">Segurança</button>
                        </nav>
                    </div>

                    <div id="settings-content-container" class="max-h-[60vh] overflow-y-auto pr-4">
                        <div id="tab-content-security" class="hidden space-y-6 text-left">
                            <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">Usuários Bloqueados</h3>
                            <p class="text-sm text-slate-600 dark:text-slate-400 mb-4">Gerencie os usuários que foram bloqueados por falsos alertas de BINGO.</p>
                            <div id="blocked-users-list" class="space-y-2"></div>
                        </div>
                        <div id="tab-content-appearance" class="space-y-6 text-left">
                           <div class="border-b border-gray-700 pb-6">
                                <label class="block text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">Nome do Programa</label>
                                <input type="text" id="app-name-input" class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-indigo-500" placeholder="Bingo Show">
                           </div>
                           <div class="border-b border-gray-700 pb-6">
                                <label class="block text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">${appLabels.settingsLogoTitle}</label>
                                <p class="text-xs text-slate-600 dark:text-slate-400 mb-4">${appLabels.settingsLogoDescription}</p>
                                <div class="flex items-center gap-4">
                                    <img id="custom-logo-preview" src="" alt="Pré-visualização do Logo" class="w-24 h-24 bg-gray-200 dark:bg-gray-700 rounded-lg object-contain border border-gray-300 dark:border-gray-600">
                                    <div class="flex-grow">
                                        <label for="custom-logo-upload" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Selecione uma imagem</label>
                                        <input type="file" id="custom-logo-upload" accept="image/png, image/jpeg, image/gif, image/webp" class="block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100">
                                    </div>
                                </div>
                                <button id="remove-custom-logo-btn" class="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-lg text-sm">${appLabels.settingsLogoRemoveButton}</button>
                            </div>
                             <div class="border-b border-gray-700 pb-6">
                                <div class="flex items-center gap-3 bg-gray-200 dark:bg-gray-700 p-3 rounded-lg mb-4">
                                    <input type="checkbox" id="enable-sound-effects" class="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                                    <label for="enable-sound-effects" class="text-slate-800 dark:text-slate-200 font-medium">${appLabels.settingsSoundEffectsLabel}</label>
                                </div>
                            </div>
                             <div class="border-b border-gray-700 pb-6">
                                <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">${appLabels.settingsModalAutocloseTitle}</h3>
                                <div class="flex items-center gap-3 bg-gray-200 dark:bg-gray-700 p-3 rounded-lg mb-4">
                                    <input type="checkbox" id="enable-modal-autoclose" class="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                                    <label for="enable-modal-autoclose" class="text-slate-800 dark:text-slate-200 font-medium">${appLabels.settingsModalAutocloseEnable}</label>
                                </div>
                                <div>
                                    <label for="modal-autoclose-timer" class="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-1">${appLabels.settingsModalAutocloseTimeLabel} (<span id="modal-autoclose-value">5</span>s)</label>
                                    <input type="range" id="modal-autoclose-timer" min="3" max="15" value="5" class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg">
                                </div>
                            </div>
                            <div class="border-b border-slate-300 dark:border-gray-700 pb-6 mt-6">
                                <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">🎈 Etapa 2: Online Sync</h3>
                                <p class="text-sm text-slate-600 dark:text-slate-400 mb-2">Ative o modo Online para permitir que os jogadores acessem suas cartelas diretamente pelo celular escaneando o QR Code. Ao ativar, você precisará aguardar a sincronização (host online).</p>
                                
                                <div class="flex flex-col sm:flex-row gap-3 mb-4">
                                    <button id="host-login-facebook-btn" class="flex items-center justify-center gap-2 bg-[#1877F2] text-white hover:bg-[#166FE5] py-2 px-4 rounded-lg font-bold transition-colors shadow-sm">
                                        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                                        Logar Facebook
                                    </button>
                                    <button id="host-login-google-btn" class="flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 py-2 px-4 rounded-lg font-bold transition-colors shadow-sm">
                                        <svg class="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                                        Logar Google
                                    </button>
                                    <button id="host-logout-btn" class="hidden flex items-center justify-center gap-2 bg-red-600 text-white hover:bg-red-700 py-2 px-4 rounded-lg font-bold transition-colors shadow-sm">
                                        Desconectar
                                    </button>
                                </div>
                                <div id="host-user-info" class="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4 hidden"></div>

                                <div class="flex items-center gap-3 bg-indigo-100 dark:bg-indigo-900/50 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800 mb-2">
                                    <input type="checkbox" id="online-sync-toggle" class="h-5 w-5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500">
                                    <label for="online-sync-toggle" class="text-slate-800 dark:text-indigo-200 font-bold">Ativar Sincronização em Nuvem</label>
                                </div>
                                <div class="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/30 p-3 rounded-lg border border-indigo-100 dark:border-indigo-800/50 mb-4">
                                    <input type="checkbox" id="show-sponsors-mobile-toggle" class="h-5 w-5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500">
                                    <label for="show-sponsors-mobile-toggle" class="text-slate-800 dark:text-indigo-200 font-bold">Mostrar patrocinadores no celular do público</label>
                                </div>
                                <p class="text-xs text-red-600 dark:text-red-400 font-bold mb-4">⚠️ Aviso: Imagens e logos não são sincronizados na Nuvem. Para salvar as imagens em alta definição, salve o backup no computador (JSON).</p>
                                <h3 class="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">🔒 Senha do Evento (Opcional)</h3>
                                <p class="text-sm text-slate-600 dark:text-slate-400 mb-2">Para proteger seu evento, defina uma senha. Quem for carregar esse evento precisará digitá-la.</p>
                                <input type="text" id="event-password-input" placeholder="Digite uma senha..." class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-indigo-500">
                                
                                <div id="online-sync-status" class="mt-4 text-sm text-center hidden p-2 rounded max-w-sm ml-auto mr-auto break-all"></div>
                                <div class="text-center mt-3">
                                    <button id="force-sync-cards-btn" class="hidden text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors">
                                        Subir Cartelas Antigas para Nuvem
                                    </button>
                                </div>
                            </div>
                            <div class="border-b border-slate-300 dark:border-gray-700 pb-6 mt-6">
                                <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">Tema</h3>
                                <div class="flex items-center gap-3 bg-gray-200 dark:bg-gray-700 p-3 rounded-lg">
                                    <input type="checkbox" id="theme-toggle" class="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                                    <label for="theme-toggle" class="text-slate-800 dark:text-slate-200 font-medium">Modo Escuro (Desmarque para Modo Claro)</label>
                                </div>
                            </div>
                            <div class="border-b border-gray-700 pb-6">
                                <label class="block text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">${appLabels.settingsBingoTitleLabel}</label>
                                <p class="text-xs text-slate-600 dark:text-slate-400 mb-4">${appLabels.settingsBingoTitleDescription}</p>
                                <select id="bingo-title-select" class="w-full p-3 bg-gray-200 dark:bg-gray-700 text-white rounded-lg focus:ring-sky-500 focus:border-sky-500">
                                    <option value="BINGO">BINGO!</option>
                                    <option value="AJUDE">AJUDE!</option>
                                </select>
                            </div>
                            <div class="border-b border-gray-700 pb-6">
                                <label class="block text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">${appLabels.settingsBoardColorLabel}</label>
                                <p class="text-xs text-slate-600 dark:text-slate-400 mb-4">${appLabels.settingsBoardColorDescription}</p>
                                <div class="flex items-center justify-center gap-4">
                                     <input type="color" id="board-color-picker" class="w-12 h-12 p-1 border-2 border-gray-300 dark:border-gray-600 rounded-full cursor-pointer" value="#FFFFFF">
                                     <button id="reset-board-color-btn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all">${appLabels.settingsBoardColorResetButton}</button>
                                </div>
                            </div>
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-3">${appLabels.settingsDrawnNumberTitle}</h3>
                            <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-1">${appLabels.settingsDrawnTextColorLabel}</label>
                                <input type="color" id="drawn-text-color-picker" class="w-12 h-12 p-1 border-2 border-gray-300 dark:border-gray-600 rounded-full cursor-pointer" value="#FFFFFF">
                            </div>
                             <div>
                                <label class="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-1">${appLabels.settingsDrawnStrokeColorLabel}</label>
                                <input type="color" id="drawn-stroke-color-picker" class="w-12 h-12 p-1 border-2 border-gray-300 dark:border-gray-600 rounded-full cursor-pointer" value="#000000">
                            </div>
                            <div>
                                <label for="drawn-stroke-width-slider" class="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-1">${appLabels.settingsDrawnStrokeWidthLabel} (<span id="drawn-stroke-width-value">2</span>px)</label>
                                <input type="range" id="drawn-stroke-width-slider" min="0" max="10" value="2" class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg">
                            </div>

                            <div class="border-t border-slate-200 dark:border-gray-700 pt-6 mt-6">
                                <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">💚 Doações e QR Code PIX (Intervalo & Telão)</h3>
                                <p class="text-xs text-slate-600 dark:text-slate-400 mb-4">Personalize a chave e a imagem do QR Code PIX da instituição exibidos durante o intervalo.</p>
                                <div class="space-y-4">
                                    <div>
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Título / Nome da Instituição</label>
                                        <input type="text" id="pix-title-input" class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 text-sm" placeholder="Ex: Doação para a Paróquia / Instituição">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Chave PIX (Texto / Chave Aleatória / CPF / CNPJ / E-mail)</label>
                                        <input type="text" id="pix-key-input" class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 text-sm font-mono" placeholder="Ex: paroquiadelutecia@gmail.com">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Imagem do QR Code PIX (Upload)</label>
                                        <p class="text-xs text-slate-500 dark:text-slate-400 mb-2">Faça upload da imagem do seu banco (se não enviar imagem, o QR Code será gerado automaticamente a partir da chave):</p>
                                        <div class="flex items-center gap-4">
                                            <img id="pix-qr-preview" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Pré-visualização QR Code PIX" class="w-24 h-24 bg-gray-100 dark:bg-gray-700 rounded-lg object-contain border border-gray-300 dark:border-gray-600">
                                            <div class="flex-grow">
                                                <input type="file" id="pix-qr-upload" accept="image/png, image/jpeg, image/webp" class="block w-full text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100">
                                                <button id="remove-pix-qr-btn" class="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-lg text-xs cursor-pointer">Remover Imagem do QR Code</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <!-- DEV PIX SETTINGS -->
                                <div class="border border-emerald-300 dark:border-emerald-700 p-4 rounded-xl space-y-4 mt-4">
                                    <h4 class="font-bold text-emerald-600 dark:text-emerald-400">Doação para o Projeto Bingo Show (Programador)</h4>
                                    <div>
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Chave PIX do Desenvolvedor</label>
                                        <input type="text" id="dev-pix-key-input" class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 text-sm font-mono" placeholder="Ex: e-mail ou chave aleatória">
                                    </div>
                                    <div>
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Imagem do QR Code PIX (Upload)</label>
                                        <div class="flex items-center gap-4">
                                            <img id="dev-pix-qr-preview" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Pré-visualização QR Code PIX Dev" class="w-24 h-24 bg-gray-100 dark:bg-gray-700 rounded-lg object-contain border border-gray-300 dark:border-gray-600">
                                            <div class="flex-grow">
                                                <input type="file" id="dev-pix-qr-upload" accept="image/png, image/jpeg, image/webp" class="block w-full text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100">
                                                <button id="remove-dev-pix-qr-btn" class="mt-2 bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-lg text-xs cursor-pointer">Remover Imagem</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="pt-2 border-t border-emerald-200 dark:border-emerald-800/60">
                                        <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Link de Doação via PayPal (Desenvolvedor)</label>
                                        <input type="text" id="dev-paypal-link-input" class="w-full bg-white dark:bg-gray-800 text-slate-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 text-sm font-mono" placeholder="https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div id="tab-content-sponsors" class="hidden space-y-6 text-left">
                           <!-- Exibição no Telão (Intervalo / Fim) -->
                           <div class="border-b border-gray-300 dark:border-gray-700 pb-6">
                               <h3 class="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">⏱️ Exibição no Telão (Intervalo / Sorteio / Fim)</h3>
                               <div class="space-y-4">
                                   <div>
                                       <label class="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Velocidade de exibição por patrocinador (<span id="sponsor-display-value">10</span> segundos):</label>
                                       <div class="flex items-center gap-2 mb-3">
                                           <button type="button" class="settings-sponsor-speed-btn px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 dark:bg-gray-700 hover:bg-sky-500 hover:text-white transition-all cursor-pointer shadow-sm" data-speed="5">5s</button>
                                           <button type="button" class="settings-sponsor-speed-btn px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 dark:bg-gray-700 hover:bg-sky-500 hover:text-white transition-all cursor-pointer shadow-sm" data-speed="8">8s</button>
                                           <button type="button" class="settings-sponsor-speed-btn px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 dark:bg-gray-700 hover:bg-sky-500 hover:text-white transition-all cursor-pointer shadow-sm" data-speed="10">10s</button>
                                           <button type="button" class="settings-sponsor-speed-btn px-4 py-2 rounded-xl text-sm font-bold bg-gray-200 dark:bg-gray-700 hover:bg-sky-500 hover:text-white transition-all cursor-pointer shadow-sm" data-speed="15">15s</button>
                                       </div>
                                       <input type="range" id="sponsor-display-timer" min="3" max="30" value="10" class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer range-lg">
                                   </div>
                                   <div>
                                       <label for="sponsor-transition-effect" class="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-1">Efeito de transição</label>
                                       <select id="sponsor-transition-effect" class="block w-full text-sm p-2 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-amber-500 outline-none">
                                           <option value="fade">Fade In / Fade Out</option>
                                           <option value="slide">Deslizar</option>
                                           <option value="zoom">Zoom</option>
                                           <option value="random">Aleatório</option>
                                       </select>
                                   </div>
                                   <div class="flex items-center gap-3 bg-gray-100 dark:bg-gray-700/60 p-3 rounded-xl border border-gray-200 dark:border-gray-600">
                                       <input type="checkbox" id="show-sponsor-countdown" class="h-5 w-5 rounded border-gray-300 text-sky-600 focus:ring-sky-500">
                                       <div>
                                           <label for="show-sponsor-countdown" class="block text-sm font-bold text-slate-700 dark:text-slate-300">Mostrar Contagem Regressiva</label>
                                           <p class="text-xs text-slate-500 dark:text-slate-400">Exibe um cronômetro circular ao lado do patrocinador</p>
                                       </div>
                                   </div>
                               </div>
                           </div>

                           <!-- Patrocinador Global / Master -->
                           <div class="border-b border-gray-300 dark:border-gray-700 pb-6">
                               <h3 class="text-xl font-bold text-slate-800 dark:text-slate-200 mb-1" data-label-key="settingsGlobalSponsorTitle">${appLabels.settingsGlobalSponsorTitle}</h3>
                               <p class="text-sm text-slate-600 dark:text-slate-400 mb-4" data-label-key="settingsGlobalSponsorDescription">${appLabels.settingsGlobalSponsorDescription}</p>
                               <div class="flex items-center gap-4">
                                   <img id="global-sponsor-preview" src="" alt="Pré-visualização do Patrocinador Global" class="w-24 h-24 bg-gray-100 dark:bg-gray-900 rounded-xl object-contain border border-gray-300 dark:border-gray-600 shadow-sm">
                                   <div class="flex-grow space-y-2">
                                       <div>
                                           <label for="global-sponsor-name" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Patrocinador Master</label>
                                           <input type="text" id="global-sponsor-name" class="block w-full text-sm p-2 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: Supermercados Estrela">
                                       </div>
                                       <div>
                                            <div class="flex items-center justify-between mb-1">
                                                <label for="global-sponsor-upload" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Logotipo</label>
                                                <button id="generate-global-sponsor-btn" class="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded font-bold hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors cursor-pointer">Gerar Logo com Nome</button>
                                            </div>
                                           <input type="file" id="global-sponsor-upload" accept="image/*" class="block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100">
                                       </div>
                                   </div>
                               </div>
                               <button id="remove-global-sponsor-btn" class="mt-3 bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-4 rounded-xl text-sm transition-colors cursor-pointer" data-label-key="removeGlobalSponsorButton">${appLabels.removeGlobalSponsorButton}</button>
                           </div>

                           <!-- Patrocinador da Cartela Extra / Rodadas Especiais -->
                           <div class="border-b border-gray-300 dark:border-gray-700 pb-6">
                               <div class="flex items-center justify-between mb-1">
                                   <h3 class="text-xl font-bold text-amber-600 dark:text-amber-400">⭐ Patrocinador para Cartela Extra</h3>
                                   <span class="text-xs px-2.5 py-1 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 rounded-full font-bold">Rodada Extra</span>
                               </div>
                               <p class="text-sm text-slate-600 dark:text-slate-400 mb-4">Este patrocinador terá destaque exclusivo na impressão das cartelas extras e será exibido nos intervalos e encerramento do evento.</p>
                               <div class="flex items-center gap-4">
                                   <img id="extra-card-sponsor-preview" src="" alt="Pré-visualização Cartela Extra" class="w-24 h-24 bg-gray-100 dark:bg-gray-900 rounded-xl object-contain border border-gray-300 dark:border-gray-600 shadow-sm">
                                   <div class="flex-grow space-y-2">
                                       <div>
                                           <label for="extra-card-sponsor-name" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome do Patrocinador da Cartela Extra</label>
                                           <input type="text" id="extra-card-sponsor-name" class="block w-full text-sm p-2 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-amber-500 outline-none" placeholder="Ex: Farmácia Central">
                                       </div>
                                       <div>
                                            <div class="flex items-center justify-between mb-1">
                                                <label for="extra-card-sponsor-upload" class="block text-sm font-medium text-slate-700 dark:text-slate-300">Logotipo</label>
                                                <button type="button" id="generate-extra-card-sponsor-btn" class="text-xs bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 px-2.5 py-1 rounded font-bold hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors cursor-pointer">Gerar Logo com Nome</button>
                                            </div>
                                           <input type="file" id="extra-card-sponsor-upload" accept="image/*" class="block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100">
                                       </div>
                                   </div>
                               </div>
                               <button type="button" id="remove-extra-card-sponsor-btn" class="mt-3 bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-4 rounded-xl text-sm transition-colors cursor-pointer">Remover Patrocinador da Cartela Extra</button>
                           </div>

                           <!-- Outros Patrocinadores do Evento (Institucionais / Fora dos Números) -->
                           <div class="border-b border-gray-300 dark:border-gray-700 pb-6">
                               <div class="flex items-center justify-between mb-2">
                                   <div>
                                       <h3 class="text-xl font-bold text-slate-800 dark:text-slate-200">🏢 Outros Patrocinadores do Evento</h3>
                                       <p class="text-sm text-slate-600 dark:text-slate-400">Adicione apoiadores e parceiros que não estão vinculados aos números do bingo. Eles serão exibidos nos intervalos e no fim do evento junto com todos os patrocinadores.</p>
                                   </div>
                                   <button type="button" id="add-general-sponsor-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-sm flex items-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0">
                                       <span>+</span> Adicionar Patrocinador
                                   </button>
                               </div>
                               <div id="general-sponsors-container" class="space-y-2 mt-4">
                                   <!-- Lista de Patrocinadores Gerais Injetada Dinamicamente -->
                               </div>
                           </div>

                           <!-- Intervalo e Patrocinadores por Número -->
                           <div class="space-y-4">
                               <h3 class="text-xl font-bold text-slate-800 dark:text-slate-200">☕ Configurações do Intervalo</h3>
                               <div class="flex items-center gap-3 bg-gray-100 dark:bg-gray-700/60 p-3 rounded-xl border border-gray-200 dark:border-gray-600">
                                    <input type="checkbox" id="show-menu-in-break-checkbox" class="h-5 w-5 rounded border-gray-300 text-sky-600 focus:ring-sky-500">
                                    <label for="show-menu-in-break-checkbox" class="text-slate-800 dark:text-slate-200 font-medium">Mostrar Cardápio / Lanchonete no Intervalo</label>
                               </div>
                               
                               <h3 class="text-xl font-bold text-slate-800 dark:text-slate-200 pt-2">${appLabels.settingsSponsorsByNumberTitle}</h3>
                               <div class="flex items-center gap-3 bg-gray-100 dark:bg-gray-700/60 p-3 rounded-xl border border-gray-200 dark:border-gray-600">
                                    <input type="checkbox" id="enable-sponsors-by-number-checkbox" class="h-5 w-5 rounded border-gray-300 text-sky-600 focus:ring-sky-500">
                                    <label for="enable-sponsors-by-number-checkbox" class="text-slate-800 dark:text-slate-200 font-medium">${appLabels.settingsSponsorsByNumberEnable}</label>
                               </div>
                               <p class="text-sm text-slate-600 dark:text-slate-400">${appLabels.settingsSponsorsByNumberDescription}</p>
                               <div id="sponsors-by-number-container" class="space-y-1"></div>
                           </div>
                        </div>
                        
                        <div id="tab-content-labels" class="hidden">
                            <div class="border-b border-gray-700 pb-4 mb-4 space-y-4">
                                <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300">Nomenclatura dos Prêmios</h3>
                                <div>
                                    <label for="label-prize1Label" class="text-base font-medium text-slate-700 dark:text-slate-300">Prêmio 1 (ex: Quina)</label>
                                    <input type="text" id="label-prize1Label" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 mt-1 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none">
                                    <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">O nome do primeiro prêmio a ser ganho na rodada. Geralmente uma linha ou quina.</p>
                                </div>
                                <div>
                                    <label for="label-prize2Label" class="text-base font-medium text-slate-700 dark:text-slate-300">Prêmio 2 (ex: Cartela Cheia)</label>
                                    <input type="text" id="label-prize2Label" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 mt-1 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none">
                                    <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">O nome do prêmio principal, que geralmente encerra a rodada.</p>
                                </div>
                                <div>
                                    <label for="label-prize3Label" class="text-base font-medium text-slate-700 dark:text-slate-300">Prêmio 3 (ex: Azarão)</label>
                                    <input type="text" id="label-prize3Label" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 mt-1 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none">
                                    <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">Um prêmio opcional, como para quem fica por uma bola ou tem a cartela com mais números no final.</p>
                                </div>
                            </div>
                            <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300 mt-6 mb-4">Todos os Textos</h3>
                             <div id="labels-form-container" class="space-y-4 text-left grid grid-cols-1 md:grid-cols-2 gap-4">
                             </div>
                        </div>

                        <div id="tab-content-shortcuts" class="hidden space-y-6 text-left">
                            <h3 class="text-xl font-bold text-slate-700 dark:text-slate-300">${appLabels.shortcutsEditTitle}</h3>
                            <p class="text-sm text-slate-600 dark:text-slate-400">${appLabels.shortcutsEditDescription}</p>
                            <div id="shortcuts-form-container" class="space-y-4">
                                <!-- Os campos de atalho serão inseridos aqui pelo JS -->
                            </div>
                        </div>
                    </div>
                    
                    <div class="mt-6 flex justify-between items-center">
                        <button id="generate-test-data-btn" class="bg-red-700 hover:bg-red-800 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all">${appLabels.settingsTestDataButton}</button>
                        <button id="close-settings-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-8 rounded-full text-lg">${appLabels.settingsCloseSaveButton}</button>
                    </div>
                </div>`,
                sponsorImageEditor: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">Criar Imagem do Patrocinador</h2>
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="space-y-4">
                                <div>
                                    <label for="sponsor-editor-text" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nome Principal</label>
                                    <input type="text" id="sponsor-editor-text" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="Nome da empresa ou pessoa">
                                </div>
                                <div>
                                    <label for="sponsor-editor-subtitle" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Subtítulo (Opcional)</label>
                                    <input type="text" id="sponsor-editor-subtitle" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="Ex: Apoio Cultural">
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="sponsor-editor-font" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Fonte</label>
                                        <select id="sponsor-editor-font" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none">
                                            <option value="sans-serif">Sans Serif</option>
                                            <option value="serif">Serif</option>
                                            <option value="monospace">Monospace</option>
                                            <option value="Impact, sans-serif">Impact</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-shape" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Forma/Ícone</label>
                                        <select id="sponsor-editor-shape" class="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm border border-slate-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500 outline-none">
                                            <option value="">Nenhum</option>
                                            <optgroup label="Geométricas">
                                                <option value="circle">Círculo</option>
                                                <option value="square">Quadrado</option>
                                                <option value="triangle">Triângulo</option>
                                                <option value="star">Estrela</option>
                                                <option value="hexagon">Hexágono</option>
                                                <option value="diamond">Losango</option>
                                                <option value="pentagon">Pentágono</option>
                                                <option value="octagon">Octógono</option>
                                                <option value="heart">Coração</option>
                                                <option value="shield">Escudo</option>
                                            </optgroup>
                                            <optgroup label="Temática Católica">
                                                <option value="cross">Cruz</option>
                                                <option value="dove">Pomba</option>
                                                <option value="rosary">Terço</option>
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Fundo Personalizado (Imagem)</label>
                                    <input type="file" id="sponsor-editor-custom-bg" accept="image/*" class="w-full text-xs text-slate-600 dark:text-slate-400 file:mr-2 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 mb-2">
                                    <div class="flex items-center gap-2 mb-2">
                                        <label for="sponsor-editor-bg-opacity" class="text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">Opacidade</label>
                                        <input type="range" id="sponsor-editor-bg-opacity" min="0" max="100" value="100" class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                                    </div>
                                    <div class="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                                        <label class="flex items-center"><input type="checkbox" id="sponsor-editor-save-bg" class="mr-1"> Lembrar fundo para próximos</label>
                                        <button id="sponsor-editor-clear-bg" class="text-red-500 hover:text-red-700">Limpar</button>
                                    </div>
                                </div>
                            </div>
                            <div class="space-y-4">
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="sponsor-editor-bg" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Fundo 1</label>
                                        <input type="color" id="sponsor-editor-bg" class="w-full h-10 p-1 bg-gray-100 dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded cursor-pointer" value="#1e293b">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-bg2" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Fundo 2 (Degradê)</label>
                                        <input type="color" id="sponsor-editor-bg2" class="w-full h-10 p-1 bg-gray-100 dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded cursor-pointer" value="#0f172a">
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="sponsor-editor-text-color" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Cor Principal</label>
                                        <input type="color" id="sponsor-editor-text-color" class="w-full h-10 p-1 bg-gray-100 dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded cursor-pointer" value="#fbbf24">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-subtitle-color" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Cor Subtítulo</label>
                                        <input type="color" id="sponsor-editor-subtitle-color" class="w-full h-10 p-1 bg-gray-100 dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded cursor-pointer" value="#e2e8f0">
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label for="sponsor-editor-border-color" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Cor da Borda</label>
                                        <input type="color" id="sponsor-editor-border-color" class="w-full h-10 p-1 bg-gray-100 dark:bg-gray-900 border border-slate-300 dark:border-gray-600 rounded cursor-pointer" value="#38bdf8">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-border-width" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">L. Borda</label>
                                        <input type="range" id="sponsor-editor-border-width" min="0" max="40" value="0" class="w-full mt-2">
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div class="col-span-2 text-sm font-bold text-slate-700 dark:text-slate-300">Posicionamento do Texto</div>
                                    <div>
                                        <label for="sponsor-editor-text-y" class="block text-xs font-medium text-slate-500 mb-1">Posição Vertical</label>
                                        <input type="range" id="sponsor-editor-text-y" min="-300" max="300" value="0" class="w-full mt-1">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-text-x" class="block text-xs font-medium text-slate-500 mb-1">Posição Horizontal</label>
                                        <input type="range" id="sponsor-editor-text-x" min="-300" max="300" value="0" class="w-full mt-1">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-text-scale" class="block text-xs font-medium text-slate-500 mb-1">Tamanho da Fonte (%)</label>
                                        <input type="range" id="sponsor-editor-text-scale" min="10" max="400" value="100" class="w-full mt-1">
                                    </div>
                                    <div>
                                        <label for="sponsor-editor-text-width" class="block text-xs font-medium text-slate-500 mb-1">Limite da Caixa de Texto (%)</label>
                                        <input type="range" id="sponsor-editor-text-width" min="10" max="100" value="90" class="w-full mt-1">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="mt-4">
                            <label class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Pré-visualização</label>
                            <div class="w-full aspect-video rounded-xl shadow-inner border-2 border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center bg-gray-100 dark:bg-gray-900">
                                <canvas id="sponsor-editor-canvas" class="max-w-full max-h-full"></canvas>
                            </div>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-8">
                        <div>
                            <button id="download-sponsor-editor-btn" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-6 rounded-full flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                Baixar Arquivo
                            </button>
                        </div>
                        <div class="flex gap-4">
                            <button id="cancel-sponsor-editor-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">Cancelar</button>
                            <button id="save-sponsor-editor-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-full">Usar no Bingo</button>
                        </div>
                    </div>
                </div>`,
                roundEdit: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full">
                    <h2 id="round-edit-title" class="text-3xl font-bold text-gray-900 dark:text-white mb-6">Editar Rodada</h2>
                    <div class="space-y-4">
                        <div>
                            <label for="round-edit-name" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Nome da Rodada</label>
                            <input type="text" id="round-edit-name" class="w-full text-lg font-bold p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-md focus:ring-sky-500 focus:border-sky-500">
                        </div>
                        <div id="round-edit-prizes-container" class="space-y-4">
                            <!-- Inputs de prêmios serão inseridos dinamicamente aqui -->
                        </div>
                        <div>
                            <label for="round-edit-description" class="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Descrição da Rodada (Opcional)</label>
                            <textarea id="round-edit-description" class="w-full h-24 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 focus:ring-sky-500 focus:border-sky-500" placeholder="Ex: Rodada especial em prol da construção..."></textarea>
                        </div>
                    </div>
                    <div class="flex justify-end gap-4 mt-8">
                        <button id="cancel-round-edit-btn" class="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalCancelButton}</button>
                        <button id="save-round-edit-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-full">${appLabels.modalSaveButton}</button>
                    </div>
                </div>`,
                nextRound: `<div class="modal-content next-round-modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full text-center overflow-hidden">
                    <h2 class="text-3xl font-bold text-sky-400 mb-4">Troca de Rodada!</h2>
                    <div class="flex items-center justify-center gap-4 text-xl my-6">
                        <div class="flex-1 text-right p-3 bg-red-900/50 rounded-lg">
                            <p class="text-sm text-red-300">Encerrada</p>
                            <p id="completed-round-name" class="font-bold text-gray-900 dark:text-white"></p>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <div class="flex-1 text-left p-3 bg-green-900/50 rounded-lg">
                            <p class="text-sm text-green-300">Próxima</p>
                            <p id="next-round-name" class="font-bold text-gray-900 dark:text-white"></p>
                        </div>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mt-6">
                      <div id="next-round-progress" class="bg-sky-500 h-2.5 rounded-full" style="width: 100%; transition: width 5s linear;"></div>
                    </div>
                 </div>`,
                cardGenerator: `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-2xl w-full text-center flex flex-col">
                                   <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-4">Gerador de Cartelas</h2>
                                   <p class="text-slate-600 dark:text-slate-400 mb-6">As cartelas serão geradas no padrão de 6 por folha (A4 - Retrato), contendo QR Code e Número de Série para jogar online.</p>
                                   <div class="flex flex-col gap-4 mb-6">
                                       <input type="text" id="card-batch-title" placeholder="Título (Ex: Bingo dos Amigos)" class="w-full text-lg font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                       <div class="flex flex-col sm:flex-row gap-2">
                                           <input type="text" id="card-batch-location" placeholder="Onde? (Local do Evento)" class="flex-[2] text-sm font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                           <input type="text" id="card-batch-date" placeholder="Data (ex: 20/DEZ)" class="flex-1 text-sm font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                           <input type="text" id="card-batch-price" placeholder="Valor (ex: R$ 10,00)" class="flex-1 text-sm font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                       </div>
                                       <div class="flex items-center justify-between gap-2">
                                            <div class="flex-1 text-left text-sm font-bold text-slate-500 dark:text-slate-400">Total de Grades:</div>
                                            <input type="number" id="card-quantity" placeholder="Ex: 120 (rendem 20 folhas)" value="120" class="w-48 text-center text-lg font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                       </div>
                                                                               <div class="flex flex-col sm:flex-row gap-2">
                                            <div class="flex-1 flex items-center justify-between border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 rounded-lg">
                                                <label class="text-slate-700 dark:text-slate-300 font-bold" for="card-color">Cor das Cartelas:</label>
                                                <input type="color" id="card-color" value="#000000" class="w-12 h-10 p-0 border-0 rounded cursor-pointer">
                                            </div>
                                            <div class="flex-1 flex items-center justify-between border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 rounded-lg">
                                                <label class="text-slate-700 dark:text-slate-300 font-bold text-sm" for="card-layout">Layout (A4):</label>
                                                <select id="card-layout" class="text-sm font-bold bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded p-1 outline-none">
                                                    <option value="6">6 por folha</option>
                                                    <option value="4">4 por folha</option>
                                                    <option value="2">2 por folha</option>
                                                    <option value="1">1 por folha</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="flex flex-col gap-2 mt-2">
                                            <div class="flex items-center gap-2 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 rounded-lg">
                                                <input type="checkbox" id="card-include-qr" checked class="w-5 h-5 rounded cursor-pointer focus:ring-2 focus:ring-sky-500 accent-sky-600 border-gray-300">
                                                <label class="text-slate-700 dark:text-slate-300 font-bold cursor-pointer" for="card-include-qr">Incluir QR Code (Jogar pelo Celular)</label>
                                            </div>
                                            <div class="flex items-center gap-2 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 rounded-lg">
                                                <input type="checkbox" id="card-include-logo" checked class="w-5 h-5 rounded cursor-pointer focus:ring-2 focus:ring-sky-500 accent-sky-600 border-gray-300">
                                                <label class="text-slate-700 dark:text-slate-300 font-bold cursor-pointer" for="card-include-logo">Exibir Logo do Evento (se configurada)</label>
                                            </div>
                                            <div class="flex items-center gap-2 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-3 rounded-lg">
                                                <input type="checkbox" id="card-reset-series" class="w-5 h-5 rounded cursor-pointer focus:ring-2 focus:ring-sky-500 accent-sky-600 border-gray-300">
                                                <label class="text-slate-700 dark:text-slate-300 font-bold cursor-pointer" for="card-reset-series">Zerar numeração de série na geração</label>
                                            </div>
                                        </div>
                                        <div class="mt-2">
                                            <input type="text" id="card-extra-instructions" placeholder="Instruções Extras / Regras (Ex: Proibido menores de 18 anos)" class="w-full text-sm font-bold p-3 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                        </div>
                                    </div>
                                    <div class="flex justify-center gap-4 mb-4 mt-4">
                                         <button id="generate-and-print-cards-btn" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-8 rounded-full text-lg w-full shadow-lg transition-transform active:scale-95">Gerar e Imprimir</button>
                                    </div>
                                   <button id="close-card-generator-btn" class="mt-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-bold py-2 px-8 uppercase tracking-widest text-sm">Cancelar</button>
                               </div>`,
                cardScanner: `<div class="modal-content bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-md w-full text-center">
                                <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">Verificar Cartela</h2>
                                <div class="mb-6 flex flex-col sm:flex-row gap-2">
                                    <input type="number" id="manual-card-id-input" placeholder="Nº (ex: 123)" class="flex-grow text-center text-lg font-bold p-2 border-2 border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                                    <button id="verify-manual-card-btn" class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-6 rounded-lg text-lg whitespace-nowrap">Verificar</button>
                                </div>
                                <div class="relative w-full aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden">
                                    <video id="scanner-video" class="w-full h-full object-cover" playsinline></video>
                                    <canvas id="scanner-canvas" class="hidden"></canvas>
                                    <div class="absolute inset-0 border-8 border-red-500/50" style="clip-path: polygon(0% 0%, 0% 25%, 25% 25%, 25% 0%, 75% 0%, 75% 25%, 100% 25%, 100% 75%, 75% 75%, 75% 100%, 25% 100%, 25% 75%, 0% 75%);"></div>
                                </div>
                                <p id="scanner-message" class="text-slate-600 dark:text-slate-400 mt-4 h-6">Aponte o QR Code ou digite o número acima.</p>
                                <button id="close-card-scanner-btn" class="mt-4 bg-slate-600 hover:bg-slate-700 text-white font-bold py-3 px-8 rounded-full text-lg">${appLabels.modalCancelButton}</button>
                            </div>`,
            };
        }
        
// FIX: Added definitions for missing UI functions to resolve multiple "Cannot find name" errors.
function confirmClearRound() {
    if (!appStore.state.activeGameNumber) {
        showAlert("Nenhuma rodada ativa para limpar.");
        return;
    }
    DOMElements.clearRoundConfirmModal.innerHTML = getModalTemplates().clearRoundConfirm;
    DOMElements.clearRoundConfirmModal.classList.remove('hidden');

    document.getElementById('confirm-clear-round-btn')!.onclick = () => {
        startNewRound();
        DOMElements.clearRoundConfirmModal.classList.add('hidden');
    };
    document.getElementById('cancel-clear-round-btn')!.onclick = () => {
        DOMElements.clearRoundConfirmModal.classList.add('hidden');
    };
}

function generateProof(selectedGameKeys: string[], signerName: string = '') {
    const { gamesData, appConfig } = appStore.state;
    let proofContent = `
        <html>
        <head>
            <title>Relatório de Resultados - ${appConfig.bingoTitle}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 4rem; color: #333; line-height: 1.6; }
                .header { text-align: center; margin-bottom: 2rem; }
                .logo { max-width: 150px; max-height: 150px; margin-bottom: 1rem; object-fit: contain; }
                h1 { color: #1a365d; margin-bottom: 0.2rem; font-size: 2.5em; text-transform: uppercase; letter-spacing: 1px; margin-top: 0; }
                .subtitle { color: #64748b; font-size: 1.1em; margin-bottom: 3rem; }
                h2 { color: #2563eb; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 3rem; font-size: 1.8em; }
                table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                th, td { border: 1px solid #e2e8f0; padding: 12px 16px; text-align: left; }
                th { background-color: #f8fafc; color: #475569; font-weight: 600; text-transform: uppercase; font-size: 0.9em; letter-spacing: 0.5px; }
                tr:nth-child(even) { background-color: #f8fafc; }
                .numbers { font-size: 0.9em; word-break: break-all; color: #475569; font-family: monospace; }
                .signature-section { margin-top: 6rem; text-align: center; page-break-inside: avoid; }
                .signature-line { width: 400px; border-bottom: 1px solid #333; margin: 0 auto; }
                .signature-name { margin-top: 15px; font-weight: bold; font-size: 1.2em; color: #1e293b; }
                .signature-title { margin-top: 5px; color: #64748b; font-size: 1em; }
                .declaration { margin-top: 4rem; padding: 2rem; background-color: #f1f5f9; border-radius: 8px; border-left: 4px solid #3b82f6; text-align: justify; font-size: 1.1em; }
                @media print {
                    body { margin: 2rem; }
                    .declaration { background-color: transparent; border: 1px solid #cbd5e1; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                ${appConfig.customLogoBase64 ? `<img src="${appConfig.customLogoBase64}" class="logo" alt="Logo do Evento">` : ''}
                <h1>${appConfig.bingoTitle}</h1>
                <p class="subtitle">Relatório Oficial de Resultados<br>Gerado em: ${new Date().toLocaleString('pt-BR')}<br>Sistema: ${appConfig.appName || 'Bingo Show'}</p>
            </div>
    `;

    selectedGameKeys.forEach(key => {
        const game = gamesData[key];
        if (game && game.winners && game.winners.length > 0) {
            proofContent += `<h2>${game.name || `Rodada ${key}`}</h2>`;
            proofContent += '<table><thead><tr><th>Ganhador</th><th>Prêmio</th>';
            if (key !== 'Brindes' && key !== 'Leilão') {
                proofContent += `<th>Números Sorteados (${game.calledNumbers.length})</th>`;
            } else if (key === 'Brindes') {
                proofContent += '<th>Nº da Cartela</th>';
            } else if (key === 'Leilão') {
                proofContent += '<th>Item</th><th>Lance</th>';
            }
            proofContent += '</tr></thead><tbody>';

            game.winners.forEach((winner: any) => {
                proofContent += '<tr>';
                proofContent += `<td>${winner.name}</td>`;
                if (key !== 'Leilão') {
                    proofContent += `<td>${winner.prize}</td>`;
                }

                if (key !== 'Brindes' && key !== 'Leilão') {
                    proofContent += `<td class="numbers">${winner.numbers.join(', ')}</td>`;
                } else if (key === 'Brindes') {
                     proofContent += `<td>${winner.cartela}</td>`;
                } else if (key === 'Leilão') {
                    proofContent += `<td>${winner.itemName}</td><td>R$ ${winner.bid},00</td>`;
                }
                proofContent += '</tr>';
            });
            proofContent += '</tbody></table>';
        }
    });

    if (signerName) {
        proofContent += `
            <div class="declaration">
                Declaramos, para os devidos fins de direito, que o presente relatório reflete fielmente e de forma auditável os resultados obtidos nos sorteios do evento "<b>${appConfig.bingoTitle}</b>", realizados no dia ${new Date().toLocaleDateString('pt-BR')}. Os números e/ou cartelas listados foram conferidos e confirmados como contemplados durante as rodadas correspondentes, em conformidade com as regras estabelecidas pela organização do evento.
            </div>
            <div class="signature-section">
                <div class="signature-line"></div>
                <div class="signature-name">${signerName}</div>
                <div class="signature-title">Responsável pela Assinatura e Conferência</div>
            </div>
        `;
    }

    proofContent += '</body></html>';
    
    const proofWindow = window.open('', '_blank');
    if (proofWindow) {
        proofWindow.document.write(proofContent);
        proofWindow.document.close();
        proofWindow.print();
    } else {
        const blob = new Blob([proofContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Prova_Bingo_${new Date().getTime()}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert("O pop-up foi bloqueado, então o arquivo HTML da prova foi baixado no seu dispositivo. Abra-o para imprimir ou compartilhar.");
    }
}

function showProofOptionsModal(isFinal = false) {
    DOMElements.proofOptionsModal.innerHTML = getModalTemplates().proofOptions;
    const optionsList = document.getElementById('proof-options-list')!;
    optionsList.innerHTML = '';

    const createCheckbox = (id: string, label: string, checked = true) => `
        <div class="flex items-center">
            <input id="proof-option-${id}" type="checkbox" ${checked ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
            <label for="proof-option-${id}" class="ml-3 text-sm text-slate-800 dark:text-slate-200">${label}</label>
        </div>
    `;

    Object.keys(appStore.state.gamesData).forEach(key => {
        const game = appStore.state.gamesData[key];
        if (game.winners && game.winners.length > 0) {
            optionsList.innerHTML += createCheckbox(key, game.name || `Rodada ${key}`);
        }
    });

    DOMElements.proofOptionsModal.classList.remove('hidden');

    document.getElementById('cancel-proof-btn')!.onclick = () => DOMElements.proofOptionsModal.classList.add('hidden');
    document.getElementById('generate-selected-proof-btn')!.onclick = () => {
        const selectedGameKeys = Array.from(optionsList.querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.id.replace('proof-option-', ''));
        const signerName = (document.getElementById('proof-signer-name') as HTMLInputElement)?.value.trim() || '';
        generateProof(selectedGameKeys, signerName);
        DOMElements.proofOptionsModal.classList.add('hidden');
        if(isFinal) DOMElements.finalWinnersModal.classList.add('hidden');
    };
}

function showWinnerEditModal(winnerId: number) {
    let winnerData: any = null;
    let gameKey: string | null = null;

    for (const key in appStore.state.gamesData) {
        const game = appStore.state.gamesData[key];
        if (game.winners) {
            const foundWinner = game.winners.find((w: any) => w.id === winnerId);
            if (foundWinner) {
                winnerData = foundWinner;
                gameKey = key;
                break;
            }
        }
    }

    if (!winnerData || !gameKey) {
        console.error(`Vencedor com ID ${winnerId} não encontrado.`);
        return;
    }

    DOMElements.winnerEditModal.innerHTML = getModalTemplates().winnerEdit;
    
    const nameInput = document.getElementById('edit-winner-name') as HTMLInputElement;
    const prizeInput = document.getElementById('edit-winner-prize') as HTMLInputElement;
    
    nameInput.value = winnerData.name;
    prizeInput.value = winnerData.prize;

    DOMElements.winnerEditModal.classList.remove('hidden');

    document.getElementById('save-winner-changes-btn')!.onclick = () => {
        winnerData.name = nameInput.value;
        winnerData.prize = prizeInput.value;
        renderAllWinners();
        appStore.debouncedSave();
        DOMElements.winnerEditModal.classList.add('hidden');
    };

    document.getElementById('cancel-winner-edit-btn')!.onclick = () => {
        DOMElements.winnerEditModal.classList.add('hidden');
    };
    
    document.getElementById('remove-winner-btn')!.onclick = () => {
        DOMElements.deleteConfirmModal.innerHTML = getModalTemplates().deleteConfirm;
        (document.getElementById('delete-confirm-message') as HTMLElement).textContent = `Tem certeza que deseja remover o vencedor "${winnerData.name}"?`;
        
        DOMElements.deleteConfirmModal.classList.remove('hidden');

        document.getElementById('confirm-delete-btn')!.onclick = () => {
            if (gameKey) {
                const game = appStore.state.gamesData[gameKey];
                game.winners = game.winners.filter((w: any) => w.id !== winnerId);
                renderAllWinners();
                appStore.debouncedSave();
            }
            DOMElements.deleteConfirmModal.classList.add('hidden');
            DOMElements.winnerEditModal.classList.add('hidden');
        };

        document.getElementById('cancel-delete-btn')!.onclick = () => {
            DOMElements.deleteConfirmModal.classList.add('hidden');
        };
    };
}

function showDrawnPrizesModal() {
    const { drawnPrizeNumbers } = appStore.state;
    DOMElements.drawnPrizesModal.innerHTML = getModalTemplates().drawnPrizes;
    const historyList = document.getElementById('drawn-prizes-history-list')!;
    const lastDrawnDisplay = document.getElementById('last-drawn-prize-display')!;
    const subtitle = document.getElementById('drawn-prizes-subtitle')!;
    historyList.innerHTML = '';
    lastDrawnDisplay.innerHTML = '';

    subtitle.textContent = `Total Sorteado: ${drawnPrizeNumbers.length}`;

    const renderLastDrawn = () => {
        lastDrawnDisplay.innerHTML = '';
        if (drawnPrizeNumbers.length > 0) {
            const lastNumber = drawnPrizeNumbers[drawnPrizeNumbers.length - 1];
            lastDrawnDisplay.innerHTML = `
                <div class="bg-amber-400 text-gray-900 font-black rounded-lg w-40 h-24 flex flex-col items-center justify-center text-5xl shadow-lg relative p-2 animate-bounce-in">
                    <span class="text-sm absolute top-1">Cartela</span>
                    <span class="text-4xl leading-none mt-2">${lastNumber}</span>
                </div>
            `;
        } else {
            lastDrawnDisplay.innerHTML = `<p class="text-slate-600 dark:text-slate-400">Nenhum brinde sorteado ainda.</p>`;
        }
    };

    let historyVisibleCount = 60;
    const renderHistory = () => {
        historyList.innerHTML = '';
        const reversed = [...drawnPrizeNumbers].reverse();
        const itemsToRender = reversed.slice(0, historyVisibleCount);
        const fragment = document.createDocumentFragment();

        itemsToRender.forEach(num => {
            const prizeEl = document.createElement('div');
            prizeEl.className = 'relative bg-gray-200 dark:bg-gray-700 text-white font-bold rounded-lg w-20 h-14 flex items-center justify-center text-2xl shadow-md cursor-pointer group';
            prizeEl.textContent = num.toString();

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'absolute -top-2 -right-2 bg-red-600 text-white w-6 h-6 rounded-full text-sm font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = `Excluir sorteio do número ${num}`;
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (appStore.state.appConfig.enableSoundEffects) sounds.playError();
                const index = appStore.state.drawnPrizeNumbers.indexOf(num);
                if (index > -1) {
                    appStore.state.drawnPrizeNumbers.splice(index, 1);
                    appStore.debouncedSave();
                    renderLastDrawn();
                    renderHistory();
                    subtitle.textContent = `Total Sorteado: ${appStore.state.drawnPrizeNumbers.length}`;
                }
            };

            prizeEl.appendChild(deleteBtn);
            fragment.appendChild(prizeEl);
        });

        historyList.appendChild(fragment);

        if (historyVisibleCount < reversed.length) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'col-span-full my-2 mx-auto bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-2 px-6 rounded-full shadow transition-all';
            loadMoreBtn.textContent = `Carregar Mais (+60 de ${reversed.length})`;
            loadMoreBtn.onclick = () => {
                historyVisibleCount += 60;
                renderHistory();
            };
            historyList.appendChild(loadMoreBtn);
        }
    };
    
    renderLastDrawn();
    renderHistory();
    
    DOMElements.drawnPrizesModal.classList.remove('hidden');

    document.getElementById('close-drawn-prizes-btn')!.addEventListener('click', () => {
        DOMElements.drawnPrizesModal.classList.add('hidden');
    });
}

async function showFinalWinnersModal(isEndOfEvent: boolean = true) {
    if (finalConfettiInterval) clearInterval(finalConfettiInterval);
    if (typeof finalSponsorsInterval !== "undefined" && finalSponsorsInterval) clearInterval(finalSponsorsInterval);

    let finalModal = DOMElements.finalWinnersModal || document.getElementById('final-winners-modal');
    if (!finalModal) {
        finalModal = document.createElement('div');
        finalModal.id = 'final-winners-modal';
        finalModal.className = 'fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-[110] hidden';
    }
    
    // Anexa ao elemento em tela cheia se existir, senão ao body
    const targetContainer = document.fullscreenElement || document.body;
    if (finalModal.parentElement !== targetContainer) {
        targetContainer.appendChild(finalModal);
    }

    finalModal.innerHTML = getModalTemplates().finalWinners;
    finalModal.classList.remove('hidden');

    const endTitle = document.getElementById('end-title');
    if (endTitle && !isEndOfEvent) {
        endTitle.textContent = 'Vencedores';
    }

    if (!isEndOfEvent) {
        const generateProofBtn = document.getElementById('generate-proof-final-btn');
        const donationBtn = document.getElementById('donation-final-btn');
        if (generateProofBtn) generateProofBtn.classList.add('hidden');
        if (donationBtn) donationBtn.classList.add('hidden');
    }

    const allWinners = Object.values(appStore.state.gamesData)
        .flatMap(g => g.winners || [])
        .filter(w => w && w.name); // Filter out any undefined/null winners

    const winnerDisplay = document.getElementById('current-winner-card')!;
    const sponsorsList = document.getElementById('final-sponsors-list')!;
    
    // Populate sponsors (Global, Extra Card, Outros Patrocinadores Gerais e Números)
    const allSponsors: Array<{ name: string, image: string }> = [];
    const cfg = appStore.state.appConfig;
    if ((cfg.globalSponsor?.name && cfg.globalSponsor.name.trim() !== "") || cfg.globalSponsor?.image) {
        allSponsors.push(cfg.globalSponsor);
    }
    if ((cfg.extraCardSponsor?.name && cfg.extraCardSponsor.name.trim() !== "") || cfg.extraCardSponsor?.image) {
        allSponsors.push(cfg.extraCardSponsor);
    }
    if ((cfg.prizeDrawSponsor?.name && cfg.prizeDrawSponsor.name.trim() !== "") || cfg.prizeDrawSponsor?.image) {
        allSponsors.push(cfg.prizeDrawSponsor);
    }
    if (cfg.generalSponsors && Array.isArray(cfg.generalSponsors)) {
        cfg.generalSponsors.forEach(s => {
            if ((s.name && s.name.trim() !== "") || s.image) allSponsors.push(s);
        });
    }
    if (cfg.sponsorsByNumber) {
        Object.values(cfg.sponsorsByNumber).forEach(s => {
            if ((s.name && s.name.trim() !== "") || s.image) allSponsors.push(s);
        });
    }
    
    const sponsorsToDisplay = allSponsors;
    const sponsorsSection = document.getElementById('final-sponsors-section');
    const pixSection = document.getElementById('final-pix-section');

    if (sponsorsToDisplay.length > 0) {
        if (sponsorsSection) sponsorsSection.classList.remove('hidden');
        if (pixSection) pixSection.classList.remove('md:col-span-2');
        let sponsorIndex = 0;
        
        const applyTransition = (el: HTMLElement, state: 'out' | 'in') => {
            const effect = appStore.state.appConfig.sponsorTransitionEffect === 'random' 
                ? ['fade', 'slide', 'zoom'][Math.floor(Math.random() * 3)] 
                : appStore.state.appConfig.sponsorTransitionEffect || 'fade';
            
            el.style.transition = 'all 0.5s ease-in-out';
            el.classList.remove('opacity-0', 'translate-x-full', 'scale-50');
            
            if (state === 'out') {
                if (effect === 'fade') el.classList.add('opacity-0');
                else if (effect === 'slide') el.classList.add('opacity-0', 'translate-x-full');
                else if (effect === 'zoom') el.classList.add('opacity-0', 'scale-50');
            }
        };

        const cycleFinalSponsors = () => {
            if (!sponsorsList) return;
            applyTransition(sponsorsList, 'out');
            setTimeout(() => {
                const s = sponsorsToDisplay[sponsorIndex % sponsorsToDisplay.length];
                let content = '';
                if (s.image) {
                    content += `<div class="w-full flex-1 min-h-0 flex items-center justify-center mb-2"><img src="${s.image}" alt="${s.name || 'Patrocinador'}" class="max-w-full max-h-full object-contain drop-shadow-xl"></div>`;
                }
                if (s.name) {
                    content += `<span class="text-2xl md:text-3xl font-bold text-amber-600 dark:text-amber-400 flex-shrink-0">${s.name}</span>`;
                }
                sponsorsList.innerHTML = `<div class="flex flex-col items-center justify-center w-full h-full min-h-0">${content}</div>`;
                applyTransition(sponsorsList, 'in');
                sponsorIndex++;
            }, 500);
        };
        
        cycleFinalSponsors();
        const cycleTime = (appStore.state.appConfig.sponsorDisplaySeconds || 10) * 1000;
        finalSponsorsInterval = setInterval(cycleFinalSponsors, cycleTime);
    } else {
        if (sponsorsSection) sponsorsSection.classList.add('hidden');
        if (pixSection) pixSection.classList.add('md:col-span-2');
    }

    // Populate Institution PIX QR Code & Details
    const pixTitleEl = document.getElementById('final-pix-title');
    const pixQrImgEl = document.getElementById('final-pix-qr-img') as HTMLImageElement;
    const pixPlaceholderEl = document.getElementById('final-pix-qr-placeholder');
    const pixKeyBoxEl = document.getElementById('final-pix-key-box');
    const copyPixBtnEl = document.getElementById('final-copy-pix-btn');

    const appConfig = appStore.state.appConfig;

    if (pixTitleEl) {
        pixTitleEl.textContent = appConfig.pixTitle || 'Apoie a Instituição via PIX';
    }

    const pixKey = appConfig.pixKey ? appConfig.pixKey.trim() : '';
    const pixQrUrl = appConfig.pixQrCodeUrl;

    if (pixQrUrl) {
        if (pixQrImgEl) {
            pixQrImgEl.src = pixQrUrl;
            pixQrImgEl.classList.remove('hidden');
        }
        if (pixPlaceholderEl) pixPlaceholderEl.classList.add('hidden');
    } else if (pixKey) {
        try {
            const generatedQr = await QRCode.toDataURL(pixKey, {
                width: 250,
                margin: 2,
                color: { dark: '#059669', light: '#ffffff' }
            });
            if (pixQrImgEl) {
                pixQrImgEl.src = generatedQr;
                pixQrImgEl.classList.remove('hidden');
            }
            if (pixPlaceholderEl) pixPlaceholderEl.classList.add('hidden');
        } catch (e) {
            console.error("Erro ao gerar QR Code PIX:", e);
            if (pixPlaceholderEl) {
                pixPlaceholderEl.textContent = "Chave PIX configurada.";
                pixPlaceholderEl.classList.remove('hidden');
            }
        }
    } else {
        if (pixPlaceholderEl) {
            pixPlaceholderEl.textContent = "Cadastre a Chave PIX nas Configurações.";
            pixPlaceholderEl.classList.remove('hidden');
        }
    }

    if (pixKeyBoxEl) {
        if (pixKey) {
            pixKeyBoxEl.textContent = `Chave: ${pixKey}`;
            pixKeyBoxEl.classList.remove('hidden');
        } else {
            pixKeyBoxEl.classList.add('hidden');
        }
    }

    if (copyPixBtnEl) {
        if (pixKey) {
            copyPixBtnEl.classList.remove('hidden');
            copyPixBtnEl.onclick = () => {
                navigator.clipboard.writeText(pixKey);
                copyPixBtnEl.textContent = '✓ Chave Copiada!';
                setTimeout(() => copyPixBtnEl.textContent = '📋 Copiar Chave PIX', 2000);
            };
        } else {
            copyPixBtnEl.classList.add('hidden');
        }
    }

    let winnerIndex = 0;
    const displayNextWinner = () => {
        if (!winnerDisplay) return;
        if (allWinners.length === 0) {
            winnerDisplay.innerHTML = `<h3 class="text-3xl font-bold text-gray-900 dark:text-white">Nenhum vencedor registrado.</h3>`;
            winnerDisplay.classList.remove('scale-90', 'opacity-0');
            winnerDisplay.classList.add('scale-100', 'opacity-100');
            return;
        }

        winnerDisplay.classList.add('scale-90', 'opacity-0');
        winnerDisplay.classList.remove('scale-100', 'opacity-100');

        setTimeout(() => {
            const winner = allWinners[winnerIndex];
            const game = Object.values(appStore.state.gamesData).find(g => g.winners && g.winners.some((w:any) => w.id === winner.id));
            
            winnerDisplay.innerHTML = `
                <p class="text-2xl font-bold text-sky-400 mb-2 [-webkit-text-stroke:1px_#0284c7] drop-shadow-sm">${game ? game.name : 'Prêmio Especial'}</p>
                <h3 class="text-5xl font-black text-amber-300 [-webkit-text-stroke:2px_#b45309] drop-shadow-md">${winner.name}</h3>
                <p class="text-3xl font-bold text-gray-900 dark:text-white mt-2">${winner.prize}</p>
            `;
            
            winnerDisplay.classList.remove('scale-90', 'opacity-0');
            winnerDisplay.classList.add('scale-100', 'opacity-100');

            winnerIndex = (winnerIndex + 1) % allWinners.length;
        }, 500);
    };

    if (winnerDisplayTimeout) clearInterval(winnerDisplayTimeout);
    displayNextWinner();
    winnerDisplayTimeout = setInterval(displayNextWinner, winnerDisplayDuration);

    const startConfetti = () => {
        const c = getConfettiFn();
        if (c) {
            c({
                particleCount: 2, angle: 270, spread: 55, origin: { x: Math.random(), y: 0 },
                startVelocity: 15 + (Math.random() * 20), gravity: 0.7, ticks: 300, zIndex: 10000,
            });
        }
    };
    finalConfettiInterval = setInterval(startConfetti, 150);

    const closeFinalBtn = document.getElementById('close-final-modal-btn');
    if (closeFinalBtn) {
        closeFinalBtn.onclick = () => {
            if (DOMElements.finalWinnersModal) DOMElements.finalWinnersModal.classList.add('hidden');
            if (winnerDisplayTimeout) clearInterval(winnerDisplayTimeout);
            if (finalConfettiInterval) clearInterval(finalConfettiInterval);
        };
    }

    const proofFinalBtn = document.getElementById('generate-proof-final-btn');
    if (proofFinalBtn) proofFinalBtn.onclick = () => showProofOptionsModal(true);

    const donationFinalBtn = document.getElementById('donation-final-btn');
    if (donationFinalBtn) donationFinalBtn.onclick = () => (DOMElements.showDonationModalBtn as HTMLElement)?.click();
}

function populateSettingsSponsorsTab() {
    const container = document.getElementById('sponsors-by-number-container');
    if (!container) return;

    container.innerHTML = '';
    
    // Timer Speed Controls
    const timerSlider = document.getElementById('sponsor-display-timer') as HTMLInputElement;
    const timerValueDisplay = document.getElementById('sponsor-display-value');
    const speedButtons = document.querySelectorAll('.settings-sponsor-speed-btn');
    const currentSpeed = appStore.state.appConfig.sponsorDisplaySeconds || 10;

    if (timerSlider) {
        timerSlider.value = currentSpeed.toString();
        if (timerValueDisplay) timerValueDisplay.textContent = currentSpeed.toString();

        timerSlider.oninput = (e) => {
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            if (timerValueDisplay) timerValueDisplay.textContent = val.toString();
            appStore.state.appConfig.sponsorDisplaySeconds = val;
            appStore.debouncedSave();
            updateSettingsSpeedButtons(val);
        };
    }

    const updateSettingsSpeedButtons = (val: number) => {
        speedButtons.forEach(btn => {
            const s = parseInt((btn as HTMLElement).dataset.speed || '0', 10);
            if (s === val) {
                btn.classList.add('bg-sky-500', 'text-white');
                btn.classList.remove('bg-gray-200', 'dark:bg-gray-700');
            } else {
                btn.classList.remove('bg-sky-500', 'text-white');
                btn.classList.add('bg-gray-200', 'dark:bg-gray-700');
            }
        });
    };

    speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const speed = parseInt((btn as HTMLElement).dataset.speed || '10', 10);
            appStore.state.appConfig.sponsorDisplaySeconds = speed;
            if (timerSlider) timerSlider.value = speed.toString();
            if (timerValueDisplay) timerValueDisplay.textContent = speed.toString();
            updateSettingsSpeedButtons(speed);
            appStore.debouncedSave();
        });
    });
    updateSettingsSpeedButtons(currentSpeed);

    // Transition effect & countdown
    const transitionSelect = document.getElementById('sponsor-transition-effect') as HTMLSelectElement;
    if (transitionSelect) {
        transitionSelect.value = appStore.state.appConfig.sponsorTransitionEffect || 'fade';
        transitionSelect.onchange = (e) => {
            appStore.state.appConfig.sponsorTransitionEffect = (e.target as HTMLSelectElement).value as any;
            appStore.debouncedSave();
        };
    }

    const countdownCheckbox = document.getElementById('show-sponsor-countdown') as HTMLInputElement;
    if (countdownCheckbox) {
        countdownCheckbox.checked = appStore.state.appConfig.showSponsorCountdown !== false;
        countdownCheckbox.onchange = (e) => {
            appStore.state.appConfig.showSponsorCountdown = (e.target as HTMLInputElement).checked;
            appStore.debouncedSave();
        };
    }

    // Global Sponsor
    const globalSponsorPreview = document.getElementById('global-sponsor-preview') as HTMLImageElement;
    const globalSponsorNameInput = document.getElementById('global-sponsor-name') as HTMLInputElement;
    const globalSponsorUpload = document.getElementById('global-sponsor-upload') as HTMLInputElement;
    
    if (appStore.state.appConfig.globalSponsor) {
        if (appStore.state.appConfig.globalSponsor.image) globalSponsorPreview.src = appStore.state.appConfig.globalSponsor.image;
        globalSponsorNameInput.value = appStore.state.appConfig.globalSponsor.name || '';
    }
    
    globalSponsorNameInput.addEventListener('change', (e) => {
        appStore.state.appConfig.globalSponsor.name = (e.target as HTMLInputElement).value;
        appStore.debouncedSave();
    });

    globalSponsorUpload.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            appStore.state.appConfig.globalSponsor.image = base64;
            globalSponsorPreview.src = base64;
            appStore.debouncedSave();
        }
    });
    
    document.getElementById('generate-global-sponsor-btn')!.addEventListener('click', () => {
        showSponsorImageEditorModal((base64) => {
            appStore.state.appConfig.globalSponsor.image = base64;
            globalSponsorPreview.src = base64;
            appStore.debouncedSave();
        }, appStore.state.appConfig.globalSponsor.name || '');
    });

    document.getElementById('remove-global-sponsor-btn')!.addEventListener('click', () => {
        appStore.state.appConfig.globalSponsor = { name: '', image: '' };
        globalSponsorPreview.src = '';
        globalSponsorNameInput.value = '';
        deleteSponsorImage('global');
        appStore.debouncedSave();
    });

    // Extra Card Sponsor
    const extraCardPreview = document.getElementById('extra-card-sponsor-preview') as HTMLImageElement;
    const extraCardNameInput = document.getElementById('extra-card-sponsor-name') as HTMLInputElement;
    const extraCardUpload = document.getElementById('extra-card-sponsor-upload') as HTMLInputElement;
    const extraCardGenerateBtn = document.getElementById('generate-extra-card-sponsor-btn');
    const extraCardRemoveBtn = document.getElementById('remove-extra-card-sponsor-btn');

    if (!appStore.state.appConfig.extraCardSponsor) {
        appStore.state.appConfig.extraCardSponsor = { name: '', image: '' };
    }
    const extraSponsor = appStore.state.appConfig.extraCardSponsor;
    if (extraCardPreview && extraSponsor.image) extraCardPreview.src = extraSponsor.image;
    if (extraCardNameInput) extraCardNameInput.value = extraSponsor.name || '';

    extraCardNameInput?.addEventListener('input', (e) => {
        appStore.state.appConfig.extraCardSponsor.name = (e.target as HTMLInputElement).value;
        appStore.debouncedSave();
    });

    extraCardUpload?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const base64 = await fileToBase64(file);
            appStore.state.appConfig.extraCardSponsor.image = base64;
            if (extraCardPreview) extraCardPreview.src = base64;
            appStore.debouncedSave();
        }
    });

    extraCardGenerateBtn?.addEventListener('click', () => {
        showSponsorImageEditorModal((base64) => {
            appStore.state.appConfig.extraCardSponsor.image = base64;
            if (extraCardPreview) extraCardPreview.src = base64;
            appStore.debouncedSave();
        }, appStore.state.appConfig.extraCardSponsor.name || '');
    });

    extraCardRemoveBtn?.addEventListener('click', () => {
        appStore.state.appConfig.extraCardSponsor = { name: '', image: '' };
        if (extraCardPreview) extraCardPreview.src = '';
        if (extraCardNameInput) extraCardNameInput.value = '';
        deleteSponsorImage('extraCard');
        appStore.debouncedSave();
    });

    // General Sponsors (Outros Patrocinadores do Evento)
    const generalSponsorsContainer = document.getElementById('general-sponsors-container');
    const addGeneralSponsorBtn = document.getElementById('add-general-sponsor-btn');

    if (!appStore.state.appConfig.generalSponsors) {
        appStore.state.appConfig.generalSponsors = [];
    }

    const renderGeneralSponsorsList = () => {
        if (!generalSponsorsContainer) return;
        generalSponsorsContainer.innerHTML = '';

        const sponsors = appStore.state.appConfig.generalSponsors;
        if (sponsors.length === 0) {
            generalSponsorsContainer.innerHTML = `
                <div class="text-center py-6 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-800/30">
                    <p class="text-sm text-slate-500 dark:text-slate-400 font-medium">Nenhum patrocinador geral cadastrado.</p>
                    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Clique no botão "+ Adicionar Patrocinador" acima para incluir empresas parceiras no telão.</p>
                </div>
            `;
            return;
        }

        sponsors.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'flex flex-col sm:flex-row items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm';

            const preview = document.createElement('img');
            preview.className = 'w-16 h-16 object-contain bg-white dark:bg-gray-900 rounded-lg border border-gray-300 dark:border-gray-600 flex-shrink-0 shadow-inner';
            preview.src = item.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

            const inputWrapper = document.createElement('div');
            inputWrapper.className = 'flex-grow w-full space-y-2';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = item.name || '';
            nameInput.placeholder = `Patrocinador ${index + 1} (Nome da Empresa / Parceiro)`;
            nameInput.className = 'w-full bg-white dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none';
            nameInput.oninput = (e) => {
                item.name = (e.target as HTMLInputElement).value;
                appStore.debouncedSave();
            };

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'flex flex-wrap items-center gap-2';

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.className = 'text-xs text-slate-600 dark:text-slate-400 file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer';
            fileInput.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                    const base64 = await fileToBase64(file);
                    item.image = base64;
                    preview.src = base64;
                    saveSponsorImage('generalSponsor_' + item.id, base64);
                    appStore.debouncedSave();
                }
            };

            const generateBtn = document.createElement('button');
            generateBtn.type = 'button';
            generateBtn.className = 'text-xs bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap';
            generateBtn.textContent = 'Gerar Logo';
            generateBtn.onclick = () => {
                showSponsorImageEditorModal((base64) => {
                    item.image = base64;
                    preview.src = base64;
                    saveSponsorImage('generalSponsor_' + item.id, base64);
                    appStore.debouncedSave();
                }, item.name || 'Patrocinador');
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 p-1.5 rounded-lg font-bold ml-auto transition-colors cursor-pointer';
            deleteBtn.innerHTML = '🗑️ Excluir';
            deleteBtn.onclick = () => {
                appStore.state.appConfig.generalSponsors = appStore.state.appConfig.generalSponsors.filter(g => g.id !== item.id);
                deleteSponsorImage('generalSponsor_' + item.id);
                appStore.debouncedSave();
                renderGeneralSponsorsList();
            };

            actionsDiv.appendChild(fileInput);
            actionsDiv.appendChild(generateBtn);
            actionsDiv.appendChild(deleteBtn);

            inputWrapper.appendChild(nameInput);
            inputWrapper.appendChild(actionsDiv);

            card.appendChild(preview);
            card.appendChild(inputWrapper);
            generalSponsorsContainer.appendChild(card);
        });
    };

    renderGeneralSponsorsList();

    if (addGeneralSponsorBtn) {
        addGeneralSponsorBtn.onclick = () => {
            const newId = 'gs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            appStore.state.appConfig.generalSponsors.push({
                id: newId,
                name: '',
                image: ''
            });
            appStore.debouncedSave();
            renderGeneralSponsorsList();
        };
    }

    // Menu in Break
    const showMenuCheckbox = document.getElementById('show-menu-in-break-checkbox') as HTMLInputElement;
    if (showMenuCheckbox) {
        showMenuCheckbox.checked = appStore.state.appConfig.showMenuInBreak !== false;
        showMenuCheckbox.addEventListener('change', (e) => {
            appStore.state.appConfig.showMenuInBreak = (e.target as HTMLInputElement).checked;
            appStore.debouncedSave();
        });
    }

    // Sponsors by Number
    const enableCheckbox = document.getElementById('enable-sponsors-by-number-checkbox') as HTMLInputElement;
    enableCheckbox.checked = appStore.state.appConfig.enableSponsorsByNumber;
    enableCheckbox.addEventListener('change', (e) => {
        appStore.state.appConfig.enableSponsorsByNumber = (e.target as HTMLInputElement).checked;
        appStore.debouncedSave();
        renderMasterBoard();
    });

    const header = `
        <div class="grid grid-cols-[auto_1fr_1fr] gap-2 items-center text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 px-2">
            <span>${appStore.state.appLabels.settingsSponsorNumberLabel}</span>
            <span>${appStore.state.appLabels.settingsSponsorNameLabel}</span>
            <span>${appStore.state.appLabels.settingsSponsorImageLabel}</span>
        </div>
    `;
    container.innerHTML = header;

    for (let i = 1; i <= 75; i++) {
        const sponsor = appStore.state.appConfig.sponsorsByNumber[i] || { name: '', image: '' };
        
        const row = document.createElement('div');
        row.className = 'grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center p-2 rounded-lg hover:bg-gray-200 dark:bg-gray-700/50';

        const numberLabel = document.createElement('span');
        numberLabel.className = 'font-bold text-lg text-slate-700 dark:text-slate-300';
        numberLabel.textContent = i.toString();

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = sponsor.name;
        nameInput.placeholder = 'Nome do patrocinador...';
        nameInput.className = 'w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white p-2 rounded-md text-sm border border-slate-300 dark:border-gray-600 focus:ring-2 focus:ring-amber-500 outline-none';
        nameInput.addEventListener('input', (e) => {
            if (!appStore.state.appConfig.sponsorsByNumber[i]) appStore.state.appConfig.sponsorsByNumber[i] = { name: '', image: '' };
            appStore.state.appConfig.sponsorsByNumber[i].name = (e.target as HTMLInputElement).value;
            appStore.debouncedSave();
            updateBoardSponsorIndicators();
        });

        const imageContainer = document.createElement('div');
        imageContainer.className = 'flex items-center gap-1';
        
        const generateBtn = document.createElement('button');
        generateBtn.className = 'text-[10px] bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-1 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors whitespace-nowrap';
        generateBtn.textContent = 'Gerar';
        generateBtn.title = 'Gerar logo com nome';
        generateBtn.onclick = () => {
            showSponsorImageEditorModal((base64) => {
                if (!appStore.state.appConfig.sponsorsByNumber[i]) appStore.state.appConfig.sponsorsByNumber[i] = { name: '', image: '' };
                appStore.state.appConfig.sponsorsByNumber[i].image = base64;
                imagePreview.src = base64;
                imagePreview.style.display = 'block';
                appStore.debouncedSave();
                renderMasterBoard();
            }, appStore.state.appConfig.sponsorsByNumber[i]?.name || '');
        };

        const imageInput = document.createElement('input');
        imageInput.type = 'file';
        imageInput.accept = 'image/*';
        imageInput.className = 'text-xs text-slate-600 dark:text-slate-400 file:mr-1 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-[10px] file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 w-24';
        
        const imagePreview = document.createElement('img');
        imagePreview.className = 'w-8 h-8 object-contain rounded bg-white flex-shrink-0';
        if (sponsor.image) {
            imagePreview.src = sponsor.image;
            imagePreview.style.display = 'block';
        } else {
            imagePreview.style.display = 'none';
        }

        imageContainer.appendChild(generateBtn);
        imageContainer.appendChild(imageInput);
        imageContainer.appendChild(imagePreview);
        
        imageInput.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const base64 = await fileToBase64(file);
                if (!appStore.state.appConfig.sponsorsByNumber[i]) appStore.state.appConfig.sponsorsByNumber[i] = { name: '', image: '' };
                appStore.state.appConfig.sponsorsByNumber[i].image = base64;
                imagePreview.src = base64;
                imagePreview.style.display = 'block';
                appStore.debouncedSave();
                renderMasterBoard();
            }
        });

        imageContainer.appendChild(imagePreview);
        imageContainer.appendChild(imageInput);

        const removeImageBtn = document.createElement('button');
        removeImageBtn.innerHTML = '🗑️';
        removeImageBtn.title = 'Remover imagem do patrocinador';
        removeImageBtn.className = 'text-slate-600 dark:text-slate-400 hover:text-red-500 rounded p-1 text-sm transition-colors';
        removeImageBtn.addEventListener('click', () => {
            if (appStore.state.appConfig.sponsorsByNumber[i]) {
                appStore.state.appConfig.sponsorsByNumber[i].image = '';
                deleteSponsorImage(i.toString());
                imageInput.value = '';
                imagePreview.src = '';
                imagePreview.style.display = 'none';
                appStore.debouncedSave();
                renderMasterBoard();
            }
        });

        row.appendChild(numberLabel);
        row.appendChild(nameInput);
        row.appendChild(imageContainer);
        row.appendChild(removeImageBtn);
        container.appendChild(row);
    }
}

function showSponsorImageEditorModal(onSave: (base64: string) => void, initialText: string = '') {
    if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
    
    let modal = document.getElementById('sponsor-image-editor-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sponsor-image-editor-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[70] hidden';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = getModalTemplates().sponsorImageEditor;
    modal.classList.remove('hidden');

    const textInput = document.getElementById('sponsor-editor-text') as HTMLInputElement;
    const subtitleInput = document.getElementById('sponsor-editor-subtitle') as HTMLInputElement;
    const fontSelect = document.getElementById('sponsor-editor-font') as HTMLSelectElement;
    
    const bgInput = document.getElementById('sponsor-editor-bg') as HTMLInputElement;
    const bg2Input = document.getElementById('sponsor-editor-bg2') as HTMLInputElement;
    const colorInput = document.getElementById('sponsor-editor-text-color') as HTMLInputElement;
    const subtitleColorInput = document.getElementById('sponsor-editor-subtitle-color') as HTMLInputElement;
    const borderColorInput = document.getElementById('sponsor-editor-border-color') as HTMLInputElement;
    const borderWidthInput = document.getElementById('sponsor-editor-border-width') as HTMLInputElement;
    const shapeSelect = document.getElementById('sponsor-editor-shape') as HTMLSelectElement;
    const textYInput = document.getElementById('sponsor-editor-text-y') as HTMLInputElement;
    const textXInput = document.getElementById('sponsor-editor-text-x') as HTMLInputElement;
    const textScaleInput = document.getElementById('sponsor-editor-text-scale') as HTMLInputElement;
    const textWidthInput = document.getElementById('sponsor-editor-text-width') as HTMLInputElement;
    
    const customBgInput = document.getElementById('sponsor-editor-custom-bg') as HTMLInputElement;
    const bgOpacityInput = document.getElementById('sponsor-editor-bg-opacity') as HTMLInputElement;
    const saveBgCheckbox = document.getElementById('sponsor-editor-save-bg') as HTMLInputElement;
    const clearBgBtn = document.getElementById('sponsor-editor-clear-bg') as HTMLButtonElement;
    
    let currentCustomBgBase64 = appStore.state.appConfig.sponsorEditorReusableBg || '';
    let customBgImage: HTMLImageElement | null = null;
    bgOpacityInput.value = appStore.state.appConfig.sponsorEditorReusableBgOpacity?.toString() || '100';
    saveBgCheckbox.checked = !!appStore.state.appConfig.sponsorEditorReusableBg;

    const loadCustomBg = () => {
        if (!currentCustomBgBase64) {
            customBgImage = null;
            renderCanvas();
            return;
        }
        const img = new Image();
        img.onload = () => {
            customBgImage = img;
            renderCanvas();
        };
        img.src = currentCustomBgBase64;
    };
    
    if (currentCustomBgBase64) loadCustomBg();
    
    const canvas = document.getElementById('sponsor-editor-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;

    textInput.value = initialText || 'Patrocinador';

    const renderCanvas = () => {
        canvas.width = 1200;
        canvas.height = 630;
        
        // Background Gradient
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, bgInput.value);
        gradient.addColorStop(1, bg2Input.value);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Custom Background Image
        if (customBgImage) {
            ctx.save();
            ctx.globalAlpha = parseInt(bgOpacityInput.value) / 100;
            // Draw image covering the canvas (cover)
            const scale = Math.max(canvas.width / customBgImage.width, canvas.height / customBgImage.height);
            const w = customBgImage.width * scale;
            const h = customBgImage.height * scale;
            const x = (canvas.width - w) / 2;
            const y = (canvas.height - h) / 2;
            ctx.drawImage(customBgImage, x, y, w, h);
            ctx.restore();
        }
        
        // Border
        const borderWidth = parseInt(borderWidthInput.value);
        if (borderWidth > 0) {
            ctx.lineWidth = borderWidth;
            ctx.strokeStyle = borderColorInput.value;
            ctx.strokeRect(borderWidth/2, borderWidth/2, canvas.width - borderWidth, canvas.height - borderWidth);
        }
        
        const fontFamily = fontSelect.value;
        const shape = shapeSelect.value;
        const text = textInput.value || 'Patrocinador';
        const subtitle = subtitleInput.value || '';
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Determine layout based on subtitle and shape
        let contentYOffset = textYInput ? parseInt(textYInput.value) : 0;
        let contentXOffset = textXInput ? parseInt(textXInput.value) : 0;
        let textScale = textScaleInput ? parseInt(textScaleInput.value) / 100 : 1;
        
        if (shape) contentYOffset += 60; // Push text down if shape is present
        
        const centerY = (canvas.height / 2) + contentYOffset;
        const textY = subtitle ? centerY - 40 * textScale : centerY;
        const subtitleY = centerY + 60 * textScale;
        const shapeY = centerY - (subtitle ? 150 : 130) * textScale;
        
        // Draw Shape
        if (shape) {
            const size = 100 * textScale;
            ctx.save();
            ctx.translate(canvas.width / 2, shapeY);
            ctx.fillStyle = colorInput.value;
            
            if (['cross', 'dove', 'rosary'].includes(shape)) {
                // Catholic themed icons using emojis
                ctx.font = `${size}px sans-serif`;
                let icon = '';
                if (shape === 'cross') icon = '✝️';
                if (shape === 'dove') icon = '🕊️';
                if (shape === 'rosary') icon = '📿';
                ctx.fillText(icon, 0, 0);
            } else {
                // Geometric shapes
                ctx.beginPath();
                if (shape === 'circle') {
                    ctx.arc(0, 0, size/2, 0, Math.PI * 2);
                } else if (shape === 'square') {
                    ctx.rect(-size/2, -size/2, size, size);
                } else if (shape === 'triangle') {
                    ctx.moveTo(0, -size/2);
                    ctx.lineTo(size/2, size/2);
                    ctx.lineTo(-size/2, size/2);
                } else if (shape === 'star') {
                    for (let i = 0; i < 5; i++) {
                        ctx.lineTo(Math.cos((18+i*72)/180*Math.PI)*size/2, -Math.sin((18+i*72)/180*Math.PI)*size/2);
                        ctx.lineTo(Math.cos((54+i*72)/180*Math.PI)*size/4, -Math.sin((54+i*72)/180*Math.PI)*size/4);
                    }
                } else if (shape === 'hexagon') {
                    for (let i = 0; i < 6; i++) {
                        ctx.lineTo(size/2 * Math.cos(i * 2 * Math.PI / 6), size/2 * Math.sin(i * 2 * Math.PI / 6));
                    }
                } else if (shape === 'diamond') {
                    ctx.moveTo(0, -size/2); ctx.lineTo(size/2, 0); ctx.lineTo(0, size/2); ctx.lineTo(-size/2, 0);
                } else if (shape === 'pentagon') {
                    for (let i = 0; i < 5; i++) {
                        ctx.lineTo(size/2 * Math.cos((i * 2 * Math.PI / 5) - Math.PI/2), size/2 * Math.sin((i * 2 * Math.PI / 5) - Math.PI/2));
                    }
                } else if (shape === 'octagon') {
                    for (let i = 0; i < 8; i++) {
                        ctx.lineTo(size/2 * Math.cos((i * 2 * Math.PI / 8) - Math.PI/8), size/2 * Math.sin((i * 2 * Math.PI / 8) - Math.PI/8));
                    }
                } else if (shape === 'heart') {
                    const topCurveHeight = size * 0.3;
                    ctx.moveTo(0, size/4);
                    ctx.bezierCurveTo(0, 0, -size/2, 0, -size/2, -size/4);
                    ctx.bezierCurveTo(-size/2, -size/2, 0, -size/2, 0, -size/4);
                    ctx.bezierCurveTo(0, -size/2, size/2, -size/2, size/2, -size/4);
                    ctx.bezierCurveTo(size/2, 0, 0, 0, 0, size/4);
                } else if (shape === 'shield') {
                    ctx.moveTo(0, size/2);
                    ctx.quadraticCurveTo(-size/2, 0, -size/2, -size/2);
                    ctx.lineTo(0, -size/2 - size*0.1);
                    ctx.lineTo(size/2, -size/2);
                    ctx.quadraticCurveTo(size/2, 0, 0, size/2);
                }
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }
        
        const textWidthInput = document.getElementById('sponsor-editor-text-width') as HTMLInputElement;
        const widthPercent = textWidthInput ? parseInt(textWidthInput.value) / 100 : 0.9;
        const maxTextWidth = canvas.width * widthPercent;

        const wrapText = (context: CanvasRenderingContext2D, textStr: string, maxWidth: number) => {
            const words = textStr.split(' ');
            const lines: string[] = [];
            let currentLine = words[0];
            
            for (let i = 1; i < words.length; i++) {
                const word = words[i];
                const width = context.measureText(currentLine + " " + word).width;
                if (width < maxWidth) {
                    currentLine += " " + word;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            }
            lines.push(currentLine);
            return lines;
        };
        
        // Main Text
        let fontSize = 120 * textScale;
        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        
        let lines = wrapText(ctx, text, maxTextWidth);
        while (lines.length > 3 && fontSize > 20) {
            fontSize -= 5;
            ctx.font = `bold ${fontSize}px ${fontFamily}`;
            lines = wrapText(ctx, text, maxTextWidth);
        }
        
        const lineHeight = fontSize * 1.2;
        const totalTextHeight = lines.length * lineHeight;
        
        // Ajustar altura inicial se for mais de uma linha
        let startY = textY - (totalTextHeight / 2) + (lineHeight / 2);
        
        ctx.fillStyle = colorInput.value;
        lines.forEach((line, i) => {
            ctx.fillText(line, (canvas.width / 2) + contentXOffset, startY + (i * lineHeight));
        });
        
        // Subtitle Text
        if (subtitle) {
            let subFontSize = 60 * textScale;
            ctx.font = `normal ${subFontSize}px ${fontFamily}`;
            
            let subLines = wrapText(ctx, subtitle, maxTextWidth);
            while (subLines.length > 2 && subFontSize > 15) {
                subFontSize -= 2;
                ctx.font = `normal ${subFontSize}px ${fontFamily}`;
                subLines = wrapText(ctx, subtitle, maxTextWidth);
            }
            
            const subLineHeight = subFontSize * 1.2;
            const subStartY = subtitleY + (lines.length > 1 ? (lines.length - 1) * lineHeight / 2 : 0);
            
            ctx.fillStyle = subtitleColorInput.value;
            subLines.forEach((line, i) => {
                ctx.fillText(line, (canvas.width / 2) + contentXOffset, subStartY + (i * subLineHeight));
            });
        }
    };

    textInput.addEventListener('input', renderCanvas);
    subtitleInput.addEventListener('input', renderCanvas);
    fontSelect.addEventListener('change', renderCanvas);
    shapeSelect.addEventListener('change', renderCanvas);
    bgInput.addEventListener('input', renderCanvas);
    bg2Input.addEventListener('input', renderCanvas);
    colorInput.addEventListener('input', renderCanvas);
    subtitleColorInput.addEventListener('input', renderCanvas);
    borderColorInput.addEventListener('input', renderCanvas);
    borderWidthInput.addEventListener('input', renderCanvas);
    bgOpacityInput.addEventListener('input', renderCanvas);
    if (textYInput) textYInput.addEventListener('input', renderCanvas);
    if (textXInput) textXInput.addEventListener('input', renderCanvas);
    if (textScaleInput) textScaleInput.addEventListener('input', renderCanvas);
    if (textWidthInput) textWidthInput.addEventListener('input', renderCanvas);
    
    customBgInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            currentCustomBgBase64 = await fileToBase64(file);
            loadCustomBg();
        }
    });

    clearBgBtn.addEventListener('click', () => {
        currentCustomBgBase64 = '';
        customBgInput.value = '';
        loadCustomBg();
    });
    
    // Initial render delay to ensure canvas is properly measured by browser if needed
    setTimeout(renderCanvas, 0);

    const downloadBtn = document.getElementById('download-sponsor-editor-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
            const base64 = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = base64;
            a.download = `patrocinador_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }

    document.getElementById('cancel-sponsor-editor-btn')!.addEventListener('click', () => {
        if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
        modal!.classList.add('hidden');
    });

    document.getElementById('save-sponsor-editor-btn')!.addEventListener('click', () => {
        if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
        
        if (saveBgCheckbox.checked) {
            appStore.state.appConfig.sponsorEditorReusableBg = currentCustomBgBase64;
            appStore.state.appConfig.sponsorEditorReusableBgOpacity = parseInt(bgOpacityInput.value);
        } else {
            appStore.state.appConfig.sponsorEditorReusableBg = '';
            appStore.state.appConfig.sponsorEditorReusableBgOpacity = 100;
        }
        appStore.debouncedSave();

        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        onSave(base64);
        modal!.classList.add('hidden');
    });
}

function showSettingsModal() {
    if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
    const { appConfig, appLabels } = appStore.state;
    DOMElements.settingsModal.innerHTML = getModalTemplates().settings;
    DOMElements.settingsModal.classList.remove('hidden');

    const tabs = ['appearance', 'sponsors', 'labels', 'shortcuts', 'security'];
    
    const switchTab = (targetTabId: string) => {
        tabs.forEach(tabId => {
            document.getElementById(`tab-${tabId}`)!.classList.remove('border-sky-500', 'text-sky-400');
            document.getElementById(`tab-${tabId}`)!.classList.add('border-transparent', 'text-gray-400', 'hover:text-gray-200', 'hover:border-gray-500');
            document.getElementById(`tab-content-${tabId}`)!.classList.add('hidden');
        });
        document.getElementById(`tab-${targetTabId}`)!.classList.add('border-sky-500', 'text-sky-400');
        document.getElementById(`tab-${targetTabId}`)!.classList.remove('border-transparent', 'text-gray-400', 'hover:text-gray-200', 'hover:border-gray-500');
        document.getElementById(`tab-content-${targetTabId}`)!.classList.remove('hidden');
    };

    tabs.forEach(tabId => {
        document.getElementById(`tab-${tabId}`)!.addEventListener('click', () => switchTab(tabId));
    });

    if (typeof (window as any).updateBlockedUsersUI === 'function') {
        (window as any).updateBlockedUsersUI();
    }

    // --- Appearance Tab ---
    const appNameInput = document.getElementById('app-name-input') as HTMLInputElement;
    appNameInput.value = appConfig.appName || 'Bingo Show';
    appNameInput.addEventListener('input', (e) => {
        appStore.state.appConfig.appName = (e.target as HTMLInputElement).value;
        renderAppName();
        appStore.debouncedSave();
    });

    const logoPreview = document.getElementById('custom-logo-preview') as HTMLImageElement;
    if(appConfig.customLogoBase64) logoPreview.src = appConfig.customLogoBase64;
    
    (document.getElementById('custom-logo-upload') as HTMLInputElement).addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            appStore.state.appConfig.customLogoBase64 = await fileToBase64(file);
            logoPreview.src = appStore.state.appConfig.customLogoBase64;
            renderCustomLogo();
            appStore.debouncedSave();
        }
    });

    document.getElementById('remove-custom-logo-btn')!.addEventListener('click', () => {
        appStore.state.appConfig.customLogoBase64 = '';
        logoPreview.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        renderCustomLogo();
        appStore.debouncedSave();
    });
    
    const bingoTitleSelect = document.getElementById('bingo-title-select') as HTMLSelectElement;
    bingoTitleSelect.value = appConfig.bingoTitle;
    bingoTitleSelect.addEventListener('change', (e) => {
        appStore.state.appConfig.bingoTitle = (e.target as HTMLSelectElement).value;
        renderMasterBoard();
        appStore.debouncedSave();
    });

    const boardColorPicker = document.getElementById('board-color-picker') as HTMLInputElement;
    boardColorPicker.value = appConfig.boardColor === 'default' ? '#334155' : appConfig.boardColor;
    boardColorPicker.addEventListener('input', (e) => {
        appStore.state.appConfig.boardColor = (e.target as HTMLInputElement).value;
        renderMasterBoard();
    });
    boardColorPicker.addEventListener('change', () => appStore.debouncedSave());
    
    document.getElementById('reset-board-color-btn')!.addEventListener('click', () => {
        appStore.state.appConfig.boardColor = 'default';
        boardColorPicker.value = '#334155';
        renderMasterBoard();
        appStore.debouncedSave();
    });
    
    const drawnTextColorPicker = document.getElementById('drawn-text-color-picker') as HTMLInputElement;
    drawnTextColorPicker.value = appConfig.drawnTextColor;
    drawnTextColorPicker.addEventListener('input', (e) => appStore.state.appConfig.drawnTextColor = (e.target as HTMLInputElement).value);
    drawnTextColorPicker.addEventListener('change', () => appStore.debouncedSave());

    const drawnStrokeColorPicker = document.getElementById('drawn-stroke-color-picker') as HTMLInputElement;
    drawnStrokeColorPicker.value = appConfig.drawnTextStrokeColor;
    drawnStrokeColorPicker.addEventListener('input', (e) => appStore.state.appConfig.drawnTextStrokeColor = (e.target as HTMLInputElement).value);
    drawnStrokeColorPicker.addEventListener('change', () => appStore.debouncedSave());
    
    const strokeWidthSlider = document.getElementById('drawn-stroke-width-slider') as HTMLInputElement;
    const strokeWidthValue = document.getElementById('drawn-stroke-width-value') as HTMLElement;
    strokeWidthSlider.value = appConfig.drawnTextStrokeWidth.toString();
    strokeWidthValue.textContent = appConfig.drawnTextStrokeWidth.toString();
    strokeWidthSlider.addEventListener('input', (e) => {
        const width = parseInt((e.target as HTMLInputElement).value);
        appStore.state.appConfig.drawnTextStrokeWidth = width;
        strokeWidthValue.textContent = width.toString();
    });
    strokeWidthSlider.addEventListener('change', () => appStore.debouncedSave());

    // PIX Settings (Interval & Donations)
    const pixTitleInput = document.getElementById('pix-title-input') as HTMLInputElement;
    if (pixTitleInput) {
        pixTitleInput.value = appConfig.pixTitle || 'Apoie nossa Instituição com PIX';
        pixTitleInput.addEventListener('input', (e) => {
            appStore.state.appConfig.pixTitle = (e.target as HTMLInputElement).value;
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }

    const pixKeyInput = document.getElementById('pix-key-input') as HTMLInputElement;
    if (pixKeyInput) {
        pixKeyInput.value = appConfig.pixKey || '';
        pixKeyInput.addEventListener('input', (e) => {
            appStore.state.appConfig.pixKey = (e.target as HTMLInputElement).value;
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }
    // --- Dev PIX Config ---
    const devPixKeyInput = document.getElementById('dev-pix-key-input') as HTMLInputElement;
    if (devPixKeyInput) {
        devPixKeyInput.value = appConfig.devPixKey || '';
        devPixKeyInput.addEventListener('input', (e) => {
            appStore.state.appConfig.devPixKey = (e.target as HTMLInputElement).value;
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }

    const devPixQrPreview = document.getElementById('dev-pix-qr-preview') as HTMLImageElement;
    if (devPixQrPreview && appConfig.devPixQrCodeUrl) {
        devPixQrPreview.src = appConfig.devPixQrCodeUrl;
    }

    const devPixQrUpload = document.getElementById('dev-pix-qr-upload') as HTMLInputElement;
    if (devPixQrUpload) {
        devPixQrUpload.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const base64 = await fileToBase64(file);
                appStore.state.appConfig.devPixQrCodeUrl = base64;
                if (devPixQrPreview) devPixQrPreview.src = base64;
                saveDonationSettings(appStore.state.appConfig);
                appStore.debouncedSave();
            }
        });
    }

    const removeDevPixQrBtn = document.getElementById('remove-dev-pix-qr-btn');
    if (removeDevPixQrBtn) {
        removeDevPixQrBtn.addEventListener('click', () => {
            appStore.state.appConfig.devPixQrCodeUrl = '';
            if (devPixQrPreview) devPixQrPreview.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            if (devPixQrUpload) devPixQrUpload.value = '';
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }

    const devPaypalLinkInput = document.getElementById('dev-paypal-link-input') as HTMLInputElement;
    if (devPaypalLinkInput) {
        devPaypalLinkInput.value = appConfig.paypalLink || 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW';
        devPaypalLinkInput.addEventListener('input', (e) => {
            appStore.state.appConfig.paypalLink = (e.target as HTMLInputElement).value;
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }


    const pixQrPreview = document.getElementById('pix-qr-preview') as HTMLImageElement;
    if (pixQrPreview && appConfig.pixQrCodeUrl) {
        pixQrPreview.src = appConfig.pixQrCodeUrl;
    }

    const pixQrUpload = document.getElementById('pix-qr-upload') as HTMLInputElement;
    if (pixQrUpload) {
        pixQrUpload.addEventListener('change', async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const base64 = await fileToBase64(file);
                appStore.state.appConfig.pixQrCodeUrl = base64;
                if (pixQrPreview) pixQrPreview.src = base64;
                saveDonationSettings(appStore.state.appConfig);
                appStore.debouncedSave();
            }
        });
    }

    const removePixQrBtn = document.getElementById('remove-pix-qr-btn');
    if (removePixQrBtn) {
        removePixQrBtn.addEventListener('click', () => {
            appStore.state.appConfig.pixQrCodeUrl = '';
            if (pixQrPreview) pixQrPreview.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            if (pixQrUpload) pixQrUpload.value = '';
            saveDonationSettings(appStore.state.appConfig);
            appStore.debouncedSave();
        });
    }

    
    const sponsorDisplayTimer = document.getElementById('sponsor-display-timer') as HTMLInputElement;
    const sponsorDisplayValue = document.getElementById('sponsor-display-value') as HTMLElement;
    const sponsorTransitionEffect = document.getElementById('sponsor-transition-effect') as HTMLSelectElement;
    const showSponsorCountdownCheckbox = document.getElementById('show-sponsor-countdown') as HTMLInputElement;

    if (sponsorDisplayTimer && appConfig.sponsorDisplaySeconds !== undefined) {
        sponsorDisplayTimer.value = appConfig.sponsorDisplaySeconds.toString();
        sponsorDisplayValue.textContent = appConfig.sponsorDisplaySeconds.toString();
    }
    if (sponsorTransitionEffect && appConfig.sponsorTransitionEffect !== undefined) {
        sponsorTransitionEffect.value = appConfig.sponsorTransitionEffect;
    }
    if (showSponsorCountdownCheckbox && appConfig.showSponsorCountdown !== undefined) {
        showSponsorCountdownCheckbox.checked = appConfig.showSponsorCountdown;
    }

    sponsorDisplayTimer?.addEventListener('input', (e) => {
        const seconds = parseInt((e.target as HTMLInputElement).value);
        appStore.state.appConfig.sponsorDisplaySeconds = seconds;
        if (sponsorDisplayValue) sponsorDisplayValue.textContent = seconds.toString();
    });
    sponsorDisplayTimer?.addEventListener('change', () => appStore.debouncedSave());
    
    sponsorTransitionEffect?.addEventListener('change', (e) => {
        appStore.state.appConfig.sponsorTransitionEffect = (e.target as HTMLSelectElement).value;
        appStore.debouncedSave();
    });

    showSponsorCountdownCheckbox?.addEventListener('change', (e) => {
        appStore.state.appConfig.showSponsorCountdown = (e.target as HTMLInputElement).checked;
        appStore.debouncedSave();
    });

    const autocloseCheckbox = document.getElementById('enable-modal-autoclose') as HTMLInputElement;
    const autocloseTimer = document.getElementById('modal-autoclose-timer') as HTMLInputElement;
    const autocloseValue = document.getElementById('modal-autoclose-value') as HTMLElement;
    autocloseCheckbox.checked = appConfig.enableModalAutoclose;
    autocloseTimer.value = appConfig.modalAutocloseSeconds.toString();
    autocloseValue.textContent = appConfig.modalAutocloseSeconds.toString();
    autocloseCheckbox.addEventListener('change', (e) => {
        appStore.state.appConfig.enableModalAutoclose = (e.target as HTMLInputElement).checked;
        appStore.debouncedSave();
    });
    autocloseTimer.addEventListener('input', (e) => {
        const seconds = parseInt((e.target as HTMLInputElement).value);
        appStore.state.appConfig.modalAutocloseSeconds = seconds;
        autocloseValue.textContent = seconds.toString();
    });
    autocloseTimer.addEventListener('change', () => appStore.debouncedSave());

    const soundEffectsCheckbox = document.getElementById('enable-sound-effects') as HTMLInputElement;
    if (soundEffectsCheckbox) {
        soundEffectsCheckbox.checked = appConfig.enableSoundEffects !== false;
        soundEffectsCheckbox.addEventListener('change', (e) => {
            appStore.state.appConfig.enableSoundEffects = (e.target as HTMLInputElement).checked;
            appStore.debouncedSave();
        });
    }

    const updateHostAuthUI = () => {
        const loginBtn = document.getElementById('host-login-facebook-btn');
        const loginGoogleBtn = document.getElementById('host-login-google-btn');
        const logoutBtn = document.getElementById('host-logout-btn');
        const userInfo = document.getElementById('host-user-info');
        
        if (firebaseUser && !firebaseUser.isAnonymous) {
            if (loginBtn) loginBtn.classList.add('hidden');
            if (loginGoogleBtn) loginGoogleBtn.classList.add('hidden');
            if (logoutBtn) logoutBtn.classList.remove('hidden');
            if (userInfo) {
                userInfo.textContent = `Logado como: ${firebaseUser.displayName || 'Usuário'} (${firebaseUser.email || 'N/A'})`;
                userInfo.classList.remove('hidden');
            }
        } else {
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (loginGoogleBtn) loginGoogleBtn.classList.remove('hidden');
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (userInfo) userInfo.classList.add('hidden');
        }
    };
    
    updateHostAuthUI();
    
    document.getElementById('host-login-facebook-btn')?.addEventListener('click', async () => {
        try {
            const provider = new FacebookAuthProvider();
            await signInWithPopup(auth, provider);
            // onAuthStateChanged will handle the rest
            updateHostAuthUI();
            showAlert("Login com Facebook realizado com sucesso!");
        } catch (e: any) {
            console.error("Login Facebook Host erro:", e);
            showAlert("Erro ao logar com Facebook: " + (e.message || String(e)));
        }
    });

    document.getElementById('host-login-google-btn')?.addEventListener('click', async () => {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            // onAuthStateChanged will handle the rest
            updateHostAuthUI();
            showAlert("Login com Google realizado com sucesso!");
        } catch (e: any) {
            console.error("Login Google Host erro:", e);
            showAlert("Erro ao logar com Google: " + (e.message || String(e)));
        }
    });

    document.getElementById('host-logout-btn')?.addEventListener('click', async () => {
        try {
            await signOut(auth);
            // await signInAnonymously(auth); // re-authenticate as anonymous
            updateHostAuthUI();
            showAlert("Desconectado com sucesso.");
        } catch (e: any) {
            console.error("Logout erro:", e);
            showAlert("Erro ao desconectar.");
        }
    });

    const syncToggle = document.getElementById('online-sync-toggle') as HTMLInputElement;
    syncToggle.checked = appConfig.onlineSyncEnabled === true;
    syncToggle.addEventListener('change', async (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        appStore.state.appConfig.onlineSyncEnabled = checked;
        appStore.debouncedSave();
        if (checked) {
            initFirebaseSync();
        } else {
            if ((window as any).masterBingoClaimsUnsub) {
                (window as any).masterBingoClaimsUnsub();
                (window as any).masterBingoClaimsUnsub = null;
            }
        }
    });

    const sponsorsMobileToggle = document.getElementById('show-sponsors-mobile-toggle') as HTMLInputElement;
    sponsorsMobileToggle.checked = appConfig.showSponsorsOnMobile !== false; // default true
    sponsorsMobileToggle.addEventListener('change', (e) => {
        appStore.state.appConfig.showSponsorsOnMobile = (e.target as HTMLInputElement).checked;
        appStore.debouncedSave();
    });

    const passwordInput = document.getElementById('event-password-input') as HTMLInputElement;
    passwordInput.value = appConfig.eventPassword || '';
    passwordInput.addEventListener('input', (e) => {
        appStore.state.appConfig.eventPassword = (e.target as HTMLInputElement).value;
    });
    passwordInput.addEventListener('change', () => appStore.debouncedSave());

    document.getElementById('force-sync-cards-btn')?.addEventListener('click', async () => {
        if (!eventId || !firebaseUser) return;
        const btn = document.getElementById('force-sync-cards-btn') as HTMLButtonElement;
        const originalText = btn.textContent;
        btn.textContent = "Sincronizando...";
        btn.disabled = true;
        try {
            let currentBatch = writeBatch(db);
            let docCount = 0;
            const entries = Object.entries(appStore.state.cardsData);
            for (const [uuid, cardData] of entries) {
                currentBatch.set(doc(db, "cards", uuid), {
                    hostId: firebaseUser.uid,
                    eventId: eventId,
                    series: cardData.series,
                    numbersString: JSON.stringify(cardData.numbers)
                });
                docCount++;
                if (docCount === 100) {
                    await currentBatch.commit();
                    await new Promise(r => setTimeout(r, 2000));
                    currentBatch = writeBatch(db);
                    docCount = 0;
                }
            }
            if (docCount > 0) {
                await currentBatch.commit();
            }
            btn.textContent = "Concluído!";
            setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
        } catch(e) {
            console.error(e);
            showAlert("Erro ao subir cartelas para a nuvem.");
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
    
    // Updates the sync status UI
    if (appConfig.onlineSyncEnabled && eventId) {
        updateSyncStatusUI();
    }

    const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
    if (themeToggle) {
        themeToggle.checked = appConfig.isDarkMode !== false; // default true
        themeToggle.addEventListener('change', (e) => {
            appStore.state.appConfig.isDarkMode = (e.target as HTMLInputElement).checked;
            applyTheme();
            appStore.debouncedSave();
        });
    }

    // --- Sponsors Tab ---
    populateSettingsSponsorsTab();

    // --- Labels Tab ---
    (document.getElementById('label-prize1Label') as HTMLInputElement).value = appLabels.prize1Label;
    (document.getElementById('label-prize2Label') as HTMLInputElement).value = appLabels.prize2Label;
    (document.getElementById('label-prize3Label') as HTMLInputElement).value = appLabels.prize3Label;
    
    (document.getElementById('label-prize1Label') as HTMLInputElement).addEventListener('change', e => { appLabels.prize1Label = (e.target as HTMLInputElement).value; appStore.debouncedSave(); });
    (document.getElementById('label-prize2Label') as HTMLInputElement).addEventListener('change', e => { appLabels.prize2Label = (e.target as HTMLInputElement).value; appStore.debouncedSave(); });
    (document.getElementById('label-prize3Label') as HTMLInputElement).addEventListener('change', e => { appLabels.prize3Label = (e.target as HTMLInputElement).value; appStore.debouncedSave(); });

    populateSettingsLabelsTab();

    // --- Shortcuts Tab ---
    populateSettingsShortcutsTab();
    
    // --- Bottom Buttons ---
    document.getElementById('generate-test-data-btn')!.addEventListener('click', generateTestData);
    document.getElementById('close-settings-btn')!.addEventListener('click', () => {
        DOMElements.settingsModal.classList.add('hidden');
        applyLabels();
        renderUIFromState(); // To update any visual changes
    });
}

        function generateTestData() {
            appStore.state.gameCount = 6;
            appStore.state.gamesData = {};
            appStore.state.drawnPrizeNumbers = [12, 45, 101, 300]; 
            appStore.state.activeGameNumber = '3';

            for (let i = 1; i <= appStore.state.gameCount; i++) {
                appStore.state.gamesData[i] = {
                    name: `Rodada de Teste ${i}`,
                    prizes: {
                        prize1: predefinedPrizes[i - 1]?.prize1 || '',
                        prize2: predefinedPrizes[i - 1]?.prize2 || '',
                        prize3: predefinedPrizes[i - 1]?.prize3 || ''
                    },
                    description: i === 3 ? 'Esta é uma rodada de teste com descrição.' : '',
                    calledNumbers: Array.from({ length: 30 }, (_, index) => (i - 1) * 5 + index + 1),
                    winners: [],
                    isComplete: false,
                    color: roundColors[(i-1) % roundColors.length],
                };
            }
            
            appStore.state.gamesData[1].winners.push({ id: 101, name: "Maria " + appStore.state.appLabels.prize1Label, prize: appStore.state.gamesData[1].prizes.prize1, gameNumber: '1', bingoType: 'prize1', numbers: appStore.state.gamesData[1].calledNumbers });
            appStore.state.gamesData[2].winners.push({ id: 201, name: "João " + appStore.state.appLabels.prize2Label, prize: appStore.state.gamesData[2].prizes.prize2, gameNumber: '2', bingoType: 'prize2', numbers: appStore.state.gamesData[2].calledNumbers });
            appStore.state.gamesData[2].isComplete = true;
            appStore.state.gamesData[4].winners.push({ id: 401, name: "Pedro Teste", prize: appStore.state.gamesData[4].prizes.prize2, gameNumber: '4', bingoType: 'prize2', numbers: appStore.state.gamesData[4].calledNumbers });
            appStore.state.gamesData[4].isComplete = true;
            appStore.state.gamesData[5].winners.push({ id: 501, name: "Ana " + appStore.state.appLabels.prize3Label, prize: appStore.state.gamesData[5].prizes.prize3, gameNumber: '5', bingoType: 'prize3', numbers: appStore.state.gamesData[5].calledNumbers });
            appStore.state.gamesData[5].isComplete = true;
            appStore.state.gamesData[6].winners.push({ id: 601, name: "Final Evento", prize: appStore.state.gamesData[6].prizes.prize2, gameNumber: '6', bingoType: 'prize2', numbers: appStore.state.gamesData[6].calledNumbers });
            appStore.state.gamesData[6].isComplete = true;

            if (!appStore.state.gamesData['Brindes']) appStore.state.gamesData['Brindes'] = { winners: [], calledNumbers: [] };
            appStore.state.gamesData['Brindes'].winners.push({ id: 901, name: "Carla", prize: "Ventilador", gameNumber: 'Brinde', bingoType: 'Sorteio', cartela: '12' });
            appStore.state.gamesData['Brindes'].winners.push({ id: 902, name: "Ronaldo", prize: "Rádio", gameNumber: 'Brinde', bingoType: 'Sorteio', cartela: '101' });

            if (!appStore.state.gamesData['Leilão']) appStore.state.gamesData['Leilão'] = { winners: [], calledNumbers: [] };
            appStore.state.gamesData['Leilão'].winners.push({ id: 1001, name: "Marcos", prize: "Bolo (Leilão)", gameNumber: 'Leilão', bingoType: 'Leilão', itemName: "Bolo de Chocolate", bid: "150" });
            
            appStore.state.appConfig.isEventClosed = false;
            appStore.state.activeGameNumber = '3';
            appStore.state.gamesData[3].calledNumbers = appStore.state.gamesData[3].calledNumbers.slice(0, 10);

            appStore.saveStateToLocalStorage();
            showAlert("Dados de teste gerados com sucesso! O aplicativo será recarregado com o novo histórico.");
            DOMElements.settingsModal.classList.add('hidden');
            setTimeout(() => window.location.reload(), 1500);
        }
        
        // --- Funções Auxiliares ---

let fsConfettiInstance: any = null;

function getConfettiFn() {
    if (typeof confetti !== 'function') return null;
    
    if (document.fullscreenElement) {
         const fsElement = document.fullscreenElement;
         let canvas = document.getElementById('fs-confetti-canvas') as HTMLCanvasElement;
         if (!canvas) {
             canvas = document.createElement('canvas');
             canvas.id = 'fs-confetti-canvas';
             canvas.style.position = 'fixed';
             canvas.style.inset = '0';
             canvas.style.width = '100%';
             canvas.style.height = '100%';
             canvas.style.pointerEvents = 'none';
             canvas.style.zIndex = '1000';
             fsElement.appendChild(canvas);
             fsConfettiInstance = confetti.create(canvas, { resize: true, useWorker: true });
         } else {
             if (canvas.parentNode !== fsElement) {
                 fsElement.appendChild(canvas);
             }
             if (!fsConfettiInstance) {
                 fsConfettiInstance = confetti.create(canvas, { resize: true, useWorker: true });
             }
         }
         return fsConfettiInstance;
    }
    return confetti;
}

function triggerConfetti(options = {}) {
    const defaults = {
        particleCount: 150,
        spread: 180,
        origin: { y: 0.6 },
        zIndex: 1000,
    };
    const c = getConfettiFn();
    if (c) {
        c({ ...defaults, ...options });
    }
}

function triggerBingoWinConfetti() {
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    function randomInRange(min: number, max: number) {
        return Math.random() * (max - min) + min;
    }

    if (confettiAnimationId) {
        clearInterval(confettiAnimationId);
    }

    const interval = setInterval(function() {
        const c = getConfettiFn();
        if (!c) {
             clearInterval(interval);
             return;
        }

        const particleCount = 50; // Efeito contínuo com contagem fixa de partículas
        c({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
        c({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
    }, 250);
    confettiAnimationId = interval as unknown as number;
}

function applyBoardZoom(scale: number) {
    const wrapper = DOMElements.bingoBoardWrapper;
    const zoomValueEl = document.getElementById('board-zoom-value');
    if (wrapper) {
        // Use CSS zoom (cleanest approach that updates layout properly in Chromium)
        wrapper.style.zoom = `${scale}%`;
    }
    if (zoomValueEl) {
        zoomValueEl.textContent = `${scale}%`;
    }
}

function applyDisplayZoom(scale: number) {
    const wrapper = DOMElements.currentNumberWrapper;
    const zoomValueEl = document.getElementById('display-zoom-value');
    const fsZoomValueEl = document.getElementById('fs-display-zoom-value');
    if (wrapper) {
        wrapper.style.zoom = `${scale}%`;
    }
     if (zoomValueEl) {
        zoomValueEl.textContent = `${scale}%`;
    }
    if (fsZoomValueEl) {
        fsZoomValueEl.textContent = `${scale}%`;
    }
}

function applyAuctionZoom(scale: number) {
    const wrapper = document.getElementById('auction-form') as HTMLFormElement;
    if (wrapper) {
        wrapper.style.zoom = `${scale}%`;
    }
    const fsZoomValueEl = document.getElementById('fs-auction-zoom-value');
    if (fsZoomValueEl) {
        fsZoomValueEl.textContent = `${scale}%`;
    }
    const zoomValueEl = document.getElementById('auction-zoom-value');
    if (zoomValueEl) {
        zoomValueEl.textContent = `${scale}`;
    }
    const auctionZoomSlider = document.getElementById('auction-zoom-slider') as HTMLInputElement;
    if (auctionZoomSlider && auctionZoomSlider.value !== scale.toString()) {
        auctionZoomSlider.value = scale.toString();
    }
    const fsAuctionZoomSlider = document.getElementById('fs-auction-zoom-slider') as HTMLInputElement;
    if (fsAuctionZoomSlider && fsAuctionZoomSlider.value !== scale.toString()) {
        fsAuctionZoomSlider.value = scale.toString();
    }
}

        const fileToBase64 = (file: File): Promise<string> =>
            new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        const maxDim = 1000;
                        if (width > maxDim || height > maxDim) {
                            if (width > height) {
                                height = Math.round((height * maxDim) / width);
                                width = maxDim;
                            } else {
                                width = Math.round((width * maxDim) / height);
                                height = maxDim;
                            }
                        }
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx?.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/webp', 0.85));
                    };
                    img.onerror = reject;
                    img.src = event.target?.result as string;
                };
                reader.onerror = error => reject(error);
            });
            
        function applyLabels() {
            const { appLabels } = appStore.state;
            for (const key in appLabels) {
                const elements = document.querySelectorAll(`[data-label-key="${key}"]`);
                elements.forEach(el => {
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                        el.placeholder = appLabels[key as keyof typeof appLabels];
                    } else if (el.tagName === 'LABEL') {
                        const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
                        if (textNode) textNode.textContent = appLabels[key as keyof typeof appLabels];
                    }
                    else {
                        el.textContent = appLabels[key as keyof typeof appLabels];
                    }
                });
            }
             renderAppName();
            (document.getElementById('no-active-round-panel') as HTMLElement).textContent = appLabels.activeRoundIndicatorDefault;
            
            document.querySelectorAll('.prize-input-label').forEach((label, index) => {
                label.textContent = `${appLabels[('prize' + (index % 3 + 1) + 'Label') as keyof typeof appLabels]}:`;
            });
            renderUpdateInfo(); 
        }

        function hexToRgba(hex: string, alpha = 1) {
            if (!hex || !/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) return null;
            let c: any = hex.substring(1).split('');
            if (c.length === 3) { c = [c[0], c[0], c[1], c[1], c[2], c[2]]; }
            c = '0x' + c.join('');
            return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${alpha})`;
        }

        function isLightColor(hex: string) {
            if (!hex || hex === 'default') return false; 
            const color = hex.startsWith('#') ? hex.slice(1) : hex;
            const r = parseInt(color.substring(0, 2), 16);
            const g = parseInt(color.substring(2, 4), 16);
            const b = parseInt(color.substring(4, 6), 16);
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b; 
            return luma > 160;
        }

        function findNextGameNumber() {
            const sortedGameNumbers = Object.keys(appStore.state.gamesData).filter(key => !isNaN(parseInt(key))).map(Number).sort((a, b) => a - b);
            for (const num of sortedGameNumbers) { if (!appStore.state.gamesData[num].isComplete) return num.toString(); }
            return null;
        }

        function areAllGamesComplete() {
            const gameKeys = Object.keys(appStore.state.gamesData).filter(key => !isNaN(parseInt(key)));
            if (gameKeys.length === 0) return false;
            return gameKeys.every(key => appStore.state.gamesData[key].isComplete);
        }

        function updateProgramTitle() {
            document.title = "Bingo Show";
        }

        function applyTheme() {
            const isDark = appStore.state.appConfig.isDarkMode !== false;
            if (isDark) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
            if (themeToggle) themeToggle.checked = isDark;
            updateCurrentNumberDisplay();
        }

        function renderAppName() {
            const mainTitle = appStore.state.appConfig.appName || `Bingo Show`;
            DOMElements.mainTitle.innerHTML = `<span class="text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 [-webkit-text-stroke:2px_#78350f] filter drop-shadow-lg">${mainTitle}</span><span id="subtitle-version" class="block mt-2 text-lg sm:text-xl md:text-2xl text-amber-100 font-semibold tracking-normal normal-case [-webkit-text-stroke:1px_#78350f] drop-shadow-md pb-2"></span>`;
        }
        
        function renderUpdateInfo() {
            const now = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            if (document.getElementById('version')) document.getElementById('version')!.innerText = currentVersion;
            const subtitle = document.getElementById('subtitle-version');
            if (subtitle) subtitle.innerText = `Versão ${currentVersion}`;
            if (DOMElements.lastUpdated) DOMElements.lastUpdated.innerText = `Sincronizado: ${now}`;
            
            const buildFooter = document.getElementById('build-footer');
            if (buildFooter) buildFooter.innerText = buildInfo;
        }
        
        // --- Funções de Salvamento Resilientes com Fallback ---
        const DB_NAME = 'BingoShowDB';
        const STORE_NAME_IMAGES = 'sponsorImages';
        const STORE_NAME_CARDS = 'cards';
        let dbPromise: Promise<IDBDatabase> | null = null;
        let isIndexedDBAvailable = true;

        // Memória temporária para imagens e cartelas caso IndexedDB falhe
        const memoryImagesStore: Record<string, string> = {};
        const memoryCardsStore: Record<string, any> = {};

        function openDb(): Promise<IDBDatabase> {
            if (!isIndexedDBAvailable) {
                return Promise.reject("IndexedDB está desativado ou indisponível.");
            }
            if (!dbPromise) {
                dbPromise = new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        console.warn("[Storage] Timeout ao conectar com IndexedDB. Usando modo memória.");
                        isIndexedDBAvailable = false;
                        reject("Timeout IndexedDB");
                    }, 1500);

                    try {
                        if (typeof indexedDB === 'undefined') {
                            clearTimeout(timeoutId);
                            isIndexedDBAvailable = false;
                            reject("IndexedDB não suportado neste navegador.");
                            return;
                        }
                        const request = indexedDB.open(DB_NAME, 2);
                        request.onblocked = () => {
                            clearTimeout(timeoutId);
                            console.warn("[Storage] Conexão com IndexedDB bloqueada por outra aba/processo.");
                            isIndexedDBAvailable = false;
                            reject("IndexedDB bloqueado");
                        };
                        request.onerror = (e) => {
                            clearTimeout(timeoutId);
                            console.error("[Storage] Erro ao abrir IndexedDB, caindo para modo memória temporária.", e);
                            isIndexedDBAvailable = false;
                            reject("Erro ao abrir IndexedDB.");
                        };
                        request.onsuccess = () => {
                            clearTimeout(timeoutId);
                            resolve(request.result);
                        };
                        request.onupgradeneeded = (event) => {
                            const db = (event.target as IDBOpenDBRequest).result;
                            if (!db.objectStoreNames.contains(STORE_NAME_IMAGES)) {
                                db.createObjectStore(STORE_NAME_IMAGES, { keyPath: 'id' });
                            }
                            if (!db.objectStoreNames.contains(STORE_NAME_CARDS)) {
                                db.createObjectStore(STORE_NAME_CARDS, { keyPath: 'uuid' });
                            }
                        };
                    } catch (err) {
                        clearTimeout(timeoutId);
                        console.error("[Storage] Exceção ao inicializar IndexedDB (pode ser restrição de iframe do Chrome):", err);
                        isIndexedDBAvailable = false;
                        reject(err);
                    }
                });
            }
            return dbPromise;
        }

        async function saveSponsorImage(id: string, image: string) {
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_IMAGES, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME_IMAGES);
                    const request = store.put({ id, image });
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject("Failed to save image to IndexedDB.");
                });
            } catch (error) {
                console.warn(`[Storage] Usando backup em memória para salvar imagem do patrocinador '${id}':`, error);
                memoryImagesStore[id] = image;
            }
        }

        async function deleteSponsorImage(id: string) {
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_IMAGES, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME_IMAGES);
                    const request = store.delete(id);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject("Failed to delete image from IndexedDB.");
                });
            } catch (error) {
                console.warn(`[Storage] Usando backup em memória para deletar imagem do patrocinador '${id}':`, error);
                delete memoryImagesStore[id];
            }
        }

        async function clearAllSponsorImages() {
            for (const key in memoryImagesStore) {
                delete memoryImagesStore[key];
            }
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_IMAGES, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME_IMAGES);
                    const request = store.clear();
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject("Failed to clear images from IndexedDB.");
                });
            } catch (e) {
                console.warn("[Storage] Limpando cache de imagens em memória:", e);
            }
        }

        async function clearCardsDB() {
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_CARDS, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME_CARDS);
                    const request = store.clear();
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject("Failed to clear cards from IndexedDB.");
                });
            } catch (e) {
                console.warn("[Storage] Limpando cartelas em memória:", e);
                for (const key in memoryCardsStore) {
                    delete memoryCardsStore[key];
                }
            }
        }

        async function saveCardsBatchToDB(cardsObj: Record<string, any>) {
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_CARDS, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME_CARDS);
                    Object.entries(cardsObj).forEach(([uuid, data]) => {
                        store.put({ uuid, ...data });
                    });
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject("Failed to save cards batch to IndexedDB.");
                });
            } catch (error) {
                console.warn("[Storage] Gravando cartelas temporariamente em memória por indisponibilidade do banco:", error);
                Object.entries(cardsObj).forEach(([uuid, data]) => {
                    memoryCardsStore[uuid] = data;
                });
            }
        }

        async function loadAllCardsFromDB(): Promise<Record<string, any>> {
            try {
                const db = await openDb();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_CARDS, 'readonly');
                    const store = transaction.objectStore(STORE_NAME_CARDS);
                    const request = store.getAll();
                    request.onsuccess = () => {
                        const cardsObj: Record<string, any> = {};
                        request.result.forEach((item: any) => {
                            const { uuid, ...rest } = item;
                            cardsObj[uuid] = rest;
                        });
                        resolve(cardsObj);
                    };
                    request.onerror = () => reject("Failed to load cards from IndexedDB.");
                });
            } catch (error) {
                console.warn("[Storage] Carregando cartelas a partir do cache em memória por indisponibilidade do banco:", error);
                return { ...memoryCardsStore };
            }
        }

        async function loadSponsorImages() {
            try {
                const db = await openDb();
                return new Promise<void>((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME_IMAGES, 'readonly');
                    const store = transaction.objectStore(STORE_NAME_IMAGES);
                    const request = store.getAll();

                    request.onsuccess = () => {
                        const images = request.result;
                        images.forEach(item => {
                            if (item.id === 'global' && appStore.state.appConfig.globalSponsor) {
                                appStore.state.appConfig.globalSponsor.image = item.image;
                            }
                            else if (item.id === 'extraCard' && appStore.state.appConfig.extraCardSponsor) {
                                appStore.state.appConfig.extraCardSponsor.image = item.image;
                            }
                            else if (item.id === 'prizeDraw' && appStore.state.appConfig.prizeDrawSponsor) {
                                appStore.state.appConfig.prizeDrawSponsor.image = item.image;
                            }
                            else if (item.id.startsWith('generalSponsor_') && appStore.state.appConfig.generalSponsors) {
                                const gId = item.id.replace('generalSponsor_', '');
                                const target = appStore.state.appConfig.generalSponsors.find(g => g.id === gId);
                                if (target) target.image = item.image;
                            }
                            else if (item.id === 'customLogo') {
                                appStore.state.appConfig.customLogoBase64 = item.image;
                            }
                            else if (item.id === 'sponsorEditorBg') {
                                appStore.state.appConfig.sponsorEditorReusableBg = item.image;
                            }
                            else if (appStore.state.appConfig.sponsorsByNumber[item.id]) {
                                appStore.state.appConfig.sponsorsByNumber[item.id].image = item.image;
                            }
                        });
                        resolve();
                    };
                    request.onerror = () => reject("Failed to load images from IndexedDB.");
                });
            } catch (error) {
                console.warn("[Storage] Carregando patrocinadores a partir do cache em memória:", error);
                if (memoryImagesStore['global'] && appStore.state.appConfig.globalSponsor) {
                    appStore.state.appConfig.globalSponsor.image = memoryImagesStore['global'];
                }
                if (memoryImagesStore['extraCard'] && appStore.state.appConfig.extraCardSponsor) {
                    appStore.state.appConfig.extraCardSponsor.image = memoryImagesStore['extraCard'];
                }
                if (memoryImagesStore['prizeDraw'] && appStore.state.appConfig.prizeDrawSponsor) {
                    appStore.state.appConfig.prizeDrawSponsor.image = memoryImagesStore['prizeDraw'];
                }
                if (appStore.state.appConfig.generalSponsors) {
                    appStore.state.appConfig.generalSponsors.forEach(g => {
                        if (memoryImagesStore['generalSponsor_' + g.id]) {
                            g.image = memoryImagesStore['generalSponsor_' + g.id];
                        }
                    });
                }
                if (memoryImagesStore['customLogo']) {
                    appStore.state.appConfig.customLogoBase64 = memoryImagesStore['customLogo'];
                }
                if (memoryImagesStore['sponsorEditorBg']) {
                    appStore.state.appConfig.sponsorEditorReusableBg = memoryImagesStore['sponsorEditorBg'];
                }
                for (const num in memoryImagesStore) {
                    if (num !== 'global' && num !== 'extraCard' && !num.startsWith('generalSponsor_') && num !== 'customLogo' && num !== 'sponsorEditorBg' && appStore.state.appConfig.sponsorsByNumber[num]) {
                        appStore.state.appConfig.sponsorsByNumber[num].image = memoryImagesStore[num];
                    }
                }
            }
        }

        async function saveStateToFile() {
            try {
                appStore.saveStateToLocalStorage();
        
                // Include cards true for backup file
                const appState = appStore.getAppStateForSaving(true);
                const stateString = JSON.stringify(appState, null, 2); 
                const blob = new Blob([stateString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
        
                const a = document.createElement('a');
                a.href = url;
                const date = new Date().toISOString().slice(0, 10); 
                a.download = `bingo-show-backup-${date}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showAlert("Backup salvo com sucesso no seu computador!");
        
            } catch (error) {
                console.error("Falha ao salvar o estado em arquivo:", error);
                showAlert("Ocorreu um erro ao tentar salvar o backup.");
            }
        }
        
        function loadStateFromFile(event: Event) {
            const input = event.target as HTMLInputElement;
            if (!input.files || input.files.length === 0) {
                return;
            }
        
            const file = input.files[0];
            input.value = '';
            
            const reader = new FileReader();
        
            reader.onload = async (e) => {
                try {
                    const result = e.target?.result as string;
                    if (!result) throw new Error("Arquivo vazio ou ilegível.");
                    
                                        const loadedState = JSON.parse(result);
                    
                    if (!loadedState.gamesData || !loadedState.appConfig) {
                         throw new Error("O arquivo selecionado não parece ser um backup válido do Bingo Show.");
                    }

                    const currentEventId = appStore.state.appConfig.eventId;
                    let keepCurrentQr = false;
                    if (currentEventId && loadedState.appConfig.eventId && currentEventId !== loadedState.appConfig.eventId) {
                        keepCurrentQr = confirm(`Este backup pertence a um evento/painel diferente.

Deseja MANTER o seu QR Code/Link atual para o público?

[OK] Sim, manter o link atual.
[Cancelar] Não, restaurar o link do backup.`);
                    }

                    appStore.loadStateFromObject(loadedState);
                    
                    if (keepCurrentQr && currentEventId) {
                        appStore.state.appConfig.eventId = currentEventId;
                        appStore.state.appConfig.onlineSyncEnabled = true;
                    }
                    
                    
                    // If file has cards, save them to IDB
                    if (loadedState.cardsData) {
                        try {
                            await saveCardsBatchToDB(loadedState.cardsData);
                        } catch (err) {
                            console.error("Erro ao importar cartelas pro banco local", err);
                        }
                    }

                    renderUIFromState();
                    applyLabels();
                    appStore.debouncedSave();
                    showAlert("Backup carregado com sucesso! O evento foi restaurado.");
        
                } catch (error: any) {
                    console.error("Falha ao carregar estado do arquivo:", error);
                    showAlert(`Erro ao carregar o arquivo: ${error.message}`);
                }
            };
        
            reader.onerror = () => {
                showAlert("Não foi possível ler o arquivo selecionado.");
            };
        
            reader.readAsText(file);
        }

        function renderUIFromState() {
            const { gamesData, activeGameNumber, appConfig } = appStore.state;
            applyTheme();
            renderCustomLogo();
            renderMasterBoard();
            DOMElements.gamesListEl.innerHTML = '';
            
            const fsRoundSelector = document.getElementById('fs-round-selector') as HTMLSelectElement | null;
            if (fsRoundSelector) fsRoundSelector.innerHTML = '';
        
            if (Object.keys(gamesData).length > 0) {
                const sortedGameNumbers = Object.keys(gamesData).filter(key => !isNaN(parseInt(key))).sort((a, b) => parseInt(a) - parseInt(b));
                for (const gameNum of sortedGameNumbers) {
                    if (gamesData[gameNum] && typeof gamesData[gameNum] === 'object') {
                        const gameEl = createGameElement(parseInt(gameNum), gamesData[gameNum].prizes);
                        DOMElements.gamesListEl.appendChild(gameEl);
                        updateGameItemUI(gameEl, gamesData[gameNum].isComplete);
                        
                        if (fsRoundSelector) {
                            const opt = document.createElement('option');
                            opt.value = gameNum.toString();
                            opt.text = gamesData[gameNum].name || `Rodada ${gameNum}`;
                            if (gameNum.toString() === appStore.state.activeGameNumber) opt.selected = true;
                            fsRoundSelector.appendChild(opt);
                        }
                    }
                }
            }
        
            renderAllWinners();
            renderShortcutsLegend();
        
            if (Object.values(gamesData).some(game => (game as any).winners && (game as any).winners.length > 0)) {
                DOMElements.shareBtn.classList.remove('hidden');
                DOMElements.endEventBtn.classList.remove('hidden');
            }
        
            const boardZoomSlider = document.getElementById('board-zoom-slider') as HTMLInputElement;
            const displayZoomSlider = document.getElementById('display-zoom-slider') as HTMLInputElement;
            const auctionZoomSliderInput = document.getElementById('auction-zoom-slider') as HTMLInputElement;
            if (boardZoomSlider) boardZoomSlider.value = appConfig.boardScale.toString();
            if (displayZoomSlider) displayZoomSlider.value = appConfig.displayScale.toString();
            if (auctionZoomSliderInput && appConfig.auctionScale) auctionZoomSliderInput.value = appConfig.auctionScale.toString();
            applyBoardZoom(appConfig.boardScale);
            applyDisplayZoom(appConfig.displayScale);
            if (appConfig.auctionScale) applyAuctionZoom(appConfig.auctionScale);
        
            DOMElements.noRepeatPrizeDrawCheckbox.checked = true;
        
            document.querySelectorAll('.game-item').forEach(el => el.classList.remove('active-round-highlight'));
            if (activeGameNumber && gamesData[activeGameNumber]) {
                const activeGameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${activeGameNumber}"]`);
                if (activeGameItem) {
                    activeGameItem.classList.add('active-round-highlight');
                    const playBtn = activeGameItem.querySelector('.play-btn');
                    if (playBtn) {
                        playBtn.textContent = '▶️ Jogando...';
                        playBtn.className = 'w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-lg play-btn playing-btn';
                    }
                }
                loadRoundState(activeGameNumber);
            } else {
                loadRoundState(null);
            }

            updateLastPrizesDisplay();
        }

        // --- Funções do Jogo ---

        function announceNumber(number: number) {
            const { activeGameNumber, gamesData, appLabels, appConfig } = appStore.state;
            if (!activeGameNumber) {
                showAlert("Por favor, selecione uma rodada clicando em 'Jogar' para iniciar.");
                return;
            }
            const game = gamesData[activeGameNumber];
            if (!game) {
                console.error(`Erro: Rodada ativa ${activeGameNumber} não encontrada.`);
                return;
            }
            if (game.calledNumbers.includes(number)) {
                showError(`O número ${number} já foi anunciado.`);
                return;
            }
            
            if (appConfig.enableSoundEffects) sounds.playDrawNumber();

            const letter = getLetterForNumber(number);
            if (!letter) {
                showError(`Número inválido. Digite um valor entre 1 e 75.`);
                return;
            }
            DOMElements.mainDisplayLabel.textContent = appLabels.announcedNumberLabel;
            const currentNumberEl = DOMElements.currentNumberEl as HTMLElement;
            DOMElements.prizeDrawDisplayContainer.classList.add('hidden'); 
            
            const mainColor = appConfig.drawnTextColor;
            const strokeColor = appConfig.drawnTextStrokeColor;
            const strokeWidth = appConfig.drawnTextStrokeWidth;
            let strokeStyle = `${strokeWidth}px ${strokeColor}`;
            
            const roundColor = gamesData[activeGameNumber]?.color;
            const isDarkTheme = document.documentElement.classList.contains('dark');
            const defaultBg = isDarkTheme ? '#1e293b' : '#f1f5f9';
            const bgColor = roundColor || (appConfig.boardColor !== 'default' ? appConfig.boardColor : defaultBg);
            currentNumberEl.style.backgroundColor = bgColor;
            
            currentNumberEl.style.color = mainColor;
            currentNumberEl.style.webkitTextStroke = strokeStyle; 

            currentNumberEl.innerHTML = `<span>${letter}</span><span>${number}</span>`;
            currentNumberEl.style.visibility = 'visible';

            currentNumberEl.classList.remove('animate-bounce-in');
            void currentNumberEl.offsetWidth; 
            currentNumberEl.classList.add('animate-bounce-in');

            // --- NOVO: Brilho ao sortear número ---
            currentNumberEl.style.boxShadow = `0 0 40px 10px ${bgColor}`;
            
            // Confete removido deste local conforme pedido: "deixe somente para sorteio de cartelas"
            // ------------------------------------------------
            
            updateMasterBoardCell(number);
            updateLastNumbers(letter, number, true);
            updateActiveRoundStats();
            
            const activeGameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${activeGameNumber}"]`);
            if (activeGameItem) {
                 const game = gamesData[activeGameNumber];
                 updateGameItemUI(activeGameItem, game.isComplete);
            }
            
            DOMElements.numberInput.value = '';
            DOMElements.letterInput.value = '';
            appStore.debouncedSave();
        }

        function showFloatingNumber(number: number) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            if (!activeGameNumber) {
                showAlert("Por favor, selecione uma rodada clicando em 'Jogar' para iniciar.");
                return;
            }
            const game = gamesData[activeGameNumber];
            if (!game) {
                console.error(`Erro: Rodada ativa ${activeGameNumber} não encontrada.`);
                return;
            }

            if (game.calledNumbers.includes(number)) {
                showError(`O número ${number} já foi anunciado.`);
                return;
            }

            appStore.state.pendingNumber = number;
            appStore.debouncedFirebaseSync(true);

            const individualSponsor = appConfig.sponsorsByNumber[number];
            const globalSponsor = appConfig.globalSponsor;

            if (appConfig.enableSponsorsByNumber && individualSponsor && individualSponsor.image) {
                showSponsorDisplayModal(number, individualSponsor);
            } else if (appConfig.enableSponsorsByNumber && globalSponsor && globalSponsor.image) {
                showSponsorDisplayModal(number, globalSponsor);
            }
            else {
                showClassicFloatingNumberModal(number);
            }
        }

        function showClassicFloatingNumberModal(number: number) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            DOMElements.floatingNumberModal.innerHTML = getModalTemplates().floatingNumber;
            const game = gamesData[activeGameNumber!];
            if (!game) {
                 console.error(`Rodada ativa ${activeGameNumber} não encontrada.`);
                 DOMElements.floatingNumberModal.classList.add('hidden');
                 return;
            }

            const floatingNumberDisplay = document.getElementById('floating-number-display') as HTMLElement;
            const displayWrapper = document.getElementById('floating-number-display-wrapper') as HTMLElement;
            const zoomValue = document.getElementById('floating-number-zoom-value')!;
            const zoomOutBtn = document.getElementById('zoom-out-btn-floating')!;
            const zoomInBtn = document.getElementById('zoom-in-btn-floating')!;
            const confirmFloatingBtn = document.getElementById('confirm-floating-btn')!;
            const cancelFloatingBtn = document.getElementById('cancel-floating-btn')!;

            const letter = getLetterForNumber(number);
            const roundColor = game.color;
            const mainColor = appConfig.drawnTextColor;
            const strokeColor = appConfig.drawnTextStrokeColor;
            const strokeWidth = appConfig.drawnTextStrokeWidth;
            let strokeStyle = `${strokeWidth}px ${strokeColor}`;
            let bgColorStyle = `background-color: ${roundColor || '#0ea5e9'};`;
            
            floatingNumberDisplay.innerHTML = `<span>${letter}</span><span>${number}</span>`;
            floatingNumberDisplay.style.cssText += `color: ${mainColor}; -webkit-text-stroke: ${strokeStyle}; ${bgColorStyle}`;
            
            const applyZoom = (scale: number) => {
                displayWrapper.style.transform = `scale(${scale / 100})`;
                if (zoomValue) zoomValue.textContent = `${scale}%`;
                appStore.state.appConfig.floatingNumberZoom = scale;
            };

            const adjustZoom = (amount: number) => {
                 const newZoom = Math.max(50, Math.min(200, appStore.state.appConfig.floatingNumberZoom + amount));
                 applyZoom(newZoom);
                 appStore.debouncedSave();
            };

            const initialZoom = appStore.state.appConfig.floatingNumberZoom || 100;
            applyZoom(initialZoom);

            zoomInBtn.addEventListener('click', () => adjustZoom(5));
            zoomOutBtn.addEventListener('click', () => adjustZoom(-5));

            DOMElements.floatingNumberModal.classList.remove('hidden');

            const cleanup = () => {
                appStore.state.pendingNumber = null;
                appStore.debouncedFirebaseSync(true);
                document.removeEventListener('keydown', handleKeydown);
                clearTimeout(floatingNumberTimeout as ReturnType<typeof setTimeout>);
            };

            const confirmAndClose = () => {
                cleanup();
                DOMElements.floatingNumberModal.classList.add('hidden');
                announceNumber(number);
            };

            const cancelAndClose = () => {
                cleanup();
                DOMElements.floatingNumberModal.classList.add('hidden');
            };

            const handleKeydown = (e: KeyboardEvent) => {
                switch (e.key) {
                    case '+': e.preventDefault(); adjustZoom(5); break;
                    case '-': e.preventDefault(); adjustZoom(-5); break;
                    case 'Enter': e.preventDefault(); confirmAndClose(); break;
                    case 'Escape': e.preventDefault(); cancelAndClose(); break;
                }
            };
            document.addEventListener('keydown', handleKeydown);

            confirmFloatingBtn.addEventListener('click', confirmAndClose);
            cancelFloatingBtn.addEventListener('click', cancelAndClose);

            clearTimeout(floatingNumberTimeout as ReturnType<typeof setTimeout>);

            if (appConfig.enableModalAutoclose) {
                floatingNumberTimeout = setTimeout(confirmAndClose, appConfig.modalAutocloseSeconds * 1000);
            }
        }

        function showSponsorDisplayModal(number: number, sponsor: any) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            DOMElements.sponsorDisplayModal.innerHTML = getModalTemplates().sponsorDisplay;
            
            const game = gamesData[activeGameNumber!];
            if (!game) {
                 console.error(`Rodada ativa ${activeGameNumber} não encontrada.`);
                 DOMElements.sponsorDisplayModal.classList.add('hidden');
                 return;
            }

            const numberDisplay = document.getElementById('sponsor-number-display') as HTMLElement;
            const imageEl = document.getElementById('sponsor-image') as HTMLImageElement;
            const nameEl = document.getElementById('sponsor-name') as HTMLElement;
            const zoomValue = document.getElementById('sponsor-display-zoom-value')!;
            const displayWrapper = document.getElementById('sponsor-display-content-wrapper') as HTMLElement;
            const zoomOutBtn = document.getElementById('zoom-out-btn-sponsor')!;
            const zoomInBtn = document.getElementById('zoom-in-btn-sponsor')!;
            const zoomOutNumBtn = document.getElementById('zoom-out-btn-sponsor-number')!;
            const zoomInNumBtn = document.getElementById('zoom-in-btn-sponsor-number')!;
            const numZoomValue = document.getElementById('sponsor-number-zoom-value')!;
            const confirmBtn = document.getElementById('confirm-sponsor-display-btn')!;
            const cancelBtn = document.getElementById('cancel-sponsor-display-btn')!;


            const letter = getLetterForNumber(number);
            const roundColor = game.color;
            const mainColor = appConfig.drawnTextColor;
            const strokeColor = appConfig.drawnTextStrokeColor;
            const strokeWidth = appConfig.drawnTextStrokeWidth;
            const strokeStyle = `${strokeWidth}px ${strokeColor}`;
            const bgColorStyle = `background-color: ${roundColor || '#0ea5e9'};`;

            numberDisplay.innerHTML = `<span>${letter}</span><span>${number}</span>`;
            numberDisplay.style.cssText += `line-height: 1; text-shadow: 2px 2px 5px #000; color: ${mainColor}; -webkit-text-stroke: ${strokeStyle}; ${bgColorStyle}`;

            imageEl.src = sponsor.image;
            nameEl.textContent = sponsor.name || '';
            
            const applyZoom = (scale: number) => {
                displayWrapper.style.transform = `scale(${scale / 100})`;
                displayWrapper.style.transformOrigin = 'center';
                if (zoomValue) zoomValue.textContent = `${scale}%`;
                appStore.state.appConfig.sponsorDisplayZoom = scale;
            };

            const adjustZoom = (amount: number) => {
                 const newZoom = Math.max(50, Math.min(200, appStore.state.appConfig.sponsorDisplayZoom + amount));
                 applyZoom(newZoom);
                 appStore.debouncedSave();
            };

            const initialZoom = appStore.state.appConfig.sponsorDisplayZoom || 100;
            applyZoom(initialZoom);

            const applyNumZoom = (scale: number) => {
                const wrapper = document.getElementById('sponsor-number-zoom-wrapper');
                if (wrapper) wrapper.style.transform = `scale(${scale / 100})`;
                if (numZoomValue) numZoomValue.textContent = `${scale}%`;
                appStore.state.appConfig.sponsorNumberZoom = scale;
            };

            const adjustNumZoom = (amount: number) => {
                 const newZoom = Math.max(50, Math.min(300, (appStore.state.appConfig.sponsorNumberZoom || 100) + amount));
                 applyNumZoom(newZoom);
                 appStore.debouncedSave();
            };

            const initialNumZoom = appStore.state.appConfig.sponsorNumberZoom || 100;
            applyNumZoom(initialNumZoom);

            zoomInBtn.addEventListener('click', () => adjustZoom(5));
            zoomOutBtn.addEventListener('click', () => adjustZoom(-5));
            zoomInNumBtn.addEventListener('click', () => adjustNumZoom(5));
            zoomOutNumBtn.addEventListener('click', () => adjustNumZoom(-5));


            DOMElements.sponsorDisplayModal.classList.remove('hidden');

            const cleanup = () => {
                appStore.state.pendingNumber = null;
                appStore.debouncedFirebaseSync(true);
                document.removeEventListener('keydown', handleKeydown);
                clearTimeout(floatingNumberTimeout as ReturnType<typeof setTimeout>);
                if ((window as any).sponsorCountdownInterval) {
                    clearInterval((window as any).sponsorCountdownInterval);
                }
            };

            const confirmAndAnnounce = () => {
                cleanup();
                DOMElements.sponsorDisplayModal.classList.add('hidden');
                announceNumber(number);
            };
        
            const cancelDraw = () => {
                cleanup();
                DOMElements.sponsorDisplayModal.classList.add('hidden');
            };

            const handleKeydown = (e: KeyboardEvent) => {
                switch (e.key) {
                    case '+': e.preventDefault(); adjustZoom(5); break;
                    case '-': e.preventDefault(); adjustZoom(-5); break;
                    case 'Enter': e.preventDefault(); confirmAndAnnounce(); break;
                    case 'Escape': e.preventDefault(); cancelDraw(); break;
                }
            };
            document.addEventListener('keydown', handleKeydown);

            confirmBtn.addEventListener('click', confirmAndAnnounce);
            cancelBtn.addEventListener('click', cancelDraw);

            let currentCountdownValue = appConfig.sponsorDisplaySeconds || 10;
            
            const startCountdown = (seconds: number) => {
                clearTimeout(floatingNumberTimeout as ReturnType<typeof setTimeout>);
                if ((window as any).sponsorCountdownInterval) {
                    clearInterval((window as any).sponsorCountdownInterval);
                }
                
                if (appConfig.enableModalAutoclose) {
                    const sponsorDuration = seconds * 1000; 
                    floatingNumberTimeout = setTimeout(confirmAndAnnounce, sponsorDuration); 
                    
                    if (appConfig.showSponsorCountdown) {
                        const wrapper = document.getElementById('sponsor-countdown-wrapper');
                        const textEl = document.getElementById('sponsor-countdown-text');
                        const circleEl = document.getElementById('sponsor-countdown-circle');
                        
                        if (wrapper && textEl && circleEl) {
                            wrapper.classList.remove('hidden');
                            let remaining = seconds;
                            textEl.textContent = remaining.toString();
                            
                            const totalDash = 283; // 2 * PI * r (r=45)
                            circleEl.style.strokeDashoffset = '0';
                            
                            let elapsedSteps = 0;
                            const totalSteps = remaining;
                            
                            (window as any).sponsorCountdownInterval = setInterval(() => {
                                remaining--;
                                elapsedSteps++;
                                if (remaining >= 0) {
                                    textEl.textContent = remaining.toString();
                                    const offset = (elapsedSteps / totalSteps) * totalDash;
                                    circleEl.style.strokeDashoffset = offset.toString();
                                } else {
                                    clearInterval((window as any).sponsorCountdownInterval);
                                }
                            }, 1000);
                        }
                    }
                }
            };
            
            startCountdown(currentCountdownValue);
            
            const updateSpeedButtons = () => {
                document.querySelectorAll('.sponsor-speed-btn').forEach(btn => {
                    const speed = parseInt((btn as HTMLElement).dataset.speed!);
                    if (speed === currentCountdownValue) {
                        btn.classList.add('bg-sky-500', 'text-white');
                        btn.classList.remove('bg-gray-200', 'dark:bg-gray-700');
                    } else {
                        btn.classList.remove('bg-sky-500', 'text-white');
                        btn.classList.add('bg-gray-200', 'dark:bg-gray-700');
                    }
                });
            };
            
            document.querySelectorAll('.sponsor-speed-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const speed = parseInt((e.target as HTMLElement).dataset.speed!);
                    currentCountdownValue = speed;
                    appStore.state.appConfig.sponsorDisplaySeconds = speed;
                    const sponsorDisplayTimer = document.getElementById('sponsor-display-timer') as HTMLInputElement;
                    const sponsorDisplayValue = document.getElementById('sponsor-display-value') as HTMLElement;
                    if (sponsorDisplayTimer) sponsorDisplayTimer.value = speed.toString();
                    if (sponsorDisplayValue) sponsorDisplayValue.textContent = speed.toString();
                    appStore.debouncedSave();
                    updateSpeedButtons();
                    startCountdown(speed);
                });
            });
            updateSpeedButtons();
        }

        function handleAutoDraw() {
            const { activeGameNumber, gamesData } = appStore.state;
            if (!activeGameNumber) {
                showAlert("Selecione uma rodada para o sorteio automático.");
                return;
            }
            const game = gamesData[activeGameNumber];
            if (!game) {
                console.error(`Erro: Rodada ativa ${activeGameNumber} não encontrada.`);
                return;
            }

            const allNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
            const availableNumbers = allNumbers.filter(num => !game.calledNumbers.includes(num));

            if (availableNumbers.length === 0) {
                showAlert("Todos os números já foram sorteados nesta rodada!");
                return;
            }
            
            document.querySelectorAll('[data-label-key="autoDrawButton"]').forEach(btn => (btn as HTMLButtonElement).disabled = true);

            DOMElements.spinningWheelModal.innerHTML = getModalTemplates().spinningWheel;
            DOMElements.spinningWheelModal.classList.remove('hidden');

            const cycloneEl = document.getElementById('number-cyclone')!;
            const cageEl = document.getElementById('bingo-cage') as HTMLElement;
            const ballContainer = document.getElementById('drawn-ball-container') as HTMLElement;
            const skipBtn = document.getElementById('skip-animation-btn') as HTMLElement;
            const closeBtn = document.getElementById('close-drawn-btn') as HTMLElement;

            cycloneEl.innerHTML = '';
            const particles = Math.min(availableNumbers.length, 50);
            for (let i = 0; i < particles; i++) {
                const particle = document.createElement('div');
                particle.className = 'number-cyclone-particle text-2xl';
                particle.textContent = availableNumbers[i % availableNumbers.length].toString();
                const anim = Math.ceil(Math.random() * 4);
                particle.style.animation = `fly-in-cage-${anim} ${3 + Math.random() * 4}s ${Math.random() * -2}s alternate infinite`;
                cycloneEl.appendChild(particle);
            }

            const finishAnimation = (drawnNumber: number) => {
                const { appConfig } = appStore.state;
                if (appStore.state.appConfig.enableSoundEffects) sounds.playDrawNumber();
                clearTimeout(spinTimeout);
                if(cycloneInterval) clearInterval(cycloneInterval);
                const letter = getLetterForNumber(drawnNumber);
                
                const finalColor = appConfig.drawnTextColor;
                const finalStroke = `${appConfig.drawnTextStrokeWidth}px ${appConfig.drawnTextStrokeColor}`;
                const roundColor = gamesData[activeGameNumber!]?.color;
                const revealColor = roundColor || (appConfig.boardColor !== 'default' && appConfig.boardColor !== '#FFFFFF' ? appConfig.boardColor : '#10b981');
                
                ballContainer.innerHTML = `<div class="font-black flex justify-center items-center gap-x-2 sm:gap-x-4 w-64 h-64 sm:w-96 sm:h-96 rounded-full shadow-inner ball-fall-in" style="font-size: clamp(8rem, 40vw, 25rem); line-height: 1; background-color: ${revealColor}; color: ${finalColor}; -webkit-text-stroke: ${finalStroke}; text-shadow: none;"><span>${letter}</span><span>${drawnNumber}</span></div>`;
                
                cageEl.style.animationPlayState = 'paused';
                cageEl.style.opacity = '0.3';
                ballContainer.style.opacity = '1';
                skipBtn.style.display = 'none';
                closeBtn.style.display = 'block';

                let autoCloseTimeout: ReturnType<typeof setTimeout>;

                const closeModalAction = () => {
                    clearTimeout(autoCloseTimeout);
                    if (DOMElements.spinningWheelModal.classList.contains('hidden')) return;

                    DOMElements.spinningWheelModal.classList.add('hidden');
                    document.querySelectorAll('[data-label-key="autoDrawButton"]').forEach(btn => (btn as HTMLButtonElement).disabled = false);
                     showFloatingNumber(drawnNumber);
                };

                closeBtn.onclick = closeModalAction;
                autoCloseTimeout = setTimeout(closeModalAction, 3000);
            };
            
            const randomIndex = Math.floor(Math.random() * availableNumbers.length);
            const drawnNumber = availableNumbers[randomIndex];

            spinTimeout = setTimeout(() => finishAnimation(drawnNumber), 4000);
            skipBtn.onclick = () => finishAnimation(drawnNumber);
        }
        
        function cancelAnnouncedNumber(number: number) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            if (!activeGameNumber) return;
            const game = gamesData[activeGameNumber];
            if (!game) return;
            
            if (appConfig.enableSoundEffects) sounds.playError();
            appStore.removeCalledNumber(number);

            // Re-aplicar animação ao novo último número se houver
            const remainingNumbers = game.calledNumbers;
            if (remainingNumbers.length > 0) {
                const lastNum = remainingNumbers[remainingNumbers.length - 1];
                updateMasterBoardCell(lastNum);
            }

            const cell = document.getElementById(`master-cell-${number}`) as HTMLElement;
            if (cell) {
                cell.classList.remove('text-white', 'scale-125', 'text-gray-900', 'animate-last-number');
                cell.style.backgroundColor = ''; 
                cell.style.transform = '';
                const activeRoundColor = gamesData[activeGameNumber]?.color;

                if (activeRoundColor) {
                    cell.style.backgroundColor = hexToRgba(activeRoundColor, 0.25)!;
                    cell.classList.add('text-slate-800', 'dark:text-slate-200');
                } else if (appConfig.boardColor !== 'default') {
                    cell.style.backgroundColor = appConfig.boardColor;
                    cell.classList.add(isLightColor(appConfig.boardColor) ? 'text-gray-900' : 'text-white');
                } else {
                    cell.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-800', 'dark:text-slate-300');
                }
            }
            DOMElements.lastNumbersDisplay.innerHTML = '';
            const lastFive = game.calledNumbers.slice(-5).reverse();
            lastFive.forEach((num: number) => {
                const letter = getLetterForNumber(num);
                const numberEl = document.createElement('div');
                numberEl.className = 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-slate-100 font-bold rounded-lg w-24 h-16 flex items-center justify-center text-3xl shadow-md';
                numberEl.textContent = `${letter}-${num}`;
                DOMElements.lastNumbersDisplay.appendChild(numberEl);
            });
            updateCurrentNumberDisplay();
            if (typeof updateSimpleControllerUI === 'function') updateSimpleControllerUI();
            const lastCalledNumber = game.calledNumbers[game.calledNumbers.length - 1];
            if (lastCalledNumber) {
                DOMElements.currentNumberEl.classList.remove('animate-bounce-in');
                void (DOMElements.currentNumberEl as HTMLElement).offsetWidth; 
                DOMElements.currentNumberEl.classList.add('animate-bounce-in');
            }
            updateActiveRoundStats();
            const activeGameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${activeGameNumber}"]`);
            if (activeGameItem) {
                 updateGameItemUI(activeGameItem, game.isComplete);
            }
        }

        function startNewRound() {
            if (appStore.state.appConfig.enableSoundEffects) sounds.playReset();
            appStore.clearActiveRound();
            loadRoundState(appStore.state.activeGameNumber);
            const activeGameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${appStore.state.activeGameNumber}"]`);
            if (activeGameItem) {
                 const game = appStore.state.gamesData[appStore.state.activeGameNumber!];
                 updateGameItemUI(activeGameItem, game.isComplete);
            }
        }

        ;(window as any).unblockUser = (uuid: string) => {
            appStore.state.blockedUsers = appStore.state.blockedUsers.filter((u: string) => u !== uuid);
            appStore.debouncedSave();
            showAlert("Usuário desbloqueado com sucesso.");
            (window as any).updateBlockedUsersUI();
        };
        
        ;(window as any).updateBlockedUsersUI = function updateBlockedUsersUI() {
            const listEl = document.getElementById('blocked-users-list');
            if (!listEl) return;
            
            if (appStore.state.blockedUsers.length === 0) {
                listEl.innerHTML = '<p class="text-sm text-slate-500 italic">Nenhum usuário bloqueado.</p>';
                return;
            }
            
            listEl.innerHTML = appStore.state.blockedUsers.map((uuid: string) => `
                <div class="flex justify-between items-center bg-gray-100 dark:bg-gray-700 p-3 rounded">
                    <span class="text-sm font-mono text-gray-800 dark:text-gray-200">${uuid}</span>
                    <button class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-xs font-bold" onclick="window.unblockUser('${uuid}')">Desbloquear</button>
                </div>
            `).join('');
        }

        ;(window as any).blockUser = (uuid: string) => {
            if (!appStore.state.blockedUsers.includes(uuid)) {
                appStore.state.blockedUsers.push(uuid);
                appStore.debouncedSave();
                showAlert("Usuário bloqueado com sucesso. Ele não poderá mais enviar alertas de BINGO.");
                (window as any).updateBlockedUsersUI();
            }
        };

        function showBingoClaimNotification(series: number, uuid: string, gameNumber: string, docData?: any) {
            const audio = new Audio('/bingo-alert.mp3');
            audio.play().catch(e => console.log('Audio blocked', e));

            const fsEl = document.fullscreenElement || document.body;
            let container = document.getElementById('bingo-claims-container');
            if (container && container.parentNode !== fsEl) {
                fsEl.appendChild(container);
            } else if (!container) {
                container = document.createElement('div');
                container.id = 'bingo-claims-container';
                container.className = 'fixed top-20 right-4 z-[9999] p-4 flex flex-col gap-2 pointer-events-none items-end max-w-sm w-[400px] overflow-hidden';
                fsEl.appendChild(container);
            }
            
            const isPublic = uuid && uuid.startsWith('public-');
            const cardStr = String(series).padStart(5, '0');
            const el = document.createElement('div');
            el.className = 'pointer-events-auto bg-green-500 text-white font-bold p-4 w-full rounded-xl shadow-2xl flex flex-col gap-2 animate-bounce-in border-4 border-white';
            
            if (isPublic) {
                const name = docData?.name || 'Público';
                const cpf = docData?.cpf || '';
                el.innerHTML = `
                    <div class="flex justify-between items-center w-full">
                        <span class="text-[10px] uppercase bg-black/20 px-2 py-0.5 rounded tracking-widest">Alerta de Jogador Online (Painel)</span>
                        <button class="text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">✕</button>
                    </div>
                    <div class="text-3xl font-black uppercase text-center mt-1 drop-shadow-md">BINGO!</div>
                    <div class="text-lg text-center mx-1 mb-1 leading-tight"><span class="bg-yellow-400 text-black px-2 py-1 mx-1 rounded inline-block shadow-sm">${name}</span> bateu pelo Painel Público!</div>
                    <div class="text-xs text-center text-green-100 mb-2">CPF: ${cpf}</div>
                    <button class="bg-white text-green-700 hover:bg-gray-100 py-3 mt-1 w-full rounded-lg font-bold shadow uppercase transition-all active:scale-95" onclick="this.parentElement.remove()">Verificar Física Manualmente</button>
                    <button class="text-white hover:text-red-200 text-xs mt-1 underline" onclick="if(confirm('Bloquear este jogador? Ele não poderá mais gritar bingo.')) { window.blockUser('${uuid}'); this.parentElement.remove(); }">Bloquear Jogador (Falso Bingo)</button>
                `;
            } else {
                el.innerHTML = `
                    <div class="flex justify-between items-center w-full">
                        <span class="text-[10px] uppercase bg-black/20 px-2 py-0.5 rounded tracking-widest">Alerta de Jogador Online</span>
                        <button class="text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">✕</button>
                    </div>
                    <div class="text-3xl font-black uppercase text-center mt-1 drop-shadow-md">BINGO!</div>
                    <div class="text-lg text-center mx-1 mb-1 leading-tight">A cartela nº <span class="bg-yellow-400 text-black px-2 py-1 mx-1 rounded inline-block shadow-sm">${cardStr}</span> bateu lá do celular!</div>
                    <button class="bg-white text-green-700 hover:bg-gray-100 py-3 mt-1 w-full rounded-lg font-bold shadow uppercase transition-all active:scale-95" onclick="window.pauseDrawAndVerify('${uuid}', '${cardStr}'); this.parentElement.remove()">Fazer Checagem Oficial</button>
                    <button class="text-white hover:text-red-200 text-xs mt-1 underline" onclick="if(confirm('Bloquear este jogador? Ele não poderá mais gritar bingo.')) { window.blockUser('${uuid}'); this.parentElement.remove(); }">Bloquear Jogador (Falso Bingo)</button>
                `;
            }
            
            container.appendChild(el);
        }
        
        (window as any).pauseDrawAndVerify = (uuid: string, displaySeries: string) => {
             // Pausar sorteio se auto-draw ligado
             const autoBtn = document.getElementById('panel-auto-draw-btn') as HTMLButtonElement;
             if (autoBtn && autoBtn.innerText.includes('Pausar')) {
                 autoBtn.click();
             }
             
             verifyCardByQRCode(uuid);
        };

        function loadRoundState(gameNumber: string | null) {
            const { gamesData, appLabels } = appStore.state;
            clearInterval(clockInterval);
            
            if ((window as any).masterBingoClaimsUnsub) {
               (window as any).masterBingoClaimsUnsub();
               (window as any).masterBingoClaimsUnsub = null;
            }

            if (gameNumber === null) {
                appStore.setActiveGame(null);
                DOMElements.activeRoundPanel.classList.add('hidden');
                DOMElements.noActiveRoundPanel.classList.remove('hidden');
                (DOMElements.currentNumberEl as HTMLElement).style.visibility = 'hidden';
                 DOMElements.prizeDrawDisplayContainer.classList.add('hidden');
                DOMElements.lastNumbersDisplay.innerHTML = '';
                clearMasterBoard(false);
                return;
            }
            
            appStore.setActiveGame(gameNumber);
            const game = gamesData[gameNumber];

            if (!game) {
                console.error(`Tentativa de carregar estado para uma rodada inexistente: ${gameNumber}`);
                loadRoundState(null); 
                return;
            }
            
            DOMElements.noActiveRoundPanel.classList.add('hidden');
            DOMElements.activeRoundPanel.classList.remove('hidden');

            const nameEl = document.getElementById('active-round-name')!;
            const dateEl = document.getElementById('active-round-date')!;
            const timeEl = document.getElementById('active-round-time')!;
            const prizesEl = document.getElementById('active-round-prizes')!;
            const descriptionContainer = document.getElementById('active-round-description-display')!;
            
            nameEl.textContent = game.name || `Rodada ${gameNumber}`;
            prizesEl.innerHTML = '';
            
            const createPrizeEl = (label: string, value: string, bingoType: string) => {
                if (!value) return null;
                const isWon = game.winners && game.winners.some((w: any) => w.bingoType === bingoType);
                const p = document.createElement('p');
                p.className = `text-2xl sm:text-3xl lg:text-4xl leading-tight flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-4 mb-2 ${isWon ? 'opacity-50 grayscale' : ''}`;
                p.innerHTML = `<span class="font-bold text-slate-500 dark:text-slate-400 text-sm sm:text-base uppercase tracking-widest ${isWon ? 'line-through' : ''}">${label}:</span> <span class="text-amber-500 dark:text-amber-400 font-black text-stroke-black drop-shadow-md break-words text-center ${isWon ? 'line-through' : ''}">${value}</span>${isWon ? '<span class="ml-2 text-green-500 text-2xl drop-shadow-sm">✓</span>' : ''}`;
                return p;
            };

            const prize1 = createPrizeEl(appLabels.prize1Label, game.prizes.prize1, 'prize1');
            const prize2 = createPrizeEl(appLabels.prize2Label, game.prizes.prize2, 'prize2');
            const prize3 = createPrizeEl(appLabels.prize3Label, game.prizes.prize3, 'prize3');
            if (prize1) prizesEl.appendChild(prize1);
            if (prize2) prizesEl.appendChild(prize2);
            if (prize3) prizesEl.appendChild(prize3);

            if (game.description) {
                (descriptionContainer.querySelector('.marquee-text') as HTMLElement).textContent = game.description;
                descriptionContainer.classList.remove('hidden');
            } else {
                descriptionContainer.classList.add('hidden');
            }
            
            const updateClock = () => {
                const now = new Date();
                dateEl.textContent = now.toLocaleDateString('pt-BR');
                timeEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            };
            updateClock();
            clockInterval = setInterval(updateClock, 1000);

            updateActiveRoundStats();
            
            (DOMElements.currentNumberEl as HTMLElement).style.visibility = 'hidden';
            DOMElements.prizeDrawDisplayContainer.classList.add('hidden');
            DOMElements.errorMessageEl.textContent = '';
            DOMElements.lastNumbersDisplay.innerHTML = '';
            DOMElements.numberInput.value = '';
            DOMElements.letterInput.value = '';

            clearMasterBoard(true);
            game.calledNumbers.forEach((num: number) => updateMasterBoardCell(num));
            
            const lastFive = game.calledNumbers.slice(-5).reverse();
            lastFive.forEach((num: number) => {
                const letter = getLetterForNumber(num);
                updateLastNumbers(letter!, num, false);
            });
            updateCurrentNumberDisplay();
            
            // Listen to Bingo Claims from online players
            if (appStore.state.appConfig.onlineSyncEnabled && eventId && gameNumber) {
               const claimsRef = collection(db, `events/${eventId}/games/${gameNumber}/bingoClaims`);
               let initialLoad = true;
               (window as any).masterBingoClaimsUnsub = onSnapshot(claimsRef, (snapshot) => {
                   if (initialLoad) {
                       initialLoad = false;
                       return;
                   }
                   snapshot.docChanges().forEach((change) => {
                       if (change.type === 'added') {
                           const docData = change.doc.data();
                           if (!appStore.state.blockedUsers.includes(docData.uuid)) {
                               showBingoClaimNotification(docData.series, docData.uuid, gameNumber, docData);
                           }
                       }
                   });
               });
            }
        }

        function updateActiveRoundStats() {
            const { activeGameNumber, gamesData } = appStore.state;
            if (!activeGameNumber) return;
            const game = gamesData[activeGameNumber];
            if (!game) return;
            const countEl = document.getElementById('active-round-called-count')!;
            countEl.textContent = `${game.calledNumbers.length} / 75`;
        }

        function updateBoardSponsorIndicators() {
            const { appConfig } = appStore.state;
            const isEnabled = appConfig.enableSponsorsByNumber;
            const sponsors = appConfig.sponsorsByNumber || {};
            for (let i = 1; i <= 75; i++) {
                const cell = document.getElementById(`master-cell-${i}`);
                if (!cell) continue;
                const s = sponsors[i];
                const hasSponsor = Boolean(isEnabled && s && ((s.name && s.name.trim() !== '') || s.image));
                if (hasSponsor) {
                    cell.classList.add('has-sponsor');
                    if (s.name && s.name.trim() !== '') {
                        cell.title = `Patrocinador: ${s.name}`;
                    }
                } else {
                    cell.classList.remove('has-sponsor');
                    cell.removeAttribute('title');
                }
            }
        }

        function renderMasterBoard() {
            const { appConfig } = appStore.state;
            DOMElements.bingoBoardEl.innerHTML = '';
            const currentLetters = appConfig.bingoTitle === 'AJUDE' ? DYNAMIC_LETTERS_AJUDE : DYNAMIC_LETTERS;
            
            const headerSizeClass = 'text-6xl'; 
            const cellSizeClass = 'w-20 h-20 text-5xl'; 

            currentLetters.forEach(letter => {
                const columnWrapper = document.createElement('div');
                columnWrapper.className = 'col-span-2 flex flex-col items-center';
                
                const headerEl = document.createElement('div');
                headerEl.className = `font-black text-sky-400 mb-4 ${headerSizeClass} [-webkit-text-stroke:2px_#0284c7] drop-shadow-md`;
                headerEl.textContent = letter;
                columnWrapper.appendChild(headerEl);

                const numbersGrid = document.createElement('div');
                numbersGrid.className = 'grid grid-cols-2 gap-2';

                let baseLetter = DYNAMIC_LETTERS[currentLetters.indexOf(letter)];
                const { min, max } = BINGO_CONFIG[baseLetter as keyof typeof BINGO_CONFIG];

                for (let i = min; i <= max; i++) {
                    const cell = document.createElement('div');
                    cell.id = `master-cell-${i}`;
                    cell.textContent = i.toString();
                    
                    let cellClasses = `bingo-cell flex items-center justify-center font-black rounded-full transition-all duration-300 ${cellSizeClass}`;
                    if (appConfig.boardColor && appConfig.boardColor !== 'default') {
                        cell.style.backgroundColor = appConfig.boardColor;
                        cellClasses += isLightColor(appConfig.boardColor) ? ' text-gray-900' : ' text-white';
                    } else {
                        cellClasses += ' bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-slate-300';
                    }
                    cell.className = cellClasses;
                    
                    const s = appConfig.sponsorsByNumber?.[i];
                    if (appConfig.enableSponsorsByNumber && s && ((s.name && s.name.trim() !== '') || s.image)) {
                         cell.classList.add('has-sponsor');
                         if (s.name && s.name.trim() !== '') {
                             cell.title = `Patrocinador: ${s.name}`;
                         }
                    }

                    cell.addEventListener('click', () => {
                        if (!appStore.state.activeGameNumber) {
                            showAlert("Por favor, selecione uma rodada clicando em 'Jogar' para iniciar.");
                            return;
                        }
                        const game = appStore.state.gamesData[appStore.state.activeGameNumber];
                        if (!game) return;
                        if (game.calledNumbers.includes(i)) cancelAnnouncedNumber(i);
                        else showFloatingNumber(i);
                    });
                    numbersGrid.appendChild(cell);
                }
                columnWrapper.appendChild(numbersGrid);
                DOMElements.bingoBoardEl.appendChild(columnWrapper);
            });
            updateBoardSponsorIndicators();
        }
        
        function clearMasterBoard(applyCustomColor = false) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            const activeRoundColor = (activeGameNumber && gamesData[activeGameNumber]?.color) ? gamesData[activeGameNumber].color : null;
            for (let i = 1; i <= 75; i++) {
                const cell = document.getElementById(`master-cell-${i}`) as HTMLElement;
                if (cell) {
                    cell.classList.remove('scale-125', 'text-gray-900', 'text-slate-200', 'text-slate-800', 'text-white');
                    cell.style.backgroundColor = '';
                    cell.style.transform = '';
                    cell.className = 'bingo-cell flex items-center justify-center font-black rounded-full transition-all duration-300 w-20 h-20 text-5xl';

                    if (applyCustomColor && activeRoundColor) {
                        cell.style.backgroundColor = hexToRgba(activeRoundColor, 0.25)!; 
                        cell.classList.add('text-slate-800', 'dark:text-slate-200');
                    } else if (appConfig.boardColor && appConfig.boardColor !== 'default') {
                        cell.style.backgroundColor = appConfig.boardColor;
                        cell.classList.add(isLightColor(appConfig.boardColor) ? 'text-gray-900' : 'text-white');
                    } else {
                        cell.classList.add('bg-gray-200', 'dark:bg-gray-700', 'text-gray-800', 'dark:text-slate-300');
                    }
                    const s = appConfig.sponsorsByNumber?.[i];
                    if (appConfig.enableSponsorsByNumber && s && ((s.name && s.name.trim() !== '') || s.image)) {
                         cell.classList.add('has-sponsor');
                         if (s.name && s.name.trim() !== '') {
                             cell.title = `Patrocinador: ${s.name}`;
                         }
                    }
                }
            }
            updateBoardSponsorIndicators();
        }

        function updateMasterBoardCell(number: number) {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            
            // Remove animação de qualquer número sorteado anteriormente
            document.querySelectorAll('.animate-last-number').forEach(el => el.classList.remove('animate-last-number'));

            const cell = document.getElementById(`master-cell-${number}`) as HTMLElement;
            if (cell) {
                cell.classList.remove('bg-gray-200', 'dark:bg-gray-700', 'text-gray-800', 'dark:text-slate-300', 'text-gray-900', 'text-white', 'text-slate-200', 'text-slate-800', 'dark:text-slate-200');
                cell.style.backgroundColor = ''; 
                const activeRoundColor = (activeGameNumber && gamesData[activeGameNumber]?.color) ? gamesData[activeGameNumber].color : '#16a34a'; 
                cell.style.backgroundColor = activeRoundColor;
                cell.classList.add(isLightColor(activeRoundColor) ? 'text-gray-900' : 'text-white', 'scale-125', 'animate-last-number');

                const isEnabled = appConfig.enableSponsorsByNumber;
                const s = appConfig.sponsorsByNumber?.[number];
                if (isEnabled && s && ((s.name && s.name.trim() !== '') || s.image)) {
                    cell.classList.add('has-sponsor');
                }
            }
        }
        
        function updateLastNumbers(_letter: string, number: number, shouldAddToState: boolean) {
            if (shouldAddToState) {
                appStore.addCalledNumber(number);
            }

            const { activeGameNumber, gamesData } = appStore.state;
            DOMElements.lastNumbersDisplay.innerHTML = '';
            if (!activeGameNumber || !gamesData[activeGameNumber]) return;

            const lastFive = gamesData[activeGameNumber].calledNumbers.slice(-5).reverse();
            lastFive.forEach((num: number) => {
                const l = getLetterForNumber(num);
                const numberEl = document.createElement('div');
                numberEl.className = 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-slate-100 font-bold rounded-lg w-24 h-16 flex items-center justify-center text-3xl shadow-md';
                numberEl.textContent = `${l}-${num}`;
                DOMElements.lastNumbersDisplay.appendChild(numberEl);
            });
            if (typeof updateSimpleControllerUI === 'function') updateSimpleControllerUI();
        }
        
        function showError(message: string) {
            DOMElements.errorMessageEl.textContent = message;
            DOMElements.errorMessageEl.classList.add('animate-shake-error');
            setTimeout(() => {
                DOMElements.errorMessageEl.textContent = '';
                DOMElements.errorMessageEl.classList.remove('animate-shake-error');
            }, 3000);
        }

        // --- Funções da Interface (UI) ---

        function createGameElement(gameNumber: number, prizes: { prize1: string, prize2: string, prize3: string }) {
            const { gamesData, appLabels } = appStore.state;
            const gameItem = document.createElement('div');
            gameItem.className = 'game-item bg-white dark:bg-gray-700 p-4 rounded-xl shadow-md dark:shadow-lg transition-all duration-300 ease-in-out border border-slate-200 dark:border-transparent';
            gameItem.dataset.gameNumber = gameNumber.toString();

            const header = document.createElement('div');
            header.className = 'flex justify-between items-center';
            const title = document.createElement('h3');
            title.className = 'text-lg font-bold text-slate-800 dark:text-white';
            title.textContent = gamesData[gameNumber]?.name || `Rodada ${gameNumber}`;

            const controlsWrapper = document.createElement('div');
            controlsWrapper.className = 'flex items-center gap-2';

            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️';
            editBtn.title = `Editar Rodada ${gameNumber}`;
            editBtn.className = 'text-lg hover:text-sky-400 transition-colors w-11 h-11 flex items-center justify-center bg-gray-100 dark:bg-gray-600 rounded-lg shadow-sm';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showRoundEditModal(gameNumber.toString());
            });

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.className = 'w-11 h-11 p-0 border-2 border-gray-600 rounded-full cursor-pointer flex-shrink-0';
            colorPicker.value = gamesData[gameNumber]?.color || '#FFFFFF'; 
            colorPicker.addEventListener('input', (e) => {
                const newColor = (e.target as HTMLInputElement).value;
                gamesData[gameNumber].color = newColor;
                if (appStore.state.activeGameNumber === gameNumber.toString()) {
                    loadRoundState(appStore.state.activeGameNumber);
                }
                appStore.debouncedSave();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = `Excluir Rodada ${gameNumber}`;
            deleteBtn.className = 'text-lg hover:text-red-500 transition-colors w-11 h-11 flex items-center justify-center bg-gray-100 dark:bg-gray-600 rounded-lg shadow-sm';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); 
                confirmDeleteRound(gameNumber.toString());
            });
            
            controlsWrapper.appendChild(editBtn);
            controlsWrapper.appendChild(colorPicker);
            controlsWrapper.appendChild(deleteBtn);
            header.appendChild(title);
            header.appendChild(controlsWrapper);

            const prizesContainer = document.createElement('div');
            prizesContainer.className = 'mt-2 space-y-1';
            
            Object.keys(prizes).forEach((prizeKey, index) => {
                const prizeInputWrapper = document.createElement('div');
                prizeInputWrapper.className = 'flex items-center gap-2';
                
                const label = document.createElement('label');
                label.className = 'text-xs font-bold text-slate-500 dark:text-slate-400 prize-input-label';
                label.textContent = `${appLabels[('prize' + (index + 1) + 'Label') as keyof typeof appLabels]}:`;

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'prize-input w-full text-sm font-bold p-2 min-h-[44px] border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500';
                input.value = prizes[prizeKey as keyof typeof prizes];
                input.dataset.prizeKey = prizeKey;
                input.addEventListener('change', (e) => {
                    gamesData[gameNumber].prizes[prizeKey as keyof typeof prizes] = (e.target as HTMLInputElement).value;
                    appStore.debouncedSave();
                });
                prizeInputWrapper.appendChild(label);
                prizeInputWrapper.appendChild(input);
                prizesContainer.appendChild(prizeInputWrapper);
            });
            
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'mt-3';
            
            gameItem.appendChild(header);
            gameItem.appendChild(prizesContainer);
            gameItem.appendChild(buttonContainer);
            return gameItem;
        }

        function addExtraGame() {
            if (appStore.state.appConfig.enableSoundEffects) sounds.playSuccess();
            const newGameNumber = appStore.addExtraGame();
            const { gamesData } = appStore.state;
            const gameEl = createGameElement(newGameNumber, gamesData[newGameNumber].prizes);
            gameEl.classList.add('animate-fade-in-down'); 
            DOMElements.gamesListEl.prepend(gameEl); 
            updateGameItemUI(gameEl, false);
        }

        function confirmDeleteRound(gameNumber: string) {
            const { gamesData } = appStore.state;
            DOMElements.deleteConfirmModal.innerHTML = getModalTemplates().deleteConfirm;
            const roundName = gamesData[gameNumber]?.name || `Rodada ${gameNumber}`;
            (document.getElementById('delete-confirm-message') as HTMLElement).textContent = `Tem certeza que deseja excluir a rodada "${roundName}"? Esta ação não pode ser desfeita.`;
            (document.getElementById('confirm-delete-btn') as HTMLElement).textContent = "Excluir Rodada";
            DOMElements.deleteConfirmModal.classList.remove('hidden');
        
            document.getElementById('confirm-delete-btn')!.addEventListener('click', () => {
                if (appStore.state.appConfig.enableSoundEffects) sounds.playReset();
                delete gamesData[gameNumber];
                
                const gameEl = document.querySelector(`.game-item[data-game-number="${gameNumber}"]`);
                if (gameEl) {
                    gameEl.remove();
                }
        
                if (appStore.state.activeGameNumber === gameNumber) {
                    appStore.setActiveGame(null);
                    loadRoundState(null); 
                }
        
                DOMElements.deleteConfirmModal.classList.add('hidden');
                appStore.debouncedSave();
            });
            
            document.getElementById('cancel-delete-btn')!.addEventListener('click', () => {
                DOMElements.deleteConfirmModal.classList.add('hidden');
            });
        }
        
        function getLetterForNumber(number: number): string | null {
            const { appConfig } = appStore.state;
            const lettersToCheck = appConfig.bingoTitle === 'AJUDE' ? DYNAMIC_LETTERS_AJUDE : DYNAMIC_LETTERS;
            const baseLetters = DYNAMIC_LETTERS; 
            
            for (let i = 0; i < baseLetters.length; i++) {
                const baseLetter = baseLetters[i];
                const displayLetter = lettersToCheck[i];
                const config = BINGO_CONFIG[baseLetter as keyof typeof BINGO_CONFIG];
                if (number >= config.min && number <= config.max) {
                    return displayLetter;
                }
            }
            return null;
        }


        function updateSimpleControllerUI() {
            if (!DOMElements.scOverlay || DOMElements.scOverlay.classList.contains('hidden')) return;
            const { activeGameNumber, gamesData } = appStore.state;
            if (!activeGameNumber || !gamesData[activeGameNumber]) {
                if (DOMElements.scGameName) DOMElements.scGameName.textContent = "Nenhuma Rodada Ativa";
                if (DOMElements.scLastNumber) DOMElements.scLastNumber.textContent = "--";
                const scBoard = document.getElementById('sc-board-rows'); if (scBoard) scBoard.innerHTML = '<span class="text-slate-500 text-sm">Nenhum</span>';
                if (DOMElements.scDrawnCount) DOMElements.scDrawnCount.textContent = '0/75';
                return;
            }
            const game = gamesData[activeGameNumber];
            if (DOMElements.scGameName) DOMElements.scGameName.textContent = game.name || `Rodada ${activeGameNumber}`;
            
            const appConfig = appStore.state.appConfig;
            const called = game.calledNumbers;
            
            const scLastNumberBall = document.getElementById('sc-last-number-ball');
            if (called.length > 0) {
                const lastNum = called[called.length - 1];
                const letter = getLetterForNumber(lastNum);
                const activeColor = game.color || '#14b8a6';
                if (scLastNumberBall) {
                    scLastNumberBall.style.borderColor = activeColor;
                }
                if (DOMElements.scLastNumber) {
                    DOMElements.scLastNumber.innerHTML = `<span>${letter}</span><span class="ml-1">${lastNum}</span>`;
                    DOMElements.scLastNumber.classList.remove('text-slate-600');
                    DOMElements.scLastNumber.classList.add('text-white');
                }
            } else {
                if (scLastNumberBall) {
                    scLastNumberBall.style.borderColor = '#475569';
                }
                if (DOMElements.scLastNumber) {
                    DOMElements.scLastNumber.innerHTML = `--`;
                    DOMElements.scLastNumber.classList.remove('text-white');
                    DOMElements.scLastNumber.classList.add('text-slate-600');
                }
            }
            
            if (DOMElements.scDrawnCount) DOMElements.scDrawnCount.textContent = `${called.length}/75`;
            
            const scRecentNumbers = document.getElementById('sc-recent-numbers');
            const scPrizesList = document.getElementById('sc-prizes-list');
            if (scPrizesList) {
                const appLabels = appStore.state.appLabels;
                let prizesHtml = '';
                ['prize1', 'prize2', 'prize3'].forEach((pKey) => {
                    const prizeVal = game.prizes[pKey as keyof typeof game.prizes];
                    if (prizeVal) {
                        const label = appLabels[pKey + 'Label' as keyof typeof appLabels] || pKey;
                        prizesHtml += `<div class="flex justify-between items-center text-sm py-1 border-b border-slate-700/50 last:border-0"><span class="text-slate-400">${label}:</span><span class="text-white font-bold text-right ml-2">${prizeVal}</span></div>`;
                    }
                });
                if (!prizesHtml) prizesHtml = '<span class="text-slate-500 text-sm text-center w-full block">Nenhuma premiação definida</span>';
                scPrizesList.innerHTML = prizesHtml;
            }

            if (scRecentNumbers) {
                if (called.length > 0) {
                    const last3 = called.slice(-4, -1).reverse();
                    if (last3.length > 0) {
                        scRecentNumbers.innerHTML = '';
                        last3.forEach((num, idx) => {
                            const pill = document.createElement('div');
                            pill.className = `w-12 h-12 rounded-full bg-slate-900 text-white border-2 flex items-center justify-center font-black text-lg shadow-sm relative overflow-hidden`;
                            pill.style.borderColor = game.color || '#38bdf8';
                            
                            const glare = document.createElement('div');
                            glare.className = 'absolute inset-0 rounded-full opacity-30 bg-gradient-to-br from-white/50 to-transparent mix-blend-overlay';
                            pill.appendChild(glare);
                            
                            const numSpan = document.createElement('span');
                            numSpan.className = 'z-10 relative';
                            numSpan.textContent = num.toString();
                            pill.appendChild(numSpan);
                            
                            scRecentNumbers.appendChild(pill);
                        });
                    } else {
                        scRecentNumbers.innerHTML = '<span class="text-slate-500 font-bold text-sm">⏳ Aguardando Início do Sorteio...</span>';
                    }
                } else {
                    scRecentNumbers.innerHTML = '<span class="text-slate-500 font-bold text-sm">⏳ Aguardando Início do Sorteio...</span>';
                }
            }

            const scBoardRows = document.getElementById('sc-board-rows');
            if (scBoardRows) {
                const letters = appConfig.bingoTitle || ['B', 'I', 'N', 'G', 'O'];
                const lettersStr = Array.isArray(letters) ? letters.join('') : letters;
                const lettersRange = lettersStr === 'AJUDE' ? [
                    { letter: 'A', min: 1, max: 15 },
                    { letter: 'J', min: 16, max: 30 },
                    { letter: 'U', min: 31, max: 45 },
                    { letter: 'D', min: 46, max: 60 },
                    { letter: 'E', min: 61, max: 75 }
                ] : [
                    { letter: 'B', min: 1, max: 15 },
                    { letter: 'I', min: 16, max: 30 },
                    { letter: 'N', min: 31, max: 45 },
                    { letter: 'G', min: 46, max: 60 },
                    { letter: 'O', min: 61, max: 75 }
                ];

                const lettersStr2 = Array.isArray(letters) ? letters.join('') : letters;
                const cacheKey = lettersStr2 + (game.color || '#14b8a6');
                
                // Initialize structure if not cached
                if (!scBoardRows.dataset.renderedLetters || scBoardRows.dataset.renderedLetters !== cacheKey) {
                    scBoardRows.innerHTML = '';
                    const lettersArray = Array.isArray(letters) ? letters : letters.split('');
                    
                    lettersArray.forEach((letter: string, index: number) => {
                        const rowWrapper = document.createElement('div');
                        rowWrapper.className = 'flex flex-row items-stretch border border-slate-700 rounded-lg min-h-[56px] relative z-10 overflow-hidden bg-slate-900 mb-1 last:mb-0';
                        
                        const letterCol = document.createElement('div');
                        letterCol.className = 'w-10 sm:w-16 shrink-0 flex items-center justify-center font-black transition-colors duration-300 text-2xl sm:text-4xl border-r border-slate-700 bg-slate-800';
                        letterCol.style.color = game.color || '#38bdf8';
                        letterCol.textContent = letter;
                        
                        const numbersCol = document.createElement('div');
                        numbersCol.className = 'flex-1 grid grid-cols-5 sm:grid-cols-8 gap-1 p-1 sm:p-2 bg-slate-900 transition-colors duration-300 min-h-0';
                        numbersCol.id = `sc-row-${index}`;
                        
                        // Populate 15 numbers for this letter
                        const rng = lettersRange[index];
                        for (let i = rng.min; i <= rng.max; i++) {
                            const cellBtn = document.createElement('button');
                            cellBtn.id = `sc-cell-${i}`;
                            cellBtn.className = 'w-full aspect-square rounded flex items-center justify-center font-bold text-xs sm:text-sm shadow-sm transition-all duration-300 relative overflow-hidden border border-slate-700 text-slate-500 bg-slate-800 active:scale-95';
                            cellBtn.innerHTML = `<span class="z-10 relative pointer-events-none">${i}</span>`;
                            
                            cellBtn.addEventListener('click', () => {
                                if (!appStore.state.activeGameNumber) {
                                    showAlert("Por favor, selecione uma rodada clicando em 'Jogar' para iniciar.");
                                    return;
                                }
                                const gameObj = appStore.state.gamesData[appStore.state.activeGameNumber];
                                if (!gameObj) return;
                                if (gameObj.calledNumbers.includes(i)) cancelAnnouncedNumber(i);
                                else showFloatingNumber(i);
                            });
                            
                            numbersCol.appendChild(cellBtn);
                        }
                        
                        rowWrapper.appendChild(letterCol);
                        rowWrapper.appendChild(numbersCol);
                        scBoardRows.appendChild(rowWrapper);
                    });
                    scBoardRows.dataset.renderedLetters = cacheKey;
                }
                
                // Update states for all 75 numbers
                const isLight = isLightColor(game.color || '#38bdf8');
                for (let i = 1; i <= 75; i++) {
                    const cellBtn = document.getElementById(`sc-cell-${i}`);
                    if (cellBtn) {
                        if (called.includes(i)) {
                            cellBtn.style.backgroundColor = game.color || '#38bdf8';
                            cellBtn.style.borderColor = game.color || '#38bdf8';
                            cellBtn.className = `w-full aspect-square rounded flex items-center justify-center font-bold text-xs sm:text-sm shadow-sm transition-all duration-300 relative overflow-hidden active:scale-95 border-2 ${isLight ? 'text-gray-900' : 'text-white'}`;
                        } else {
                            cellBtn.style.backgroundColor = '';
                            cellBtn.style.borderColor = '';
                            cellBtn.className = 'w-full aspect-square rounded flex items-center justify-center font-bold text-xs sm:text-sm shadow-sm transition-all duration-300 relative overflow-hidden border border-slate-700 text-slate-500 bg-slate-800 hover:bg-slate-700 active:scale-95';
                        }
                    }
                }
            }
        }

        function updateCurrentNumberDisplay() {
            const { activeGameNumber, gamesData, appConfig } = appStore.state;
            const currentNumberEl = DOMElements.currentNumberEl as HTMLElement;
            if (!currentNumberEl) return;

            if (!activeGameNumber || !gamesData[activeGameNumber]) {
                currentNumberEl.style.visibility = 'hidden';
                return;
            }

            const game = gamesData[activeGameNumber];
            const lastCalledNumber = game.calledNumbers[game.calledNumbers.length - 1];

            if (lastCalledNumber) {
                const letter = getLetterForNumber(lastCalledNumber);
                const roundColor = game.color;
                const mainColor = appConfig.drawnTextColor;
                const strokeColor = appConfig.drawnTextStrokeColor;
                const strokeWidth = appConfig.drawnTextStrokeWidth;
                const strokeStyle = `${strokeWidth}px ${strokeColor}`;

                const isDarkTheme = document.documentElement.classList.contains('dark');
                const defaultBg = isDarkTheme ? '#1e293b' : '#f1f5f9';
                const bgColor = roundColor || (appConfig.boardColor && appConfig.boardColor !== 'default' ? appConfig.boardColor : defaultBg);

                currentNumberEl.style.backgroundColor = bgColor;
                currentNumberEl.style.color = mainColor;
                currentNumberEl.style.webkitTextStroke = strokeStyle;
                currentNumberEl.style.boxShadow = `0 0 40px 10px ${bgColor}`;
                currentNumberEl.innerHTML = `<span>${letter}</span><span>${lastCalledNumber}</span>`;
                currentNumberEl.style.visibility = 'visible';
            } else {
                currentNumberEl.style.visibility = 'hidden';
            }
            if (typeof updateSimpleControllerUI === 'function') updateSimpleControllerUI();
        }

        function showVerificationPanel() {
            const { activeGameNumber, gamesData, appConfig, appLabels } = appStore.state;
            if (!activeGameNumber) {
                showAlert("Nenhuma rodada ativa para verificar.");
                return;
            }
            const game = gamesData[activeGameNumber];
            if (!game) {
                console.error(`Erro: Rodada ativa ${activeGameNumber} não encontrada.`);
                return;
            }
            if (game.calledNumbers.length === 0) {
                showAlert("Nenhum número foi sorteado nesta rodada.");
                return;
            }
        
            DOMElements.verificationModal.innerHTML = getModalTemplates().verification;
            const verificationNumbersContainer = document.getElementById('verification-numbers') as HTMLElement;
            const zoomValue = document.getElementById('verification-zoom-value')!;
            const zoomInBtn = document.getElementById('zoom-in-btn-verification')!;
            const zoomOutBtn = document.getElementById('zoom-out-btn-verification')!;
            const prize1Btn = document.getElementById('confirm-prize1-btn') as HTMLButtonElement;
            const prize2Btn = document.getElementById('confirm-prize2-btn') as HTMLButtonElement;
            const prize3Btn = document.getElementById('confirm-prize3-btn') as HTMLButtonElement;
            const rejectBtn = document.getElementById('reject-bingo-btn')!;
        
            verificationNumbersContainer.innerHTML = '';
            
            const sortedNumbers = [...game.calledNumbers].sort((a, b) => a - b);
        
            const applyZoom = (scale: number) => {
                const baseSize = 96; 
                const baseFontSize = 48; 
                const newSize = Math.round(baseSize * (scale / 100));
                const newFontSize = Math.round(baseFontSize * (scale / 100));
                
                verificationNumbersContainer.querySelectorAll('.verification-number').forEach(el => {
                    const htmlEl = el as HTMLElement;
                    htmlEl.style.width = `${newSize}px`;
                    htmlEl.style.height = `${newSize}px`;
                    htmlEl.style.fontSize = `${newFontSize}px`;
                });
                
                if (zoomValue) zoomValue.textContent = `${scale}%`;
                appStore.state.appConfig.verificationPanelZoom = scale;
            };
            
            const adjustZoom = (amount: number) => {
                const newZoom = Math.max(50, Math.min(200, appStore.state.appConfig.verificationPanelZoom + amount));
                applyZoom(newZoom);
                appStore.debouncedSave();
            };
        
            sortedNumbers.forEach((num: number) => {
                const letter = getLetterForNumber(num);
                const numberEl = document.createElement('div');
                numberEl.className = 'verification-number flex items-center justify-center font-black rounded-full transition-colors duration-200 cursor-pointer bg-gray-200 dark:bg-gray-700 text-slate-800 dark:text-slate-200';
                numberEl.dataset.number = num.toString();
                numberEl.innerHTML = `<span>${letter}</span><span class="ml-1">${num}</span>`;
                
                numberEl.addEventListener('click', () => {
                    numberEl.classList.toggle('bg-green-500');
                    numberEl.classList.toggle('text-white');
                    numberEl.classList.toggle('bg-gray-200'); numberEl.classList.toggle('dark:bg-gray-700');
                    numberEl.classList.toggle('text-slate-800'); numberEl.classList.toggle('dark:text-slate-200');
                });
                verificationNumbersContainer.appendChild(numberEl);
            });
        
            const initialZoom = appConfig.verificationPanelZoom || 100;
            applyZoom(initialZoom);
        
            zoomInBtn.addEventListener('click', () => adjustZoom(5));
            zoomOutBtn.addEventListener('click', () => adjustZoom(-5));
        
            appStore.state.isVerifying = true;
            appStore.debouncedSave(true);
            DOMElements.verificationModal.classList.remove('hidden');
        
            const cleanup = () => {
                document.removeEventListener('keydown', handleKeydown);
            };
        
            const handleKeydown = (e: KeyboardEvent) => {
                e.preventDefault();
                switch(e.key) {
                    case '+': adjustZoom(5); break;
                    case '-': adjustZoom(-5); break;
                    case 'Escape': rejectBtn.click(); break;
                    case '1': if (!prize1Btn.disabled) prize1Btn.click(); break;
                    case '2': if (!prize2Btn.disabled) prize2Btn.click(); break;
                    case '3': if (!prize3Btn.disabled) prize3Btn.click(); break;
                }
            };
            document.addEventListener('keydown', handleKeydown);
        
            prize1Btn.addEventListener('click', () => {
                cleanup();
                handleBingoConfirmation('prize1');
            });
            prize2Btn.addEventListener('click', () => {
                cleanup();
                handleBingoConfirmation('prize2');
            });
            prize3Btn.addEventListener('click', () => {
                cleanup();
                handleBingoConfirmation('prize3');
            });
            rejectBtn.addEventListener('click', () => {
                cleanup();
                appStore.state.isVerifying = false;
                appStore.debouncedSave(true);
                DOMElements.verificationModal.classList.add('hidden');
            });
        
            prize1Btn.disabled = !game.prizes.prize1;
            prize2Btn.disabled = !game.prizes.prize2;
            prize3Btn.disabled = !game.prizes.prize3;
            
            const wonPrize1 = game.winners && game.winners.some((w: any) => w.bingoType === 'prize1');
            const wonPrize2 = game.winners && game.winners.some((w: any) => w.bingoType === 'prize2');
            const wonPrize3 = game.winners && game.winners.some((w: any) => w.bingoType === 'prize3');

            prize1Btn.disabled = !game.prizes.prize1;
            prize2Btn.disabled = !game.prizes.prize2;
            prize3Btn.disabled = !game.prizes.prize3;
            
            if (!game.prizes.prize1) prize1Btn.style.display = 'none';
            else {
                prize1Btn.style.display = 'block';
                if (wonPrize1) prize1Btn.innerHTML = `1: ${appLabels.prize1Label} (Já Sorteado)`;
                else prize1Btn.innerHTML = `1: ${appLabels.prize1Label}`;
            }
            
            if (!game.prizes.prize2) prize2Btn.style.display = 'none';
            else {
                prize2Btn.style.display = 'block';
                if (wonPrize2) prize2Btn.innerHTML = `2: ${appLabels.prize2Label} (Já Sorteado)`;
                else prize2Btn.innerHTML = `2: ${appLabels.prize2Label}`;
            }
            
            if (!game.prizes.prize3) prize3Btn.style.display = 'none';
            else {
                prize3Btn.style.display = 'block';
                if (wonPrize3) prize3Btn.innerHTML = `3: ${appLabels.prize3Label} (Já Sorteado)`;
                else prize3Btn.innerHTML = `3: ${appLabels.prize3Label}`;
            }
        }
        
        function areAllPrizesWon(game: any) {
             const hasPrize1 = !!game.prizes.prize1;
             const hasPrize2 = !!game.prizes.prize2;
             const hasPrize3 = !!game.prizes.prize3;
             
             const wonPrize1 = game.winners.some((w: any) => w.bingoType === 'prize1');
             const wonPrize2 = game.winners.some((w: any) => w.bingoType === 'prize2');
             const wonPrize3 = game.winners.some((w: any) => w.bingoType === 'prize3');

             return (!hasPrize1 || wonPrize1) && (!hasPrize2 || wonPrize2) && (!hasPrize3 || wonPrize3);
        }

        function showNextRoundModal(completedRound: string, nextRound: string) {
            const modal = DOMElements.nextRoundModal;
            if (!modal) return;
        
            DOMElements.nextRoundModal.innerHTML = getModalTemplates().nextRound;
        
            (document.getElementById('completed-round-name') as HTMLElement).textContent = completedRound;
            (document.getElementById('next-round-name') as HTMLElement).textContent = nextRound;
            
            modal.classList.remove('hidden');
        
            const progressBar = document.getElementById('next-round-progress') as HTMLElement;
            
            progressBar.style.transition = 'none';
            progressBar.style.width = '100%';
            
            setTimeout(() => {
                progressBar.style.transition = 'width 5s linear';
                progressBar.style.width = '0%';
            }, 50); 
        
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 5000);
        }

        function handleBingoConfirmation(prizeType: string) {
            const { activeGameNumber, gamesData, appConfig, appLabels } = appStore.state;
            if (!activeGameNumber) return;
            const game = gamesData[activeGameNumber];
            if (!game) return;
            appStore.state.currentBingoType = prizeType;
            DOMElements.verificationModal.classList.add('hidden');
            
            DOMElements.winnerModal.innerHTML = getModalTemplates().winner;
            (document.getElementById('winner-title-display') as HTMLElement).textContent = appConfig.bingoTitle + '!';
            (document.getElementById('game-text-winner') as HTMLElement).textContent = game.name || `Rodada ${activeGameNumber}`;
            (document.getElementById('prize-text-winner') as HTMLElement).textContent = appLabels[`${prizeType}Label` as keyof typeof appLabels] + ': ' + game.prizes[prizeType];

            DOMElements.winnerModal.classList.remove('hidden');
            document.getElementById('winner-name-input')!.focus();

            triggerBingoWinConfetti();
            
            const winnerNameInput = document.getElementById('winner-name-input') as HTMLInputElement;
            const registerWinnerBtn = document.getElementById('register-winner-btn')!;
            let countdown = 60; // Increased to 60 seconds
            const timerEl = document.getElementById('winner-countdown-timer')!;
            timerEl.textContent = countdown.toString();
            
            const cleanupWinnerModal = () => {
                if (countdownInterval) clearInterval(countdownInterval);
                if (confettiAnimationId) clearInterval(confettiAnimationId);
                document.removeEventListener('keydown', handleKeydown);
                appStore.state.isVerifying = false;
                appStore.debouncedSave(true);
            };

            let countdownInterval: any = setInterval(() => {
                countdown--;
                timerEl.textContent = countdown.toString();
                if (countdown <= 0) {
                    cleanupWinnerModal();
                    DOMElements.winnerModal.classList.add('hidden');
                }
            }, 1000);

            winnerNameInput.addEventListener('focus', () => {
                if (countdownInterval) {
                    clearInterval(countdownInterval);
                    timerEl.style.display = 'none'; // Hide timer when typing
                }
            });

            const registerAndClose = () => {
                cleanupWinnerModal();
                const winnerName = winnerNameInput.value.trim();
                const winnerData = appStore.addWinner(prizeType, winnerName);
                
                if (winnerData) {
                    renderWinner(winnerData);
                }
                
                DOMElements.winnerModal.classList.add('hidden');
                
                const gameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${activeGameNumber}"]`);
                if (gameItem && areAllPrizesWon(game)) {
                    game.isComplete = true;
                    updateGameItemUI(gameItem, true);
                    triggerConfetti({ particleCount: 200, spread: 360 });

                    const nextGameNumber = findNextGameNumber();
                    if (nextGameNumber) {
                        const completedRoundName = game.name || `Rodada ${activeGameNumber}`;
                        const nextRoundName = gamesData[nextGameNumber].name || `Rodada ${nextGameNumber}`;
                        showNextRoundModal(completedRoundName, nextRoundName);
                        
                        document.querySelectorAll('.game-item').forEach(el => el.classList.remove('active-round-highlight'));
                        const nextGameItem = DOMElements.gamesListEl.querySelector(`.game-item[data-game-number="${nextGameNumber}"]`);
                        if (nextGameItem) {
                            nextGameItem.classList.add('active-round-highlight');
                            const playBtn = nextGameItem.querySelector('.play-btn');
                            if (playBtn) {
                                playBtn.textContent = '▶️ Jogando...';
                                playBtn.className = 'w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-lg play-btn playing-btn';
                            }
                        }
                        loadRoundState(nextGameNumber.toString());
                    } else if (areAllGamesComplete()) {
                        appStore.state.appConfig.isEventClosed = true;
                        showFinalWinnersModal();
                    }
                }
                
                DOMElements.shareBtn.classList.remove('hidden');
                DOMElements.endEventBtn.classList.remove('hidden');
                appStore.debouncedSave();
            };

            registerWinnerBtn.addEventListener('click', registerAndClose);
            
            const handleKeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    registerAndClose();
                } else if (e.key === 'Escape') {
                    cleanupWinnerModal();
                    DOMElements.winnerModal.classList.add('hidden');
                }
            };
            document.addEventListener('keydown', handleKeydown);
        }
        
        function createWinnerCardElement(winnerData: any): HTMLElement {
            const { gamesData, appLabels } = appStore.state;
            const winnerCard = document.createElement('div');
            winnerCard.className = 'winner-card bg-white dark:bg-gray-700 p-4 rounded-xl shadow-md cursor-pointer transition-transform transform hover:scale-[1.02] border border-slate-200 dark:border-transparent min-h-[44px]';
            winnerCard.dataset.winnerId = winnerData.id.toString();

            const prizeLabelKey = (winnerData.bingoType + 'Label') as keyof typeof appLabels;
            const prizeText = winnerData.bingoType === 'Sorteio' ? winnerData.prize : `${appLabels[prizeLabelKey] || winnerData.bingoType} (${winnerData.prize})`;
            winnerCard.innerHTML = `<h4 class="text-lg font-bold text-gray-900 dark:text-white">${winnerData.name}</h4>
                                     <p class="text-sm font-semibold text-amber-500 dark:text-amber-300">${prizeText}</p>
                                     <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${winnerData.gameNumber === 'Brinde' || winnerData.gameNumber === 'Leilão' ? '' : gamesData[winnerData.gameNumber]?.name || `Rodada ${winnerData.gameNumber}`}</p>`;
            
            winnerCard.addEventListener('click', () => showWinnerEditModal(winnerData.id));
            return winnerCard;
        }

        function renderWinner(winnerData: any) {
            renderAllWinners();
        }
        
        function renderAllWinners() {
            if (!DOMElements.winnersContainer) return;

            const allWinners: any[] = [];
            Object.values(appStore.state.gamesData).forEach((game: any) => {
                if (game.winners && game.winners.length > 0) {
                    allWinners.push(...game.winners);
                }
            });
            allWinners.sort((a: any, b: any) => b.id - a.id);

            const query = winnerSearchFilter.trim().toLowerCase();
            const filtered = query
                ? allWinners.filter((w: any) => {
                    const name = (w.name || '').toLowerCase();
                    const prize = (w.prize || '').toLowerCase();
                    const gameName = (appStore.state.gamesData[w.gameNumber]?.name || `Rodada ${w.gameNumber}` || '').toLowerCase();
                    return name.includes(query) || prize.includes(query) || gameName.includes(query);
                  })
                : allWinners;

            let searchInput = document.getElementById('winners-search-input') as HTMLInputElement;
            let listWrapper = document.getElementById('winners-list-wrapper');

            if (!searchInput || !listWrapper) {
                DOMElements.winnersContainer.innerHTML = `
                    <div class="sticky top-0 z-10 bg-slate-100 dark:bg-gray-800 pt-1 pb-2 space-y-1 border-b border-slate-200 dark:border-gray-700 mb-2">
                        <input id="winners-search-input" type="text" placeholder="🔍 Pesquisar em ${allWinners.length} vencedores..." value="${winnerSearchFilter}" class="w-full text-xs font-medium p-2 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
                        <div id="winners-count-badge" class="text-[11px] text-slate-500 dark:text-slate-400 font-semibold px-1 flex justify-between items-center">
                            <span>Total: ${allWinners.length} vencedores</span>
                            <span>${filtered.length < allWinners.length ? `(${filtered.length} filtrados)` : ''}</span>
                        </div>
                    </div>
                    <div id="winners-list-wrapper" class="space-y-3"></div>
                    <div id="winners-load-more-container" class="mt-3 text-center"></div>
                `;

                searchInput = document.getElementById('winners-search-input') as HTMLInputElement;
                listWrapper = document.getElementById('winners-list-wrapper')!;

                searchInput.addEventListener('input', (e) => {
                    winnerSearchFilter = (e.target as HTMLInputElement).value;
                    winnersVisibleCount = WINNERS_BATCH_SIZE;
                    renderAllWinners();
                });
            } else {
                const countBadge = document.getElementById('winners-count-badge');
                if (countBadge) {
                    countBadge.innerHTML = `
                        <span>Total: ${allWinners.length} vencedores</span>
                        <span>${filtered.length < allWinners.length ? `(${filtered.length} filtrados)` : ''}</span>
                    `;
                }
            }

            if (!listWrapper) return;
            listWrapper.innerHTML = '';

            if (filtered.length === 0) {
                listWrapper.innerHTML = `<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-4">${allWinners.length === 0 ? 'Nenhum vencedor registrado.' : 'Nenhum vencedor encontrado com esse filtro.'}</p>`;
                const loadMoreContainer = document.getElementById('winners-load-more-container');
                if (loadMoreContainer) loadMoreContainer.innerHTML = '';
                return;
            }

            const itemsToRender = filtered.slice(0, winnersVisibleCount);
            const fragment = document.createDocumentFragment();

            itemsToRender.forEach((winner: any) => {
                fragment.appendChild(createWinnerCardElement(winner));
            });

            listWrapper.appendChild(fragment);

            const loadMoreContainer = document.getElementById('winners-load-more-container');
            if (loadMoreContainer) {
                if (winnersVisibleCount < filtered.length) {
                    loadMoreContainer.innerHTML = `
                        <div class="flex flex-col gap-1 items-center pb-2">
                            <p class="text-[11px] text-slate-500 dark:text-slate-400">Exibindo ${itemsToRender.length} de ${filtered.length} vencedores</p>
                            <div class="flex gap-2">
                                <button id="winners-load-more-btn" class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 px-4 rounded-lg shadow-sm transition-all">
                                    Carregar Mais (+${WINNERS_BATCH_SIZE})
                                </button>
                                <button id="winners-load-all-btn" class="bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold py-1.5 px-3 rounded-lg shadow-sm transition-all">
                                    Mostrar Todos
                                </button>
                            </div>
                        </div>
                    `;

                    document.getElementById('winners-load-more-btn')?.addEventListener('click', () => {
                        winnersVisibleCount += WINNERS_BATCH_SIZE;
                        renderAllWinners();
                    });

                    document.getElementById('winners-load-all-btn')?.addEventListener('click', () => {
                        winnersVisibleCount = filtered.length;
                        renderAllWinners();
                    });
                } else if (filtered.length > WINNERS_BATCH_SIZE) {
                    loadMoreContainer.innerHTML = `
                        <p class="text-[11px] text-slate-400 dark:text-slate-500 text-center py-1">Todos os ${filtered.length} vencedores carregados</p>
                    `;
                } else {
                    loadMoreContainer.innerHTML = '';
                }
            }

            if (!isWinnersScrollBound) {
                isWinnersScrollBound = true;
                DOMElements.winnersContainer.addEventListener('scroll', () => {
                    const container = DOMElements.winnersContainer;
                    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
                        if (winnersVisibleCount < filtered.length) {
                            winnersVisibleCount += WINNERS_BATCH_SIZE;
                            renderAllWinners();
                        }
                    }
                });
            }
        }
        
        function showAlert(message: string) {
            DOMElements.customAlertModal.innerHTML = getModalTemplates().alert;
            document.getElementById('custom-alert-message')!.textContent = message;
            DOMElements.customAlertModal.classList.remove('hidden');
            document.getElementById('custom-alert-close-btn')!.addEventListener('click', () => {
                DOMElements.customAlertModal.classList.add('hidden');
            });
        }
        
        function showCongratsModal(winnerName: string, prize: string) {
            if (appStore.state.appConfig.enableSoundEffects) sounds.playWinner();
            DOMElements.congratsModal.innerHTML = getModalTemplates().congrats;
            (document.getElementById('congrats-winner-name') as HTMLElement).textContent = winnerName;
            (document.getElementById('congrats-prize-value') as HTMLElement).textContent = `Ganhou: ${prize}`;
            DOMElements.congratsModal.classList.remove('hidden');
            document.getElementById('close-congrats-modal-btn')!.onclick = () => {
                DOMElements.congratsModal.classList.add('hidden');
                if (confettiAnimationId) clearInterval(confettiAnimationId);
            };
            triggerConfetti();
        }

        function showIntervalModal() {
            const { gamesData, appConfig, menuItems } = appStore.state;
            let breakModal = DOMElements.eventBreakModal || document.getElementById('event-break-modal');
            if (!breakModal) {
                breakModal = document.createElement('div');
                breakModal.id = 'event-break-modal';
                breakModal.className = 'fixed inset-0 bg-gray-100 dark:bg-gray-900 bg-opacity-95 flex items-center justify-center p-4 z-[70] hidden';
                document.body.appendChild(breakModal);
            }
            breakModal.innerHTML = getModalTemplates().eventBreak;
            breakModal.classList.remove('hidden');
            if (DOMElements.confettiCanvas) {
                DOMElements.confettiCanvas.style.zIndex = '51'; // Above modal content
            }
            
            const leftColumnEl = document.getElementById('break-left-column')!;
            const leftContentEl = document.getElementById('break-left-content')!;
            const rightColumnEl = document.getElementById('break-right-column')!;
            const rightContentEl = document.getElementById('break-right-content')!;
            const rightTitleEl = document.getElementById('break-right-title')!;
            const clockEl = document.getElementById('break-clock')!;
            
            const mainGrid = DOMElements.eventBreakModal.querySelector('main');
            
            // Handle Menu Visibility
            const hasMenu = appConfig.showMenuInBreak !== false && menuItems.length > 0;
            let isFullscreen = false;
            
            const updateGridState = () => {
                if ((!hasMenu || isFullscreen) && mainGrid) {
                    leftColumnEl.style.display = 'none';
                    mainGrid.classList.remove('md:grid-cols-2');
                    mainGrid.classList.add('grid-cols-1');
                } else if (mainGrid) {
                    leftColumnEl.style.display = 'flex';
                    mainGrid.classList.add('md:grid-cols-2');
                }
            };
            
            updateGridState();
            
            const toggleBtn = document.getElementById('toggle-sponsors-fullscreen-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    isFullscreen = !isFullscreen;
                    updateGridState();
                });
            }

            const allWinners = Object.values(gamesData).flatMap(g => g.winners || []);
            const allSponsors: Array<{ name: string, image: string }> = [];
            if ((appConfig.globalSponsor?.name && appConfig.globalSponsor.name.trim() !== "") || appConfig.globalSponsor?.image) {
                allSponsors.push(appConfig.globalSponsor);
            }
            if ((appConfig.extraCardSponsor?.name && appConfig.extraCardSponsor.name.trim() !== "") || appConfig.extraCardSponsor?.image) {
                allSponsors.push(appConfig.extraCardSponsor);
            }
            if ((appConfig.prizeDrawSponsor?.name && appConfig.prizeDrawSponsor.name.trim() !== "") || appConfig.prizeDrawSponsor?.image) {
                allSponsors.push(appConfig.prizeDrawSponsor);
            }
            if (appConfig.generalSponsors && Array.isArray(appConfig.generalSponsors)) {
                appConfig.generalSponsors.forEach(s => {
                    if ((s.name && s.name.trim() !== "") || s.image) allSponsors.push(s);
                });
            }
            if (appConfig.enableSponsorsByNumber && appConfig.sponsorsByNumber) {
                Object.values(appConfig.sponsorsByNumber).forEach(s => {
                    if ((s.name && s.name.trim() !== "") || s.image) allSponsors.push(s);
                });
            }
            
            const useSponsors = allSponsors.length > 0;
            const rightColumnContent = useSponsors ? allSponsors : allWinners;
            rightTitleEl.textContent = useSponsors ? "Apoio" : "Vencedores";

            let leftIndex = 0;
            let rightIndex = 0;

            const applyTransition = (el: HTMLElement, state: 'out' | 'in') => {
                const effect = appConfig.sponsorTransitionEffect === 'random' 
                    ? ['fade', 'slide', 'zoom'][Math.floor(Math.random() * 3)] 
                    : appConfig.sponsorTransitionEffect || 'fade';
                
                el.style.transition = 'all 0.5s ease-in-out';
                el.classList.remove('opacity-0', 'translate-x-full', 'scale-50');
                
                if (state === 'out') {
                    if (effect === 'fade') el.classList.add('opacity-0');
                    else if (effect === 'slide') el.classList.add('opacity-0', 'translate-x-full');
                    else if (effect === 'zoom') el.classList.add('opacity-0', 'scale-50');
                }
            };

            const updateContent = () => {
                if (hasMenu) {
                    applyTransition(leftContentEl, 'out');
                    setTimeout(() => {
                        leftContentEl.innerHTML = menuItems[leftIndex % menuItems.length] || '';
                        applyTransition(leftContentEl, 'in');
                        leftIndex++;
                    }, 500);
                }

                if (rightColumnContent.length > 0) {
                    applyTransition(rightContentEl, 'out');
                    setTimeout(() => {
                        const item = rightColumnContent[rightIndex % rightColumnContent.length];
                        
                        let innerHTML = '';
                        if (useSponsors) {
                            rightTitleEl.textContent = item.name || "Apoio";
                            if (item.image) {
                                innerHTML += `<div class="w-full flex-1 min-h-0 flex items-center justify-center p-2 md:p-6"><img src="${item.image}" class="max-w-full max-h-full object-contain drop-shadow-2xl ${isFullscreen ? 'transform scale-125' : ''} transition-transform duration-700"></div>`;
                            } else {
                                innerHTML += `<p class="text-6xl md:text-8xl text-center font-black text-amber-600 dark:text-amber-400 flex-shrink-0">${item.name || 'Patrocinador'}</p>`;
                            }
                        } else {
                            rightTitleEl.textContent = "Vencedores";
                            if (item.name) {
                                innerHTML += `<p class="text-5xl md:text-7xl text-center font-bold text-slate-800 dark:text-slate-100 mb-6">${item.name}</p>`;
                            }
                            if (item.prize) {
                                innerHTML += `<p class="text-6xl md:text-8xl text-center font-black text-amber-600 dark:text-amber-400">${item.prize}</p>`;
                            }
                        }
                        
                        rightContentEl.innerHTML = `<div class="flex flex-col items-center justify-center bg-black/40 rounded-xl p-4 md:p-8 w-full h-full border border-sky-900/40 shadow-xl overflow-hidden min-h-0">${innerHTML}</div>`;
                        applyTransition(rightContentEl, 'in');
                        rightIndex++;
                    }, 500);
                } else {
                     rightContentEl.innerHTML = `<div class="flex flex-col items-center justify-center h-full w-full bg-black/40 rounded-xl border border-sky-900/40"><p class="text-4xl text-slate-400 font-bold">Nenhum dado cadastrado.</p></div>`;
                }
            };
            
            const updateClock = () => {
                clockEl.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            };

            updateContent();
            updateClock();
            
            // Start confetti
            triggerConfetti();
            
            if (intervalContentInterval) clearInterval(intervalContentInterval);
            if (intervalClockInterval) clearInterval(intervalClockInterval);
            if (breakConfettiInterval) clearInterval(breakConfettiInterval);
            
            const cycleTime = (appConfig.sponsorDisplaySeconds || 10) * 1000;
            intervalContentInterval = setInterval(updateContent, cycleTime);
            intervalClockInterval = setInterval(updateClock, 1000);
            breakConfettiInterval = setInterval(triggerConfetti, 3500);
            
            const openIntervalQrBtn = document.getElementById('open-interval-qr-btn');
            if (openIntervalQrBtn) {
                openIntervalQrBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showIntervalQrModal();
                };
            }

            const closeBreakBtn = document.getElementById('close-break-modal-btn');
            if (closeBreakBtn) {
                closeBreakBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (DOMElements.eventBreakModal) DOMElements.eventBreakModal.classList.add('hidden');
                    if (intervalContentInterval) clearInterval(intervalContentInterval);
                    if (intervalClockInterval) clearInterval(intervalClockInterval);
                    if (breakConfettiInterval) clearInterval(breakConfettiInterval);
                    if (DOMElements.confettiCanvas) DOMElements.confettiCanvas.style.zIndex = '50';
                };
            }

            if (DOMElements.eventBreakModal) {
                DOMElements.eventBreakModal.onclick = (e: MouseEvent) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('#open-interval-qr-btn')) {
                        showIntervalQrModal();
                    } else if (target.closest('#close-break-modal-btn')) {
                        if (DOMElements.eventBreakModal) DOMElements.eventBreakModal.classList.add('hidden');
                        if (intervalContentInterval) clearInterval(intervalContentInterval);
                        if (intervalClockInterval) clearInterval(intervalClockInterval);
                        if (breakConfettiInterval) clearInterval(breakConfettiInterval);
                        if (DOMElements.confettiCanvas) DOMElements.confettiCanvas.style.zIndex = '50';
                    }
                };
            }
        }

        async function showIntervalQrModal() {
            let modalEl = document.getElementById('interval-qr-modal');
            if (!modalEl) {
                modalEl = document.createElement('div');
                modalEl.id = 'interval-qr-modal';
                modalEl.className = 'fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-[120] hidden';
            }
            
            const targetContainer = document.fullscreenElement || document.body;
            if (modalEl.parentElement !== targetContainer) {
                targetContainer.appendChild(modalEl);
            }
            modalEl.innerHTML = getModalTemplates().intervalQr;
            modalEl.classList.remove('hidden');

            const appConfig = appStore.state.appConfig;

            // Close handlers
            const closeModal = () => {
                if (modalEl) {
                    modalEl.classList.add('hidden');
                }
            };
            document.getElementById('close-interval-qr-x-btn')?.addEventListener('click', closeModal);
            document.getElementById('close-interval-qr-footer-btn')?.addEventListener('click', closeModal);

            // 1. Live Tracking QR Code
            const liveQrImg = document.getElementById('interval-live-qr-img') as HTMLImageElement;
            const liveQrLoading = document.getElementById('interval-live-qr-loading');
            const liveUrlText = document.getElementById('interval-live-url-text');
            const copyLiveBtn = document.getElementById('interval-copy-live-url-btn');

            if (!appConfig.onlineSyncEnabled) {
                appConfig.onlineSyncEnabled = true;
                appStore.debouncedSave();
                if (typeof initFirebaseSync === 'function') {
                    initFirebaseSync();
                }
            }

            const origin = window.location.origin;
            let basePath = window.location.pathname;
            if (basePath.endsWith('index.html')) basePath = basePath.replace('index.html', '');
            if (!basePath.endsWith('/')) basePath += '/';

            const currentEventId = appConfig.eventId || (window as any).eventId || '';
            const liveUrl = `${origin}${basePath}attendee.html?event=${encodeURIComponent(currentEventId)}`;

            if (liveUrlText) liveUrlText.textContent = liveUrl;

            if (copyLiveBtn) {
                copyLiveBtn.onclick = () => {
                    navigator.clipboard.writeText(liveUrl);
                    copyLiveBtn.textContent = '✓ Link Copiado!';
                    setTimeout(() => copyLiveBtn.textContent = '📋 Copiar Link Ao Vivo', 2000);
                };
            }

            try {
                const qrDataUrl = await QRCode.toDataURL(liveUrl, {
                    width: 300,
                    margin: 2,
                    color: { dark: '#4f46e5', light: '#ffffff' }
                });
                if (liveQrImg && liveQrLoading) {
                    liveQrImg.src = qrDataUrl;
                    liveQrImg.classList.remove('hidden');
                    liveQrLoading.classList.add('hidden');
                }
            } catch (e) {
                console.error("Erro ao gerar QR Code Ao Vivo:", e);
                if (liveQrLoading) liveQrLoading.textContent = "Erro ao gerar QR Code.";
            }

            // 2. PIX QR Code & Key
            const pixTitleDisplay = document.getElementById('interval-pix-title-display');
            const pixQrImg = document.getElementById('interval-pix-qr-img') as HTMLImageElement;
            const pixQrPlaceholder = document.getElementById('interval-pix-qr-placeholder');
            const pixKeyBox = document.getElementById('interval-pix-key-box');
            const copyPixBtn = document.getElementById('interval-copy-pix-key-btn');

            if (pixTitleDisplay) {
                pixTitleDisplay.textContent = appConfig.pixTitle || 'Doação via PIX';
            }

            const hasPixImage = Boolean(appConfig.pixQrCodeUrl);
            const hasPixKey = Boolean(appConfig.pixKey && appConfig.pixKey.trim().length > 0);

            if (hasPixImage) {
                if (pixQrImg) {
                    pixQrImg.src = appConfig.pixQrCodeUrl;
                    pixQrImg.classList.remove('hidden');
                }
                if (pixQrPlaceholder) pixQrPlaceholder.classList.add('hidden');
            } else if (hasPixKey) {
                try {
                    const pixQrDataUrl = await QRCode.toDataURL(appConfig.pixKey.trim(), {
                        width: 300,
                        margin: 2,
                        color: { dark: '#059669', light: '#ffffff' }
                    });
                    if (pixQrImg) {
                        pixQrImg.src = pixQrDataUrl;
                        pixQrImg.classList.remove('hidden');
                    }
                    if (pixQrPlaceholder) pixQrPlaceholder.classList.add('hidden');
                } catch (e) {
                    console.error("Erro ao gerar QR Code do PIX:", e);
                    if (pixQrPlaceholder) {
                        pixQrPlaceholder.textContent = "Chave PIX configurada.";
                        pixQrPlaceholder.classList.remove('hidden');
                    }
                }
            } else {
                if (pixQrPlaceholder) {
                    pixQrPlaceholder.textContent = "Nenhum QR Code ou Chave PIX cadastrada nas Configurações.";
                    pixQrPlaceholder.classList.remove('hidden');
                }
            }

            if (pixKeyBox) {
                if (hasPixKey) {
                    pixKeyBox.textContent = `Chave: ${appConfig.pixKey}`;
                    pixKeyBox.classList.remove('hidden');
                } else {
                    pixKeyBox.classList.add('hidden');
                }
            }

            if (copyPixBtn) {
                if (hasPixKey) {
                    copyPixBtn.classList.remove('hidden');
                    copyPixBtn.onclick = () => {
                        navigator.clipboard.writeText(appConfig.pixKey);
                        copyPixBtn.textContent = '✓ Chave Copiada!';
                        setTimeout(() => copyPixBtn.textContent = '📋 Copiar Chave PIX', 2000);
                    };
                } else {
                    copyPixBtn.classList.add('hidden');
                }
            }
        }
        
        function updateGameItemUI(gameItem: Element, isComplete: boolean) {
            let buttonContainer = gameItem.querySelector('.mt-3');
            if (!buttonContainer) {
                 buttonContainer = document.createElement('div');
                 buttonContainer.className = 'mt-3';
                 gameItem.appendChild(buttonContainer);
            }

            if (isComplete) {
                gameItem.classList.add('game-completed-style');
                gameItem.classList.remove('cursor-pointer');
                buttonContainer.innerHTML = `<button class="w-full min-h-[44px] bg-gray-500 text-white font-bold py-2 px-4 rounded-lg text-sm cursor-pointer reopen-btn">🔄 Reabrir Rodada</button>`;
                gameItem.classList.add('animate-flash-complete');
                setTimeout(() => gameItem.classList.remove('animate-flash-complete'), 1000);
            } else {
                gameItem.classList.remove('game-completed-style');
                gameItem.classList.add('cursor-pointer');
                const gameNumber = gameItem.getAttribute('data-game-number');
                const isActive = appStore.state.activeGameNumber === gameNumber;
                
                let btnHtml = '';
                if (isActive) {
                    btnHtml = `<button class="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-lg play-btn playing-btn">▶️ Jogando...</button>`;
                } else {
                    btnHtml = `<button class="w-full min-h-[44px] bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all shadow-lg play-btn">▶️ Jogar</button>`;
                }
                buttonContainer.innerHTML = btnHtml;
            }
        }
        
        function updateLastPrizesDisplay() {
            const { drawnPrizeNumbers } = appStore.state;
            if (!DOMElements.lastPrizesDisplay) return;
            DOMElements.lastPrizesDisplay.innerHTML = '';
            
            if (drawnPrizeNumbers.length === 0) {
                if (DOMElements.lastPrizesContainer) DOMElements.lastPrizesContainer.classList.add('hidden');
                return;
            }
            
            if (DOMElements.lastPrizesContainer) DOMElements.lastPrizesContainer.classList.remove('hidden');
            const lastFive = drawnPrizeNumbers.slice(-5).reverse();
            lastFive.forEach((num: number) => {
                const prizeEl = document.createElement('div');
                prizeEl.className = 'text-white font-bold rounded-lg w-28 h-16 flex flex-col items-center justify-center shadow-md p-1 scale-90 sm:scale-100 transform transition-all';
                const activeRoundColor = (appStore.state.activeGameNumber && appStore.state.gamesData[appStore.state.activeGameNumber]?.color) 
                    ? appStore.state.gamesData[appStore.state.activeGameNumber].color 
                    : '#a855f7';
                prizeEl.style.backgroundColor = activeRoundColor;
                
                const labelSpan = document.createElement('span');
                labelSpan.className = 'text-[10px] uppercase opacity-80 leading-none mb-1';
                labelSpan.textContent = 'Cartela';
        
                const numberSpan = document.createElement('span');
                numberSpan.className = 'text-3xl font-black leading-none';
                numberSpan.textContent = num.toString();
        
                prizeEl.appendChild(labelSpan);
                prizeEl.appendChild(numberSpan);
                DOMElements.lastPrizesDisplay.appendChild(prizeEl);
            });
        }

        function drawRandomPrize(fromMobile = false) {
            const minInput = document.getElementById(fromMobile === true ? 'sc-prize-min' : 'prize-draw-min') as HTMLInputElement;
            const maxInput = document.getElementById(fromMobile === true ? 'sc-prize-max' : 'prize-draw-max') as HTMLInputElement;
            const noRepeatCheckbox = document.getElementById(fromMobile === true ? 'sc-no-repeat' : 'no-repeat-prize-draw') as HTMLInputElement;

            const min = parseInt(minInput.value);
            const max = parseInt(maxInput.value);

            if (isNaN(min) || isNaN(max) || min > max) {
                showAlert("Por favor, insira um intervalo de números válido.");
                return;
            }

            let finalNumber;
            if (noRepeatCheckbox.checked) {
                const availableNumbers = Array.from({ length: max - min + 1 }, (_, i) => i + min)
                    .filter(num => !appStore.state.drawnPrizeNumbers.includes(num));

                if (availableNumbers.length === 0) {
                    showAlert("Todos os números neste intervalo já foram sorteados!");
                    return;
                }
                finalNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
            } else {
                finalNumber = Math.floor(Math.random() * (max - min + 1)) + min;
            }

            if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
            appStore.state.drawnPrizeNumbers.push(finalNumber);
            appStore.debouncedSave(true);

            const displayContainer = fromMobile === true ? document.getElementById('sc-prize-display-container')! : DOMElements.prizeDrawDisplayContainer;
            
            if (!fromMobile) {
                // Centraliza a tela no painel de sorteio (apenas desktop)
                displayContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const mainNumberDisplay = DOMElements.currentNumberEl;
                mainNumberDisplay.style.visibility = 'hidden';
                DOMElements.mainDisplayLabel.textContent = "SORTEANDO BRINDE...";
            }

            displayContainer.classList.remove('hidden');
            displayContainer.innerHTML = '';

            const prizeDisplay = document.createElement('div');
            if (fromMobile) {
                prizeDisplay.className = 'font-black flex items-center justify-center rounded-2xl w-full h-32 text-white shadow-xl transition-all duration-300';
                prizeDisplay.style.fontSize = '4rem';
            } else {
                prizeDisplay.className = 'font-black flex items-center justify-center rounded-3xl w-72 h-48 sm:w-full sm:max-w-md sm:h-64 text-white shadow-2xl transition-all duration-300';
                prizeDisplay.style.fontSize = 'clamp(4rem, 15vw, 10rem)';
            }
            prizeDisplay.style.lineHeight = '1';
            const { activeGameNumber, gamesData } = appStore.state;
            const roundColor = (activeGameNumber && gamesData[activeGameNumber]?.color) ? gamesData[activeGameNumber].color : '#a855f7';
            prizeDisplay.style.backgroundColor = roundColor;

            displayContainer.appendChild(prizeDisplay);

            let shuffleInterval: ReturnType<typeof setInterval>;
            
            const startShuffle = (speed: number) => {
                clearInterval(shuffleInterval);
                shuffleInterval = setInterval(() => {
                    const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
                    prizeDisplay.textContent = randomNum.toString();
                }, speed);
            };

            startShuffle(50); 
            setTimeout(() => startShuffle(100), 2000); 
            setTimeout(() => startShuffle(200), 3000); 
            setTimeout(() => startShuffle(400), 4000); 

            setTimeout(() => {
                clearInterval(shuffleInterval);
                if (appStore.state.appConfig.enableSoundEffects) sounds.playWinner();
                prizeDisplay.textContent = finalNumber.toString();
                prizeDisplay.classList.add('animate-custom-flash', 'animate-lucky-card');
                
                // --- NOVO: Efeitos de Brilho e Confete Contínuo ---
                prizeDisplay.style.boxShadow = `0 0 50px 20px ${roundColor}`;
                
                const c = getConfettiFn();
                if (c) {
                    // Primeiro estouro grande
                    c({
                        particleCount: 150,
                        spread: 100,
                        origin: { y: 0.6 },
                        zIndex: 10000
                    });

                    // Loop de confete contínuo
                    const end = Date.now() + (3 * 1000); // 3 segundos de festa (ajustado de 30 para 3)
                    const colors = ['#bb0000', '#ffffff', '#facc15', '#3b82f6'];

                    const frame = () => {
                        if (Date.now() > end || displayContainer.classList.contains('hidden')) return;

                        c({
                            particleCount: 2,
                            angle: 60,
                            spread: 55,
                            origin: { x: 0 },
                            colors: colors,
                            zIndex: 10000
                        });
                        c({
                            particleCount: 2,
                            angle: 120,
                            spread: 55,
                            origin: { x: 1 },
                            colors: colors,
                            zIndex: 10000
                        });

                        requestAnimationFrame(frame);
                    };
                    frame();
                }
                // ----------------------------------------
                
                if (DOMElements.mainDisplayLabel) DOMElements.mainDisplayLabel.textContent = "CARTELA SORTEADA!";
                updateLastPrizesDisplay();
                
                const numberInput = document.getElementById('prize-draw-number-manual') as HTMLInputElement;
                if (numberInput) numberInput.value = finalNumber.toString();
                
                // "não precisa descer para colocar o nome" - Removido o focus() automático para evitar saltos de tela
                // nameInput.focus();

                // Removed setTimeout so glow stays until next draw
            }, 5000);

            appStore.debouncedSave();
        }

function showRoundEditModal(gameNumber: string) {
    const { gamesData, appLabels } = appStore.state;
    const game = gamesData[gameNumber];
    if (!game) {
        console.error(`Attempted to edit non-existent round: ${gameNumber}`);
        return;
    }

    DOMElements.roundEditModal.innerHTML = getModalTemplates().roundEdit;

    const titleEl = document.getElementById('round-edit-title') as HTMLElement;
    const nameInput = document.getElementById('round-edit-name') as HTMLInputElement;
    const prizesContainer = document.getElementById('round-edit-prizes-container') as HTMLElement;
    const descriptionTextarea = document.getElementById('round-edit-description') as HTMLTextAreaElement;
    const saveBtn = document.getElementById('save-round-edit-btn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('cancel-round-edit-btn') as HTMLButtonElement;

    titleEl.textContent = `Editar ${game.name || `Rodada ${gameNumber}`}`;
    nameInput.value = game.name;
    descriptionTextarea.value = game.description || '';
    prizesContainer.innerHTML = '';

    Object.keys(game.prizes).forEach((prizeKey, index) => {
        const prizeValue = game.prizes[prizeKey as keyof typeof game.prizes];
        const prizeLabelKey = `prize${index + 1}Label` as keyof typeof appLabels;
        const labelText = appLabels[prizeLabelKey] || `Prêmio ${index + 1}`;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <label for="round-edit-${prizeKey}" class="block text-sm font-medium text-slate-400 mb-1">${labelText}</label>
            <input type="text" id="round-edit-${prizeKey}" data-prize-key="${prizeKey}" value="${prizeValue}" class="w-full p-2 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white rounded-lg text-sm focus:ring-sky-500 focus:border-sky-500">
        `;
        prizesContainer.appendChild(wrapper);
    });

    DOMElements.roundEditModal.classList.remove('hidden');

    saveBtn.onclick = () => {
        game.name = nameInput.value;
        game.description = descriptionTextarea.value;
        
        prizesContainer.querySelectorAll<HTMLInputElement>('input[data-prize-key]').forEach(input => {
            const key = input.dataset.prizeKey;
            if (key && (key === 'prize1' || key === 'prize2' || key === 'prize3')) {
                game.prizes[key] = input.value;
            }
        });

        renderUIFromState();
        
        DOMElements.roundEditModal.classList.add('hidden');
        appStore.debouncedSave();
    };

    cancelBtn.onclick = () => {
        DOMElements.roundEditModal.classList.add('hidden');
    };
}
        
        function setupGlobalKeydownListener() {
            window.addEventListener('keydown', (e) => {
                const activeEl = document.activeElement as HTMLElement;
                const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
                
                if (DOMElements.winnerModal && !DOMElements.winnerModal.classList.contains('hidden')) {
                    return;
                }

                const isOtherModalOpen = !!document.querySelector('.fixed.inset-0.z-50:not(.hidden):not(#verification-modal):not(#floating-number-modal):not(#sponsor-display-modal)');
                if (isOtherModalOpen) {
                    return;
                }

                if (isInputFocused) {
                    return;
                }

                let shortcutString = '';
                if (e.ctrlKey) shortcutString += 'Control+';
                if (e.altKey) shortcutString += 'Alt+';
                if (e.shiftKey) shortcutString += 'Shift+';
                
                let key = e.key;
                if (key === ' ') {
                    key = 'Space';
                } else if (key.length === 1) {
                    key = key.toUpperCase();
                } else {
                    key = key.charAt(0).toUpperCase() + key.slice(1);
                }
                
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
                    return;
                }
                shortcutString += key;

                const action = Object.keys(appStore.state.appConfig.shortcuts).find(
                    (k) => appStore.state.appConfig.shortcuts[k as keyof typeof appStore.state.appConfig.shortcuts] === shortcutString
                );
                
                if (action) {
                    e.preventDefault();
                    
                    switch (action) {
                        case 'autoDraw': handleAutoDraw(); break;
                        case 'verify': showVerificationPanel(); break;
                        case 'clearRound': confirmClearRound(); break;
                        case 'drawPrize': drawRandomPrize(); break;
                        case 'registerPrize': (document.getElementById('prize-draw-form') as HTMLFormElement)?.requestSubmit(); break;
                        case 'sellAuction': (DOMElements.auctionForm as HTMLFormElement)?.requestSubmit(); break;
                        case 'showInterval': showIntervalModal(); break;
                    }
                }
            });
        }

        // --- Gerador e Verificador de Cartelas ---
        function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        
        function generateSingleBingoCardNumbers(): number[][] {
            const card: number[][] = [];
            const ranges = {
                B: { min: 1, max: 15, count: 5 },
                I: { min: 16, max: 30, count: 5 },
                N: { min: 31, max: 45, count: 4 }, // Centro é livre
                G: { min: 46, max: 60, count: 5 },
                O: { min: 61, max: 75, count: 5 }
            };
        
            Object.values(ranges).forEach(config => {
                const column: number[] = [];
                const availableNumbers = Array.from({ length: config.max - config.min + 1 }, (_, i) => i + config.min);
                for (let i = 0; i < config.count; i++) {
                    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
                    column.push(availableNumbers.splice(randomIndex, 1)[0]);
                }
                card.push(column.sort((a, b) => a - b));
            });
        
            card[2].splice(2, 0, 0); // Usando 0 para o espaço livre
        
            return card;
        }



        
        async function generateAndPrintCards() {
            const titleInput = document.getElementById('card-batch-title') as HTMLInputElement;
            const locationInput = document.getElementById('card-batch-location') as HTMLInputElement;
            const dateInput = document.getElementById('card-batch-date') as HTMLInputElement;
            const priceInput = document.getElementById('card-batch-price') as HTMLInputElement;
            const quantityInput = document.getElementById('card-quantity') as HTMLInputElement;
            const colorInput = document.getElementById('card-color') as HTMLInputElement;
            const layoutInput = document.getElementById('card-layout') as HTMLSelectElement;
            const includeQrInput = document.getElementById('card-include-qr') as HTMLInputElement;
            const includeLogoInput = document.getElementById('card-include-logo') as HTMLInputElement;
            const extraInstructionsInput = document.getElementById('card-extra-instructions') as HTMLInputElement;
            
            if (!quantityInput) return;

            const title = (titleInput && titleInput.value.trim()) || "Bingo Amigos";
            const locationVal = (locationInput && locationInput.value.trim()) || "";
            const dateVal = (dateInput && dateInput.value.trim()) || "";
            const priceVal = (priceInput && priceInput.value.trim()) || "";
            const quantity = parseInt(quantityInput.value, 10);
            const cardColor = colorInput ? colorInput.value : '#0ea5e9';
            const isLight = isLightColor(cardColor);
            const headerTextColor = isLight ? '#000000' : '#ffffff';
            const cardsPerPage = layoutInput ? parseInt(layoutInput.value, 10) : 6;
            const includeQr = includeQrInput ? includeQrInput.checked : true;
            const cardUseLogo = includeLogoInput ? includeLogoInput.checked : true;
            const extraInstructions = (extraInstructionsInput && extraInstructionsInput.value.trim()) || '';

            if (isNaN(quantity) || quantity <= 0 || quantity > 5000) {
                showAlert("Por favor, insira uma quantidade válida entre 1 e 5000.");
                return;
            }

            const printBtn = document.getElementById('generate-and-print-cards-btn') as HTMLButtonElement | null;
            if (printBtn) {
                printBtn.innerHTML = "Gerando... Aguarde";
                printBtn.disabled = true;
            }

            // small delay to allow UI to update
            await new Promise(res => setTimeout(res, 100));

            const printWindow = window.open('', '_blank');
            let hasPrintWindow = !!printWindow;
            
            if (hasPrintWindow) {
                printWindow!.document.write('<html><head><title>Preparando...</title></head><body style="font-family: sans-serif; text-align: center; padding: 50px;"><h2>Gerando ' + quantity + ' cartelas...</h2></body></html>');
            } else {
                showAlert("Gerando cartelas em segundo plano (pop-ups bloqueados). Um arquivo HTML será baixado ao final.");
            }
            if (hasPrintWindow) showAlert("Preparando PDF na nova aba. Aguarde...");

            // Generating raw data
            const resetSeriesInput = document.getElementById('card-reset-series') as HTMLInputElement | null;
            const resetSeries = resetSeriesInput ? resetSeriesInput.checked : false;
            
            const { activeGameNumber, gamesData, appLabels } = appStore.state;
            let prizesText = "";
            let sidePrizesText = "";
            if (activeGameNumber && gamesData[activeGameNumber]) {
                const game = gamesData[activeGameNumber];
                const parts = [];
                if (game.prizes.prize1) parts.push(`<b>${appLabels.prize1Label}:</b> ${game.prizes.prize1}`);
                if (game.prizes.prize2) parts.push(`<b>${appLabels.prize2Label}:</b> ${game.prizes.prize2}`);
                if (game.prizes.prize3) parts.push(`<b>${appLabels.prize3Label}:</b> ${game.prizes.prize3}`);
                if (parts.length > 0) {
                    prizesText = `<div class="text-center font-bold text-sm bg-gray-100 border-2 border-black w-full p-2 mb-2 break-words">Prêmios: ${parts.join(' &nbsp;|&nbsp; ')}</div>`;
                    
                    const sideParts = [];
                    if (game.prizes.prize1) sideParts.push(`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block">${appLabels.prize1Label}</span>${game.prizes.prize1}</div>`);
                    if (game.prizes.prize2) sideParts.push(`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block">${appLabels.prize2Label}</span>${game.prizes.prize2}</div>`);
                    if (game.prizes.prize3) sideParts.push(`<div><span class="font-bold border-b border-black/20 block">${appLabels.prize3Label}</span>${game.prizes.prize3}</div>`);
                    sidePrizesText = `<div class="text-[5px] sm:text-[6px] leading-[1.1] text-center w-full mt-1 px-1 break-words">${sideParts.join('')}</div>`;
                }
            }
            
            if (resetSeries) {
                appStore.state.cardsData = {};
            }
            const startSeries = resetSeries ? 1 : Object.keys(appStore.state.cardsData).length + 1;
            const newCardsBatch: Record<string, any> = {};
            const uuids = [];
            for (let i = 0; i < quantity; i++) {
                const uuid = generateUUID();
                uuids.push(uuid);
                const numbers = generateSingleBingoCardNumbers();
                const cardData = {
                    series: startSeries + i,
                    numbers: numbers
                };
                appStore.state.cardsData[uuid] = cardData;
                newCardsBatch[uuid] = cardData;
            }
            
            try {
                await saveCardsBatchToDB(newCardsBatch);
            } catch (e) {
                console.error("Erro ao salvar cartelas no banco local:", e);
            }

            // Sync to firebase in background if needed
            if (appStore.state.appConfig.onlineSyncEnabled && eventId && firebaseUser) {
                const syncToFirebase = async () => {
                    try {
                        let currentBatch = writeBatch(db);
                        let docCount = 0;
                        for (const [uuid, cardData] of Object.entries(newCardsBatch)) {
                            currentBatch.set(doc(db, "cards", uuid), {
                                hostId: firebaseUser.uid,
                                eventId: eventId,
                                series: cardData.series,
                                numbersString: JSON.stringify(cardData.numbers)
                            });
                            docCount++;
                            if (docCount === 100) {
                                await currentBatch.commit();
                                await new Promise(r => setTimeout(r, 2000));
                                currentBatch = writeBatch(db);
                                docCount = 0;
                            }
                        }
                        if (docCount > 0) {
                            await currentBatch.commit();
                        }
                    } catch (e) {
                        console.error('Failed to sync generated cards to Firebase:', e);
                    }
                };
                syncToFirebase();
            }
            
            appStore.debouncedSave();

            // Generation HTML
            let fullHtmlContent = `
                <html>
                    <head>
                        <title>${title}</title>
                        <script src="https://cdn.tailwindcss.com"></script>
                        <style>
                            @media print {
                                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
                                @page { size: A4 portrait; margin: 5mm; }
                            }
                            body { font-family: 'Helvetica', 'Arial', sans-serif; background: white; margin: 0; padding: 0; }
                        </style>
                    </head>
                    <body>
                        <div class="w-full flex flex-col items-center">
            `;
            if (hasPrintWindow) {
                printWindow!.document.open();
                printWindow!.document.write(fullHtmlContent);
            }

            const logoData = appStore.state.appConfig.customLogoBase64 || '';
            const useLogo = cardUseLogo && !!logoData;

            // Split into pages
            for (let i = 0; i < uuids.length; i += cardsPerPage) {
                const batch = uuids.slice(i, i + cardsPerPage);
                const firstSeriesOfFolha = appStore.state.cardsData[batch[0]].series;
                const folhaNumber = Math.floor((firstSeriesOfFolha - 1) / cardsPerPage) + 1;

                const batchPromises = batch.map(async (uuid, idx) => {
                    const cardData = appStore.state.cardsData[uuid];
                    if (!cardData) return "";
                                        let basePath = window.location.pathname;
                    if (basePath.endsWith('index.html')) {
                        basePath = basePath.replace('index.html', '');
                    }
                    if (!basePath.endsWith('/')) {
                        basePath += '/';
                    }
                    const attendeeUrl = `${window.location.origin}${basePath}attendee.html?event=${encodeURIComponent(appStore.state.appConfig.eventId || "default")}`;
                    let qrDataUrl = "";
                    try {
                        qrDataUrl = await QRCode.toDataURL(attendeeUrl, { width: 140, margin: 1 });
                    } catch (e) {}
                    
                    const gameInfo = appStore.state.gamesData[idx + 1];
                    let prizeLabel = `${idx + 1}º PRÊMIO`;
                    let prizeDesc = "";
                    
                    if (gameInfo) {
                       const mainPrize = gameInfo.prizes.prize1 || gameInfo.prizes.prize2 || gameInfo.prizes.prize3 || `Sorteio ${idx + 1}`;
                       prizeDesc = mainPrize;
                    } else {
                       prizeDesc = `Sorteio ${idx + 1}`;
                    }
                    
                    const cardThemeColor = gameInfo?.color || cardColor;
                    const cardHeaderTextColor = isLightColor(cardThemeColor) ? '#000000' : '#ffffff';
                    
                    // Specific prizes below QR Code
                    let gridSideParts = [];
                    if (gameInfo) {
                       if (gameInfo.prizes.prize1) gridSideParts.push(`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block text-[5px]">1º</span>${gameInfo.prizes.prize1}</div>`);
                       if (gameInfo.prizes.prize2) gridSideParts.push(`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block text-[5px]">2º</span>${gameInfo.prizes.prize2}</div>`);
                       if (gameInfo.prizes.prize3) gridSideParts.push(`<div class=""><span class="font-bold border-b border-black/20 block text-[5px]">3º</span>${gameInfo.prizes.prize3}</div>`);
                    }
                    const gridSideText = gridSideParts.length > 0 ? `<div class="text-[5px] sm:text-[6px] leading-[1.1] text-left w-full mt-1 px-0.5 break-words">${gridSideParts.join('')}</div>` : '';

                    return `
                        <div class="border-[2px] border-black flex flex-col bg-white overflow-hidden text-center h-full max-h-full break-inside-avoid" style="page-break-inside: avoid;">
                            <!-- Grade Header -->
                            <div class="border-b-[2px] border-black py-0.5" style="background-color: ${cardThemeColor}; color: ${cardHeaderTextColor};">
                                <div class="font-bold text-[8px] uppercase leading-none mb-0.5 tracking-wider">${prizeLabel}</div>
                                <div class="font-black text-[10px] uppercase leading-none truncate px-1">${prizeDesc}</div>
                            </div>
                            
                            <!-- Split Layout -->
                            <div class="flex flex-row flex-grow items-stretch align-middle w-full min-h-0">
                                <!-- 5x5 GRID Layout (Left side) -->
                                <div class="w-[72%] flex flex-col border-r-[2px] border-black">
                                    <!-- BINGO Header -->
                                    <div class="grid grid-cols-5 border-b-[2px] border-black bg-gray-100 flex-shrink-0">
                                        ${['B', 'I', 'N', 'G', 'O'].map((letter, colIndex) => `
                                            <div class="font-black text-[11px] uppercase flex items-center justify-center py-0.5 ${colIndex === 4 ? '' : 'border-r-[2px] border-black'}">${letter}</div>
                                        `).join('')}
                                    </div>
                                    <!-- BINGO Numbers -->
                                    <div class="flex-grow flex flex-col">
                                        ${[0,1,2,3,4].map((rowIndex) => `
                                            <div class="grid grid-cols-5 flex-grow ${rowIndex === 4 ? '' : 'border-b-[2px] border-black'}">
                                                ${[0,1,2,3,4].map((colIndex) => {
                                                    const num = cardData.numbers[colIndex][rowIndex];
                                                    let cellContent = '';
                                                    if (num === 0) cellContent = useLogo ? `<img src="${logoData}" class="w-full h-full object-contain p-0.5" />` : '★';
                                                    else cellContent = num.toString();
                                                    return `<div class="flex items-center justify-center font-black text-[16px] leading-[1.1] ${colIndex === 4 ? '' : 'border-r-[2px] border-black'} ${num === 0 && !useLogo ? 'bg-gray-200' : ''}">${cellContent}</div>`;
                                                }).join('')}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                        
                                <!-- Info Column (Right side) -->
                                ${includeQr ? `
                                <div class="w-[28%] flex flex-col items-center bg-white p-[2px] justify-between flex-shrink-0 min-h-0">
                                    <div class="text-[7px] font-bold leading-tight uppercase mb-[1px] text-center px-1">Acompanhe ao<br>vivo</div>
                                    <img src="${qrDataUrl}" alt="QR" class="w-20 h-20 border-[2px] border-black object-contain bg-white" />
                                    <div class="text-[4px] text-gray-500 uppercase tracking-widest break-all font-mono mb-[2px]">ID: ${uuid.substring(0,8)}</div>
                                    
                                    <!-- Premiações abaixo do QR Code -->
                                    <div class="flex-grow w-full border-t-[2px] border-black pt-0.5 px-0 flex flex-col gap-[1px] mt-auto bg-gray-50 overflow-hidden">
                                        <div class="text-[5px] font-black uppercase text-center w-full leading-tight bg-gray-200 border border-black py-[1px]">Premiações</div>
                                        ${gridSideText}
                                    </div>
                                </div>
                                ` : `
                                <div class="w-[28%] flex flex-col items-center bg-white p-1 flex-shrink-0 min-h-0 bg-gray-50">
                                    <div class="text-[4px] text-gray-500 uppercase tracking-widest break-all font-mono mb-[2px] mt-1 text-center">ID: ${uuid.substring(0,8)}</div>
                                    <div class="flex-grow flex items-center justify-center opacity-10">
                                        <!-- Placeholder if no QR -->
                                        <div class="text-4xl font-black rotate-[-45deg] whitespace-nowrap">BINGO</div>
                                    </div>
                                    <div class="w-full flex flex-col gap-[1px] mt-auto">
                                        <div class="text-[5px] font-black uppercase text-center w-full leading-tight bg-gray-200 border border-black py-[1px]">Premiações</div>
                                        ${gridSideText}
                                    </div>
                                </div>
                                `}
                            </div>
                        </div>
                    `;
                });

                const resolvedBatchHTML = await Promise.all(batchPromises);
                
                const chunkHtml = `
                    <div class="bg-white border-[4px] border-black flex flex-col w-full h-[287mm] max-w-[210mm] mx-auto p-1 box-border print:p-0" style="page-break-after: always; overflow: hidden;">
                        <!-- MASTER HEADER -->
                        <div class="border-[2px] border-black mb-1 flex flex-col flex-shrink-0">
                            <h1 class="text-center font-black text-3xl uppercase py-1.5 m-0 leading-none tracking-widest" style="background-color: ${cardColor}; color: ${headerTextColor};">
                                ${title}
                            </h1>
                            <div class="flex border-t-[2px] border-black text-[9px] font-bold uppercase divide-x-[2px] divide-black">
                                <div class="flex-1 px-1 py-1 flex items-center">ONDE:&nbsp;<span class="font-normal border-b border-black flex-grow ml-1 min-w-[20px] truncate">${locationVal}</span></div>
                                <div class="w-32 px-1 py-1 flex items-center">DATA:&nbsp;<span class="font-normal border-b border-black flex-grow ml-1 min-w-[20px] truncate">${dateVal}</span></div>
                                <div class="w-[85px] bg-gray-200 flex flex-col items-center justify-center leading-none p-[2px]">
                                    <span class="text-[7px]">CARTELA Nº</span>
                                    <span class="text-sm font-black">${String(folhaNumber).padStart(5, '0')}</span>
                                </div>
                            </div>
                        </div>
                    
                        <!-- MAIN GRIDS -->
                        <div class="flex-grow grid gap-1 pb-1 relative min-h-0 ${cardsPerPage === 1 ? 'grid-cols-1 grid-rows-1' : cardsPerPage === 2 ? 'grid-cols-1 grid-rows-2' : cardsPerPage === 4 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2 grid-rows-3'}">
                             ${resolvedBatchHTML.join('')}
                        </div>
                        
                        ${extraInstructions ? `<div class="border-[2px] border-black border-b-0 text-center font-bold text-[8px] bg-yellow-100 py-0.5">${extraInstructions}</div>` : ''}

                        <!-- MASTER BOTTOM STUB -->
                        <div class="border-[2px] border-black mt-auto flex flex-col uppercase text-[9px] font-bold leading-none flex-shrink-0 bg-white">
                            <div class="flex border-b-[2px] border-black divide-x-[2px] divide-black bg-gray-100">
                                 <div class="flex-1 px-2 py-1 flex items-center justify-center"><span class="font-black text-sm tracking-widest truncate max-w-[250px]">${title}</span></div>
                                 <div class="w-28 px-2 py-1 flex items-center">VALOR:&nbsp;<span class="font-black text-xs ml-auto min-w-[20px]">${priceVal}</span></div>
                                 <div class="w-[85px] bg-gray-300 flex flex-col items-center justify-center py-0.5">
                                      <span class="text-[6px]">CARTELA Nº</span>
                                      <span class="text-sm font-black leading-none">${String(folhaNumber).padStart(5, '0')}</span>
                                 </div>
                            </div>
                            <div class="flex border-b-[2px] border-black">
                                 <div class="flex-1 px-2 py-1 flex items-end">NOME:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                            <div class="flex border-b-[2px] border-black">
                                 <div class="flex-1 px-2 py-1 flex items-end">ENDEREÇO:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                            <div class="flex divide-x-[2px] divide-black">
                                 <div class="flex-[3] px-2 py-1 flex items-end">CIDADE:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                                 <div class="flex-[1] px-2 py-1 flex items-end">UF:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                                 <div class="flex-[3] px-2 py-1 flex items-end">FONE:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                        </div>
                    </div>
                `;
                fullHtmlContent += chunkHtml;
                if (hasPrintWindow) printWindow!.document.write(chunkHtml);

                if (uuids.length > 200) await new Promise(res => setTimeout(res, 5));
            }

            const endHtml = `
                        </div>
                        <script>
                            setTimeout(() => {
                                window.print();
                                window.close();
                            }, 1000);
                        </script>
                    </body>
                </html>
            `;
            fullHtmlContent += endHtml;
            if (hasPrintWindow) {
                printWindow!.document.write(endHtml);
                printWindow!.document.close();
            } else {
                const blob = new Blob([fullHtmlContent], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Cartelas_${title}_${new Date().getTime()}.html`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showAlert("O pop-up foi bloqueado. As cartelas foram baixadas como um arquivo HTML para o seu dispositivo.");
            }
            
            // Auto close modal
            DOMElements.cardGeneratorModal.classList.add('hidden');
        }

        function showCardGeneratorModal() {
             if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
             DOMElements.cardGeneratorModal.innerHTML = getModalTemplates().cardGenerator;
             DOMElements.cardGeneratorModal.classList.remove('hidden');

             const colorInput = document.getElementById('card-color') as HTMLInputElement;
             const { activeGameNumber, gamesData, appConfig } = appStore.state;
             if (colorInput) {
                 if (activeGameNumber && gamesData[activeGameNumber]?.color) {
                     colorInput.value = gamesData[activeGameNumber].color;
                 } else if (appConfig.boardColor && appConfig.boardColor !== 'default') {
                     colorInput.value = appConfig.boardColor;
                 } else {
                     colorInput.value = '#0ea5e9'; // fallback sky-500
                 }
             }

             document.getElementById('generate-and-print-cards-btn')!.addEventListener('click', generateAndPrintCards);
             document.getElementById('close-card-generator-btn')!.addEventListener('click', () => {
                 DOMElements.cardGeneratorModal.classList.add('hidden');
             });
        }

        let scannerStream: MediaStream | null = null;
        let scannerAnimationId: number | null = null;

        async function verifyCardByQRCode(scannedData: string) {
            let uuid = scannedData;
            try {
                const url = new URL(scannedData);
                const cardParam = url.searchParams.get('card');
                if (cardParam) {
                    uuid = cardParam;
                }
            } catch (e) {
                // Not a valid URL, assume it's already the UUID
            }

            const cardData = appStore.state.cardsData[uuid];
            
            if (!cardData) {
                showAlert(`Cartela não encontrada na base local (${uuid}).`);
                return;
            }
            
            const activeGame = appStore.state.activeGameNumber ? appStore.state.gamesData[appStore.state.activeGameNumber] : null;
            if (!activeGame) {
                showAlert("Nenhuma rodada ativa no momento para verificar a cartela.");
                return;
            }

            const calledNumbers = activeGame.calledNumbers;
            let hits = 0;
            let totalNumbers = 24;
            let isWinner = true;
            let cardHTML = `<div class="grid grid-cols-5 gap-1 w-full my-4 bg-white p-2 rounded text-black max-w-sm mx-auto">`;
            
            for (let col = 0; col < 5; col++) {
                cardHTML += `<div class="text-center"><div class="font-black text-xl text-red-600">${['B', 'I', 'N', 'G', 'O'][col]}</div>`;
                for (let row = 0; row < 5; row++) {
                    const num = cardData.numbers[col][row];
                    if (num === 0) {
                        cardHTML += `<div class="w-8 h-8 flex items-center justify-center border border-gray-400 bg-green-300 font-bold text-xs mx-auto mb-1">★</div>`;
                    } else {
                        const isHit = calledNumbers.includes(num);
                        if (isHit) hits++;
                        if (!isHit) isWinner = false;
                        
                        cardHTML += `<div class="w-8 h-8 flex items-center justify-center border border-gray-400 font-bold text-xs mx-auto mb-1 ${isHit ? 'bg-green-300' : 'bg-red-200'}">${num}</div>`;
                    }
                }
                cardHTML += `</div>`;
            }
            cardHTML += `</div>`;
            
            const resultHtml = isWinner ? 
                `<h3 class="text-2xl font-bold text-green-400 mb-2">BINGO VÁLIDO!</h3><p class="text-slate-800 dark:text-slate-200">Todos os números da cartela foram cantados!</p>` :
                `<h3 class="text-2xl font-bold text-red-400 mb-2">BINGO INVÁLIDO</h3><p class="text-slate-800 dark:text-slate-200">Faltam ${(totalNumbers - hits)} número(s).</p>`;
                
            DOMElements.customAlertModal.innerHTML = `<div class="modal-content bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
                <h2 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">Resultado da Verificação</h2>
                <h3 class="text-xl text-slate-800 dark:text-slate-300 mb-4">Cartela N° ${String(cardData.series).padStart(4, '0')}</h3>
                ${resultHtml}
                ${cardHTML}
                <button id="close-card-result-btn" class="mt-6 bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-8 rounded-full text-lg">Fechar</button>
            </div>`;
            
            DOMElements.customAlertModal.classList.remove('hidden');

            if (isWinner) {
                // Broadcast verified winning card to attendee view
                if (!activeGame.verifiedWinningCards) {
                    activeGame.verifiedWinningCards = [];
                }
                activeGame.verifiedWinningCards.push({
                    series: cardData.series,
                    uuid: uuid,
                    numbers: cardData.numbers,
                    drawnCount: calledNumbers.length
                });
                appStore.debouncedSave(true);
            }
            document.getElementById('close-card-result-btn')!.onclick = () => {
                DOMElements.customAlertModal.classList.add('hidden');
            };
        }
        
        // --- Handlers de Eventos ---

        function setupEventListeners() {
            try {
                DOMElements.manualInputForm?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const number = parseInt(DOMElements.numberInput?.value || '');
                    if (!isNaN(number)) {
                        showFloatingNumber(number);
                    } else {
                        showError("Por favor, insira um número válido.");
                    }
                });

                DOMElements.addExtraGameBtn?.addEventListener('click', addExtraGame);
                document.getElementById('auto-draw-btn-top')?.addEventListener('click', handleAutoDraw);
                document.getElementById('auto-draw-btn-bottom')?.addEventListener('click', handleAutoDraw);
                document.getElementById('verify-btn-top')?.addEventListener('click', showVerificationPanel);
                document.getElementById('verify-btn-bottom')?.addEventListener('click', showVerificationPanel);

                DOMElements.prizeDrawForm?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const numberInput = document.getElementById('prize-draw-number-manual') as HTMLInputElement;
                    const nameInput = document.getElementById('prize-draw-name') as HTMLInputElement;
                    const descriptionInput = document.getElementById('prize-draw-description') as HTMLInputElement;
                    
                    const number = numberInput?.value;
                    if (!number) {
                        showAlert("Por favor, insira o número da cartela do brinde.");
                        return;
                    }
                    
                    if (!appStore.state.gamesData['Brindes']) appStore.state.gamesData['Brindes'] = { winners: [], calledNumbers: [] };
                    
                    const winnerData = {
                        id: Date.now(),
                        name: nameInput?.value || `Ganhador #${number}`,
                        prize: descriptionInput?.value || "Brinde",
                        gameNumber: 'Brinde',
                        bingoType: 'Sorteio',
                        cartela: number
                    };
                    appStore.state.gamesData['Brindes'].winners.push(winnerData);
                    renderWinner(winnerData);
                    
                    if (numberInput) numberInput.value = '';
                    if (nameInput) nameInput.value = '';
                    if (descriptionInput) descriptionInput.value = '';
                    
                    appStore.state.latestBingoTimestamp = Date.now();
                    showCongratsModal(winnerData.name, winnerData.prize);
                    appStore.debouncedSave();
                });

                const handleGameSelect = (gameNumber: string) => {
                    if (appStore.state.gamesData[gameNumber]?.isComplete) {
                        showAlert("Esta rodada já foi concluída. Você pode reabri-la se necessário.");
                        return;
                    }
                    const gameItem = document.querySelector(`.game-item[data-game-number="${gameNumber}"]`);
                    if (appStore.state.activeGameNumber === gameNumber) {
                        appStore.setActiveGame(null);
                        loadRoundState(null);
                        document.querySelectorAll('.game-item').forEach(el => {
                            el.classList.remove('active-round-highlight');
                            const num = el.getAttribute('data-game-number');
                            if (num && appStore.state.gamesData[num]) {
                                updateGameItemUI(el, appStore.state.gamesData[num].isComplete);
                            }
                        });
                        const fsRoundSelector = document.getElementById('fs-round-selector') as HTMLSelectElement | null;
                        if (fsRoundSelector) fsRoundSelector.value = '';
                        if (typeof updateSimpleControllerUI === 'function') updateSimpleControllerUI();
                        appStore.debouncedSave();
                        return;
                    }

                    document.querySelectorAll('.game-item').forEach(el => {
                        if (el !== gameItem) el.classList.remove('active-round-highlight');
                    });
                    
                    loadRoundState(gameNumber);
                    
                    document.querySelectorAll('.game-item').forEach(el => {
                         updateGameItemUI(el, appStore.state.gamesData[el.getAttribute('data-game-number')!].isComplete);
                    });
                    
                    if (gameItem) gameItem.classList.add('active-round-highlight');
                    
                    const fsRoundSelector = document.getElementById('fs-round-selector') as HTMLSelectElement | null;
                    if (fsRoundSelector) fsRoundSelector.value = gameNumber;
                    if (typeof updateSimpleControllerUI === 'function') updateSimpleControllerUI();
                };

                DOMElements.gamesListEl?.addEventListener('click', (e) => {
                    const target = e.target as HTMLElement;
                    const gameItem = target.closest('.game-item');
                    if (!gameItem) return;

                    const gameNumber = gameItem.getAttribute('data-game-number');
                    if (!gameNumber) return;

                    if (target.classList.contains('reopen-btn')) {
                        const game = appStore.state.gamesData[gameNumber];
                        if (game) {
                            game.isComplete = false;
                            updateGameItemUI(gameItem, false);
                            appStore.debouncedSave();
                        }
                        return;
                    }
                    
                    // Only select/toggle round if clicking the play button
                    if (!target.closest('.play-btn')) {
                        return;
                    }

                    handleGameSelect(gameNumber);
                });
                
                document.getElementById('prize-draw-random-btn')?.addEventListener('click', () => drawRandomPrize(false));
                
                // Mobile Modal Controls
                document.getElementById('sc-prize-draw-btn')?.addEventListener('click', () => {
                    document.getElementById('sc-prize-draw-modal')?.classList.remove('hidden');
                });
                document.getElementById('close-sc-prize-modal')?.addEventListener('click', () => {
                    document.getElementById('sc-prize-draw-modal')?.classList.add('hidden');
                });
                document.getElementById('sc-do-prize-draw')?.addEventListener('click', () => {
                    // Não escondemos o modal no mobile, a animação vai rolar dentro dele
                    drawRandomPrize(true);
                });
                
                // Quando fechar o modal mobile, limpar o container e esconder
                document.getElementById('close-sc-prize-modal')?.addEventListener('click', () => {
                    const scDisplay = document.getElementById('sc-prize-display-container');
                    if (scDisplay) {
                        scDisplay.innerHTML = '';
                        scDisplay.classList.add('hidden');
                    }
                });
                document.getElementById('sc-view-prizes-btn')?.addEventListener('click', () => {
                    document.getElementById('sc-prize-draw-modal')?.classList.add('hidden');
                    DOMElements.drawnPrizesModal?.classList.remove('hidden');
                });

                if (DOMElements.simpleControllerBtn) {
                    DOMElements.simpleControllerBtn.addEventListener('click', () => {
                        if (DOMElements.scOverlay) {
                            DOMElements.scOverlay.classList.remove('hidden');
                            DOMElements.scOverlay.classList.add('flex');
                            document.querySelector('header')?.classList.add('hidden');
                            document.querySelector('main')?.classList.add('hidden');
                            document.querySelector('footer')?.classList.add('hidden');
                            updateSimpleControllerUI();
                        }
                    });
                }

                if (DOMElements.scCloseBtn) {
                    DOMElements.scCloseBtn.addEventListener('click', () => {
                        DOMElements.scOverlay?.classList.add('hidden');
                        DOMElements.scOverlay?.classList.remove('flex');
                        document.querySelector('header')?.classList.remove('hidden');
                        document.querySelector('main')?.classList.remove('hidden');
                        document.querySelector('footer')?.classList.remove('hidden');
                    });
                }
                
                const scPrevGameBtn = document.getElementById('sc-prev-game-btn');
                const scNextGameBtn = document.getElementById('sc-next-game-btn');
                
                if (scPrevGameBtn) {
                    scPrevGameBtn.addEventListener('click', () => {
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let prevKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            prevKey = keys[0];
                        } else if (currentKeyIdx > 0) {
                            prevKey = keys[currentKeyIdx - 1];
                        } else {
                            prevKey = keys[keys.length - 1];
                        }
                        if (prevKey) {
                            handleGameSelect(prevKey);
                            updateSimpleControllerUI();
                        }
                    });
                }
                
                if (scNextGameBtn) {
                    scNextGameBtn.addEventListener('click', () => {
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let nextKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            nextKey = keys[0];
                        } else if (currentKeyIdx < keys.length - 1) {
                            nextKey = keys[currentKeyIdx + 1];
                        } else {
                            nextKey = keys[0];
                        }
                        if (nextKey) {
                            handleGameSelect(nextKey);
                            updateSimpleControllerUI();
                        }
                    });
                }

                if (DOMElements.scDrawBtn) {
                    DOMElements.scDrawBtn.addEventListener('click', () => {
                        handleAutoDraw();
                    });
                }

                const scVerifyBtn = document.getElementById('sc-verify-btn');
                if (scVerifyBtn) {
                    scVerifyBtn.addEventListener('click', () => {
                        showVerificationPanel();
                    });
                }
                if (DOMElements.scClaimsBtn) {
                    DOMElements.scClaimsBtn.addEventListener('click', () => {
                        DOMElements.scOverlay?.classList.add('hidden');
                        DOMElements.scOverlay?.classList.remove('flex');
                        document.querySelector('header')?.classList.remove('hidden');
                        document.querySelector('main')?.classList.remove('hidden');
                        document.querySelector('footer')?.classList.remove('hidden');
                        setTimeout(() => {
                            document.getElementById('bingo-claims-container')?.scrollIntoView({ behavior: 'smooth' });
                        }, 100);
                    });
                }

                DOMElements.shareBtn?.addEventListener('click', () => showProofOptionsModal());
                DOMElements.endEventBtn?.addEventListener('click', () => showFinalWinnersModal(true));
                DOMElements.resetEventBtn?.addEventListener('click', () => {
                    if (DOMElements.resetConfirmModal) {
                        DOMElements.resetConfirmModal.innerHTML = getModalTemplates().resetConfirm;
                        DOMElements.resetConfirmModal.classList.remove('hidden');
                    }
                    const backupBtn = document.getElementById('backup-before-reset-btn');
                    if (backupBtn) {
                        backupBtn.onclick = () => {
                            saveStateToFile();
                            backupBtn.innerHTML = '✅ Backup Baixado com Sucesso!';
                            backupBtn.classList.remove('bg-amber-600', 'hover:bg-amber-700');
                            backupBtn.classList.add('bg-green-600', 'hover:bg-green-700');
                        };
                    }
                    const confirmBtn = document.getElementById('confirm-reset-btn');
                    if (confirmBtn) {
                        confirmBtn.onclick = async () => {
                            confirmBtn.innerHTML = '<div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2"></div> Apagando...';
                            (confirmBtn as HTMLButtonElement).disabled = true;

                            appStore.isResetting = true;
                            appStore.isInitialized = false;
                            clearTimeout(appStore.saveTimeout);
                            if ((appStore as any).firebaseSyncTimeout) clearTimeout((appStore as any).firebaseSyncTimeout);

                            if (appStore.state.appConfig.eventId) {
                                try {
                                    await setDoc(doc(db, "events", appStore.state.appConfig.eventId), { 
                                        isReset: true,
                                        activeGameNumber: '',
                                        fullStateJSON: ''
                                    }, { merge: true });
                                } catch (e) {
                                    console.error("Erro ao notificar painéis públicos:", e);
                                }
                            }
                            // Preserva expressamente as chaves PIX, QR codes e doações
                            saveDonationSettings(appStore.state.appConfig);
                            safeLocalStorage.removeItem(LOCAL_STORAGE_KEY);
                            safeLocalStorage.removeItem(LOCAL_STORAGE_KEY + '_backup');
                            await clearAllSponsorImages();
                            await clearCardsDB();

                            // Limpa todos os dados do jogo no estado atual
                            appStore.state.activeGameNumber = null;
                            appStore.state.gamesData = {};
                            appStore.state.cardsData = {};
                            appStore.state.drawnPrizeNumbers = [];
                            appStore.state.blockedUsers = [];
                            appStore.state.pendingNumber = null;
                            appStore.state.isVerifying = false;
                            appStore.state.latestBingoTimestamp = 0;
                            appStore.state.latestRoundTimestamp = 0;

                            // Limpa todos os patrocinadores do estado e remove os indicadores do painel de números
                            appStore.state.appConfig.enableSponsorsByNumber = false;
                            appStore.state.appConfig.sponsorsByNumber = {};
                            appStore.state.appConfig.generalSponsors = [];
                            appStore.state.appConfig.globalSponsor = { name: '', image: '' };
                            appStore.state.appConfig.extraCardSponsor = { name: '', image: '' };
                            appStore.state.appConfig.customLogoBase64 = '';
                            (appStore.state.appConfig as any).customLogo = '';
                            updateBoardSponsorIndicators();

                            window.location.reload();
                        };
                    }
                    const cancelBtn = document.getElementById('cancel-reset-btn');
                    if (cancelBtn) {
                        cancelBtn.onclick = () => DOMElements.resetConfirmModal?.classList.add('hidden');
                    }
                });
                DOMElements.intervalBtn?.addEventListener('click', showIntervalModal);
                DOMElements.editMenuBtn?.addEventListener('click', () => {
                    if (DOMElements.menuEditModal) {
                        DOMElements.menuEditModal.innerHTML = getModalTemplates().menuEdit;
                        DOMElements.menuEditModal.classList.remove('hidden');
                    }
                    const textarea = document.getElementById('menu-textarea') as HTMLTextAreaElement;
                    if (textarea) textarea.value = appStore.state.menuItems.join('\n');
                    const saveMenuBtn = document.getElementById('save-menu-btn');
                    if (saveMenuBtn) {
                        saveMenuBtn.onclick = () => {
                            if (textarea) appStore.state.menuItems = textarea.value.split('\n').filter(item => item.trim() !== '');
                            DOMElements.menuEditModal?.classList.add('hidden');
                            appStore.debouncedSave();
                        };
                    }
                    const cancelMenuBtn = document.getElementById('cancel-menu-edit-btn');
                    if (cancelMenuBtn) {
                        cancelMenuBtn.onclick = () => DOMElements.menuEditModal?.classList.add('hidden');
                    }
                });
                DOMElements.checkDrawnPrizesBtn?.addEventListener('click', showDrawnPrizesModal);
                
                const boardZoomSlider = document.getElementById('board-zoom-slider') as HTMLInputElement;
                const displayZoomSlider = document.getElementById('display-zoom-slider') as HTMLInputElement;
                if (boardZoomSlider) {
                    boardZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.boardScale = scale;
                        applyBoardZoom(scale);
                    });
                    boardZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }
                
                const fullScreenAuctionBtn = document.getElementById('fullscreen-auction-btn');
                if (fullScreenAuctionBtn) {
                    fullScreenAuctionBtn.addEventListener('click', () => {
                        const section = document.getElementById('auction-section');
                        if (section) {
                            if (!document.fullscreenElement) {
                                section.requestFullscreen().catch(err => showAlert(`Erro: ${err.message}`));
                            } else {
                                document.exitFullscreen();
                            }
                        }
                    });
                }

                const fullScreenDisplayBtn = document.getElementById('fullscreen-display-btn');
                if (fullScreenDisplayBtn) {
                    fullScreenDisplayBtn.addEventListener('click', () => {
                        const section = document.getElementById('draw-and-prize-section');
                        if (section) {
                            if (!document.fullscreenElement) {
                                section.requestFullscreen().catch(err => {
                                    showAlert(`Erro ao entrar em tela cheia: ${err.message}`);
                                });
                            } else {
                                document.exitFullscreen();
                            }
                        }
                    });
                }

                const showAttendeeQrBtn = document.getElementById('show-attendee-qr-btn');
                const closeAttendeeQrBtn = document.getElementById('close-attendee-qr-btn');
                const attendeeQrModal = document.getElementById('attendee-qr-modal');
                const attendeeQrImage = document.getElementById('attendee-qr-image') as HTMLImageElement;
                const attendeeQrLoading = document.getElementById('attendee-qr-loading');
                const attendeeQrUrlText = document.getElementById('attendee-qr-url-text');
                
                if (showAttendeeQrBtn && closeAttendeeQrBtn && attendeeQrModal) {
                    showAttendeeQrBtn.addEventListener('click', async () => {
                        if (!appStore.state.appConfig.onlineSyncEnabled) {
                            appStore.state.appConfig.onlineSyncEnabled = true;
                            appStore.debouncedSave();
                            initFirebaseSync();
                        }
                        
                        attendeeQrModal.classList.remove('hidden');
                        
                        if (eventId) {
                            generateAttendeeQr();
                        } else {
                            if (attendeeQrUrlText) attendeeQrUrlText.textContent = "Conectando e gerando link...";
                            // Wait for eventId to be generated by Firebase init
                            let checks = 0;
                            const checkInterval = setInterval(() => {
                                if (eventId) {
                                    clearInterval(checkInterval);
                                    generateAttendeeQr();
                                } else if (checks > 20) { // 10 seconds max wait
                                    clearInterval(checkInterval);
                                    if (attendeeQrUrlText) attendeeQrUrlText.textContent = "Falha ao gerar link. Verifique a conexão.";
                                }
                                checks++;
                            }, 500);
                        }
                    });

                    closeAttendeeQrBtn.addEventListener('click', () => {
                        attendeeQrModal.classList.add('hidden');
                    });
                    
                    async function generateAttendeeQr() {
                        if (!attendeeQrUrlText || !attendeeQrImage || !attendeeQrLoading) return;
                        
                        const origin = window.location.origin;
                        let basePath = window.location.pathname;
                        // If pathname ends with index.html, remove it to get the base dir
                        if (basePath.endsWith('index.html')) {
                            basePath = basePath.replace('index.html', '');
                        }
                        if (!basePath.endsWith('/')) {
                            basePath += '/';
                        }
                        const attendeeUrl = `${origin}${basePath}attendee.html?event=${encodeURIComponent(eventId)}`;
                        
                        attendeeQrUrlText.textContent = attendeeUrl;
                        (attendeeQrUrlText as HTMLAnchorElement).href = attendeeUrl;
                        const openBtn = document.getElementById("attendee-open-new-tab-btn");
                        if (openBtn) {
                            openBtn.onclick = () => window.open(attendeeUrl, "_blank");
                        }
                        
                        try {
                            const qrDataUrl = await QRCode.toDataURL(attendeeUrl, { width: 300, margin: 2, color: { dark: '#4f46e5', light: '#ffffff' } });
                            attendeeQrImage.src = qrDataUrl;
                            attendeeQrImage.classList.remove('hidden');
                            attendeeQrLoading.classList.add('hidden');
                            
                            // Check if running on dev URL and show warning
                            if (window.location.hostname.includes('ais-dev')) {
                                let warningEl = document.getElementById('attendee-qr-dev-warning');
                                if (!warningEl) {
                                    warningEl = document.createElement('div');
                                    warningEl.id = 'attendee-qr-dev-warning';
                                    warningEl.className = "mt-4 p-3 bg-red-100 text-red-800 text-xs font-bold rounded-lg border border-red-300 text-center";
                                    warningEl.innerHTML = "⚠️ <strong>Atenção:</strong> Você está no ambiente de desenvolvimento (ais-dev). O QR Code exigirá login no Google se escaneado por outra pessoa. Para criar um QR Code público acessível a todos, clique no botão <strong>Share</strong> (Compartilhar) no canto superior direito e use a URL pública gerada (ais-pre).";
                                    attendeeQrImage.parentElement?.parentElement?.appendChild(warningEl);
                                }
                            }
                        } catch (e) {
                            console.error('Failed to generate attendee QR', e);
                            attendeeQrUrlText.textContent = "Erro ao gerar QR Code.";
                            attendeeQrLoading.classList.add('hidden');
                        }
                    }
                }

                const fullScreenBoardBtn = document.getElementById('fullscreen-board-btn');
                if (fullScreenBoardBtn) {
                    fullScreenBoardBtn.addEventListener('click', () => {
                        const section = document.getElementById('board-section');
                        if (section) {
                            if (!document.fullscreenElement) {
                                section.requestFullscreen().catch(err => {
                                    showAlert(`Erro ao entrar em tela cheia: ${err.message}`);
                                });
                            } else {
                                document.exitFullscreen();
                            }
                        }
                    });
                }
                
                const showWinnersBoardBtn = document.getElementById('show-winners-board-btn');
                if (showWinnersBoardBtn) {
                    showWinnersBoardBtn.addEventListener('click', () => {
                        showFinalWinnersModal(false);
                    });
                }
                
                // Listen to fullscreen changes to style the section properly
                document.addEventListener('fullscreenchange', () => {
                    const fsControls = document.getElementById('fullscreen-controls');
                    const htmlElement = document.documentElement;
                    const isDark = htmlElement.classList.contains('dark');
                    
                    const showWinnersBtn = document.getElementById('show-winners-board-btn');
                    
                    if (showWinnersBtn) {
                        if (document.fullscreenElement && document.fullscreenElement.id === 'board-section') {
                            showWinnersBtn.classList.remove('hidden');
                        } else {
                            showWinnersBtn.classList.add('hidden');
                        }
                    }
                    
                    ['board-section', 'auction-section', 'draw-and-prize-section', 'display-section'].forEach(id => {
                        const section = document.getElementById(id);
                        if (!section) return;

                            if (document.fullscreenElement === section) {
                            section.classList.remove('rounded-2xl', 'shadow-xl');
                            section.classList.add('overflow-y-auto');
                            section.classList.add('h-screen');
                            
                            if (id === 'display-section' || id === 'draw-and-prize-section') {
                                 section.classList.add('p-4');
                                 const fsPrizeControls = document.getElementById('fs-prize-controls');
                                 if (fsPrizeControls) {
                                     fsPrizeControls.classList.remove('hidden');
                                     fsPrizeControls.classList.remove('flex-row');
                                     fsPrizeControls.classList.add('flex');
                                 }
                                 const fsDisplayZoomSlider = document.getElementById('fs-display-zoom-slider') as HTMLInputElement;
                                 if (fsDisplayZoomSlider) fsDisplayZoomSlider.value = appStore.state.appConfig.displayScale.toString();
                                 const fsDisplayZoomValue = document.getElementById('fs-display-zoom-value');
                                 if (fsDisplayZoomValue) fsDisplayZoomValue.textContent = appStore.state.appConfig.displayScale.toString();
                                 
                                 if (id === 'draw-and-prize-section') {
                                     const auctionSection = document.getElementById('auction-section');
                                     if (auctionSection) auctionSection.style.display = 'none';
                                 }
                            }
                            
                            document.querySelectorAll('.fixed.inset-0').forEach(el => {
                                if (el.id !== 'confetti-canvas') {
                                    section.appendChild(el);
                                }
                            });

                            if (id === 'board-section') {
                                if (fsControls) fsControls.classList.remove('hidden');
                                if (fsControls) fsControls.classList.remove('flex-row');
                                if (fsControls) fsControls.classList.add('flex');
                                
                                const fsZoomSlider = document.getElementById('fs-board-zoom-slider') as HTMLInputElement;
                                if (fsZoomSlider) fsZoomSlider.value = appStore.state.appConfig.boardScale.toString();
                                const fsZoomValue = document.getElementById('fs-board-zoom-value');
                                if (fsZoomValue) fsZoomValue.textContent = appStore.state.appConfig.boardScale.toString();
                            }
                            
                            if (id === 'auction-section') {
                                const fsAuctionControls = document.getElementById('fs-auction-controls');
                                if (fsAuctionControls) {
                                    fsAuctionControls.classList.remove('hidden');
                                    fsAuctionControls.classList.remove('flex-row');
                                    fsAuctionControls.classList.add('flex');
                                }

                                const fsAuctionZoomSlider = document.getElementById('fs-auction-zoom-slider') as HTMLInputElement;
                                if (fsAuctionZoomSlider) fsAuctionZoomSlider.value = appStore.state.appConfig.auctionScale.toString();
                                const fsAuctionZoomValue = document.getElementById('fs-auction-zoom-value');
                                if (fsAuctionZoomValue) fsAuctionZoomValue.textContent = appStore.state.appConfig.auctionScale.toString();
                            }

                            if (isDark) {
                                 section.classList.add('bg-gray-800');
                                 section.classList.remove('bg-white');
                            } else {
                                 section.classList.remove('bg-gray-800');
                                 section.classList.add('bg-white');
                            }
                        } else if (!document.fullscreenElement) {
                            section.classList.add('rounded-2xl', 'shadow-xl');
                            section.classList.remove('overflow-y-auto');
                            section.classList.remove('h-screen');
                            if (id === 'display-section' || id === 'draw-and-prize-section') {
                                 section.classList.remove('p-4');
                                 const fsPrizeControls = document.getElementById('fs-prize-controls');
                                 if (fsPrizeControls) {
                                     fsPrizeControls.classList.add('hidden');
                                 }
                                 
                                 if (id === 'draw-and-prize-section') {
                                     const auctionSection = document.getElementById('auction-section');
                                     if (auctionSection) auctionSection.style.display = '';
                                 }
                            }
                            
                            ['floating-number-modal', 'custom-alert-modal', 'congrats-modal', 'winner-modal', 'sponsor-display-modal', 'verification-modal', 'event-break-modal', 'round-edit-modal', 'spinning-wheel-modal', 'next-round-modal', 'final-winners-modal'].forEach(modalId => {
                                 const el = document.getElementById(modalId);
                                 if (el) document.body.appendChild(el);
                            });

                            if (id === 'board-section') {
                                if (fsControls) fsControls.classList.add('hidden');
                                if (fsControls) fsControls.classList.remove('flex');
                            }
                            if (id === 'auction-section') {
                                const fsAuctionControls = document.getElementById('fs-auction-controls');
                                if (fsAuctionControls) {
                                    fsAuctionControls.classList.add('hidden');
                                    fsAuctionControls.classList.remove('flex');
                                }
                            }
                            
                            if (!document.fullscreenElement) {
                                document.querySelectorAll('.fixed.inset-0').forEach(el => {
                                    if (el.id !== 'confetti-canvas') {
                                        document.body.appendChild(el);
                                    }
                                });
                            }
                        }
                    });
                });
                
                // FS controls events
                const fsZoomSlider = document.getElementById('fs-board-zoom-slider');
                if (fsZoomSlider) {
                    fsZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.boardScale = scale;
                        applyBoardZoom(scale);
                        const fsBoardZoomValue = document.getElementById('fs-board-zoom-value');
                        if (fsBoardZoomValue) fsBoardZoomValue.textContent = `${scale}%`;
                        const boardZoomSlider = document.getElementById('board-zoom-slider') as HTMLInputElement;
                        if (boardZoomSlider) boardZoomSlider.value = scale.toString();
                        const boardZoomValue = document.getElementById('board-zoom-value');
                        if (boardZoomValue) boardZoomValue.textContent = `${scale}%`;
                    });
                    fsZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }

                const fsAuctionZoomSlider = document.getElementById('fs-auction-zoom-slider');
                if (fsAuctionZoomSlider) {
                    fsAuctionZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.auctionScale = scale;
                        applyAuctionZoom(scale);
                        const fsAuctionZoomValue = document.getElementById('fs-auction-zoom-value');
                        if (fsAuctionZoomValue) fsAuctionZoomValue.textContent = `${scale}%`;
                    });
                    fsAuctionZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }

                const fsNextBtn = document.getElementById('fs-next-round-btn');
                if (fsNextBtn) {
                    fsNextBtn.addEventListener('click', () => {
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let nextKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            nextKey = keys[0];
                        } else if (currentKeyIdx < keys.length - 1) {
                            nextKey = keys[currentKeyIdx + 1];
                        } else {
                            nextKey = keys[0];
                        }
                        if (nextKey) handleGameSelect(nextKey);
                    });
                }

                const fsPrevBtn = document.getElementById('fs-prev-round-btn');
                if (fsPrevBtn) {
                    fsPrevBtn.addEventListener('click', () => {
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let prevKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            prevKey = keys[0];
                        } else if (currentKeyIdx > 0) {
                            prevKey = keys[currentKeyIdx - 1];
                        } else {
                            prevKey = keys[keys.length - 1];
                        }
                        if (prevKey) handleGameSelect(prevKey);
                    });
                }

                const panelNextBtn = document.getElementById('panel-next-round-btn');
                if (panelNextBtn) {
                    panelNextBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let nextKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            nextKey = keys[0];
                        } else if (currentKeyIdx < keys.length - 1) {
                            nextKey = keys[currentKeyIdx + 1];
                        } else {
                            nextKey = keys[0];
                        }
                        if (nextKey) handleGameSelect(nextKey);
                    });
                }

                const panelPrevBtn = document.getElementById('panel-prev-round-btn');
                if (panelPrevBtn) {
                    panelPrevBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const games = appStore.state.gamesData;
                        const keys = Object.keys(games).filter(k => parseInt(k) > 0).sort((a,b)=>parseInt(a)-parseInt(b));
                        if (keys.length === 0) return;
                        let prevKey = null;
                        let currentKeyIdx = appStore.state.activeGameNumber ? keys.indexOf(appStore.state.activeGameNumber) : -1;
                        if (currentKeyIdx === -1) {
                            prevKey = keys[0];
                        } else if (currentKeyIdx > 0) {
                            prevKey = keys[currentKeyIdx - 1];
                        } else {
                            prevKey = keys[keys.length - 1];
                        }
                        if (prevKey) handleGameSelect(prevKey);
                    });
                }

                const fsRoundSelector = document.getElementById('fs-round-selector');
                if (fsRoundSelector) {
                    fsRoundSelector.addEventListener('change', (e) => {
                        const val = (e.target as HTMLSelectElement).value;
                        if (val) {
                            handleGameSelect(val);
                        }
                    });
                }

                if (DOMElements.activeRoundPanel) {
                    DOMElements.activeRoundPanel.addEventListener('click', (e) => {
                        // Evita disparar se clicou nos botões de navegação
                        if ((e.target as HTMLElement).closest('#panel-prev-round-btn') || 
                            (e.target as HTMLElement).closest('#panel-next-round-btn')) {
                            return;
                        }
                        if (appStore.state.activeGameNumber) {
                            showRoundEditModal(appStore.state.activeGameNumber);
                        }
                    });
                }

                const fsAutoDrawBtn = document.getElementById('fs-auto-draw-btn');
                if (fsAutoDrawBtn) {
                    fsAutoDrawBtn.addEventListener('click', handleAutoDraw);
                }
                
                const fsIntervalBtn = document.getElementById('fs-interval-btn');
                if (fsIntervalBtn) {
                    fsIntervalBtn.addEventListener('click', showIntervalModal);
                }

                if (displayZoomSlider) {
                    displayZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.displayScale = scale;
                        applyDisplayZoom(scale);
                    });
                    displayZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }
                
                const fsDisplayZoomSlider = document.getElementById('fs-display-zoom-slider') as HTMLInputElement;
                if (fsDisplayZoomSlider) {
                    fsDisplayZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.displayScale = scale;
                        applyDisplayZoom(scale);
                        const displayZoomSlider = document.getElementById('display-zoom-slider') as HTMLInputElement;
                        if (displayZoomSlider) displayZoomSlider.value = scale.toString();
                    });
                    fsDisplayZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }

                const auctionZoomSlider = document.getElementById('auction-zoom-slider') as HTMLInputElement;
                if (auctionZoomSlider) {
                    auctionZoomSlider.addEventListener('input', (e) => {
                        const scale = parseInt((e.target as HTMLInputElement).value);
                        appStore.state.appConfig.auctionScale = scale;
                        applyAuctionZoom(scale);
                        const auctionZoomValue = document.getElementById('auction-zoom-value');
                        if (auctionZoomValue) auctionZoomValue.textContent = `${scale}`;
                    });
                    auctionZoomSlider.addEventListener('change', () => appStore.debouncedSave());
                }

                DOMElements.clearRoundBtnTop?.addEventListener('click', confirmClearRound);
                DOMElements.clearRoundBtnBottom?.addEventListener('click', confirmClearRound);

                DOMElements.showDonationModalBtn?.addEventListener('click', async () => {
                    if (DOMElements.donationModal) {
                        DOMElements.donationModal.innerHTML = getModalTemplates().donation;
                    }
                    const appConfig = appStore.state.appConfig;
                    const pixKey = appConfig.pixKey?.trim() || 'paroquiadelutecia@gmail.com';
                    const pixQrUrl = appConfig.pixQrCodeUrl || '';
                    
                    const qrImg = document.getElementById('institution-pix-qr-img') as HTMLImageElement;
                    const placeholder = document.getElementById('institution-pix-qr-placeholder');
                    const pixDisplay = document.getElementById('pix-key-display');
                    const copyPixBtn = document.getElementById('copy-pix-btn');

                    if (pixDisplay) pixDisplay.textContent = pixKey;

                    if (pixQrUrl) {
                        if (qrImg) {
                            qrImg.src = pixQrUrl;
                            qrImg.classList.remove('hidden');
                        }
                        placeholder?.classList.add('hidden');
                    } else if (pixKey) {
                        try {
                            const generatedQr = await QRCode.toDataURL(pixKey, {
                                width: 250, margin: 2, color: { dark: '#059669', light: '#ffffff' }
                            });
                            if (qrImg) {
                                qrImg.src = generatedQr;
                                qrImg.classList.remove('hidden');
                            }
                            placeholder?.classList.add('hidden');
                        } catch (e) {
                            if (placeholder) {
                                placeholder.textContent = 'Erro ao gerar QR Code';
                                placeholder.classList.remove('hidden');
                            }
                        }
                    } else {
                        qrImg?.classList.add('hidden');
                        if (placeholder) {
                            placeholder.textContent = 'Chave PIX não configurada';
                            placeholder.classList.remove('hidden');
                        }
                    }

                    if (copyPixBtn) {
                        copyPixBtn.addEventListener('click', () => {
                            if (pixKey) {
                                navigator.clipboard.writeText(pixKey);
                                copyPixBtn.textContent = '✓ Chave PIX Copiada!';
                                setTimeout(() => { if (copyPixBtn) copyPixBtn.textContent = appStore.state.appLabels.donationModalCopyButton || '📋 Copiar Chave PIX'; }, 2000);
                            }
                        });
                    }
                    const closeDonationBtn = document.getElementById('close-donation-btn');
                    if (closeDonationBtn) {
                        closeDonationBtn.addEventListener('click', () => DOMElements.donationModal?.classList.add('hidden'));
                    }
                    if (DOMElements.donationModal) {
                        DOMElements.donationModal.onclick = (e) => {
                            if (e.target === DOMElements.donationModal) {
                                DOMElements.donationModal.classList.add('hidden');
                            }
                        };
                    }
                    DOMElements.donationModal?.classList.remove('hidden');
                });

                DOMElements.showChangelogBtn?.addEventListener('click', () => {
                    if (DOMElements.changelogModal) {
                        DOMElements.changelogModal.innerHTML = getModalTemplates().changelog;
                    }
                    const contentEl = document.getElementById('version-history-content');
                    if (contentEl) {
                        const htmlContent = appStore.state.versionHistory
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/- \*\*(.*?)\*\*:/g, '<h3 class="text-sky-400 font-bold mt-3 mb-1">$1</h3><p class="pl-4 border-l-2 border-gray-700">')
                            .replace(/\n- /g, '</p><p class="pl-4 border-l-2 border-gray-700">')
                            .replace(/<p class="pl-4 border-l-2 border-gray-700">$/, ''); 

                        contentEl.innerHTML = htmlContent;
                    }
                    const closeChangelogBtn = document.getElementById('close-changelog-btn');
                    if (closeChangelogBtn) {
                        closeChangelogBtn.addEventListener('click', () => DOMElements.changelogModal?.classList.add('hidden'));
                    }
                    DOMElements.changelogModal?.classList.remove('hidden');
                });

                DOMElements.showSettingsBtn?.addEventListener('click', showSettingsModal);

                const themeToggleMainBtn = document.getElementById('theme-toggle-main-btn');
                if (themeToggleMainBtn) {
                    themeToggleMainBtn.addEventListener('click', () => {
                        if (appStore.state.appConfig.enableSoundEffects) sounds.playClick();
                        const themeToggle = document.getElementById('theme-toggle') as HTMLInputElement;
                        // Toggle current value
                        appStore.state.appConfig.isDarkMode = !appStore.state.appConfig.isDarkMode;
                        if (themeToggle) {
                            themeToggle.checked = appStore.state.appConfig.isDarkMode;
                        }
                        applyTheme();
                        appStore.debouncedSave();
                    });
                }

                document.getElementById('add-50-bid')?.addEventListener('click', () => incrementAuctionBid(50));
                document.getElementById('add-100-bid')?.addEventListener('click', () => incrementAuctionBid(100));
                const auctionItemNameInput = document.getElementById('auction-item-name') as HTMLInputElement;
                const auctionWinnerNameInput = document.getElementById('auction-winner-name') as HTMLInputElement;
                const auctionBidInput = document.getElementById('auction-item-current-bid') as HTMLInputElement;
                if (auctionItemNameInput) {
                    auctionItemNameInput.value = appStore.state.appConfig.auctionItemName || '';
                    auctionItemNameInput.addEventListener('input', (e) => { appStore.state.appConfig.auctionItemName = (e.target as HTMLInputElement).value; });
                    auctionItemNameInput.addEventListener('change', (e) => { appStore.debouncedSave(); });
                }
                if (auctionWinnerNameInput) {
                    auctionWinnerNameInput.value = appStore.state.appConfig.auctionWinnerName || '';
                    auctionWinnerNameInput.addEventListener('input', (e) => { appStore.state.appConfig.auctionWinnerName = (e.target as HTMLInputElement).value; });
                    auctionWinnerNameInput.addEventListener('change', (e) => { appStore.debouncedSave(); });
                }
                if (auctionBidInput) {
                    auctionBidInput.value = appStore.state.appConfig.auctionBid || '0';
                    updateAuctionBidDisplay(parseInt(auctionBidInput.value) || 0);
                    auctionBidInput.addEventListener('input', (e) => { 
                        appStore.state.appConfig.auctionBid = (e.target as HTMLInputElement).value; 
                        updateAuctionBidDisplay(parseInt(appStore.state.appConfig.auctionBid) || 0);
                    });
                    auctionBidInput.addEventListener('change', (e) => { appStore.debouncedSave(); });
                }
                const auctionMinus50Btn = document.getElementById('auction-minus-50-btn');
                if (auctionMinus50Btn) auctionMinus50Btn.addEventListener('click', () => incrementAuctionBid(-50));
                const auctionPlus50Btn = document.getElementById('auction-plus-50-btn');
                if (auctionPlus50Btn) auctionPlus50Btn.addEventListener('click', () => incrementAuctionBid(50));

                document.getElementById('add-custom-bid-btn')?.addEventListener('click', () => {
                    const customInput = document.getElementById('custom-bid-input') as HTMLInputElement;
                    const value = parseInt(customInput?.value, 10);
                    if (!isNaN(value)) {
                        incrementAuctionBid(value);
                        if (customInput) customInput.value = '';
                    }
                });

                document.getElementById('reset-auction-btn')?.addEventListener('click', () => {
                    if (appStore.state.appConfig.enableSoundEffects) sounds.playReset();
                    (DOMElements.auctionForm as HTMLFormElement)?.reset();
                     updateAuctionBidDisplay(0);
                     const currentBidInput = document.getElementById('auction-item-current-bid') as HTMLInputElement;
                     if (currentBidInput) currentBidInput.value = '0';
                     appStore.state.appConfig.auctionBid = '0';
                     appStore.debouncedSave();
                });

                 DOMElements.auctionForm?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const itemName = (document.getElementById('auction-item-name') as HTMLInputElement)?.value;
                    const winnerName = (document.getElementById('auction-winner-name') as HTMLInputElement)?.value;
                    const bid = (document.getElementById('auction-item-current-bid') as HTMLInputElement)?.value;

                    if (!itemName || !winnerName || !bid || parseInt(bid) <= 0) {
                        showAlert("Preencha todos os campos do leilão (item, arrematador e lance).");
                        return;
                    }
                     if (!appStore.state.gamesData['Leilão']) appStore.state.gamesData['Leilão'] = { winners: [], calledNumbers: [] };
                    
                    const winnerData = {
                        id: Date.now(),
                        name: winnerName,
                        prize: `${itemName} (Leilão)`,
                        gameNumber: 'Leilão',
                        bingoType: 'Leilão',
                        itemName: itemName,
                        bid: bid
                    };
                    appStore.state.gamesData['Leilão'].winners.push(winnerData);
                    renderWinner(winnerData);
                    
                    if (appStore.state.appConfig.enableSoundEffects) sounds.playSold();
                    
                    showCongratsModal(winnerName, `${itemName} por R$ ${bid},00`);
                    const nameInputEl = document.getElementById('auction-item-name') as HTMLInputElement;
                    const winnerInputEl = document.getElementById('auction-winner-name') as HTMLInputElement;
                    const bidInputEl = document.getElementById('auction-item-current-bid') as HTMLInputElement;
                    if (nameInputEl) nameInputEl.value = '';
                    if (winnerInputEl) winnerInputEl.value = '';
                    if (bidInputEl) bidInputEl.value = '0';
                    appStore.state.appConfig.auctionBid = '0';
                    appStore.debouncedSave();
                    updateAuctionBidDisplay(0);

                    appStore.debouncedSave();
                });
                
                const loadFromFileInput = document.getElementById('load-from-file-input') as HTMLInputElement;
                if (loadFromFileInput) {
                    loadFromFileInput.addEventListener('change', (e) => {
                        loadStateFromFile(e);
                        DOMElements.loadOptionsModal?.classList.add('hidden');
                    });
                }
                document.getElementById('save-to-file-btn')?.addEventListener('click', saveStateToFile);
                
                document.getElementById('show-load-options-btn')?.addEventListener('click', () => {
                    if (DOMElements.loadOptionsModal) {
                        DOMElements.loadOptionsModal.innerHTML = getModalTemplates().loadOptions;
                    }
                    document.getElementById('close-load-options-btn')?.addEventListener('click', () => DOMElements.loadOptionsModal?.classList.add('hidden'));
                    
                    document.getElementById('show-load-cloud-btn')?.addEventListener('click', () => {
                        if (DOMElements.loadOptionsModal) {
                            DOMElements.loadOptionsModal.innerHTML = getModalTemplates().loadCloudPrompt;
                        }
                        document.getElementById('cancel-load-cloud-btn')?.addEventListener('click', () => {
                            DOMElements.loadOptionsModal?.classList.add('hidden');
                        });
                        document.getElementById('confirm-load-cloud-btn')?.addEventListener('click', async () => {
                            const input = document.getElementById('cloud-event-id-input') as HTMLInputElement;
                            const eventIdToLoad = input?.value.trim();
                            if (!eventIdToLoad) return;
                            
                            const spinner = document.getElementById('cloud-load-spinner');
                            spinner?.classList.remove('hidden');
                            const btn = document.getElementById('confirm-load-cloud-btn') as HTMLButtonElement;
                            if (btn) btn.disabled = true;

                            if (!firebaseUser) {
                                try {
                                    // await signInAnonymously(auth);
                                } catch (e) {
                                    showAlert("Erro: Não foi possível conectar ao servidor.");
                                    spinner?.classList.add('hidden');
                                    if (btn) btn.disabled = false;
                                    return;
                                }
                            }

                            try {
                                const docSnap = await getDoc(doc(db, "events", eventIdToLoad));
                                if (docSnap.exists()) {
                                    const data = docSnap.data();
                                    if (data.fullStateJSON) {
                                        const parsedState = JSON.parse(data.fullStateJSON);
                                        const requiredPassword = parsedState.appConfig?.eventPassword;
                                        const providedPassword = (document.getElementById('cloud-event-password-input') as HTMLInputElement)?.value.trim() || '';
                                        if (requiredPassword && requiredPassword !== providedPassword) {
                                            showAlert("Senha incorreta ou não fornecida para este evento.");
                                            spinner?.classList.add('hidden');
                                            if (btn) btn.disabled = false;
                                            return;
                                        }
                                        
                                        appStore.loadStateFromObject(parsedState);
                                        appStore.state.appConfig.eventId = eventIdToLoad;
                                        appStore.state.appConfig.onlineSyncEnabled = true;
                                        renderUIFromState();
                                        updateActiveRoundStats();
                                        applyTheme();
                                        applyLabels();
                                        appStore.debouncedSave();
                                        initFirebaseSync();
                                        showAlert("Evento carregado com sucesso da nuvem!");
                                        DOMElements.loadOptionsModal?.classList.add('hidden');
                                    } else {
                                        showAlert("O evento encontrado não possui um backup completo.");
                                    }
                                } else {
                                    showAlert("Evento não encontrado. Verifique o ID.");
                                }
                            } catch (error: any) {
                                console.error("Erro ao carregar evento da nuvem:", error);
                                showAlert(`Erro: ${error.message}`);
                            } finally {
                                spinner?.classList.add('hidden');
                                if (btn) btn.disabled = false;
                            }
                        });
                    });

                    DOMElements.loadOptionsModal?.classList.remove('hidden');
                });

                const showDevDonationBtn = document.getElementById('show-dev-donation-modal-btn');
                if (showDevDonationBtn) {
                    showDevDonationBtn.addEventListener('click', async () => {
                        const devModal = document.getElementById('dev-donation-modal');
                        const devKey = appStore.state.appConfig.devPixKey?.trim() || '1e8e4af0-4d23-440c-9f3d-b4e527f65911';
                        const devQrUrl = appStore.state.appConfig.devPixQrCodeUrl || '';
                        
                        // Dev PIX
                        const qrImg = document.getElementById('dev-pix-qr-img') as HTMLImageElement;
                        const placeholder = document.getElementById('dev-pix-qr-placeholder');
                        const keyDisplay = document.getElementById('dev-pix-key-display');
                        const copyBtn = document.getElementById('copy-dev-pix-btn');

                        if (devQrUrl) {
                            if (qrImg) {
                                qrImg.src = devQrUrl;
                                qrImg.classList.remove('hidden');
                            }
                            placeholder?.classList.add('hidden');
                        } else if (devKey) {
                            try {
                                const generatedQr = await QRCode.toDataURL(devKey, {
                                    width: 250, margin: 2, color: { dark: '#059669', light: '#ffffff' }
                                });
                                if (qrImg) {
                                    qrImg.src = generatedQr;
                                    qrImg.classList.remove('hidden');
                                }
                                placeholder?.classList.add('hidden');
                            } catch (e) {
                                if (placeholder) {
                                    placeholder.textContent = 'Erro ao gerar QR PIX';
                                    placeholder.classList.remove('hidden');
                                }
                            }
                        } else {
                            qrImg?.classList.add('hidden');
                            if (placeholder) {
                                placeholder.textContent = 'Pix não configurado (Ajuste nas configurações)';
                                placeholder.classList.remove('hidden');
                            }
                        }

                        if (keyDisplay) {
                            keyDisplay.textContent = devKey || 'Chave PIX não informada';
                        }

                        if (copyBtn) {
                            copyBtn.onclick = () => {
                                if (devKey) {
                                    navigator.clipboard.writeText(devKey);
                                    copyBtn.textContent = '✓ Chave PIX Copiada!';
                                    setTimeout(() => { if (copyBtn) copyBtn.textContent = '📋 Copiar Chave PIX'; }, 2000);
                                }
                            };
                        }

                        // Dev PayPal
                        const paypalLink = appStore.state.appConfig.paypalLink?.trim() || 'https://www.paypal.com/donate/?hosted_button_id=WJBLF3LV3RZRW';
                        const paypalQrImg = document.getElementById('dev-paypal-qr-img') as HTMLImageElement;
                        const paypalPlaceholder = document.getElementById('dev-paypal-qr-placeholder');
                        const paypalLinkBtn = document.getElementById('dev-paypal-link-btn') as HTMLAnchorElement;

                        if (paypalLinkBtn) {
                            paypalLinkBtn.href = paypalLink;
                        }

                        if (paypalLink) {
                            try {
                                const generatedPaypalQr = await QRCode.toDataURL(paypalLink, {
                                    width: 250, margin: 2, color: { dark: '#0070ba', light: '#ffffff' }
                                });
                                if (paypalQrImg) {
                                    paypalQrImg.src = generatedPaypalQr;
                                    paypalQrImg.classList.remove('hidden');
                                }
                                paypalPlaceholder?.classList.add('hidden');
                            } catch (e) {
                                if (paypalPlaceholder) {
                                    paypalPlaceholder.textContent = 'Erro ao gerar QR PayPal';
                                    paypalPlaceholder.classList.remove('hidden');
                                }
                            }
                        }

                        if (devModal) {
                            devModal.onclick = (e) => {
                                if (e.target === devModal) {
                                    devModal.classList.add('hidden');
                                    devModal.classList.remove('flex');
                                }
                            };
                        }

                        devModal?.classList.remove('hidden');
                        devModal?.classList.add('flex');
                    });
                }

                const closeDevDonationBtn = document.getElementById('close-dev-donation-btn');
                if (closeDevDonationBtn) {
                    closeDevDonationBtn.addEventListener('click', () => {
                        const modal = document.getElementById('dev-donation-modal');
                        modal?.classList.add('hidden');
                        modal?.classList.remove('flex');
                    });
                }

                if (DOMElements.showCardGeneratorBtn) {
                    DOMElements.showCardGeneratorBtn.addEventListener('click', showCardGeneratorModal);
                }
            } catch (err) {
                console.error("Aviso ao configurar event listeners:", err);
            }
        }

        async function renderDigitalCardMode(uuid: string) {
            let cardData = appStore.state.cardsData[uuid];
            let cardEventId = '';
            
            // Loading UI
            document.body.className = "bg-slate-900 text-slate-100 flex flex-col items-center justify-center min-h-screen p-4";
            document.body.innerHTML = `
                <div class="text-center">
                    <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-sky-500 border-t-transparent mb-4"></div>
                    <p class="text-sky-300 font-bold animate-pulse">Carregando cartela online...</p>
                </div>
            `;
            
            if (!cardData) {
                // Try fetching from Firebase
                try {
                    const docSnap = await getDoc(doc(db, "cards", uuid));
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        cardData = {
                            series: data.series,
                            numbers: JSON.parse(data.numbersString)
                        };
                        cardEventId = data.eventId;
                    } else {
                        document.body.innerHTML = `<div class="text-slate-800 font-bold p-8 bg-white rounded-lg shadow-xl max-w-sm text-center">
                            <h2 class="text-2xl text-red-600 mb-2">Cartela offline</h2>
                            <p class="text-sm">O organizador do bingo ainda não ativou a <b>Nuvem</b> ou não enviou as cartelas para a internet.</p>
                            <p class="text-xs text-slate-500 mt-2 mb-4">Se você for o organizador: vá no computador onde gerou as cartelas, abra as "Opções do Programa", marque "Sincronização Online" e clique em "Forçar Envio de Cartelas para a Nuvem".</p>
                            <p class="text-sm mt-4 text-sky-700">Você ainda pode jogar com a sua cartela de papel!</p>
                        </div>`;
                        return;
                    }
                } catch (e) {
                    console.error("Firebase fetch error", e);
                    document.body.innerHTML = `<div class="text-slate-800 font-bold p-8 bg-white rounded-lg shadow-xl max-w-sm text-center">
                        <h2 class="text-2xl text-red-600 mb-2">Sem conexão</h2>
                        <p class="text-sm">Não foi possível conectar à nuvem. Verifique sua internet.</p>
                    </div>`;
                    return;
                }
            } else {
                // We have it locally but we need the eventId, let's use appStore event ID
                cardEventId = appStore.state.appConfig.eventId;
            }

            // Clean up body and build a simple UI
            document.body.className = "bg-slate-900 text-slate-100 flex flex-col items-center justify-start min-h-screen p-4";
            document.body.innerHTML = `
                <div class="fixed top-0 left-0 w-full p-4 bg-slate-800 shadow-md flex justify-between items-center z-10">
                    <div class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-300 to-yellow-500" id="digital-app-name">
                        Bingo Show
                    </div>
                    <div class="text-sm text-slate-400">Cartela ${cardData.series}</div>
                </div>
                <!-- Realtime Status Line -->
                <div id="realtime-status-banner" class="w-full max-w-md mt-16 p-2 text-center text-sm font-bold bg-slate-800 text-yellow-400 rounded shadow animate-pulse">
                    Aguardando sincronização de sorteio...
                </div>
                
                <div class="mt-4 w-full max-w-md bg-white rounded-xl shadow-2xl p-4 text-slate-900">
                    <h2 class="text-center font-black text-2xl mb-4 text-sky-800 uppercase tracking-widest" id="digital-bingo-title">BINGO</h2>
                    <div class="grid grid-cols-5 gap-1 mx-auto" id="digital-card-grid"></div>
                </div>
                <div class="mt-8 mb-24 text-center text-slate-500 text-xs max-w-md px-4">
                    <p>Série: ${cardData.series.toString().padStart(5, '0')} | UUID: ${uuid}</p>
                    <p class="mt-2 text-yellow-500 font-bold">As pedras serão marcadas automaticamente. Você também pode tocar para marcar manualmente.</p>
                </div>
                
                <div class="fixed bottom-0 left-0 w-full p-4 bg-slate-900 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] z-20 flex justify-center border-t border-slate-700">
                    <button id="shout-bingo-btn" class="w-full max-w-md py-4 px-8 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-black text-2xl uppercase tracking-widest rounded-full shadow-xl transform active:scale-95 transition-all">
                        🔔 BATI BINGO!
                    </button>
                </div>
            `;

                        const grid = document.getElementById('digital-card-grid')!;

            // Bingo Shout Logic
            const shoutBtn = document.getElementById('shout-bingo-btn') as HTMLButtonElement;
            if (shoutBtn) {
                shoutBtn.addEventListener('click', async () => {
                    if (!cardEventId || !(window as any).currentActiveGame) {
                        alert("Sorteio não iniciado ou sem conexão!");
                        return;
                    }
                    shoutBtn.disabled = true;
                    shoutBtn.innerHTML = "🔔 ENVIANDO...";
                    
                    try {
                        const activeGame = (window as any).currentActiveGame;
                        const claimsRef = doc(db, `events/${cardEventId}/games/${activeGame}/bingoClaims`, uuid);
                        await setDoc(claimsRef, {
                            uuid,
                            series: cardData.series,
                            timestamp: Date.now(),
                        });
                        shoutBtn.innerHTML = "✅ BINGO ENVIADO!";
                        shoutBtn.classList.remove('from-green-500', 'to-emerald-600');
                        shoutBtn.classList.add('from-blue-500', 'to-sky-600');
                        alert("Grito de BINGO enviado à banca! Aguarde a conferência oficial.");
                        
                        // Reset button after 10s
                        setTimeout(() => {
                           shoutBtn.innerHTML = "🔔 BATI BINGO!";
                           shoutBtn.classList.add('from-green-500', 'to-emerald-600');
                           shoutBtn.classList.remove('from-blue-500', 'to-sky-600');
                           shoutBtn.disabled = false;
                        }, 10000);
                        
                    } catch (e) {
                         alert("Erro ao enviar: verifique sua internet.");
                         shoutBtn.innerHTML = "🔔 BATI BINGO!";
                         shoutBtn.disabled = false;
                    }
                });
            }

            const headers = ['B', 'I', 'N', 'G', 'O'];
            
            // Draw headers
            headers.forEach(h => {
                const headerCell = document.createElement('div');
                headerCell.className = "font-bold text-center py-2 bg-sky-200 text-sky-900 rounded-t border border-sky-300";
                headerCell.textContent = h;
                grid.appendChild(headerCell);
            });

            const cellsByNumber: Record<number, HTMLElement> = {};

            // Draw numbers (5 columns x 5 rows)
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    const number = cardData.numbers[col][row];
                    const cell = document.createElement('div');
                    
                    if (number === 0) {
                        cell.className = "flex items-center justify-center font-bold h-12 sm:h-16 text-xs sm:text-sm bg-yellow-200 text-yellow-800 border border-yellow-400 p-1 text-center leading-none";
                        cell.textContent = "BINGO";
                        cell.onclick = () => {
                            cell.classList.toggle('bg-yellow-200');
                            cell.classList.toggle('text-yellow-800');
                            cell.classList.toggle('bg-green-500');
                            cell.classList.toggle('text-white');
                        };
                    } else {
                        cell.className = "flex items-center justify-center font-black text-xl sm:text-2xl h-12 sm:h-16 bg-slate-50 text-slate-800 border border-slate-300 cursor-pointer transition-colors select-none";
                        cell.textContent = number.toString();
                        cellsByNumber[number] = cell; // store for auto-marking
                        cell.onclick = () => {
                            // Manual toggle
                            if (cell.dataset.drawn !== 'true') {
                                cell.classList.toggle('bg-slate-50');
                                cell.classList.toggle('text-slate-800');
                                cell.classList.toggle('bg-indigo-600');
                                cell.classList.toggle('text-white');
                            }
                        };
                    }
                    grid.appendChild(cell);
                }
            }

            // Realtime Sync Logic (Listen to Event and Games)
            if (cardEventId) {
                // Anonymous sign-in for players
                onAuthStateChanged(auth, async (user) => {
                    if (!user) {
                        try {
                            // await signInAnonymously(auth);
                        } catch(e: any) {
                            console.warn("Auth falhou online", e);
                            document.body.innerHTML += `<div class="fixed top-0 left-0 w-full p-4 bg-red-600 text-white font-bold text-center z-50 shadow-lg">
                                ⚠️ Erro de nuvem: O organizador não ativou a permissão de "Login Anônimo" no banco de dados. O bingo não funcionará online.
                            </div>`;
                        }
                    } else {
                        let lastActiveGame = '';
                        // Watch event
                        onSnapshot(doc(db, "events", cardEventId), (docSnap) => {
                           if (docSnap.exists()) {
                               const eventData = docSnap.data();
                               document.getElementById('digital-app-name')!.textContent = eventData.appName || "Bingo Show";
                               if (eventData.bingoTitle) {
                                   document.getElementById('digital-bingo-title')!.textContent = eventData.bingoTitle;
                               }
                               
                               const activeGame = eventData.activeGameNumber;
                               const statusBanner = document.getElementById('realtime-status-banner')!;
                               
                               if (activeGame !== lastActiveGame) {
                                   lastActiveGame = activeGame;
                                   
                                   if (activeGame) {
                                       statusBanner.className = "w-full max-w-md mt-16 p-2 text-center text-sm font-bold bg-green-800 text-green-100 rounded shadow";
                                       statusBanner.innerHTML = `🟢 Rodada Ativa! Carregando sincronização...`;
                                       (window as any).currentActiveGame = activeGame;
                                       
                                       // Unsub previous game listeners
                                       if ((window as any).currentGameUnsub) {
                                           (window as any).currentGameUnsub();
                                       }
                                       
                                       // Watch active game
                                       (window as any).currentGameUnsub = onSnapshot(doc(db, `events/${cardEventId}/games`, activeGame), (gameSnap) => {
                                       if (gameSnap.exists()) {
                                            const gameData = gameSnap.data();
                                            statusBanner.innerHTML = `🟢 Sorteio Online: <strong>${gameData.name || activeGame}</strong>`;
                                            const calledNumbers: number[] = gameData.calledNumbers || [];
                                            
                                            // Process auto-marking
                                            Object.keys(cellsByNumber).forEach(numStr => {
                                                const num = parseInt(numStr);
                                                const cell = cellsByNumber[num];
                                                if (calledNumbers.includes(num)) {
                                                    cell.dataset.drawn = 'true';
                                                    cell.className = "flex items-center justify-center font-black text-xl sm:text-2xl h-12 sm:h-16 text-white cursor-pointer transition-colors select-none";
                                                    cell.style.backgroundColor = gameData.color || '#3b82f6';
                                                    cell.style.borderColor = gameData.color || '#3b82f6';
                                                } else {
                                                    cell.dataset.drawn = 'false';
                                                    cell.className = "flex items-center justify-center font-black text-xl sm:text-2xl h-12 sm:h-16 bg-slate-50 text-slate-800 border border-slate-300 cursor-pointer transition-colors select-none";
                                                    cell.style.backgroundColor = '';
                                                    cell.style.borderColor = '';
                                                }
                                            });
                                       }
                                   });
                                   
                               } else {
                                   statusBanner.className = "w-full max-w-md mt-16 p-2 text-center text-sm font-bold bg-slate-800 text-yellow-400 rounded shadow animate-pulse";
                                   statusBanner.innerHTML = `⏳ Aguardando próximo sorteio...`;
                                   // Clear boards
                                   Object.values(cellsByNumber).forEach(cell => {
                                      cell.dataset.drawn = 'false';
                                      cell.className = "flex items-center justify-center font-black text-xl sm:text-2xl h-12 sm:h-16 bg-slate-50 text-slate-800 border border-slate-300 cursor-pointer transition-colors select-none";
                                      cell.style.backgroundColor = '';
                                      cell.style.borderColor = '';
                                   });
                               }
                               }
                           }
                        });
                    }
                });
            }
        }

        // --- Inicialização Robusta ---
        function initializeBingoApp() {
            const urlParams = new URLSearchParams(window.location.search);
            const cardToPlay = urlParams.get('card');
            const viewMode = urlParams.get('view');
            const eventParam = urlParams.get('event');

            if (viewMode === 'attendee' && eventParam) {
                const basePath = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
                window.location.href = `${window.location.origin}${basePath}attendee.html?event=${encodeURIComponent(eventParam)}`;
                return;
            }

            appStore.loadInitialState().then(() => {
                console.log("Estado inicial carregado com sucesso.");

                if (cardToPlay && !urlParams.get('host')) {
                    // Inicia o modo de cartela digital imediatamente
                    document.body.innerHTML = '';
                    renderDigitalCardMode(cardToPlay);
                    return;
                }
                
                try {
                    setupEventListeners();
                } catch (e) {
                    console.error("[Init] Erro ao configurar listeners de eventos:", e);
                }

                try {
                    setupGlobalKeydownListener();
                } catch (e) {
                    console.error("[Init] Erro ao configurar listeners de teclado:", e);
                }

                // Salva o estado imediatamente antes de qualquer recarregamento ou fechamento da janela
                window.addEventListener('beforeunload', () => {
                    if (!appStore.isResetting) {
                        appStore.saveStateToLocalStorage();
                    }
                });
                window.addEventListener('pagehide', () => {
                    if (!appStore.isResetting) {
                        appStore.saveStateToLocalStorage();
                    }
                });
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'hidden' && !appStore.isResetting) {
                        appStore.saveStateToLocalStorage();
                    }
                });

                const initialRound = appStore.state.activeGameNumber;
                if (initialRound && appStore.state.gamesData[initialRound]) {
                    try {
                        loadRoundState(initialRound);
                    } catch (e) {
                        console.error("[Init] Erro ao carregar estado da rodada inicial:", e);
                    }
                } else {
                    loadRoundState(null);
                }
                
                if (appStore.state.appConfig.onlineSyncEnabled) {
                    try {
                        initFirebaseSync();
                    } catch (e) {
                        console.error("[Init] Erro ao iniciar sincronização:", e);
                    }
                }
            }).catch(err => {
                console.error("Erro na inicialização do Bingo Show:", err);
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeBingoApp);
        } else {
            initializeBingoApp();
        }

        // --- Firebase Sync Logic ---
        function updateSyncStatusUI() {
            const statusEl = document.getElementById('online-sync-status');
            const forceSyncBtn = document.getElementById('force-sync-cards-btn');
            const globalStatusEl = document.getElementById('global-connection-status');
            
            if (statusEl) {
                statusEl.classList.remove('hidden');
                if (eventId) {
                    statusEl.classList.add('bg-green-100', 'text-green-800', 'border', 'border-green-300', 'dark:bg-green-900', 'dark:text-green-200');
                    statusEl.innerHTML = `✅ Sincronizado. Jogadores online.<br/><strong>ID:</strong> ${eventId}`;
                    if (forceSyncBtn && Object.keys(appStore.state.cardsData).length > 0) {
                        forceSyncBtn.classList.remove('hidden');
                    }
                } else {
                    statusEl.className = 'mt-2 text-sm text-center p-2 rounded max-w-sm ml-auto mr-auto break-all bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-200';
                    statusEl.innerHTML = `⏳ Conectando...`;
                    if (forceSyncBtn) forceSyncBtn.classList.add('hidden');
                }
            }
            
            if (globalStatusEl) {
                 if (appStore.state.appConfig.onlineSyncEnabled) {
                     globalStatusEl.classList.remove('hidden');
                     if (eventId) {
                         globalStatusEl.className = 'flex items-center justify-center p-2 rounded-full shadow-lg bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm font-bold font-mono text-center px-6 border-2 border-green-400 dark:border-green-600 cursor-pointer hover:bg-green-200 dark:hover:bg-green-800 transition-colors';
                         globalStatusEl.innerHTML = `✅ Modo Online`;
                         globalStatusEl.onclick = () => {
                             navigator.clipboard.writeText(eventId).then(() => {
                                 showAlert(`ID do Evento copiado para a área de transferência:\n${eventId}\n\nAtenção: Apenas os jogos e configurações são exportadas para a Nuvem. Imagens de patrocinadores e logos não são sincronizados na Nuvem.\n\nPara exportar tudo em alta definição (incluindo imagens), vá em "Opções do Programa" e salve o Backup (JSON) no seu computador!`);
                             }).catch(() => {
                                 showAlert(`O ID do Evento é:\n${eventId}`);
                             });
                         };
                     } else {
                         globalStatusEl.className = 'flex items-center justify-center p-2 rounded-full shadow-lg bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-sm font-bold font-mono text-center px-6 border-2 border-yellow-400 dark:border-yellow-600';
                         globalStatusEl.innerHTML = `⏳ Conectando à Nuvem...`;
                     }
                 } else {
                     globalStatusEl.classList.add('hidden');
                 }
            }
        }

        async function initFirebaseSync() {
            if (!auth || !db) return;
            if (!appStore.state.appConfig.onlineSyncEnabled) return;
            
            if (!appStore.state.appConfig.eventId) {
                appStore.state.appConfig.eventId = 'event-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
                appStore.debouncedSave();
            }
            eventId = appStore.state.appConfig.eventId;
            
            updateSyncStatusUI();

            onAuthStateChanged(auth, async (user) => {
                firebaseUser = user || { uid: 'public-host' };
                updateSyncStatusUI();
                
                // Trigger a sync
                if (typeof (appStore as any).debouncedFirebaseSync === 'function') {
                    (appStore as any).debouncedFirebaseSync();
                }

                if (appStore.state.activeGameNumber) {
                    loadRoundState(appStore.state.activeGameNumber);
                }
            });
        }

        // --- PWA Auto Update Logic ---
        function showSystemUpdateModal(onUpdateNow?: () => void) {
            let modal = document.getElementById('system-update-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'system-update-modal';
                modal.className = 'fixed inset-0 bg-black/80 z-[99999] flex items-center justify-center p-4 backdrop-blur-md animate-fade-in';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-3xl shadow-2xl max-w-md w-full text-center border-2 border-sky-500">
                    <div class="w-16 h-16 bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl shadow-inner animate-bounce">
                        🚀
                    </div>
                    <h2 class="text-2xl font-black text-gray-900 dark:text-white mb-2">Atualizando o Bingo Show...</h2>
                    <p class="text-slate-600 dark:text-slate-300 text-sm mb-6 leading-relaxed">
                        Uma nova versão foi detectada e o sistema está sendo atualizado automaticamente para garantir que você utilize sempre a versão mais recente e sem falhas.
                    </p>
                    <button id="pwa-force-update-btn" class="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-xl text-base shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer">
                        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Atualizar Agora</span>
                    </button>
                </div>
            `;
            modal.classList.remove('hidden');
            const forceBtn = document.getElementById('pwa-force-update-btn');
            if (forceBtn) {
                forceBtn.onclick = () => {
                    if (onUpdateNow) onUpdateNow();
                    else window.location.reload();
                };
            }
            setTimeout(() => {
                if (onUpdateNow) onUpdateNow();
                else window.location.reload();
            }, 2000);
        }

        try {
            const lastSeenVer = safeLocalStorage.getItem('bingo_last_seen_version');
            if (lastSeenVer && lastSeenVer !== currentVersion) {
                const toast = document.createElement('div');
                toast.className = 'fixed bottom-6 right-6 z-50 bg-sky-600 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-sky-400/50 animate-fade-in-up';
                toast.innerHTML = `
                    <span class="text-xl">🎉</span>
                    <div class="text-xs sm:text-sm">
                        <p class="font-bold">Bingo Show Atualizado para a v${currentVersion}!</p>
                        <p class="text-sky-100 text-[11px]">Você está utilizando a versão mais recente do sistema.</p>
                    </div>
                    <button class="ml-2 text-white/80 hover:text-white font-black text-lg leading-none cursor-pointer" onclick="this.parentElement.remove()">✕</button>
                `;
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 6000);
            }
            safeLocalStorage.setItem('bingo_last_seen_version', currentVersion);
        } catch (err) {
            console.warn("Version check error:", err);
        }

        try {
            if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                const updateSW = registerSW({
                    immediate: true,
                    onNeedRefresh() {
                        showSystemUpdateModal(() => {
                            updateSW(true);
                        });
                    },
                    onOfflineReady() {
                        console.log('App ready to work offline');
                    },
                    onRegistered(swRegistration: ServiceWorkerRegistration | undefined) {
                        if (swRegistration) {
                            swRegistration.update().catch(() => {});
                            setInterval(() => {
                                swRegistration.update().catch(() => {});
                            }, 60 * 1000);
                        }
                    },
                    onRegisterError(error: any) {
                        console.warn('Service worker registration failed:', error);
                    }
                });
            }
        } catch (e) {
            console.warn('Service worker registration skipped:', e);
        }

        // --- PWA Installation Logic ---
        let deferredPrompt: any;

        window.addEventListener('beforeinstallprompt', (e) => {
            try {
                e.preventDefault();
                deferredPrompt = e;
                const installBtn = document.getElementById('install-pwa-btn');
                if (installBtn && window.self === window.top) {
                    installBtn.classList.remove('hidden');
                    installBtn.addEventListener('click', async () => {
                        installBtn.classList.add('hidden');
                        if (deferredPrompt) {
                            deferredPrompt.prompt();
                            const { outcome } = await deferredPrompt.userChoice;
                            console.log(`User response to the install prompt: ${outcome}`);
                            deferredPrompt = null;
                        }
                    });
                }
            } catch (err) {
                console.warn("PWA install error:", err);
            }
        });