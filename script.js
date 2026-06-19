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

document.getElementById('drop-zone').addEventListener('click', () => {
    document.getElementById('file-input').click();
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
            
            // Muda a aparência do Tooltip com base no estado
            tooltip.textContent = extractState.step === 'idle' ? '📍 Definir Início' : '🛑 Definir Fim e Extrair';
            tooltip.style.backgroundColor = extractState.step === 'idle' ? 'var(--primary-color)' : '#dc2626';

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
    markerInstruction.textContent = "🟢 Aguardando: Selecione o texto para marcar o INÍCIO.";
    btnCancelMarker.style.display = 'none';
}

// AÇÃO DO TOOLTIP: Avançar a máquina de estados
tooltip.addEventListener('click', async () => {
    tooltip.style.display = 'none';
    window.getSelection().removeAllRanges();

    if (extractState.step === 'idle') {
        // SET START MARKER
        extractState.start = { page: currentPageNum, text: pendingSelectionText };
        extractState.step = 'awaiting_end';
        markerInstruction.textContent = `🔴 Início na pág ${currentPageNum}. Navegue e selecione o FIM.`;
        btnCancelMarker.style.display = 'block';
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
// NOVAS LÓGICAS DE FLUXO (Navegação Rápida, Exportação e Extração Total)
// ============================================================================

// 1. Botão de Retorno à Primeira Página
const btnFirstPage = document.getElementById('btn-first-page');
if (btnFirstPage) {
    btnFirstPage.addEventListener('click', () => {
        if (pdfDoc && currentPageNum !== 1) renderPage(1);
    });
}

// 2. Lógica de Nomenclatura Dinâmica na Exportação de Recortes
document.getElementById('btn-export-txt').addEventListener('click', () => {
    let finalTxt = "=== ARQUIVO DE CURADORIA EM LOTE ===\n\n";
    capturedSnippets.forEach(s => { 
        finalTxt += `[TÓPICO: ${s.titulo.toUpperCase()}]\n${s.texto}\n\n`; 
    });
    
    // NOME DINÂMICO: Usa o título do primeiro recorte capturado (ou um fallback seguro)
    let fileNameBase = capturedSnippets[0]?.titulo || "Extracao_Documento";
    // Sanitiza o nome do arquivo (remove caracteres que o Windows/Mac não aceitam)
    let safeFileName = fileNameBase.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');

    const blob = new Blob([finalTxt], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${safeFileName}.txt`;
    link.click();
});

// 3. NOVO RECURSO: Extração Total do PDF
const btnExtractFull = document.getElementById('btn-extract-full');
btnExtractFull.addEventListener('click', async () => {
    if (!pdfDoc) return;

    // A janelinha que pede o nome batizará o arquivo TXT
    const topicName = prompt("Qual será o nome deste documento?", "Processo_Completo");
    if (!topicName) return; // Usuário cancelou

    const safeFileName = topicName.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');

    // UI Feedback (Trava a tela durante o processamento longo)
    const panel = document.getElementById('snippets-panel');
    const overlay = document.createElement('div');
    overlay.className = 'extracting-overlay';
    overlay.textContent = "Lendo todo o documento. Aguarde...";
    panel.appendChild(overlay);

    try {
        let fullText = `=== EXTRATO COMPLETO: ${topicName.toUpperCase()} ===\n\n`;
        
        // Loop varrendo da primeira à última página
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const tempPage = await pdfDoc.getPage(i);
            const textContent = await tempPage.getTextContent();
            
            // Junta as strings, preservando espaços básicos
            let pageText = textContent.items.map(item => item.str).join(' ');
            
            // Quebra de linha básica por página para organização
            fullText += `--- PÁGINA ${i} ---\n${pageText}\n\n`;
            
            // Pequeno respiro para o navegador não congelar a UI (Yield to Main Thread)
            if (i % 5 === 0) await new Promise(res => setTimeout(res, 10));
        }

        // Gera e dispara o Download
        const blob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${safeFileName}.txt`;
        link.click();

    } catch (err) {
        console.error("Erro na extração completa:", err);
        alert("Falha ao extrair o documento completo.");
    } finally {
        overlay.remove(); // Remove o aviso de carregamento
    }
});