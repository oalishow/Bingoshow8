// Histórico de versões do app (valor inicial de appStore.state.versionHistory).
export const versionHistory = `**v8.0 (Atual)**
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
- **CONTROLE DE MODAIS:** Adicionada uma nova seção nas configurações para desativar o fechamento automático dos modais de sorteio ou ajustar seu tempo de exibição (de 3 a 15 segundos).`;
