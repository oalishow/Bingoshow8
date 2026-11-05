// Logo padrão do PrêmioShow (bilhete premiado) e migração do logo antigo do Bingo Show.
import iconSvg from '../../public/icon.svg?raw';

export const DEFAULT_LOGO = 'data:image/svg+xml;base64,' + btoa(iconSvg);

// O logo padrão antigo era um SVG com os textos "BINGO" e "SHOW".
// Quem nunca trocou o logo tem essa cópia salva; ela é trocada pelo logo novo.
// Logos enviados pelo usuário (PNG, JPG ou outro SVG) não são tocados.
export function isLegacyDefaultLogo(logo: unknown): boolean {
    if (typeof logo !== 'string' || !logo.startsWith('data:image/svg+xml;base64,')) return false;
    try {
        const svg = atob(logo.slice('data:image/svg+xml;base64,'.length));
        return svg.includes('>BINGO</text>') && svg.includes('>SHOW</text>');
    } catch {
        return false;
    }
}

export function migrateLogo(logo: string): string {
    return isLegacyDefaultLogo(logo) ? DEFAULT_LOGO : logo;
}
