// Constantes do painel do apresentador.
export const currentVersion = "8.0";
export const buildInfo = "Build: 20/08/2026 - 10:00"; // Data e hora em formato DD/MM/AAAA 
export const DYNAMIC_LETTERS = ['B', 'I', 'N', 'G', 'O'];
export const DYNAMIC_LETTERS_AJUDE = ['A', 'J', 'U', 'D', 'E'];
export const BINGO_CONFIG: { [key: string]: { min: number; max: number } } = { B: { min: 1, max: 15 }, I: { min: 16, max: 30 }, N: { min: 31, max: 45 }, G: { min: 46, max: 60 }, O: { min: 61, max: 75 },
                       A: { min: 1, max: 15 }, J: { min: 16, max: 30 }, U: { min: 31, max: 45 }, D: { min: 46, max: 60 }, E: { min: 61, max: 75 } };
export const roundColors = ['#16a34a', '#ca8a04', '#c2410c', '#0e7490', '#be185d', '#6d28d9', '#059669', '#b45309'];
export const predefinedPrizes = [ { prize1: 'R$ 100,00', prize2: '', prize3: '' }, { prize1: 'R$ 100,00', prize2: 'R$ 200,00', prize3: '' }, { prize1: 'R$ 200,00', prize2: '', prize3: '' }, { prize1: 'R$ 100,00', prize2: 'R$ 300,00', prize3: '' }, { prize1: 'R$ 300,00', prize2: '', prize3: 'R$ 300,00' }, { prize1: 'R$ 200,00', prize2: 'R$ 2.000,00', prize3: '' } ];
export const winnerDisplayDuration = 5000;
