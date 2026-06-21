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
    processNumber: "", topicName: "", alegacoes: "", fundamentos: "", veredito: "",
    faseProcessual: "Conhecimento", tipoRecurso: "Recurso Ordinário (RO)",
    diretrizes: [{ id: generateId(), content: "", intent: "fallback" }]
};

let saveFeedbackTimeout = null;
let toastTimeout = null;

function showToast(message, type = 'success') {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        document.body.appendChild(toast);
    }
    
    clearTimeout(toastTimeout);
    toast.className = `toast-message ${type}`;
    
    const icon = type === 'success' 
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

    toast.innerHTML = `${icon} <span>${message}</span>`;
    
    void toast.offsetWidth; 
    toast.classList.add('show');

    toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}

// --- MÁSCARA E PERSISTÊNCIA ---
function aplicarMascaraCNJ(input) {
    let v = input.value.replace(/\D/g, "");
    if (v.length > 20) v = v.substring(0, 20);
    if (v.length > 7) v = v.replace(/^(\d{7})(\d)/, "$1-$2");
    if (v.length > 10) v = v.replace(/^(\d{7})\-(\d{2})(\d)/, "$1-$2.$3");
    if (v.length > 14) v = v.replace(/^(\d{7})\-(\d{2})\.(\d{4})(\d)/, "$1-$2.$3.$4");
    if (v.length > 15) v = v.replace(/^(\d{7})\-(\d{2})\.(\d{4})\.(\d{1})(\d)/, "$1-$2.$3.$4.$5");
    if (v.length > 17) v = v.replace(/^(\d{7})\-(\d{2})\.(\d{4})\.(\d{1})\.(\d{2})(\d)/, "$1-$2.$3.$4.$5.$6");
    input.value = v;
}

let saveStateDebounceTimer;

function saveState() {
    // FASE 1: Síncrona (Atualização Imediata da Interface)
    const currentTopic = document.getElementById('input-topic-name').value;
    const currentProcess = document.getElementById('input-process-number').value;
    
    document.getElementById('display-topic-name').innerText = currentTopic || "Novo Tópico Recursal";
    document.getElementById('display-process-number').innerText = currentProcess || "Sem Processo";
    
    triggerSaveFeedback();

    // FASE 2: Assíncrona (Debounce para I/O no disco)
    clearTimeout(saveStateDebounceTimer);
    saveStateDebounceTimer = setTimeout(() => {
        state.processNumber = currentProcess;
        state.topicName = currentTopic;
        state.faseProcessual = document.getElementById('select-fase').value;
        state.tipoRecurso = document.getElementById('select-recurso').value;
        state.alegacoes = document.getElementById('editor-alegacoes').innerHTML;
        state.fundamentos = document.getElementById('editor-fundamentos').innerHTML;
        state.veredito = document.getElementById('editor-veredito').innerHTML;
        
        localStorage.setItem('minuta_builder_data', JSON.stringify(state));
    }, 600);
}

function triggerSaveFeedback() {
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel) return;
    const statusEl = activePanel.querySelector('.local-save-status');
    if (!statusEl) return;

    statusEl.innerHTML = '<span class="saving-dot"></span> Salvando...';
    statusEl.classList.add('saving');
    clearTimeout(saveFeedbackTimeout);
    saveFeedbackTimeout = setTimeout(() => {
        statusEl.innerHTML = '✓ Salvo';
        statusEl.classList.remove('saving');
    }, 800);
}

