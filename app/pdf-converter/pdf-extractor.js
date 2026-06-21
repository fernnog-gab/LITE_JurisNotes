// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// ============================================================================
// SISTEMA DE ESTADO MULTI-ARQUIVO (ARQUITETURA ROBUSTA)
// ============================================================================
let pdfFiles = []; // Estrutura: Array de { file, pdfDoc, classifications: { type, party, customName }, snippets: [] }
let activeFileIndex = -1;

let pdfDoc = null; // Aponta temporariamente para o documento ativo (compatibilidade retroativa)
let currentPageNum = 1;
let currentScale = 1.3; 
let currentRenderTask = null;
let activePageReference = null;

let pendingSelectionText = "";

// Máquina de Estados de Marcadores
let extractState = {
    step: 'idle', // 'idle' | 'awaiting_end'
    start: { page: null, text: null },
    end: { page: null, text: null }
};

// Configurações Globais de Mapeamentos
const DOC_TYPES = [
    { value: "Peticao_Inicial", label: "Petição Inicial", defaultParty: "Parte_Autora" },
    { value: "Contestacao", label: "Contestação", defaultParty: "Parte_Re" },
    { value: "Impugnacao_Contestacao", label: "Impugnação à Contestação", defaultParty: "Parte_Autora" },
    { value: "Laudo_Pericial", label: "Laudo Pericial", defaultParty: "Perito" },
    { value: "Recurso_Ordinario", label: "Recurso Ordinário", defaultParty: "Parte_Autora" },
    { value: "Contrarrazoes", label: "Contrarrazões", defaultParty: "Parte_Re" },
    { value: "Agravo_de_Peticao", label: "Agravo de Petição", defaultParty: "Parte_Autora" },
    { value: "Agravo_de_Instrumento", label: "Agravo de Instrumento", defaultParty: "Parte_Autora" },
    { value: "Embargos_de_Declaracao", label: "Embargos de Declaração", defaultParty: "" },
    { value: "Sentenca", label: "Sentença", defaultParty: "" },
    { value: "Outro", label: "Outro (Manual)", defaultParty: "" }
];

// Elementos do DOM
const pageInput = document.getElementById('page-input');
const pageTotalSpan = document.getElementById('page-total');
const tooltip = document.getElementById('selection-tooltip');
const markerInstruction = document.getElementById('marker-instruction');
const btnCancelMarker = document.getElementById('btn-cancel-marker');
const activeFileSelect = document.getElementById('active-file-select');

// ============================================================================
// TRATAMENTO E SANITIZAÇÃO DE STRINGS
// ============================================================================
function sanitizeFilename(str) {
    if (!str) return "";
    return str
        .normalize("NFD")                  // Separa acentos das letras base
        .replace(/[\u0300-\u036f]/g, "")    // Remove diacriticos (incluindo cedilha)
        .replace(/[^a-zA-Z0-9-_]/g, "_")   // Remove caracteres especiais e substitui por underline
        .replace(/_+/g, "_")                // Condensa underlines repetidos
        .replace(/^_+|_+$/g, "");           // Remove underlines nas bordas
}

