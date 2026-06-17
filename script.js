// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// DOM Elements: Básicos
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusArea = document.getElementById('status-area');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// DOM Elements: Configuração
const fastModeCheckbox = document.getElementById('fast-mode');
const removeSignaturesCheckbox = document.getElementById('remove-signatures');
const customFootersTextarea = document.getElementById('custom-footers');
const textOnlyToggle = document.getElementById('text-only-toggle');

// DOM Elements: Ações / UI
const downloadActionArea = document.getElementById('download-action-area');
const actionFeedbackMsg = document.getElementById('action-feedback-msg');
const btnProcessImagesLater = document.getElementById('btn-process-images-later');
const btnDownloadZip = document.getElementById('btn-download-zip');
const btnDownloadTxtAgain = document.getElementById('btn-download-txt-again');

// Eventos de Drag & Drop e Clique
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

// ============================================================================
// Helpers
// ============================================================================
const withTimeout = (promise, ms, errorMsg) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

async function yieldToMain() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSanitizationRules() {
    const rules = [];
    if (removeSignaturesCheckbox.checked) {
        rules.push(/\s*Documento assinado eletronicamente por [^,\n]+, em \d{2}\/\d{2}\/\d{4}, às \d{2}:\d{2}:\d{2}(?:\s*-\s*[a-f0-9]+)?\s*/gi);
    }
    const customBlocks = customFootersTextarea.value;
    if (customBlocks && customBlocks.trim() !== "") {
        const blocks = customBlocks.split('---').map(b => b.trim()).filter(b => b.length > 0);
        for (const block of blocks) {
            rules.push(new RegExp(`\\s*${escapeRegExp(block)}\\s*`, 'gi'));
        }
    }
    return rules;
}

function sanitizePageText(text, compiledRules) {
    let cleaned = text;
    for (const regex of compiledRules) {
        cleaned = cleaned.replace(regex, '\n\n');
    }
    return cleaned;
}

function normalizeImageData(rawData, width, height) {
    const expectedLength = width * height * 4;
    if (rawData.length === expectedLength) return new Uint8ClampedArray(rawData);

    const normalized = new Uint8ClampedArray(expectedLength);
    let j = 0;
    if (rawData.length === width * height * 3) {
        for (let i = 0; i < rawData.length; i += 3) {
            normalized[j++] = rawData[i]; normalized[j++] = rawData[i + 1];
            normalized[j++] = rawData[i + 2]; normalized[j++] = 255;
        }
    } else if (rawData.length === width * height) {
        for (let i = 0; i < rawData.length; i++) {
            normalized[j++] = rawData[i]; normalized[j++] = rawData[i];
            normalized[j++] = rawData[i]; normalized[j++] = 255;
        }
    } else {
        throw new Error(`Matriz inválida`);
    }
    return normalized;
}

function updateStatus(message, isError) {
    statusArea.textContent = message;
    statusArea.style.color = isError ? "#dc2626" : "var(--text-muted)";
}

// ============================================================================
// State Machine (Máquina de Estados)
// ============================================================================
let AppState = {
    pdfDoc: null,
    baseFileName: '',
    fullText: '',
    imageQueue: [], // Mapa do tesouro: { pageNum, imgId, imageName }
    isFastMode: true
};

function resetState() {
    if (AppState.pdfDoc) {
        AppState.pdfDoc.destroy(); // Libera Worker e Previne Memory Leak
    }
    AppState = { 
        pdfDoc: null, 
        baseFileName: '', 
        fullText: '', 
        imageQueue: [], 
        isFastMode: fastModeCheckbox.checked 
    };
    
    downloadActionArea.style.display = 'none';
    btnProcessImagesLater.style.display = 'none';
    btnDownloadZip.style.display = 'none';
    btnDownloadTxtAgain.style.display = 'none';
    actionFeedbackMsg.textContent = '';
}