function loadState() {
    const saved = localStorage.getItem('minuta_builder_data');
    if (saved) {
        state = JSON.parse(saved);
        if(!state.processNumber) state.processNumber = ""; 
        document.getElementById('input-process-number').value = state.processNumber;
        document.getElementById('input-topic-name').value = state.topicName || "";
        document.getElementById('editor-alegacoes').innerHTML = state.alegacoes || "";
        document.getElementById('editor-fundamentos').innerHTML = state.fundamentos || "";
        document.getElementById('editor-veredito').innerHTML = state.veredito || "";
        if(!state.diretrizes) state.diretrizes = [{ id: generateId(), content: "", intent: "fallback" }];
        
        document.getElementById('select-fase').value = state.faseProcessual || "Conhecimento";
        document.getElementById('select-recurso').value = state.tipoRecurso || "Recurso Ordinário (RO)";

        document.getElementById('display-topic-name').innerText = state.topicName || "Novo Tópico Recursal";
        document.getElementById('display-process-number').innerText = state.processNumber || "Sem Processo";
    }
    renderList();
    if (typeof renderizarHistoricoDB === "function") renderizarHistoricoDB(); // Gatilho do novo DB
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
function deleteBloco(id) { 
    state.diretrizes = state.diretrizes.filter(i => i.id !== id); 
    renderList(); 
    saveState(); 
    showToast('Bloco de diretriz removido.', 'danger'); 
}
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
    let payload = `<diretrizes_do_assessor>\n`;
    
    // Tag exigida pelo Prompt para calibragem de rigor da IA (Dinâmica)
    const fase = state.faseProcessual || "Conhecimento";
    const recurso = state.tipoRecurso || "Recurso Ordinário (RO)";
    payload += `  <diretriz_cognitiva_ia>Fase de ${fase} / ${recurso}</diretriz_cognitiva_ia>\n\n`;

    payload += `  <relatorio_do_conflito>\n`;
    payload += `    <numero_processo>${state.processNumber || "NAO_INFORMADO"}</numero_processo>\n`;
    payload += `    <topico_recursal>${state.topicName || "Tópico não informado"}</topico_recursal>\n`;
    payload += `    <alegacoes_recursais>\n      ${sanitizeToMarkdown(state.alegacoes).replace(/\n/g, '\n      ')}\n    </alegacoes_recursais>\n`;
    payload += `    <fundamentos_da_origem>\n      ${sanitizeToMarkdown(state.fundamentos).replace(/\n/g, '\n      ')}\n    </fundamentos_da_origem>\n`;
    payload += `  </relatorio_do_conflito>\n\n`;

    const bubbleUp = (tagId) => {
        const blocos = state.diretrizes.filter(b => INTENT_CATALOG[b.intent || 'fallback'].bubbleTag === tagId);
        if (blocos.length === 0) return "";
        let res = `  <${tagId}>\n`;
        blocos.forEach(b => { res += `    - ${sanitizeToMarkdown(b.content)}\n`; });
        res += `  </${tagId}>\n\n`;
        return res;
    };

    payload += bubbleUp('questoes_preliminares_e_prejudiciais');
    payload += bubbleUp('base_legal_obrigatoria');

    // NOVA ESTRUTURA: Matriz Dialética Mapeada (Substitui a antiga <analise_estruturada>)
    payload += `  <analise_da_prova>\n`;
    
    // Filtra apenas fatos crus (fallback ou texto) para a tag de Inconteste
    const fatosBrutos = state.diretrizes.filter(b => !INTENT_CATALOG[b.intent || 'fallback'].bubbleTag && ['fallback', 'texto'].includes(b.intent || 'fallback'));
    if (fatosBrutos.length > 0) {
        payload += `    <fato_bruto_inconteste>\n`;
        fatosBrutos.forEach((b) => {
            const txt = sanitizeToMarkdown(b.content).replace(/\n/g, '\n      ');
            if(txt && txt !== "N/A") payload += `      - ${txt}\n`;
        });
        payload += `    </fato_bruto_inconteste>\n\n`;
    }

    // Filtra comandos cognitivos (premissa, comando, refutacao) para a tag Vinculante
    const diretrizesVinculantes = state.diretrizes.filter(b => !INTENT_CATALOG[b.intent || 'fallback'].bubbleTag && !['fallback', 'texto'].includes(b.intent || 'fallback'));
    if (diretrizesVinculantes.length > 0) {
        payload += `    <diretrizes_vinculantes_do_assessor>\n`;
        diretrizesVinculantes.forEach((b) => {
            const intentDef = INTENT_CATALOG[b.intent || 'fallback'];
            const txt = sanitizeToMarkdown(b.content).replace(/\n/g, '\n      ');
            if(txt && txt !== "N/A") payload += `      - ${intentDef.prefix} ${txt}\n`;
        });
        payload += `    </diretrizes_vinculantes_do_assessor>\n`;
    }
    
    payload += `  </analise_da_prova>\n\n`;

    payload += `  <decisao_magistrado_pretendida>\n    ${sanitizeToMarkdown(state.veredito).replace(/\n/g, '\n    ')}\n  </decisao_magistrado_pretendida>\n`;
    
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
    const content = document.getElementById(id).getAttribute('data-raw');
    navigator.clipboard.writeText(content).then(() => {
        showToast('Conteúdo copiado com sucesso!', 'success');
    }).catch(err => {
        showToast('Falha ao copiar texto.', 'danger');
        console.error(err);
    });
}

