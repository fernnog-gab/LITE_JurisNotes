// Catálogo Otimizado (Sem Veredito/Nota)
const INTENT_CATALOG = {
    fallback: { label: 'Fato Bruto / Padrão', color: '#4b5563', prefix: '[CONTEXTO FÁTICO COMPLEMENTAR]:', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>` },
    premissa: { label: 'Premissa Lógica', color: '#7b1fa2', prefix: '[PREMISSA LÓGICA INQUESTIONÁVEL]:', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6v-2h-6v2zm0-4h6v-2h-6v2zm3-10a5 5 0 0 0-5 5c0 2 1 3 2 4v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2c1-1 2-2 2-4a5 5 0 0 0-5-5z"></path></svg>` },
    comando: { label: 'Comando Direto', color: '#c62828', prefix: '[COMANDO DE EXECUÇÃO ESTRITA]:', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>` },
    texto: { label: 'Texto Fixo', color: '#1565c0', prefix: '[COPIAR E COLAR EXATAMENTE ESTE TEXTO]:', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>` },
    fundamentacao: { label: 'Base Legal', color: '#00695c', bubbleTag: 'base_legal_obrigatoria', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>` },
    refutacao: { label: 'Refutação de Mérito', color: '#8B4513', prefix: '[AFASTAMENTO DE TESE OBRIGATÓRIO]:', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="4" y1="4" x2="20" y2="20"></line></svg>` },
    preliminar: { label: 'Filtro Prejudicial', color: '#5d4037', bubbleTag: 'questoes_preliminares_e_prejudiciais', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>` }
};

function generateId() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36); }

let state = {
    topicName: "", alegacoes: "", fundamentos: "", veredito: "",
    diretrizes: [{ id: generateId(), content: "", intent: "fallback" }]
};

// --- NAVEGAÇÃO E PERSISTÊNCIA ---
function saveState() {
    state.topicName = document.getElementById('input-topic-name').value;
    state.alegacoes = document.getElementById('editor-alegacoes').innerHTML;
    state.fundamentos = document.getElementById('editor-fundamentos').innerHTML;
    state.veredito = document.getElementById('editor-veredito').innerHTML;
    localStorage.setItem('minuta_builder_data', JSON.stringify(state));
    document.getElementById('display-topic-name').innerText = state.topicName || "Novo Tópico Recursal";
}

function loadState() {
    const saved = localStorage.getItem('minuta_builder_data');
    if (saved) {
        state = JSON.parse(saved);
        document.getElementById('input-topic-name').value = state.topicName || "";
        document.getElementById('editor-alegacoes').innerHTML = state.alegacoes || "";
        document.getElementById('editor-fundamentos').innerHTML = state.fundamentos || "";
        document.getElementById('editor-veredito').innerHTML = state.veredito || "";
        if(!state.diretrizes) state.diretrizes = [{ id: generateId(), content: "", intent: "fallback" }];
    }
    renderList();
}

// --- NAVEGAÇÃO SEGURA ---
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // CORREÇÃO CRÍTICA: Ignora tags <a> que não gerenciam abas internas
        if (!btn.dataset.target) return; 

        document.querySelectorAll('.nav-btn, .panel').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
        
        if (btn.dataset.target === 'panel-resultado-dados') generateXMLData();
        
        // NOVO ALINHAMENTO ARQUITETURAL: Auto-preenchimento Inteligente do Prompt
        if (btn.dataset.target === 'panel-ai-prompt') {
            document.getElementById('prompt-in-topico').value = state.topicName || "Tópico não informado";
            document.getElementById('prompt-in-diretrizes').value = sanitizeToMarkdown(buildExportPayload());
        }
    });
});

// --- DELEGAÇÃO DE EVENTOS GLOBAL PARA DROPDOWNS ---
document.addEventListener('click', (e) => {
    // Fecha todos os dropdowns se o clique não foi dentro de um deles
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(dd => dd.classList.remove('open'));
    }
});

function toggleDropdown(event, id) {
    event.stopPropagation(); // Impede borbulhamento e mantém o documento sem registrar o clique "fora"
    const targetDropdown = document.querySelector(`.drag-item[data-id="${id}"] .custom-dropdown`);
    
    // Fecha outros abertos
    document.querySelectorAll('.custom-dropdown.open').forEach(dd => {
        if(dd !== targetDropdown) dd.classList.remove('open');
    });
    targetDropdown.classList.toggle('open');
}

function selectIntent(id, key) {
    state.diretrizes.find(i => i.id == id).intent = key;
    saveState(); renderList();
}

// --- LÓGICA DE DIRETRIZES (DRAG & DROP) ---
function addBloco() { state.diretrizes.push({ id: generateId(), content: "", intent: "fallback" }); renderList(); saveState(); }
function deleteBloco(id) { state.diretrizes = state.diretrizes.filter(i => i.id !== id); renderList(); saveState(); }
function updateBloco(id, content) { state.diretrizes.find(i => i.id == id).content = content; saveState(); }

function renderList() {
    const container = document.getElementById('list-diretrizes'); 
    container.innerHTML = "";

    state.diretrizes.forEach((item, index) => {
        const div = document.createElement('div'); 
        div.className = "drag-item"; div.draggable = true; div.dataset.id = item.id;
        
        const currentIntent = INTENT_CATALOG[item.intent || 'fallback'];
        
        const optionsHTML = Object.keys(INTENT_CATALOG).map(key => `
            <div class="dropdown-option" onclick="selectIntent('${item.id}', '${key}')">
                <div style="color: ${INTENT_CATALOG[key].color}">${INTENT_CATALOG[key].icon}</div>
                <span>${INTENT_CATALOG[key].label}</span>
            </div>
        `).join('');

        // ISOLAMENTO ARQUITETURAL: .drag-grip-zone isolado da .action-zone
        div.innerHTML = `
            <div class="block-badge">${index + 1}</div>
            <div class="card-header-bar" style="border-top: 4px solid ${currentIntent.color};">
                <div class="drag-grip-zone" title="Arraste para reordenar">⠿</div>
                <div class="action-zone">
                    <div class="custom-dropdown" onclick="toggleDropdown(event, '${item.id}')">
                        <div class="dropdown-selected" style="background-color: ${currentIntent.color};">
                            ${currentIntent.icon} <span>${currentIntent.label}</span> <span class="dropdown-arrow">▼</span>
                        </div>
                        <div class="dropdown-list">${optionsHTML}</div>
                    </div>
                    <button class="btn-delete-block" onclick="deleteBloco('${item.id}')">✕</button>
                </div>
            </div>
            <div class="drag-content" style="padding: 15px;">
                <div class="editor-area" contenteditable="true" oninput="updateBloco('${item.id}', this.innerHTML)">${item.content}</div>
            </div>`;
        
        div.addEventListener('dragstart', () => div.classList.add('dragging'));
        div.addEventListener('dragend', () => { div.classList.remove('dragging'); reorderList(); });
        container.appendChild(div);
    });
}

function reorderList() {
    const newOrder = []; 
    document.querySelectorAll('#list-diretrizes .drag-item').forEach(el => {
        newOrder.push(state.diretrizes.find(item => item.id == el.dataset.id));
    });
    state.diretrizes = newOrder; 
    renderList(); // Atualiza numeração visual
    saveState();
}

function getDragAfterElement(container, y) {
    const draggable = [...container.querySelectorAll('.drag-item:not(.dragging)')];
    return draggable.reduce((closest, child) => {
        const box = child.getBoundingClientRect(); const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- MOTOR DE EXPORTAÇÃO (CORRIGIDO E SEGURO) ---
function sanitizeToMarkdown(html) {
    if(!html) return "N/A";
    let text = html.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '').replace(/<br\s*[\/]?>/gi, '\n')
                   .replace(/<(b|strong)>(.*?)<\/(b|strong)>/gi, '**$2**').replace(/<(i|em)>(.*?)<\/(i|em)>/gi, '*$2*')
                   .replace(/<[^>]+>/g, ''); 
    const tmp = document.createElement("DIV"); tmp.innerHTML = text;
    return (tmp.textContent || tmp.innerText || "").trim();
}

function buildExportPayload() {
    // Reconstrução limpa do String Liteteral, sem cortes arbitrários
    let payload = `<diretrizes_do_assessor>\n`;
    payload += `  <relatorio_do_conflito>\n`;
    payload += `    <topico_recursal>${state.topicName || "Tópico não informado"}</topico_recursal>\n`;
    
    // Injeções Modulares de Texto Puro
    payload += `    <alegacoes_recursais>\n      ${sanitizeToMarkdown(state.alegacoes).replace(/\n/g, '\n      ')}\n    </alegacoes_recursais>\n`;
    payload += `    <fundamentos_da_origem>\n      ${sanitizeToMarkdown(state.fundamentos).replace(/\n/g, '\n      ')}\n    </fundamentos_da_origem>\n`;
    payload += `  </relatorio_do_conflito>\n\n`;

    const bubbleUp = (tagId) => {
        const blocos = state.diretrizes.filter(b => INTENT_CATALOG[b.intent || 'fallback'].bubbleTag === tagId);
        if (blocos.length === 0) return "";
        let res = `  <${tagId}>\n`;
        blocos.forEach(b => { res += `    - ${sanitizeToMarkdown(b.content)}\n\n`; });
        res += `  </${tagId}>\n\n`;
        return res;
    };

    payload += bubbleUp('questoes_preliminares_e_prejudiciais');
    payload += bubbleUp('base_legal_obrigatoria');

    // Injeção Direta do Veredito
    payload += `  <decisao_magistrado_pretendida>\n    ${sanitizeToMarkdown(state.veredito).replace(/\n/g, '\n    ')}\n  </decisao_magistrado_pretendida>\n\n`;

    payload += `  <analise_estruturada>\n`;
    let focusCounter = 1;
    state.diretrizes.forEach((b) => {
        const intentDef = INTENT_CATALOG[b.intent || 'fallback'];
        if (intentDef.bubbleTag) return; 
        
        const txt = sanitizeToMarkdown(b.content).replace(/\n/g, '\n      ');
        if(txt && txt !== "N/A") {
            payload += `    <diretriz_foco_${focusCounter}>\n`;
            payload += `      ${intentDef.prefix} ${txt}\n`;
            payload += `    </diretriz_foco_${focusCounter}>\n\n`;
            focusCounter++;
        }
    });
    payload += `  </analise_estruturada>\n`;
    payload += `</diretrizes_do_assessor>`;
    return payload;
}

function applyHighlight(text) {
    let escaped = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.replace(/(&lt;\/?[a-z_]+(?: id="[0-9]+")?&gt;)/g, '<span class="xml-tag">$1</span>');
}

function generateXMLData() {
    const payload = buildExportPayload();
    const outputEl = document.getElementById('output-xml');
    outputEl.innerHTML = applyHighlight(payload);
    outputEl.setAttribute('data-raw', payload);
}

function copyContent(id, btn) {
    navigator.clipboard.writeText(document.getElementById(id).getAttribute('data-raw')).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = `✓ Copiado!`;
        setTimeout(() => { btn.innerHTML = originalText; }, 2000);
    });
}

// --- MOTOR GERADOR DE PROMPT PARA IA EXTERNA ---
function gerarPromptFinal() {
    const txtMinuta = document.getElementById('prompt-in-minuta').value.trim() || "";
    const txtTopico = document.getElementById('prompt-in-topico').value.trim() || "Tópico não informado";
    const txtDiretrizes = document.getElementById('prompt-in-diretrizes').value.trim();
    const txtRascunho = document.getElementById('prompt-in-rascunho').value.trim();

    if (!txtRascunho) {
        alert("O rascunho do Chat.JT é obrigatório para realizar a lapidação.");
        return;
    }

    const promptMaster = `# PERSONA E OBJETIVO CORE
Você é o Revisor Sênior de Acórdãos e Especialista em Lógica Deôntica (TRT-23/TST). Sua função exclusiva atuar como um "Lapidador Textual", recebendo um rascunho gerado por uma IA de menor capacidade e transformando-o em uma minuta de voto escorreita, com altíssimo rigor técnico, aplicação de Legal Design e argumentação silogística perfeita.

# O FLUXO DE TRABALHO
Abaixo, fornecerei dois blocos de informação que você deve processar imediatamente:
1. [DIRETRIZES JURIS NOTES]: As regras do jogo. A estrutura esperada, a base legal, a jurisprudência aplicável e o destino final.
2. [RASCUNHO BASE]: O texto preliminar gerado.

# RESTRIÇÃO FUNDAMENTAL (NEGATIVE PROMPT)
Você ESTÁ ESTRITAMENTE PROIBIDO de alterar a verdade dos fatos, inventar novas provas processuais ou modificar a conclusão de mérito (decisão do magistrado). Seu trabalho é 100% focado na FORMA, ESTRUTURA, LÓGICA SILOGÍSTICA e ADEQUAÇÃO ÀS DIRETRIZES.

# REGRAS DE REDAÇÃO E AUDITORIA LÓGICA (ORDEM DE PRIORIDADE)
1. **Adequação e Revisão Rigorosa:** Conferência atenta com as diretrizes [DIRETRIZES JURIS NOTES] e correção gramatical.
2. **Padronização Terminológica:** Substitua "reclamante" e "reclamada" por "parte autora" e "parte ré".
3. **Conversão de Tempo de Gravação:** Converta para o formato: "(MM' SS'' a MM' SS'' da gravação da audiência)".
4. **Reordenação Estrutural:** O início da minuta deve abordar os fundamentos da origem antes das razões recursais.
5. **Síntese Argumentativa:** Proibido reiterar expressões de postulação ("requer a reforma"). Sintetize uma vez no intróito.
6. **Desfragmentação e Linearidade:** Proibido utilizar subtópicos intermediários para fatiar teses da mesma natureza.
7. **Microcoesão e Macrocoerência:** Elimine frases ilhadas e conectivos genéricos.
8. **Legal Design Tático:** Mantenha os parágrafos curtos e objetivos.

# REGRAS RÍGIDAS DE FORMATAÇÃO DE SAÍDA (SISTEMA DE TAGS)
- Toda palavra ou trecho reescrito/adicionado deve estar entre chaves e em negrito (ex: **{texto}**).
- **EXCEÇÃO:** Padronizações ("parte autora", "parte ré", tempo de audiência) NÃO recebem chaves/negrito.

# FORMATO DE SAÍDA OBRIGATÓRIO
## 1. Auditoria de Conformidade (Juris Notes)
[Análise curta sobre o rascunho base vs diretrizes]

## 2. Minuta de Voto Lapidada
[Texto final com marcação **{texto}** aplicada]

## 3. Engenharia da Refatoração
* **Pontes Lógicas Criadas:** [Explicação]
* **Fio Condutor:** [Explicação]

---
### DADOS DE ENTRADA E GATILHO DE EXECUÇÃO

📜 1. CONTEXTO: 
MINUTA REDIGIDA ATÉ O MOMENTO 
== MINUTA_ATUAL ==
>|${txtMinuta}|< 
== FIM_MINUTA ==

🎯 2. TÓPICO RECURSAL EM ANÁLISE 
<topico_atual>
>|${txtTopico}|<
</topico_atual> 

🛑 3. PROTOCOLO DE ALINHAMENTO E CONTRADIÇÕES (CIRCUIT BREAKER)
[Avalie o Pacote de Dados e as premissas. Se houver choque lógico (comandos vs provimento), NÃO REESCREVA O TEXTO. Interrompa e formule perguntas de alinhamento para o usuário.]

📎 4. ACERVO DOCUMENTAL E PROBATÓRIO (ANEXOS)
[Utilize arquivos ativamente para ancoragem fática]

📦 5. PACOTE DE DADOS ESTRUTURADO VIA JURIS NOTES
== DIRETRIZES ==
>|${txtDiretrizes}|<
== FIM_DIRETRIZES ==

**[RASCUNHO BASE]**
>|${txtRascunho}|<

**AÇÃO:** Processe os dados de entrada e gere a saída rigorosamente conforme o FORMATO DE SAÍDA OBRIGATÓRIO.`;

    const outputEl = document.getElementById('output-prompt-final');
    outputEl.textContent = promptMaster;
    outputEl.setAttribute('data-raw', promptMaster);
    document.getElementById('prompt-result-wrapper').style.display = 'block';
}

// --- INICIALIZADORES E EVENTOS GERAIS (Final do Arquivo) ---

// HOISTING DA LÓGICA DE DRAGOVER: Executa apenas 1x na vida da aplicação (Corrige Memory Leak)
const dragContainer = document.getElementById('list-diretrizes');
dragContainer.addEventListener('dragover', e => {
    e.preventDefault(); 
    const after = getDragAfterElement(dragContainer, e.clientY);
    const dragging = document.querySelector('.dragging');
    if (dragging) { 
        if (after == null) dragContainer.appendChild(dragging); 
        else dragContainer.insertBefore(dragging, after);
    }
});

document.getElementById('input-topic-name').addEventListener('input', saveState);
window.onload = loadState;