// ============================================================================
// CARREGAMENTO E INICIALIZAÇÃO MULTI-PDF
// ============================================================================
document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    document.getElementById('drop-zone').classList.add('is-hidden');
    document.getElementById('top-back-container').classList.add('is-hidden');
    document.getElementById('curation-workspace').classList.remove('is-hidden');
    
    // Reseta estado anterior antes do processamento do novo lote
    await destroyCurrentPDFView();
    
    activeFileSelect.innerHTML = '';
    
    for (let i = 0; i < files.length; i++) {
        try {
            const arrayBuffer = await files[i].arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            // Predição simplificada do tipo com base no nome do arquivo original
            let autoType = "Outro";
            let nameLower = files[i].name.toLowerCase();
            
            if (nameLower.includes("inicial") || nameLower.includes("peticao_inicial")) autoType = "Peticao_Inicial";
            else if (nameLower.includes("contestacao")) autoType = "Contestacao";
            else if (nameLower.includes("impugnacao") || nameLower.includes("replica")) autoType = "Impugnacao_Contestacao";
            else if (nameLower.includes("laudo") || nameLower.includes("perito")) autoType = "Laudo_Pericial";
            else if (nameLower.includes("recurso")) autoType = "Recurso_Ordinario";
            else if (nameLower.includes("contrarraz")) autoType = "Contrarrazoes";
            else if (nameLower.includes("sentenca") || nameLower.includes("acordao")) autoType = "Sentenca";
            else if (nameLower.includes("embargos")) autoType = "Embargos_de_Declaracao";

            const matchedType = DOC_TYPES.find(d => d.value === autoType);

            pdfFiles.push({
                file: files[i],
                pdfDoc: doc,
                classifications: {
                    type: autoType,
                    party: matchedType ? matchedType.defaultParty : "",
                    customName: ""
                },
                snippets: [] // Espaço de snippets isolados por arquivo
            });

            // Adiciona opção ao seletor de arquivos ativos do workspace
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${i + 1}. ${files[i].name.substring(0, 30)}${files[i].name.length > 30 ? '...' : ''}`;
            activeFileSelect.appendChild(opt);

        } catch (err) {
            console.error("Erro ao carregar documento PDF de index " + i, err);
            alert(`Não foi possível carregar o arquivo: ${files[i].name}`);
        }
    }

    if (pdfFiles.length > 0) {
        if (pdfFiles.length > 1) {
            activeFileSelect.classList.remove('is-hidden');
        } else {
            activeFileSelect.classList.add('is-hidden');
        }
        setActivePDF(0);
    }
});

// Alterna o foco do visualizador de PDF para o documento escolhido
function setActivePDF(index) {
    if (index < 0 || index >= pdfFiles.length) return;
    
    // Salva o estado atual de renderização para troca limpa
    if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
    }
    if (activePageReference) {
        activePageReference.cleanup();
        activePageReference = null;
    }

    activeFileIndex = index;
    pdfDoc = pdfFiles[index].pdfDoc;
    currentPageNum = 1;
    pageTotalSpan.textContent = pdfDoc.numPages;
    pageInput.max = pdfDoc.numPages;
    activeFileSelect.value = index;
    
    renderPage(1);
    renderSnippetsList(); // Renderiza apenas os trechos que pertencem a este arquivo
}

// Navegação rápida da lista de arquivos
activeFileSelect.addEventListener('change', (e) => {
    setActivePDF(parseInt(e.target.value));
});

// Constantes SVG Isoladas
const ICON_PIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;

function updateMarkerStatus(icon, text, showCancel = false) {
    document.getElementById('marker-icon').innerHTML = icon;
    document.getElementById('marker-instruction').textContent = text;
    btnCancelMarker.style.display = showCancel ? 'block' : 'none';
}

function updateTooltip(icon, text, isStop = false) {
    document.getElementById('tooltip-icon').innerHTML = icon;
    document.getElementById('tooltip-text').textContent = text;
    tooltip.style.backgroundColor = isStop ? '#dc2626' : 'var(--primary-color)';
}

// Configuração Drag and Drop da Área Inicial
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', () => document.getElementById('file-input').click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        document.getElementById('file-input').files = e.dataTransfer.files;
        document.getElementById('file-input').dispatchEvent(new Event('change'));
    }
});

// ============================================================================
// ENGINE DE RENDERIZAÇÃO DE PÁGINAS
// ============================================================================
async function renderPage(num) {
    if (currentRenderTask) currentRenderTask.cancel();
    if (activePageReference) activePageReference.cleanup();

    try {
        const page = await pdfDoc.getPage(num);
        activePageReference = page;
        const viewport = page.getViewport({ scale: currentScale }); 
        
        const canvas = document.getElementById('pdf-canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const container = document.getElementById('pdf-page-container');
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        currentRenderTask = page.render({ canvasContext: ctx, viewport: viewport });
        await currentRenderTask.promise;

        const textLayerDiv = document.getElementById('text-layer');
        const textContent = await page.getTextContent();
        textLayerDiv.innerHTML = ''; 
        
        pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        currentPageNum = num;
        pageInput.value = num;
        document.getElementById('zoom-indicator').textContent = `${Math.round(currentScale * 100)}%`;

    } catch (err) {
        if (err.name !== 'RenderingCancelledException') console.error("Falha ao renderizar a página:", err);
    }
}

// Navegadores de páginas
document.getElementById('btn-prev').addEventListener('click', () => { if (currentPageNum > 1) renderPage(currentPageNum - 1); });
document.getElementById('btn-next').addEventListener('click', () => { if (currentPageNum < pdfDoc.numPages) renderPage(currentPageNum + 1); });

pageInput.addEventListener('change', (e) => {
    let target = parseInt(e.target.value);
    if (target >= 1 && target <= pdfDoc.numPages) renderPage(target);
    else e.target.value = currentPageNum;
});

// Controles de Ampliação (Zoom)
document.getElementById('btn-zoom-in').addEventListener('click', () => { currentScale += 0.2; renderPage(currentPageNum); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { if (currentScale > 0.5) { currentScale -= 0.2; renderPage(currentPageNum); }});

// ============================================================================
// MARCADORES E ANOTAÇÃO DE TRECHOS
// ============================================================================
document.getElementById('pdf-page-container').addEventListener('mouseup', () => {
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 2 && document.getElementById('text-layer').contains(selection.anchorNode)) {
            pendingSelectionText = selectedText.replace(/\n/g, ' '); 
            
            if (extractState.step === 'idle') {
                updateTooltip(ICON_PIN, " Definir Início", false);
            } else {
                updateTooltip(ICON_STOP, " Definir Fim e Extrair", true);
            }

            const rect = selection.getRangeAt(0).getBoundingClientRect();
            tooltip.style.top = `${rect.top + window.scrollY - 45}px`;
            tooltip.style.left = `${rect.left + window.scrollX + (rect.width/2) - 70}px`; 
            tooltip.style.display = 'block';
        } else {
            tooltip.style.display = 'none';
        }
    }, 0);
});

document.addEventListener('mousedown', (e) => {
    if (e.target !== tooltip && !tooltip.contains(e.target)) tooltip.style.display = 'none';
});

btnCancelMarker.addEventListener('click', () => {
    resetExtractionState();
});

function resetExtractionState() {
    extractState = { step: 'idle', start: { page: null, text: null }, end: { page: null, text: null } };
    updateMarkerStatus(ICON_CHECK, " Aguardando: Selecione o texto de Início.", false);
}

// Aciona a transição da máquina de estados do marcador ao clicar no Tooltip
tooltip.addEventListener('click', async () => {
    tooltip.style.display = 'none';
    window.getSelection().removeAllRanges();

    if (extractState.step === 'idle') {
        extractState.start = { page: currentPageNum, text: pendingSelectionText };
        extractState.step = 'awaiting_end';
        updateMarkerStatus(ICON_STOP, ` Início na pág ${currentPageNum}. Selecione o FIM.`, true);
    } 
    else if (extractState.step === 'awaiting_end') {
        if (currentPageNum < extractState.start.page) {
            alert("A página de Fim não pode preceder a página de Início.");
            return;
        }
        extractState.end = { page: currentPageNum, text: pendingSelectionText };
        
        const topicName = prompt("Trecho delimitado. Qual o nome deste Tópico?", "Novo Tópico");
        if (topicName !== null) {
            await processCrossPageExtraction(topicName);
        } else {
            resetExtractionState();
        }
    }
});

// Executa varredura profunda de páginas delimitadas nos bastidores (background)
async function processCrossPageExtraction(topicName) {
    const panel = document.getElementById('snippets-panel');
    const overlay = document.createElement('div');
    overlay.className = 'extracting-overlay';
    overlay.textContent = "Lendo páginas em background...";
    panel.appendChild(overlay);

    let fullExtractedText = "";

    try {
        for (let i = extractState.start.page; i <= extractState.end.page; i++) {
            const tempPage = await pdfDoc.getPage(i);
            const textContent = await tempPage.getTextContent();
            let pageText = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' '); 

            if (extractState.start.page === extractState.end.page) {
                const idxStart = pageText.indexOf(extractState.start.text);
                const idxEnd = pageText.indexOf(extractState.end.text) + extractState.end.text.length;
                if (idxStart !== -1 && idxEnd !== -1) fullExtractedText = pageText.substring(idxStart, idxEnd);
                else fullExtractedText = pageText; // Fallback parcial
            } 
            else if (i === extractState.start.page) {
                const idxStart = pageText.indexOf(extractState.start.text);
                fullExtractedText += idxStart !== -1 ? pageText.substring(idxStart) : pageText;
                fullExtractedText += " \n\n ";
            } 
            else if (i === extractState.end.page) {
                const idxEnd = pageText.indexOf(extractState.end.text) + extractState.end.text.length;
                fullExtractedText += idxEnd !== -1 ? pageText.substring(0, idxEnd) : pageText;
            } 
            else {
                fullExtractedText += pageText + " \n\n ";
            }
        }

        // Salva os snippets exclusivamente sob a lista de dados do arquivo ativo
        pdfFiles[activeFileIndex].snippets.push({ titulo: topicName, texto: fullExtractedText });
        renderSnippetsList();

    } catch (err) {
        console.error("Erro na extração em background:", err);
        alert("Falha na extração entre páginas.");
    } finally {
        overlay.remove();
        resetExtractionState();
    }
}

// Renderiza os recortes pertencentes exclusivamente ao documento ativo no workspace
function renderSnippetsList() {
    const list = document.getElementById('snippets-list');
    const emptyState = document.getElementById('empty-state');
    
    // Remove os nós de cards de trechos anteriores mantendo apenas o estado vazio padrão
    Array.from(list.children).forEach(c => { if(c.id !== 'empty-state') c.remove(); });
    
    const activeSnippets = pdfFiles[activeFileIndex] ? pdfFiles[activeFileIndex].snippets : [];
    
    if (activeSnippets.length === 0) {
        emptyState.style.display = 'block';
        document.getElementById('btn-export-txt').disabled = true;
        return;
    }
    
    emptyState.style.display = 'none';
    document.getElementById('btn-export-txt').disabled = false;

    activeSnippets.forEach((snippet, idx) => {
        const card = document.createElement('div');
        card.className = 'snippet-card';
        
        const title = document.createElement('input');
        title.className = 'snippet-input-title';
        title.value = snippet.titulo;
        title.addEventListener('input', e => {
            activeSnippets[idx].titulo = e.target.value;
        });
        
        const text = document.createElement('div');
        text.className = 'snippet-text-content';
        text.textContent = snippet.texto;
        
        const btn = document.createElement('button');
        btn.className = 'btn-remove-snippet';
        btn.textContent = 'Excluir';
        btn.onclick = () => { 
            activeSnippets.splice(idx, 1); 
            renderSnippetsList(); 
        };

        card.append(title, text, btn);
        list.appendChild(card);
    });
}

// ============================================================================
// CONTROLE DO BOTÃO HOME E DESALOCAÇÃO DE MEMÓRIA
// ============================================================================
async function destroyCurrentPDFView() {
    if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
    }
    if (activePageReference) {
        activePageReference.cleanup();
        activePageReference = null;
    }
    
    // Libera ponteiros da API do PDF.js para evitar vazamentos na pilha do Garbage Collector
    for (const item of pdfFiles) {
        if (item.pdfDoc) {
            try {
                await item.pdfDoc.destroy();
            } catch (e) {
                console.warn("Falha ao desalocar recursos do PDF:", e);
            }
        }
    }
    
    pdfFiles = [];
    activeFileIndex = -1;
    pdfDoc = null;
    
    const canvas = document.getElementById('pdf-canvas');
    if (canvas) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
    document.getElementById('text-layer').innerHTML = '';
}

document.getElementById('btn-home').addEventListener('click', async () => {
    if(confirm("Deseja voltar à tela inicial? Todo o progresso de recortes não salvos será perdido.")) {
        await destroyCurrentPDFView();
        
        document.getElementById('curation-workspace').classList.add('is-hidden');
        document.getElementById('drop-zone').classList.remove('is-hidden');
        document.getElementById('top-back-container').classList.remove('is-hidden');
        
        document.getElementById('file-input').value = ""; 
        renderSnippetsList();
        resetExtractionState();
    }
});
// ============================================================================
// DIÁLOGO DE CLASSIFICAÇÃO (MODAL DINÂMICO MULTI-MODO)
// ============================================================================
function openNamingModal(mode = 'batch') {
    return new Promise((resolve) => {
        const modal = document.getElementById('naming-modal');
        const container = document.getElementById('modal-files-container');
        const btnCancel = document.getElementById('btn-cancel-modal');
        const btnConfirm = document.getElementById('btn-confirm-modal');

        container.innerHTML = '';

        // Filtra os arquivos a serem editados de acordo com o modo chamado
        const targetFiles = (mode === 'single') 
            ? [pdfFiles[activeFileIndex]] 
            : pdfFiles;

        targetFiles.forEach((pdfObj, idx) => {
            const row = document.createElement('div');
            row.className = 'modal-file-row';

            // Nome original
            const label = document.createElement('span');
            label.className = 'modal-file-label';
            label.textContent = pdfObj.file.name;
            label.title = pdfObj.file.name;

            // Seletor de Tipo
            const typeSelect = document.createElement('select');
            typeSelect.className = 'custom-select';
            typeSelect.style.padding = '6px';
            typeSelect.style.fontSize = '12px';
            DOC_TYPES.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.value;
                opt.textContent = t.label;
                if (t.value === pdfObj.classifications.type) opt.selected = true;
                typeSelect.appendChild(opt);
            });

            // Seletor de Parte Relacionada
            const partySelect = document.createElement('select');
            partySelect.className = 'custom-select';
            partySelect.style.padding = '6px';
            partySelect.style.fontSize = '12px';
            const parties = [
                { value: "Parte_Autora", label: "Parte Autora" },
                { value: "Parte_Re", label: "Parte Ré" },
                { value: "Perito", label: "Perito" },
                { value: "", label: "Não se aplica" }
            ];
            parties.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.value;
                opt.textContent = p.label;
                if (p.value === pdfObj.classifications.party) opt.selected = true;
                partySelect.appendChild(opt);
            });

            // Campo de Input de Nome Livre (Usado quando tipo === 'Outro')
            const customInput = document.createElement('input');
            customInput.type = 'text';
            customInput.className = 'custom-input';
            customInput.placeholder = 'Nome manual obrigatório';
            customInput.style.padding = '6px';
            customInput.style.fontSize = '12px';
            customInput.value = pdfObj.classifications.customName || '';

            // Lógica de sincronização e exibição visual inicial para evitar incoerências
            function syncInputs(selectedType) {
                if (selectedType === 'Outro') {
                    partySelect.style.display = 'none';
                    customInput.style.display = 'block';
                } else if (selectedType === 'Sentenca') {
                    partySelect.style.display = 'none';
                    customInput.style.display = 'none';
                } else {
                    partySelect.style.display = 'block';
                    customInput.style.display = 'none';
                }
            }

            syncInputs(pdfObj.classifications.type);

            typeSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                const matched = DOC_TYPES.find(d => d.value === val);
                if (matched) {
                    partySelect.value = matched.defaultParty;
                }
                syncInputs(val);
            });

            const actionWrapper = document.createElement('div');
            actionWrapper.style.display = 'flex';
            actionWrapper.style.gap = '6px';
            actionWrapper.appendChild(partySelect);
            actionWrapper.appendChild(customInput);

            row.appendChild(label);
            row.appendChild(typeSelect);
            row.appendChild(actionWrapper);
            container.appendChild(row);
        });

        modal.style.display = 'flex';

        const closeModal = () => {
            modal.style.display = 'none';
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
        };

        btnConfirm.onclick = () => {
            let pass = true;
            const rows = container.getElementsByClassName('modal-file-row');

            targetFiles.forEach((pdfObj, idx) => {
                const row = rows[idx];
                const typeVal = row.getElementsByTagName('select')[0].value;
                const partyVal = row.getElementsByTagName('select')[1].value;
                const customVal = row.getElementsByTagName('input')[0].value.trim();

                if (typeVal === 'Outro' && !customVal) {
                    alert(`O documento "${pdfObj.file.name}" necessita de uma nomeação manual para prosseguir.`);
                    pass = false;
                }

                pdfObj.classifications.type = typeVal;
                pdfObj.classifications.party = partyVal;
                pdfObj.classifications.customName = customVal;
            });

            if (!pass) return;

            closeModal();
            resolve(true);
        };

        btnCancel.onclick = () => {
            closeModal();
            resolve(false);
        };
    });
}

// ============================================================================
// GERAÇÃO DE SAÍDAS E ARQUIVOS EXPORTADOS
// ============================================================================
function formatOutputFilename(pdfObj, isSnippet = false) {
    let name = "";
    const cls = pdfObj.classifications;
    
    if (cls.type === "Outro") {
        name = cls.customName;
    } else {
        name = cls.type;
        if (cls.party) {
            name += `_${cls.party}`;
        }
    }

    name = sanitizeFilename(name);

    if (isSnippet) {
        return `trecho_${name}`;
    }
    
    // Sem extensão "_completo" desnecessária na exportação completa do arquivo
    return name;
}

// Exportar Recortes Individuais
document.getElementById('btn-export-txt').addEventListener('click', async () => {
    const activeFile = pdfFiles[activeFileIndex];
    if (!activeFile || activeFile.snippets.length === 0) return;

    // Classifica apenas o arquivo ativo na exportação individual
    const confirmed = await openNamingModal('single');
    if (!confirmed) return;

    const documentName = formatOutputFilename(activeFile, true); 
    let textResult = `=== ARQUIVO DE CURADORIA DE TRECHOS ===\nDOCUMENTO DE ORIGEM: ${formatOutputFilename(activeFile, false)}\n\n`;

    activeFile.snippets.forEach(s => {
        textResult += `[TÓPICO: ${s.titulo.toUpperCase()}]\n${s.texto}\n\n`;
    });

    const blob = new Blob([textResult], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${documentName}.txt`;
    link.click();
});

