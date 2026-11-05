<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/df27f58b-8b3b-470b-a175-122e0aff1556

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Teste de fumaça

`npm run test:smoke` compila o app e percorre o roteiro de um evento no painel do apresentador (escolher rodada, sortear, cancelar, conferir bingo, sortear brinde, intervalo, configurações, gerar cartelas, salvar e carregar backup). No fim compara o estado salvo com `tests/smoke/baseline.json`.

Se uma mudança alterar o resultado de propósito, regrave a referência com `npm run test:smoke -- --update` e revise a diferença no commit.
