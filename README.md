# Juris Notes LITE - Suite de Otimização para IA (Chat.JT)

## 📌 Pano de Fundo e Objetivo
No ambiente de análise de processos trabalhistas (TRT/TST), a utilização de Inteligência Artificial para sumarização, análise de recursos e minutas exige **engenharia de prompt** e **dados estruturados**. Modelos de linguagem (como Gemini e ChatGPT) entregam resultados superiores, mais rápidos e com menor custo de tokens quando alimentados com textos limpos, logicamente encadeados e livres da formatação pesada de PDFs nativos.

O **Juris Notes LITE** é uma suíte de ferramentas *client-side* (roda 100% no navegador do usuário, sem servidores externos, garantindo o sigilo judicial absoluto) projetada para otimizar o fluxo de trabalho de magistrados e assessores na interação com IAs generativas.

---

## 🚀 Arquitetura e Módulos do Sistema

A aplicação é dividida em um Hub Principal (`index.html`) que dá acesso a dois grandes módulos independentes:

### 1. Extrator e Curador de PDFs (Módulo de Conversão)
Ferramenta para extrair textos de petições e processos de forma cirúrgica. Ao invés de jogar um PDF de 100 páginas na IA, o usuário recorta apenas o que importa.

* **Processamento em Lote (Batch):** Permite arrastar múltiplos PDFs de uma vez.
* **Classificação Jurídica:** Identifica e taxa os documentos (Ex: *Petição Inicial - Parte Autora*, *Recurso Ordinário*, *Sentença*).
* **Workspace de Curadoria:** Visualizador de PDF integrado (`pdf.js`) lado a lado com um painel de recortes. O usuário seleciona o início e o fim de um trecho (mesmo cruzando múltiplas páginas), e o sistema extrai o texto limpo de forma invisível.
* **Exportação Otimizada:** Baixa recortes individuais em `.txt` ou compila todo o lote em um arquivo `.zip` estruturado e sanitizado, pronto para alimentar o contexto do modelo de IA.

### 2. Construtor de Minutas (Minuta Builder)
Um estúdio de arquitetura de prompts judiciais. Permite ao assessor montar a "espinha dorsal" da decisão antes de pedir para a IA redigir o texto final.

* **Estruturação Semântica:** Separação clara entre *Alegações Recursais*, *Fundamentos da Origem* e *Veredito Pretendido*.
* **Diretrizes em Blocos (Drag & Drop):** Criação de teses através de blocos arrastáveis. Cada bloco recebe uma "Intenção Jurídica" (Ex: *Premissa Lógica*, *Comando de Execução Estrita*, *Filtro Prejudicial*), que colore o bloco e injeta tags semânticas no prompt final.
* **Exportação XML:** O sistema compila o trabalho em um payload superestruturado com tags XML (ex: `<diretrizes_do_assessor>`), formato que as IAs modernas processam com altíssima precisão de obediência.
* **Prompt Lapidador (Novo):** Um gerador de prompt embutido que cruza o histórico da minuta do usuário com o rascunho gerado pela IA, criando um comando blindado para revisão técnica de estilo e coesão.

---

## ✨ Melhorias Recentes e UX (Última Atualização)

A plataforma recebeu uma refatoração focada em Usabilidade (UX), Acessibilidade (WCAG) e Previsibilidade de Sistema:

* **Feedback Visual de Salvamento Dinâmico:** Os painéis de texto agora possuem um indicador no cabeçalho. Ao digitar, o sistema exibe um status animado de `Salvando...` (Debounce de 800ms) e, ao pausar, crava `✓ Salvo`. Os dados persistem no `LocalStorage` de forma síncrona, evitando perda de trabalho.
* **Sistema de Toast Unificado:** Remoção de `alerts` bloqueantes e mensagens legadas. Implementação de um módulo Singleton de notificações flutuantes na parte inferior da tela (Mensagens de Sucesso, Erro e Alerta), com transições elásticas nativas em CSS3.
* **Acessibilidade e Legal Design:** Correção das taxas de contraste (textos escuros sobre fundos verde-limão) nas tags de Tópico, atendendo ao nível AA da WCAG 2.1. 
* **Microinterações:** Adição de foco responsivo (`focus-within`) nas áreas de texto, destacando a div pai e guiando a visão do analista em textos longos.
* **Iconografia Semântica:** Atualização de SVGs de interface (como o ícone do Robô/IA), corrigindo vetores matemáticos para melhor legibilidade da função do assistente.

---

## 🛠️ Tecnologias Utilizadas

* **HTML5 / CSS3 (Vanilla):** Layout responsivo usando CSS Grid/Flexbox e variáveis de raiz (`:root`) para consistência de paleta.
* **JavaScript (ES6+):** Lógica assíncrona, manipulação avançada de DOM e gestão de estado local.
* **Bibliotecas Externas (Importadas via CDN):**
  * `pdf.js` (Mozilla): Para renderização e leitura de coordenadas/texto de PDFs diretamente no client.
  * `jszip`: Para empacotamento das extrações em lote no Módulo PDF.

---

## 🔒 Segurança e Privacidade (Data Privacy)
Por lidar com processos judiciais, **nenhum dado trafega pela rede**. A leitura do PDF, a extração de texto e a construção do prompt XML ocorrem 100% na memória do navegador do usuário (`client-side`). O código não possui chamadas a APIs de terceiros no back-end.