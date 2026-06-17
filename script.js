// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusArea = document.getElementById('status-area');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// Novas configurações
const fastModeCheckbox = document.getElementById('fast-mode');
const removeSignaturesCheckbox = document.getElementById('remove-signatures');
const customFootersTextarea = document.getElementById('custom-footers');

// Novos elementos do DOM
const splitDownloadCheckbox = document.getElementById('split-download');
const downloadActionArea = document.getElementById('download-action-area');
const btnDownloadZip = document.getElementById('btn-download-zip');

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

async function handleFile(file) {
    if (file.type !== "application/pdf") {
        updateStatus("Por favor, envie um arquivo PDF válido.", true);
        return;
    }

    const baseFileName = file.name.replace(/\.[^/.]+$/, "");
    downloadActionArea.style.display = 'none'; // Esconde botão se houver nova conversão
    updateStatus("Fase 1: Extraindo texto e mapeando estruturalmente...", false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '2%';

    const sanitizationRules = buildSanitizationRules();
    const isFastMode = fastModeCheckbox.checked;
    const isSplitMode = splitDownloadCheckbox ? splitDownloadCheckbox.checked : true;
    
    const imageQuality = isFastMode ? 0.60 : 0.85; 
    const ZIP_COMPRESSION = isFastMode ? "STORE" : "DEFLATE";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const zip = new JSZip();
        
        let fullText = "";
        let imageTasks = []; 
        let imageCounterTotal = 0;

        // FASE 1: Leitura Síncrona de Texto e Metadados Visuais
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`Fase 1 - Lendo página ${pageNum} de ${pdf.numPages}...`, false);
            progressBar.style.width = `${(pageNum / pdf.numPages) * 50}%`; 
            await yieldToMain(); 

            let pageText = "";
            try {
                const page = await pdf.getPage(pageNum);
                const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout texto");
                pageText = textContent.items.map(item => item.str).join(' ');
                
                pageText = sanitizePageText(pageText, sanitizationRules);

                const operatorList = await withTimeout(page.getOperatorList(), 5000, "Timeout operadores");
                let imageCounterPage = 1;
                const OPS = pdfjsLib.OPS;

                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                        const imgId = operatorList.argsArray[i][0];
                        const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                        
                        pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;
                        imageTasks.push({ pageNum, imgId, imageName });
                        imageCounterPage++;
                        imageCounterTotal++;
                    }
                }
                page.cleanup(); // CRÍTICO: Evita vazamento de memória na Fase 1
            } catch (err) {
                console.warn(`Erro estrutural Pág ${pageNum}.`, err);
            }
            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
        }

        // FIM DA FASE 1: Download imediato e seguro do TXT
        if (isSplitMode) {
            updateStatus("Texto extraído! O TXT foi baixado. Iniciando imagens...", false);
            const txtBlob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
            const txtLink = document.createElement("a");
            txtLink.href = URL.createObjectURL(txtBlob);
            txtLink.download = `${baseFileName}_transcrito.txt`;
            txtLink.click();
        } else {
            zip.file(`${baseFileName}_transcrito.txt`, fullText);
        }

        // FASE 2: Processamento Isolado de Imagens em Segundo Plano
        if (imageTasks.length > 0) {
            const renderCanvas = document.createElement('canvas');
            const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
            const extractCanvas = document.createElement('canvas');
            const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

            for (let i = 0; i < imageTasks.length; i++) {
                const task = imageTasks[i];
                updateStatus(`Fase 2 - Processando imagem ${i + 1} de ${imageTasks.length}...`, false);
                progressBar.style.width = `${50 + ((i / imageTasks.length) * 50)}%`; 
                await yieldToMain();

                try {
                    // Refetch necessário: Troca de custo de CPU por estabilidade de RAM
                    const page = await pdf.getPage(task.pageNum);
                    const img = await new Promise(resolve => page.objs.get(task.imgId, resolve));
                    
                    if (img) {
                        let drawWidth = img.width || 800;
                        let drawHeight = img.height || 800;
                        const MAX_SIZE = isFastMode ? 1000 : 1600;
                        
                        if (drawWidth > MAX_SIZE || drawHeight > MAX_SIZE) {
                            const ratio = Math.min(MAX_SIZE / drawWidth, MAX_SIZE / drawHeight);
                            drawWidth *= ratio; drawHeight *= ratio;
                        }

                        renderCanvas.width = drawWidth; renderCanvas.height = drawHeight;
                        await yieldToMain(); 

                        if (img.bitmap) {
                            renderCtx.drawImage(img.bitmap, 0, 0, drawWidth, drawHeight);
                        } else if (img.data) {
                            extractCanvas.width = img.width; extractCanvas.height = img.height;
                            const safePixelArray = normalizeImageData(img.data, img.width, img.height);
                            const imageData = new ImageData(safePixelArray, img.width, img.height);
                            
                            extractCtx.putImageData(imageData, 0, 0);
                            renderCtx.drawImage(extractCanvas, 0, 0, drawWidth, drawHeight);
                        }

                        const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', imageQuality));
                        if (blob) zip.file(task.imageName, blob);
                    }
                    page.cleanup(); // CRÍTICO: Libera a RAM da imagem após ela estar no JSZip
                } catch (err) {
                    console.warn(`Imagem ${task.imageName} ignorada.`, err);
                }
            }

            // Geração final do Blob do ZIP
            updateStatus(`Compactando arquivo de imagens...`, false);
            const zipBlob = await zip.generateAsync({ type: "blob", compression: ZIP_COMPRESSION }, (metadata) => {
                if(metadata.percent > 0) updateStatus(`Criando ZIP: ${Math.round(metadata.percent)}%`, false);
            });
            
            // UX Segura: Transfere a responsabilidade do download para o usuário
            progressBar.style.width = '100%';
            progressContainer.style.display = 'none';
            downloadActionArea.style.display = 'block';
            updateStatus("Processamento concluído! Clique no botão para baixar as imagens.", false);

            // Reseta event listeners anteriores para evitar múltiplos downloads indesejados
            btnDownloadZip.onclick = () => {
                const zipLink = document.createElement("a");
                zipLink.href = URL.createObjectURL(zipBlob);
                zipLink.download = isSplitMode ? `${baseFileName}_Imagens.zip` : `${baseFileName}_Extraido.zip`;
                zipLink.click();
            };

        } else {
            // Documentos apenas com texto
            if (!isSplitMode) {
                const zipBlob = await zip.generateAsync({ type: "blob", compression: ZIP_COMPRESSION });
                const zipLink = document.createElement("a");
                zipLink.href = URL.createObjectURL(zipBlob);
                zipLink.download = `${baseFileName}_Extraido.zip`;
                zipLink.click();
            }
            updateStatus(`Pronto! Processo finalizado (Sem imagens detectadas).`, false);
            progressBar.style.width = '100%';
            setTimeout(() => { progressContainer.style.display = 'none'; progressBar.style.width = '0%'; }, 3000);
        }
    } catch (error) {
        console.error("Erro fatal:", error);
        updateStatus("Erro crítico na leitura. Tente novamente.", true);
    }
}

function updateStatus(message, isError) {
    statusArea.textContent = message;
    statusArea.style.color = isError ? "#dc2626" : "var(--text-muted)";
}