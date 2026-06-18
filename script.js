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

// ============================================================================
// Eventos de Drag & Drop e Clique (Atualizado para múltiplos arquivos)
// ============================================================================
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(e.target.files);
});

// ============================================================================
// Helpers & Logging
// ============================================================================
const debugConsole = document.getElementById('debug-console');
const debugLogsWrapper = document.getElementById('debug-logs-wrapper');

function logDebug(msg, isError = false) {
    if (!debugConsole || !debugLogsWrapper) return;
    debugConsole.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    
    // Performance: O(1) DOM Insertion para evitar Reflow Thrashing
    const logNode = document.createElement('p');
    logNode.textContent = `[${time}] ${msg}`;
    if (isError) logNode.style.color = '#EF4444'; // Vermelho em erros
    
    debugLogsWrapper.appendChild(logNode);
    debugConsole.scrollTop = debugConsole.scrollHeight; // Auto-scroll
}

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
// State Machine (Atualizada para Lote de Arquivos)
// ============================================================================
let AppState = {
    files: [],           // Fila de arquivos para processamento
    processedFiles: [],  // Lista de arquivos processados com metadados para as imagens { baseFileName, fullText, imageQueue, arrayBuffer }
    isFastMode: true
};

function resetState() {
    AppState = { 
        files: [], 
        processedFiles: [], 
        isFastMode: fastModeCheckbox.checked 
    };
    
    downloadActionArea.style.display = 'none';
    btnProcessImagesLater.style.display = 'none';
    btnDownloadZip.style.display = 'none';
    btnDownloadTxtAgain.style.display = 'none';
    actionFeedbackMsg.textContent = '';
}

// Helper para acionar download individual de arquivo de texto
function triggerIndividualTxtDownload(fileName, textContent) {
    const txtBlob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const txtLink = document.createElement("a");
    txtLink.href = URL.createObjectURL(txtBlob);
    txtLink.download = `${fileName}_transcrito.txt`;
    txtLink.click();
}

// ============================================================================
// Core Logic: Entrada de Múltiplos Arquivos
// ============================================================================
async function handleFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type === "application/pdf");
    if (files.length === 0) { 
        updateStatus("Por favor, envie arquivos PDF válidos.", true); 
        return; 
    }
    
    resetState();
    AppState.files = files;
    AppState.isFastMode = fastModeCheckbox.checked;
    
    updateStatus(`Iniciando lote de ${files.length} arquivo(s)...`, false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '2%';

    try {
        await processBatchPhaseOne();
    } catch (error) {
        console.error("Erro fatal no lote:", error);
        updateStatus("Erro crítico na leitura dos arquivos em lote.", true);
    }
}

// ============================================================================
// FASE 1: Extração de Texto Individual por Arquivo (Sequencial para Performance)
// ============================================================================
async function processBatchPhaseOne() {
    const sanitizationRules = buildSanitizationRules();

    for (let i = 0; i < AppState.files.length; i++) {
        const file = AppState.files[i];
        const baseFileName = file.name.replace(/\.[^/.]+$/, "");
        
        updateStatus(`[${i + 1}/${AppState.files.length}] Lendo: ${file.name}...`, false);
        await yieldToMain();

        let pdfDoc = null;
        let textResult = "";
        const imageQueue = [];

        try {
            const arrayBuffer = await file.arrayBuffer();
            pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdfDoc.numPages;

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                // Cálculo de progresso proporcional ao lote e às páginas do arquivo atual
                const fileProgress = (pageNum / numPages);
                const totalProgress = ((i + fileProgress) / AppState.files.length) * 50;
                progressBar.style.width = `${totalProgress}%`;
                updateStatus(`[${i + 1}/${AppState.files.length}] ${baseFileName} - Pág ${pageNum}/${numPages}`, false);
                await yieldToMain();

                let pageText = "";
                try {
                    const page = await pdfDoc.getPage(pageNum);
                    
                    // 1. Extração de Texto
                    const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout texto");
                    pageText = textContent.items.map(item => item.str).join(' ');
                    pageText = sanitizePageText(pageText, sanitizationRules);

                    // 2. Mapeamento de Imagens
                    const operatorList = await withTimeout(page.getOperatorList(), 5000, "Timeout operadores");
                    const OPS = pdfjsLib.OPS;
                    let imageCounterPage = 1;

                    for (let j = 0; j < operatorList.fnArray.length; j++) {
                        const fn = operatorList.fnArray[j];
                        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                            const imgId = operatorList.argsArray[j][0];
                            const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                            
                            pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;
                            imageQueue.push({ pageNum, imgId, imageName });
                            imageCounterPage++;
                        }
                    }
                    page.cleanup(); 
                } catch (err) {
                    console.warn(`Erro na Pág ${pageNum} do arquivo ${file.name}.`, err);
                }
                textResult += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
            }

            // Armazena no estado do lote para a posterior etapa visual
            AppState.processedFiles.push({
                baseFileName,
                fullText: textResult,
                imageQueue,
                arrayBuffer
            });

            // Dispara imediatamente o download do TXT específico deste arquivo
            triggerIndividualTxtDownload(baseFileName, textResult);

        } catch (err) {
            console.error(`Erro ao carregar o arquivo ${file.name}:`, err);
        } finally {
            if (pdfDoc) {
                await pdfDoc.destroy(); // Garante liberação imediata de memória
            }
        }
    }

    const totalImagesMapped = AppState.processedFiles.reduce((sum, f) => sum + f.imageQueue.length, 0);

    // Verificação de fluxo
    if (textOnlyToggle.checked) {
        progressBar.style.width = '100%';
        progressContainer.style.display = 'none';
        
        btnDownloadTxtAgain.style.display = 'inline-block';
        btnDownloadTxtAgain.onclick = () => {
            AppState.processedFiles.forEach(f => triggerIndividualTxtDownload(f.baseFileName, f.fullText));
        };

        if (totalImagesMapped > 0) {
            updateStatus(`Extração de texto concluída para todos os ${AppState.files.length} arquivos!`, false);
            actionFeedbackMsg.textContent = `${totalImagesMapped} imagens mapeadas no total. Deseja processá-las agora?`;
            btnProcessImagesLater.style.display = 'inline-block';
            downloadActionArea.style.display = 'block';
            
            btnProcessImagesLater.onclick = async () => {
                btnProcessImagesLater.style.display = 'none';
                btnDownloadTxtAgain.style.display = 'none';
                actionFeedbackMsg.textContent = '';
                await processBatchPhaseTwo();
            };
        } else {
            updateStatus("Processo finalizado. Nenhuma imagem encontrada nos arquivos do lote.", false);
            downloadActionArea.style.display = 'block';
        }
    } else {
        await processBatchPhaseTwo();
    }
}