// Extração de todos os textos carregados em Lote consolidado em um pacote .ZIP
document.getElementById('btn-extract-full').addEventListener('click', async () => {
    if (pdfFiles.length === 0) return;

    const confirmed = await openNamingModal('batch');
    if (!confirmed) return;

    const panel = document.getElementById('snippets-panel');
    const overlay = document.createElement('div');
    overlay.className = 'extracting-overlay';
    overlay.textContent = "Processando arquivos do Lote...";
    panel.appendChild(overlay);

    try {
        const zip = new JSZip();

        for (let idx = 0; idx < pdfFiles.length; idx++) {
            const pdfObj = pdfFiles[idx];
            let documentContent = "";

            for (let pageNum = 1; pageNum <= pdfObj.pdfDoc.numPages; pageNum++) {
                const pageInstance = await pdfObj.pdfDoc.getPage(pageNum);
                const textNode = await pageInstance.getTextContent();
                const pageText = textNode.items.map(item => item.str).join(' ');
                
                documentContent += `--- PÁGINA ${pageNum} ---\n${pageText}\n\n`;
                
                // Cede o processamento da thread principal (yield) a cada 4 páginas para manter responsividade do DOM
                if (pageNum % 4 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            const cleanFileName = formatOutputFilename(pdfObj, false);
            zip.file(`${cleanFileName}.txt`, documentContent);
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(zipBlob);
        link.download = "Extracao_Processo_Lote.zip"; // String ASCII livre de diacríticos para evitar erros em download OS
        link.click();

    } catch (err) {
        console.error("Falha ao processar a extração em lote:", err);
        alert("Ocorreu um erro no processamento das páginas em lote.");
    } finally {
        overlay.remove();
    }
});