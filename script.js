// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// ============================================================================
// STATE & CONFIG (Máquina de Estados de Marcadores)
// ============================================================================
let pdfDoc = null;
let currentPageNum = 1;
let currentScale = 1.3; // Zoom Padrão
let currentRenderTask = null;
let activePageReference = null;

let capturedSnippets = [];
let pendingSelectionText = "";

// Estado da Extração
let extractState = {
    step: 'idle', // 'idle' (esperando inicio) | 'awaiting_end' (esperando fim)
    start: { page: null, text: null },
    end: { page: null, text: null }
};

// Elementos DOM
const pageInput = document.getElementById('page-input');
const pageTotalSpan = document.getElementById('page-total');
const tooltip = document.getElementById('selection-tooltip');
const markerInstruction = document.getElementById('marker-instruction');
const btnCancelMarker = document.getElementById('btn-cancel-marker');

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================
document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return alert("Por favor, selecione um arquivo PDF.");
    
    document.getElementById('drop-zone').style.display = 'none';
    document.getElementById('curation-workspace').style.display = 'block';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pageTotalSpan.textContent = pdfDoc.numPages;
        pageInput.max = pdfDoc.numPages;
        renderPage(1);
    } catch (err) {
        console.error("Erro ao ler PDF:", err);
    }
});

// Constantes SVG Isoladas
const ICON_PIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const ICON_STOP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;

function updateMarkerStatus(icon, text, showCancel = false) {
    document.getElementById('marker-icon').innerHTML = icon;
    document.getElementById('marker-instruction').textContent = text;
    document.getElementById('btn-cancel-marker').style.display = showCancel ? 'block' : 'none';
}

function updateTooltip(icon, text, isStop = false) {
    document.getElementById('tooltip-icon').innerHTML = icon;
    document.getElementById('tooltip-text').textContent = text;
    tooltip.style.backgroundColor = isStop ? '#dc2626' : 'var(--primary-color)';
}

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
// ZOOM E RENDERIZAÇÃO
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
        if (err.name !== 'RenderingCancelledException') console.error("Erro:", err);
    }
}

// Controles Navegação Direta e Botões
document.getElementById('btn-prev').addEventListener('click', () => { if (currentPageNum > 1) renderPage(currentPageNum - 1); });
document.getElementById('btn-next').addEventListener('click', () => { if (currentPageNum < pdfDoc.numPages) renderPage(currentPageNum + 1); });

pageInput.addEventListener('change', (e) => {
    let target = parseInt(e.target.value);
    if (target >= 1 && target <= pdfDoc.numPages) renderPage(target);
    else e.target.value = currentPageNum; // Reverte se inválido
});