// --- MOTOR GERADOR DE PROMPT PARA IA EXTERNA ---
function gerarPromptFinal() {
    const txtMinuta = document.getElementById('prompt-in-minuta').value.trim() || "";
    const txtTopico = document.getElementById('prompt-in-topico').value.trim() || "Tópico não informado";
    const txtDiretrizes = document.getElementById('prompt-in-diretrizes').value.trim();
    const txtRascunho = document.getElementById('prompt-in-rascunho').value.trim();

    if (!txtRascunho) {
        showToast("O rascunho da IA é obrigatório para realizar a lapidação.", "danger");
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

🎯 2. METADADOS E TÓPICO RECURSAL EM ANÁLISE 
<identificacao>
    <numero_processo>>|${state.processNumber || "NAO_INFORMADO"}|<</numero_processo>
    <topico_atual>>|${txtTopico}|<</topico_atual> 
</identificacao> 

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

/* === NOVO MOTOR DE HISTÓRICO ASSÍNCRONO (INDEXED DB) E MODAL === */
const DB_NAME = "JurisNotesDB";
const STORE_NAME = "historyStore";

function initDB(callback) {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
        let db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = (e) => callback(e.target.result);
    request.onerror = (e) => console.error("Erro IndexedDB", e);
}

function salvarNoHistoricoDB() {
    if (!state.processNumber && !state.topicName) return; 
    initDB((db) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const registro = {
            id: new Date().getTime(),
            processo: state.processNumber || "Sem Processo",
            topico: state.topicName || "Sem Tópico",
            data: new Date().toLocaleString('pt-BR'),
            estado_salvo: JSON.parse(JSON.stringify(state))
        };
        store.put(registro);
        const reqCursor = store.openCursor(null, "prev");
        let count = 0;
        reqCursor.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                count++;
                if (count > 10) store.delete(cursor.primaryKey);
                cursor.continue();
            } else { renderizarHistoricoDB(); }
        };
    });
}

function renderizarHistoricoDB() {
    initDB((db) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const container = document.getElementById('lista-historico');
            if(!container) return;
            let historico = request.result.sort((a,b) => b.id - a.id);
            if (historico.length === 0) {
                container.innerHTML = `<div style="text-align:center; padding:30px; color:#94a3b8;">Nenhum trabalho salvo no banco de dados local.</div>`;
                return;
            }
            container.innerHTML = historico.map(item => `
                <div class="history-item" onclick="carregarDoHistoricoDB(${item.id})">
                    <div class="history-info">
                        <strong>${item.processo}</strong>
                        <span>${item.topico} • ${item.data}</span>
                    </div>
                    <button class="btn-load-history">Restaurar</button>
                </div>
            `).join('');
        };
    });
}

function carregarDoHistoricoDB(id) {
    initDB((db) => {
        const transaction = db.transaction([STORE_NAME], "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            if (request.result) {
                salvarNoHistoricoDB(); // Salva estado atual antes de sobrepor
                localStorage.setItem('minuta_builder_data', JSON.stringify(request.result.estado_salvo));
                loadState();
                showToast(`Trabalho recuperado!`, "success");
            }
        };
    });
}