// ============================================================================
// FASE 2: Processamento das Imagens do Lote (Compilação em ZIP único)
// ============================================================================
async function processBatchPhaseTwo() {
    const totalImages = AppState.processedFiles.reduce((sum, f) => sum + f.imageQueue.length, 0);
    
    if (totalImages === 0) {
        updateStatus(`Pronto! Processo finalizado (sem imagens detectadas nos arquivos).`, false);
        progressBar.style.width = '100%';
        setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
        return;
    }

    updateStatus(`Iniciando processamento gráfico de ${totalImages} imagens no lote...`, false);
    progressContainer.style.display = 'block';
    downloadActionArea.style.display = 'none'; 
    
    const zip = new JSZip();
    
    AppState.processedFiles.forEach(f => {
        zip.file(`${f.baseFileName}_transcrito.txt`, f.fullText);
    });
    
    // Configurações focadas em IA e Memória
    const imageQuality = AppState.isFastMode ? 0.60 : 0.85;
    const MAX_SAFE_PIXELS = 25000000; // Circuit Breaker: Max 25 Megapixels (evita OOM)
    const MAX_SIZE = 800; // Tamanho ideal para modelos LLM
    
    const renderCanvas = document.createElement('canvas');
    const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
    const extractCanvas = document.createElement('canvas');
    const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

    let processedCount = 0;

    for (const fileEntry of AppState.processedFiles) {
        if (fileEntry.imageQueue.length === 0) continue;

        let pdfDoc = null;
        try {
            pdfDoc = await pdfjsLib.getDocument({ data: fileEntry.arrayBuffer }).promise;
            
            const queueByPage = fileEntry.imageQueue.reduce((acc, item) => {
                if (!acc[item.pageNum]) acc[item.pageNum] = [];
                acc[item.pageNum].push(item);
                return acc;
            }, {});

            // Criamos uma tela invisível apenas para "enganar" o PDF.js
            const fakePageCanvas = document.createElement('canvas');
            const fakePageCtx = fakePageCanvas.getContext('2d');

            for (const [pageNumStr, imagesArr] of Object.entries(queueByPage)) {
                const pageNum = parseInt(pageNumStr);
                const page = await pdfDoc.getPage(pageNum);
                
                logDebug(`Desbloqueando recursos da página ${pageNum}...`);
                await yieldToMain();

                // TRUQUE MÁGICO: Mandamos ele renderizar a página numa escala pequena.
                // Isso OBRIGA o motor interno do PDF a decodificar 100% das imagens da página na memória.
                const viewport = page.getViewport({ scale: 0.8 });
                fakePageCanvas.width = viewport.width;
                fakePageCanvas.height = viewport.height;
                
                try {
                    await page.render({ canvasContext: fakePageCtx, viewport }).promise;
                } catch (renderErr) {
                    logDebug(`Aviso pág ${pageNum}: ${renderErr.message} (Tentando extrair mesmo assim)`, true);
                }

                // Agora as imagens estão frescas e 100% decodificadas!
                const operatorList = await page.getOperatorList(); 
                const OPS = pdfjsLib.OPS;
                let currentIndex = 0;

                for (let j = 0; j < operatorList.fnArray.length; j++) {
                    const fn = operatorList.fnArray[j];
                    
                    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                        const freshImgId = operatorList.argsArray[j][0];
                        const item = imagesArr[currentIndex];

                        if (item) {
                            updateStatus(`Extraindo imagem ${processedCount + 1} de ${totalImages}...`, false);
                            progressBar.style.width = `${50 + (processedCount / totalImages) * 35}%`;
                            
                            logDebug(`Salvando: ${item.imageName}`);
                            await yieldToMain();

                            try {
                                // Pega a imagem instantaneamente do cache destravado
                                const img = await withTimeout(
                                    new Promise((resolve) => page.objs.get(freshImgId, resolve)), 
                                    3000, 
                                    "A imagem não foi carregada para a memória."
                                );
                                
                                if (img) {
                                    let drawWidth = img.width || 800;
                                    let drawHeight = img.height || 800;
                                    
                                    if ((drawWidth * drawHeight) > MAX_SAFE_PIXELS) {
                                        throw new Error("Imagem gigante ignorada por segurança de RAM.");
                                    }

                                    if (drawWidth > MAX_SIZE || drawHeight > MAX_SIZE) {
                                        const ratio = Math.min(MAX_SIZE / drawWidth, MAX_SIZE / drawHeight);
                                        drawWidth = Math.round(drawWidth * ratio);
                                        drawHeight = Math.round(drawHeight * ratio);
                                    }

                                    renderCanvas.width = drawWidth; 
                                    renderCanvas.height = drawHeight;
                                    
                                    // ADAPTADOR UNIVERSAL: Aceita qualquer loucura de formato do PDF.js
                                    let imageToDraw = null;
                                    if (img instanceof HTMLElement || img instanceof ImageBitmap) {
                                        imageToDraw = img; // Formato Web Nativo
                                    } else if (img.bitmap) {
                                        imageToDraw = img.bitmap; // Formato Interno 1
                                    } else if (img.data) {
                                        // Formato Interno 2 (Matriz de Pixels Brutos)
                                        extractCanvas.width = img.width; 
                                        extractCanvas.height = img.height;
                                        const safePixels = normalizeImageData(img.data, img.width, img.height);
                                        extractCtx.putImageData(new ImageData(safePixels, img.width, img.height), 0, 0);
                                        imageToDraw = extractCanvas;
                                    } else if (img.canvas) {
                                        imageToDraw = img.canvas; // Formato Interno 3 (Pré-desenhado)
                                    }

                                    if (!imageToDraw) throw new Error("O PDF gerou um formato de imagem alienígena.");

                                    // Pinta, converte para JPG leve e coloca no ZIP
                                    renderCtx.drawImage(imageToDraw, 0, 0, drawWidth, drawHeight);
                                    const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', imageQuality));
                                    zip.file(item.imageName, blob);
                                    
                                    // Reciclagem de memória
                                    renderCanvas.width = 0; renderCanvas.height = 0;
                                    extractCanvas.width = 0; extractCanvas.height = 0;
                                }
                            } catch (imgErr) {
                                logDebug(`Erro na ${item.imageName}: ${imgErr.message}`, true);
                                zip.file(`${item.imageName}_FALHA.txt`, `Erro ao processar: ${imgErr.message}`);
                            }
                            processedCount++;
                            currentIndex++;
                        }
                    }
                }
                // Limpa o truque da página falsa
                fakePageCanvas.width = 0;
                fakePageCanvas.height = 0;
                page.cleanup();
            }
        } catch (err) {
            logDebug(`Erro fatal no PDF ${fileEntry.baseFileName}`, true);
        } finally {
            if (pdfDoc) await pdfDoc.destroy();
        }
    }

    logDebug("Iniciando empacotamento ZIP (Compressão STORE para máxima performance)...");
    
    // Mudança Crítica: Compressão STORE impede gargalo de CPU em JPEGs
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (meta) => {
        if (meta.percent > 0) {
            progressBar.style.width = `${85 + (meta.percent / 100) * 15}%`;
            updateStatus(`Criando ZIP: ${Math.round(meta.percent)}%`, false);
        }
    });
    
    progressBar.style.width = '100%';
    setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
    
    actionFeedbackMsg.textContent = "Processamento concluído com sucesso!";
    btnDownloadZip.style.display = 'inline-block';
    btnDownloadTxtAgain.style.display = 'inline-block';
    downloadActionArea.style.display = 'block';

    btnDownloadZip.onclick = () => {
        const zipLink = document.createElement("a");
        zipLink.href = URL.createObjectURL(zipBlob);
        zipLink.download = `Lote_Processado_${AppState.files.length}_PDFs.zip`;
        zipLink.click();
    };
}