// Controles Zoom
document.getElementById('btn-zoom-in').addEventListener('click', () => { currentScale += 0.2; renderPage(currentPageNum); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { if (currentScale > 0.5) { currentScale -= 0.2; renderPage(currentPageNum); }});

// ============================================================================
// MÁQUINA DE ESTADO DOS MARCADORES E TOOLTIP
// ============================================================================
document.getElementById('pdf-page-container').addEventListener('mouseup', () => {
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 2 && document.getElementById('text-layer').contains(selection.anchorNode)) {
            pendingSelectionText = selectedText.replace(/\n/g, ' '); // Guarda texto limpo
            
            // Muda a aparência do Tooltip com base no estado e via Slots Seguros
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

// AÇÃO DO TOOLTIP: Avançar a máquina de estados
tooltip.addEventListener('click', async () => {
    tooltip.style.display = 'none';
    window.getSelection().removeAllRanges();

    if (extractState.step === 'idle') {
        // SET START MARKER
        extractState.start = { page: currentPageNum, text: pendingSelectionText };
        extractState.step = 'awaiting_end';
        updateMarkerStatus(ICON_STOP, ` Início na pág ${currentPageNum}. Navegue e selecione o FIM.`, true);
    } 
    else if (extractState.step === 'awaiting_end') {
        // SET END MARKER
        if (currentPageNum < extractState.start.page) {
            alert("A página de Fim não pode ser menor que a página de Início.");
            return;
        }
        extractState.end = { page: currentPageNum, text: pendingSelectionText };
        
        // Pede o Tópico e Roda a Extração Profunda
        const topicName = prompt("Trecho delimitado. Qual o nome deste Tópico?", "Novo Tópico");
        if (topicName !== null) {
            await processCrossPageExtraction(topicName);
        } else {
            resetExtractionState(); // Cancela se o usuário der esc no prompt
        }
    }
});

// ============================================================================
// ALGORITMO CORE: CROSS-PAGE EXTRACTION NO BACKGROUND
// ============================================================================
async function processCrossPageExtraction(topicName) {
    // UI Feedback
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
            // Junta as strings da página
            let pageText = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' '); 

            if (extractState.start.page === extractState.end.page) {
                // Mesmo Início e Fim na mesma página
                const idxStart = pageText.indexOf(extractState.start.text);
                const idxEnd = pageText.indexOf(extractState.end.text) + extractState.end.text.length;
                if (idxStart !== -1 && idxEnd !== -1) fullExtractedText = pageText.substring(idxStart, idxEnd);
                else fullExtractedText = "Aviso: Não foi possível obter correspondência exata. Texto corrompido no PDF.";
            } 
            else if (i === extractState.start.page) {
                // Primeira Página: Do marcador pro final
                const idxStart = pageText.indexOf(extractState.start.text);
                fullExtractedText += idxStart !== -1 ? pageText.substring(idxStart) : pageText;
                fullExtractedText += " \n\n ";
            } 
            else if (i === extractState.end.page) {
                // Última Página: Do início até o marcador
                const idxEnd = pageText.indexOf(extractState.end.text) + extractState.end.text.length;
                fullExtractedText += idxEnd !== -1 ? pageText.substring(0, idxEnd) : pageText;
            } 
            else {
                // Páginas do Meio (Pega tudo)
                fullExtractedText += pageText + " \n\n ";
            }
        }

        // Salva e Renderiza
        capturedSnippets.push({ titulo: topicName, texto: fullExtractedText });
        renderSnippetsList();

    } catch (err) {
        console.error("Erro na extração em background:", err);
        alert("Falha na extração múltipla.");
    } finally {
        overlay.remove();
        resetExtractionState();
    }
}

// Renderização dos Snippets (Mantida segura contra XSS)
function renderSnippetsList() {
    const list = document.getElementById('snippets-list');
    document.getElementById('empty-state').style.display = capturedSnippets.length > 0 ? 'none' : 'block';
    document.getElementById('btn-export-txt').disabled = capturedSnippets.length === 0;
    
    Array.from(list.children).forEach(c => { if(c.id !== 'empty-state') c.remove(); });

    capturedSnippets.forEach((snippet, idx) => {
        const card = document.createElement('div');
        card.className = 'snippet-card';
        
        const title = document.createElement('input');
        title.className = 'snippet-input-title';
        title.value = snippet.titulo;
        title.addEventListener('input', e => capturedSnippets[idx].titulo = e.target.value);
        
        const text = document.createElement('div');
        text.className = 'snippet-text-content';
        text.textContent = snippet.texto; // Proteção XSS garantida
        
        const btn = document.createElement('button');
        btn.className = 'btn-remove-snippet';
        btn.textContent = 'Excluir';
        btn.onclick = () => { capturedSnippets.splice(idx, 1); renderSnippetsList(); };

        card.append(title, text, btn);
        list.appendChild(card);
    });
}

// ============================================================================
// NOVAS LÓGICAS DE FLUXO (Memory Clean, Modal de Nomenclatura e Extração Total)
// ============================================================================

