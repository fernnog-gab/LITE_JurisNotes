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
    updateStatus("Iniciando conversão estrutural. Preparando ambiente...", false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '2%';

    const sanitizationRules = buildSanitizationRules();
    
    // Captura o estado do Modo Turbo
    const isFastMode = fastModeCheckbox.checked;
    
    // Configurações dinâmicas baseadas no Modo Turbo
    const imageQuality = isFastMode ? 0.60 : 0.85; 
    const ZIP_COMPRESSION = isFastMode ? "STORE" : "DEFLATE";

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const zip = new JSZip();
        
        let fullText = "";
        let imageCounterTotal = 0;

        const renderCanvas = document.createElement('canvas');
        const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
        const extractCanvas = document.createElement('canvas');
        const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`Analisando página ${pageNum} de ${pdf.numPages}...`, false);
            progressBar.style.width = `${(pageNum / pdf.numPages) * 100}%`;
            
            await yieldToMain(); 

            let pageText = "";
            let operatorList = null;

            try {
                const page = await pdf.getPage(pageNum);
                const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout texto");
                pageText = textContent.items.map(item => item.str).join(' ');

                pageText = sanitizePageText(pageText, sanitizationRules);

                operatorList = await withTimeout(page.getOperatorList(), 5000, "Timeout operadores");
                
                let imageCounterPage = 1;
                const OPS = pdfjsLib.OPS;

                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    
                    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                        const imgId = operatorList.argsArray[i][0];
                        const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                        
                        try {
                            const img = await new Promise(resolve => page.objs.get(imgId, resolve));
                            if (!img) continue;

                            pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;

                            let drawWidth = img.width || 800;
                            let drawHeight = img.height || 800;
                            
                            // Reduz limite de tamanho se o Turbo estiver ligado
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
                                
                                await yieldToMain();
                                extractCtx.putImageData(imageData, 0, 0);
                                renderCtx.drawImage(extractCanvas, 0, 0, drawWidth, drawHeight);
                            }

                            // Renderiza o Blob aplicando a qualidade dinâmica
                            const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', imageQuality));
                            if (blob) zip.file(imageName, blob);

                            imageCounterPage++; imageCounterTotal++;

                        } catch (err) {
                            console.warn(`Imagem ignorada na Pág ${pageNum}.`, err);
                        }
                    }
                }
            } catch (pageError) {
                console.warn(`Erro estrutural Pág ${pageNum}.`, pageError);
            }

            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
        }

        updateStatus(`Finalizando e empacotando (${isFastMode ? 'Modo Turbo' : 'Padrão'})...`, false);
        zip.file(`${baseFileName}_transcrito.txt`, fullText);

        // Gera o ZIP aplicando o método de compressão condicional
        const zipBlob = await zip.generateAsync({ 
            type: "blob", 
            compression: ZIP_COMPRESSION // "STORE" = Rápido; "DEFLATE" = Lento, tamanho menor
        }, (metadata) => {
            updateStatus(`Criando ZIP: ${Math.round(metadata.percent)}%`, false);
        });
        
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `${baseFileName}_Extraido.zip`;
        downloadLink.click();

        updateStatus(`Pronto! ${pdf.numPages} páginas e ${imageCounterTotal} imagens extraídas.`, false);
        setTimeout(() => { progressContainer.style.display = 'none'; progressBar.style.width = '0%'; }, 5000);

    } catch (error) {
        console.error("Erro fatal:", error);
        updateStatus("Erro crítico na leitura. Tente novamente.", true);
    }
}

function updateStatus(message, isError) {
    statusArea.textContent = message;
    statusArea.style.color = isError ? "#dc2626" : "var(--text-muted)";
}