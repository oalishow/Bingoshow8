// Senha do evento na nuvem.
//
// Os dados do evento (fullStateJSON) podem ser lidos por qualquer pessoa que
// tenha o ID, porque o Painel do Público precisa deles. Por isso a senha
// nunca vai para a nuvem em texto: só vai um resumo SHA-256 dela, misturado
// com o ID do evento. Quem lê os dados não descobre a senha digitada.

export async function hashEventPassword(eventId: string, password: string): Promise<string> {
    const data = new TextEncoder().encode(`premioshow:${eventId}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Tira a senha em texto do estado que vai para a nuvem e coloca o resumo no lugar.
export async function protectPasswordForCloud(appConfig: any, eventId: string): Promise<void> {
    if (!appConfig) return;
    const password = (appConfig.eventPassword || '').trim();
    delete appConfig.eventPassword;
    delete appConfig.eventPasswordHash;
    if (password) {
        appConfig.eventPasswordHash = await hashEventPassword(eventId, password);
    }
}

// Confere a senha digitada contra o que está na nuvem.
// Aceita o formato novo (resumo) e o antigo (senha em texto, de eventos que
// ainda não sincronizaram depois desta versão).
export async function checkCloudEventPassword(cloudAppConfig: any, eventId: string, provided: string): Promise<boolean> {
    const hash = cloudAppConfig?.eventPasswordHash;
    if (hash) {
        return (await hashEventPassword(eventId, provided)) === hash;
    }
    const legacy = cloudAppConfig?.eventPassword;
    if (legacy) {
        return legacy === provided;
    }
    return true;
}