function abrirModalNovoTopico() { document.getElementById('modal-confirmacao').classList.add('active'); }
function fecharModal() { document.getElementById('modal-confirmacao').classList.remove('active'); }
function confirmarNovoTopico() {
    salvarNoHistoricoDB();
    
    // Purifica o estado global na memória
    state = {
        processNumber: "", topicName: "", alegacoes: "", fundamentos: "", veredito: "",
        faseProcessual: "Conhecimento", tipoRecurso: "Recurso Ordinário (RO)",
        diretrizes: [{ id: generateId(), content: "", intent: "fallback" }]
    };
    
    // Purifica o DOM visual
    document.getElementById('input-process-number').value = "";
    document.getElementById('input-topic-name').value = "";
    document.getElementById('select-fase').value = "Conhecimento";
    document.getElementById('select-recurso').value = "Recurso Ordinário (RO)";
    document.getElementById('editor-alegacoes').innerHTML = "";
    document.getElementById('editor-fundamentos').innerHTML = "";
    document.getElementById('editor-veredito').innerHTML = "";
    
    saveState(); 
    renderList(); 
    fecharModal();
    
    document.querySelector('[data-target="panel-processo"]').click();
    setTimeout(() => document.getElementById('input-process-number').focus(), 100);
    showToast("Área limpa e pronta para novo processo.", "success");
}

function exportarBackup() {
    saveState(); salvarNoHistoricoDB();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const numProc = state.processNumber ? state.processNumber.replace(/[^a-zA-Z0-9]/g, "") : "sem_processo";
    const nomeTop = state.topicName ? state.topicName.replace(/\s+/g, "_").toLowerCase() : "sem_topico";
    const a = document.createElement("a"); a.href = url; a.download = `${numProc}_${nomeTop}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast("Backup exportado!", "success");
}

function importarBackup(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState && Array.isArray(importedState.diretrizes)) {
                salvarNoHistoricoDB();
                localStorage.setItem('minuta_builder_data', JSON.stringify(importedState));
                loadState(); showToast("Backup importado com sucesso!", "success");
            } else { showToast("Arquivo inválido.", "danger"); }
        } catch (error) { showToast("Erro ao ler arquivo.", "danger"); }
        event.target.value = "";
    };
    reader.readAsText(file);
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

// --- DELEGAÇÃO DE EVENTOS DE LIMPEZA E INPUTS ---
document.getElementById('input-process-number').addEventListener('input', saveState);
document.getElementById('select-fase').addEventListener('change', saveState);
document.getElementById('select-recurso').addEventListener('change', saveState);

document.addEventListener('click', function(e) {
    if (e.target.closest('.btn-clear-input')) {
        const targetId = e.target.closest('.btn-clear-input').dataset.target;
        const el = document.getElementById(targetId);
        if (el) { el.value = ''; el.focus(); saveState(); }
    }
    
    if (e.target.closest('.btn-clear-panel')) {
        const targetId = e.target.closest('.btn-clear-panel').dataset.target;
        const el = document.getElementById(targetId);
        if (el) { el.innerHTML = ''; el.focus(); saveState(); }
    }
});

// --- INTERCEPTOR DE PASTE (RANGE API) ---
document.addEventListener('paste', function(e) {
    const editableTarget = e.target.closest('[contenteditable="true"]');
    if (!editableTarget) return;

    e.preventDefault();
    const plainText = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!plainText) return;

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const fragment = document.createDocumentFragment();
    const lines = plainText.split(/\r?\n/);
    
    lines.forEach((line, index) => {
        if (index > 0) fragment.appendChild(document.createElement('br'));
        if (line.length > 0) fragment.appendChild(document.createTextNode(line));
    });

    range.insertNode(fragment);
    editableTarget.normalize(); 

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    
    saveState();
});