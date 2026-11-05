# PrêmioShow

Programa para conduzir **Shows de Prêmios (bingo)** em paróquias, quermesses e organizações beneficentes. Funciona no navegador, pode ser instalado como aplicativo (PWA) e sincroniza em tempo real, via Firebase, o painel de quem apresenta com a tela que o público acompanha.

## Os dois painéis

### Painel do Apresentador (`/` → `index.html`)

É a tela de controle de quem conduz o evento. Nela é possível:

- cadastrar as **rodadas e os prêmios** de cada uma, com patrocinadores e imagens;
- sortear os números (manualmente ou com **sorteio automático**) e acompanhar o **painel de números** já chamados;
- registrar e conferir **vencedores**, inclusive com a verificação de cartelas;
- **gerar cartelas** para impressão e **ler cartelas por QR Code** com a câmera;
- fazer **sorteio de brindes**, usar a **roleta** e conduzir um **leilão**;
- exibir telas de intervalo e de patrocinadores;
- mostrar o QR Code que leva o público ao painel dele.

### Painel do Público (`/attendee.html`)

É a tela aberta pelos participantes no celular (lendo o QR Code mostrado pelo apresentador) ou projetada num telão. Ela recebe do Firebase, em tempo real, os números sorteados, a rodada e o prêmio em jogo, os vencedores e os avisos do evento. Não é preciso instalar nada.

## Tecnologias

- [Vite](https://vitejs.dev/) + TypeScript (sem framework de interface; DOM puro)
- [Firebase](https://firebase.google.com/) — Authentication e Cloud Firestore
- `vite-plugin-pwa` para instalação e funcionamento offline do painel do apresentador
- `qrcode` e `jsqr` para gerar e ler QR Codes

## Como rodar localmente

**Pré-requisito:** [Node.js](https://nodejs.org/) 18 ou superior.

```bash
npm install
npm run dev
```

O servidor sobe em `http://localhost:3000`. O painel do público fica em `http://localhost:3000/attendee.html`.

Outros comandos:

| Comando           | O que faz                                              |
| ----------------- | ------------------------------------------------------ |
| `npm run build`   | Gera a versão de produção na pasta `dist/`             |
| `npm run preview` | Serve a pasta `dist/` na porta 3000 para conferência   |
| `npm run lint`    | Verifica os tipos do TypeScript (`tsc --noEmit`)       |
| `npm run test:smoke` | Roda o teste de fumaça do painel do apresentador    |

O projeto **não precisa de nenhuma chave de API do Gemini** nem de arquivo `.env` para funcionar.

## Teste de fumaça

`npm run test:smoke` compila o app e percorre o roteiro de um evento no painel do apresentador (escolher rodada, sortear, cancelar, conferir bingo, sortear brinde, intervalo, configurações, gerar cartelas, salvar e carregar backup). No fim compara o estado salvo com `tests/smoke/baseline.json`.

Se uma mudança alterar o resultado de propósito, regrave a referência com `npm run test:smoke -- --update` e revise a diferença no commit. O mesmo teste roda automaticamente em todo pull request (`.github/workflows/checks.yml`).

## Configuração do Firebase

As credenciais do Firebase ficam no arquivo [`firebase-applet-config.json`](firebase-applet-config.json), lido pelos dois painéis. O repositório já vem apontando para um projeto existente; para usar um projeto próprio:

1. Crie um projeto no [Console do Firebase](https://console.firebase.google.com/) e adicione um **app Web**.
2. Em **Firestore Database**, crie um banco de dados. Anote o ID dele: o banco padrão se chama `(default)`.
3. Em **Authentication → Método de login**, ative os provedores **Anônimo** e **Google** (e **Facebook**, se quiser oferecer esse login).
4. Em **Authentication → Configurações → Domínios autorizados**, inclua o domínio onde o app será publicado (o `localhost` já vem incluído).
5. Substitua os valores de `firebase-applet-config.json` pelos do seu app:

   ```json
   {
     "projectId": "seu-projeto",
     "appId": "1:000000000000:web:xxxxxxxxxxxx",
     "apiKey": "AIza...",
     "authDomain": "seu-projeto.firebaseapp.com",
     "firestoreDatabaseId": "(default)",
     "storageBucket": "seu-projeto.firebasestorage.app",
     "messagingSenderId": "000000000000"
   }
   ```

6. Publique as regras de segurança do Firestore a partir de [`firestore.rules`](firestore.rules) (pelo console ou com `firebase deploy --only firestore:rules`).

As regras funcionam assim:

- qualquer pessoa, mesmo sem login, pode **ler** um evento, suas rodadas e uma cartela pelo ID, que é o que o Painel do Público e a cartela digital precisam;
- só o organizador **logado com Google ou Facebook** que é dono do evento (`hostId`) pode **gravar** nele, por isso a sincronização online exige login no painel do apresentador;
- os pedidos de "BINGO!" podem ser enviados por qualquer pessoa, mas só o dono do evento consegue lê-los, porque contêm nome e CPF;
- listar coleções inteiras e qualquer outro caminho do banco ficam bloqueados.

## Publicação

Rode `npm run build` e publique a pasta `dist/` em qualquer hospedagem de sites estáticos (Firebase Hosting, Netlify, Vercel, GitHub Pages etc.). Lembre-se de autorizar o domínio da hospedagem no Firebase Authentication.

## Estrutura dos arquivos principais

| Arquivo                       | Conteúdo                                         |
| ----------------------------- | ------------------------------------------------ |
| `index.html` / `index.tsx`    | Painel do Apresentador                           |
| `attendee.html` / `attendee.tsx` | Painel do Público                             |
| `audio.ts`                    | Efeitos sonoros (sorteio, vencedor, leilão etc.) |
| `print.css`                   | Estilos de impressão do relatório do evento      |
| `firebase-applet-config.json` | Credenciais do Firebase                          |
| `firestore.rules`             | Regras de segurança do Firestore                 |
| `vite.config.ts`              | Configuração do Vite e do PWA                    |
| `tests/smoke/`                | Teste de fumaça e estado de referência           |
| `public/`                     | Ícones e imagens do PWA                          |