// ============================================================================
// Core Logic: Entry Point
// ============================================================================
async function handleFile(file) {
    if (file.type !== "application/pdf") { 
        updateStatus("Por favor, envie um arquivo PDF válido.", true); 
        return; 
    }
    
    resetState();
    AppState.baseFileName = file.name.replace(/\.[^/.]+$/, "");
    AppState.isFastMode = fastModeCheckbox.checked;
    
    updateStatus("Lendo estrutura do processo...", false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '5%';

    try {
        const arrayBuffer = await file.arrayBuffer();
        AppState.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        await phaseOneTextExtraction();

    } catch (error) {
        console.error("Erro fatal:", error);
        updateStatus("Erro crítico na leitura do arquivo.", true);
    }
}

// ============================================================================
// FASE 1: Apenas texto e mapeamento de imagens (Ultra Rápido)
// ============================================================================
async function phaseOneTextExtraction() {
    const sanitizationRules = buildSanitizationRules();
    let textResult = "";

    for (let pageNum = 1; pageNum <= AppState.pdfDoc.numPages; pageNum++) {
        updateStatus(`Lendo Texto e Mapeando Imagens: Pág ${pageNum} de ${AppState.pdfDoc.numPages}...`, false);
        progressBar.style.width = `${5 + (pageNum / AppState.pdfDoc.numPages) * 45}%`;
        await yieldToMain();

        let pageText = "";
        try {
            const page = await AppState.pdfDoc.getPage(pageNum);
            
            // 1. Extração de Texto
            const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout texto");
            pageText = textContent.items.map(item => item.str).join(' ');
            pageText = sanitizePageText(pageText, sanitizationRules);

            // 2. Mapeamento de Imagens
            const operatorList = await withTimeout(page.getOperatorList(), 5000, "Timeout operadores");
            const OPS = pdfjsLib.OPS;
            let imageCounterPage = 1;

            for (let i = 0; i < operatorList.fnArray.length; i++) {
                const fn = operatorList.fnArray[i];
                if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                    const imgId = operatorList.argsArray[i][0];
                    const imageName = `${AppState.baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                    
                    pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;
                    
                    // Alimenta o Mapa do Tesouro (NÃO renderiza agora)
                    AppState.imageQueue.push({ pageNum, imgId, imageName });
                    imageCounterPage++;
                }
            }
            // Garante o destrancamento da memória da página no Loop
            page.cleanup(); 
        } catch (err) {
            console.warn(`Erro na Pág ${pageNum}.`, err);
        }
        textResult += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
    }

    AppState.fullText = textResult;
    triggerTxtDownload();

    // ==========================================
    // Roteamento baseado no Toggle
    // ==========================================
    if (textOnlyToggle.checked) {
        // Pausa de fluxo. UX: Pergunta se quer as imagens depois.
        progressBar.style.width = '100%';
        progressContainer.style.display = 'none';
        
        btnDownloadTxtAgain.style.display = 'inline-block';
        btnDownloadTxtAgain.onclick = triggerTxtDownload;

        if (AppState.imageQueue.length > 0) {
            updateStatus("Extração de texto concluída instantaneamente!", false);
            actionFeedbackMsg.textContent = `${AppState.imageQueue.length} imagens mapeadas. Deseja processá-las agora?`;
            btnProcessImagesLater.style.display = 'inline-block';
            downloadActionArea.style.display = 'block';
            
            // Atrela a Etapa 2 ao botão de continuação
            btnProcessImagesLater.onclick = async () => {
                btnProcessImagesLater.style.display = 'none';
                btnDownloadTxtAgain.style.display = 'none';
                actionFeedbackMsg.textContent = '';
                await phaseTwoImageExtraction();
            };
        } else {
            updateStatus("Processo finalizado. Nenhuma imagem encontrada no PDF.", false);
            downloadActionArea.style.display = 'block';
        }
    } else {
        // Fluxo contínuo (Modo Rápido Desligado)
        await phaseTwoImageExtraction();
    }
}

function triggerTxtDownload() {
    const txtBlob = new Blob([AppState.fullText], { type: "text/plain;charset=utf-8" });
    const txtLink = document.createElement("a");
    txtLink.href = URL.createObjectURL(txtBlob);
    txtLink.download = `${AppState.baseFileName}_transcrito.txt`;
    txtLink.click();
}

// ============================================================================
// FASE 2: Processamento exclusivo das imagens mapeadas usando cache
// ============================================================================
async function phaseTwoImageExtraction() {
    // Fail-safe caso passe direto pelo toggle e não haja imagens
    if (AppState.imageQueue.length === 0) {
        updateStatus(`Pronto! Processo finalizado (sem imagens detectadas).`, false);
        progressBar.style.width = '100%';
        setTimeout(() => { progressContainer.style.display = 'none'; progressBar.style.width = '0%'; }, 3000);
        return;
    }

    updateStatus(`Iniciando processamento gráfico de ${AppState.imageQueue.length} imagem(ns)...`, false);
    progressContainer.style.display = 'block';
    downloadActionArea.style.display = 'none'; 
    
    const zip = new JSZip();
    zip.file(`${AppState.baseFileName}_transcrito.txt`, AppState.fullText);
    
    const imageQuality = AppState.isFastMode ? 0.60 : 0.85;
    const renderCanvas = document.createElement('canvas');
    const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
    const extractCanvas = document.createElement('canvas');
    const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

    // Agrupa as coordenadas por página para não recarregar a mesma página no cache
    const queueByPage = AppState.imageQueue.reduce((acc, item) => {
        if (!acc[item.pageNum]) acc[item.pageNum] = [];
        acc[item.pageNum].push(item);
        return acc;
    }, {});

    let processedCount = 0;
    const totalImages = AppState.imageQueue.length;

    for (const [pageNumStr, imagesArr] of Object.entries(queueByPage)) {
        const pageNum = parseInt(pageNumStr);
        try {
            const page = await AppState.pdfDoc.getPage(pageNum);
            // Reconstrução rápida do cache de XObjects via operatorList nativo
            await page.getOperatorList(); 

            for (const item of imagesArr) {
                updateStatus(`Extraindo imagem ${processedCount + 1} de ${totalImages}...`, false);
                progressBar.style.width = `${50 + (processedCount / totalImages) * 35}%`;
                await yieldToMain();

                try {
                    const img = await new Promise((resolve) => page.objs.get(item.imgId, resolve));
                    if (img) {
                        let drawWidth = img.width || 800;
                        let drawHeight = img.height || 800;
                        const MAX_SIZE = AppState.isFastMode ? 1000 : 1600;

                        if (drawWidth > MAX_SIZE || drawHeight > MAX_SIZE) {
                            const ratio = Math.min(MAX_SIZE / drawWidth, MAX_SIZE / drawHeight);
                            drawWidth = Math.round(drawWidth * ratio);
                            drawHeight = Math.round(drawHeight * ratio);
                        }

                        renderCanvas.width = drawWidth; 
                        renderCanvas.height = drawHeight;
                        
                        if (img.bitmap) {
                            renderCtx.drawImage(img.bitmap, 0, 0, drawWidth, drawHeight);
                        } else if (img.data) {
                            extractCanvas.width = img.width; 
                            extractCanvas.height = img.height;
                            const safePixels = normalizeImageData(img.data, img.width, img.height);
                            extractCtx.putImageData(new ImageData(safePixels, img.width, img.height), 0, 0);
                            renderCtx.drawImage(extractCanvas, 0, 0, drawWidth, drawHeight);
                        }

                        const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', imageQuality));
                        zip.file(item.imageName, blob);
                    }
                } catch (imgErr) {
                    console.warn(`Erro isolado na imagem ${item.imageName}`, imgErr);
                }
                processedCount++;
            }
            page.cleanup();
        } catch (pageErr) {
            console.error(`Erro ao carregar página ${pageNum} na Etapa 2`, pageErr);
        }
    }

    updateStatus("Gerando arquivo ZIP final...", false);
    const zipBlob = await zip.generateAsync({ type: "blob", compression: AppState.isFastMode ? "STORE" : "DEFLATE" }, (meta) => {
        if (meta.percent > 0) {
            progressBar.style.width = `${85 + (meta.percent / 100) * 15}%`;
            updateStatus(`Criando ZIP: ${Math.round(meta.percent)}%`, false);
        }
    });
    
    // UI Final
    progressBar.style.width = '100%';
    setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
    
    actionFeedbackMsg.textContent = "Processamento finalizado com sucesso!";
    btnDownloadZip.style.display = 'inline-block';
    btnDownloadTxtAgain.style.display = 'inline-block';
    downloadActionArea.style.display = 'block';

    btnDownloadZip.onclick = () => {
        const zipLink = document.createElement("a");
        zipLink.href = URL.createObjectURL(zipBlob);
        zipLink.download = `${AppState.baseFileName}_Extraido.zip`;
        zipLink.click();
    };
}