// 1. Memory Cleanup (Prevenção de Vazamento no Botão Home)
function destroyCurrentPDFView() {
    if (currentRenderTask) {
        currentRenderTask.cancel();
        currentRenderTask = null;
    }
    if (activePageReference) {
        activePageReference.cleanup(); // Libera renderização da GPU
        activePageReference = null;
    }
    const canvas = document.getElementById('pdf-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); // Zera o Bitmap
    document.getElementById('text-layer').innerHTML = ''; // Zera o DOM
    pdfDoc = null; // Remove referência root
}

const btnHome = document.getElementById('btn-home');
if (btnHome) {
    btnHome.addEventListener('click', () => {
        if(confirm("Voltar à tela inicial? Todo progresso de recortes não exportados será perdido.")) {
            destroyCurrentPDFView();
            document.getElementById('curation-workspace').style.display = 'none';
            document.getElementById('drop-zone').style.display = 'flex';
            document.getElementById('file-input').value = ""; 
            capturedSnippets = [];
            renderSnippetsList();
            resetExtractionState();
        }
    });
}

// 2. Modal Promisified (Interceptador de Nomenclatura Seguro)
function openNamingModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('naming-modal');
        const typeSelect = document.getElementById('doc-type-select');
        const partyGroup = document.getElementById('party-selection-group');
        const partySelect = document.getElementById('doc-party-select');
        const customGroup = document.getElementById('custom-name-group');
        const customInput = document.getElementById('doc-custom-input');
        const customError = document.getElementById('custom-error');
        const btnCancel = document.getElementById('btn-cancel-modal');
        const btnConfirm = document.getElementById('btn-confirm-modal');

        // Setup Inicial
        typeSelect.value = "Recurso_Ordinario";
        partySelect.value = "Parte_Autora";
        customInput.value = "";
        customError.style.display = "none";
        partyGroup.style.display = 'block';
        customGroup.style.display = 'none';
        modal.style.display = 'flex';

        typeSelect.onchange = (e) => {
            const val = e.target.value;
            partyGroup.style.display = (val === 'Sentenca' || val === 'Outro') ? 'none' : 'block';
            customGroup.style.display = (val === 'Outro') ? 'block' : 'none';
        };

        const cleanup = () => {
            modal.style.display = 'none';
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
        };

        btnConfirm.onclick = () => {
            let finalName = "";
            if (typeSelect.value === 'Outro') {
                if (!customInput.value.trim()) {
                    customError.style.display = "block";
                    return; // Early return: impede a resolução se vazio
                }
                finalName = customInput.value.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
            } else {
                finalName = typeSelect.value;
                if (partyGroup.style.display !== 'none' && partySelect.value) {
                    finalName += `_${partySelect.value}`;
                }
            }
            cleanup();
            resolve(finalName);
        };

        btnCancel.onclick = () => {
            cleanup();
            resolve(null);
        };
    });
}

// 3. Exportação de Recortes (Com Modal)
document.getElementById('btn-export-txt').addEventListener('click', async () => {
    const documentName = await openNamingModal();
    if (!documentName) return; // Usuário cancelou

    let finalTxt = `=== ARQUIVO DE CURADORIA EM LOTE ===\nDOCUMENTO: ${documentName}\n\n`;
    capturedSnippets.forEach(s => { 
        finalTxt += `[TÓPICO: ${s.titulo.toUpperCase()}]\n${s.texto}\n\n`; 
    });
    
    const blob = new Blob([finalTxt], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${documentName}.txt`;
    link.click();
});

// 4. Extração Total (Com Modal)
const btnExtractFull = document.getElementById('btn-extract-full');
btnExtractFull.addEventListener('click', async () => {
    if (!pdfDoc) return;

    const documentName = await openNamingModal();
    if (!documentName) return;

    const panel = document.getElementById('snippets-panel');
    const overlay = document.createElement('div');
    overlay.className = 'extracting-overlay';
    overlay.textContent = "Lendo todo o documento. Aguarde...";
    panel.appendChild(overlay);

    try {
        let fullText = `=== EXTRATO COMPLETO: ${documentName.toUpperCase()} ===\n\n`;
        
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const tempPage = await pdfDoc.getPage(i);
            const textContent = await tempPage.getTextContent();
            let pageText = textContent.items.map(item => item.str).join(' ');
            
            fullText += `--- PÁGINA ${i} ---\n${pageText}\n\n`;
            if (i % 5 === 0) await new Promise(res => setTimeout(res, 10)); // Respiro UI
        }

        const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${documentName}_COMPLETO.txt`;
        link.click();

    } catch (err) {
        console.error("Erro na extração completa:", err);
        alert("Falha ao extrair o documento completo.");
    } finally {
        overlay.remove();
    }
});