// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusArea = document.getElementById('status-area');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

const fastModeCheckbox = document.getElementById('fast-mode');
const removeSignaturesCheckbox = document.getElementById('remove-signatures');
const customFootersTextarea = document.getElementById('custom-footers');

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
    downloadActionArea.style.display = 'none';
    updateStatus("Iniciando processamento...", false);
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

        // imageBlobs acumula os blobs extraídos inline — sem re-fetch de página.
        // A Fase 2 passa a ser apenas empacotamento (zip), sem tocar no PDF.
        let imageBlobs = [];

        const renderCanvas = document.createElement('canvas');
        const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
        const extractCanvas = document.createElement('canvas');
        const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

        // ─────────────────────────────────────────────────────────────────
        // PASSAGEM ÚNICA: texto + imagens por página
        //
        // CORREÇÃO ARQUITETURAL:
        // O PDF.js guarda os dados dos XObjects de imagem em page.objs enquanto
        // a página está ativa. Quando page.cleanup() é chamado, esse cache é
        // destruído. Na abordagem anterior (duas fases), tentava-se acessar
        // page.objs DEPOIS do cleanup via re-fetch — mas o PDF.js retorna o
        // operator list de cache sem re-enviar os dados das imagens ao worker,
        // então page.objs permanecia vazio e page.objs.get() nunca resolvia.
        //
        // Solução: extrair os blobs das imagens ANTES de page.cleanup(),
        // enquanto page.objs ainda está populado. A Fase 2 passa a ser apenas
        // um zip dos blobs já coletados, sem nenhum re-fetch de página.
        // ─────────────────────────────────────────────────────────────────
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`Processando página ${pageNum} de ${pdf.numPages}...`, false);
            progressBar.style.width = `${2 + (pageNum / pdf.numPages) * 83}%`;
            await yieldToMain();

            let pageText = "";
            try {
                const page = await pdf.getPage(pageNum);

                // 1. Extração de texto
                const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout texto");
                pageText = textContent.items.map(item => item.str).join(' ');
                pageText = sanitizePageText(pageText, sanitizationRules);

                // 2. Operator list — popula page.objs com os dados das imagens
                const operatorList = await withTimeout(page.getOperatorList(), 8000, "Timeout operadores");
                const OPS = pdfjsLib.OPS;
                let imageCounterPage = 1;

                // 3. Extrair imagens agora, com page.objs vivo (antes do cleanup)
                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                        const imgId = operatorList.argsArray[i][0];
                        const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;

                        pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;

                        try {
                            // page.objs.get() resolve imediatamente ou aguarda
                            // o worker terminar o decode — funciona porque a
                            // página ainda não foi limpa.
                            const img = await withTimeout(
                                new Promise((resolve, reject) => {
                                    page.objs.get(imgId, (obj) => {
                                        if (obj) resolve(obj);
                                        else reject(new Error(`Objeto nulo: ${imgId}`));
                                    });
                                }),
                                8000,
                                `Timeout imagem ${imageName}`
                            );

                            if (img) {
                                let drawWidth = img.width || 800;
                                let drawHeight = img.height || 800;
                                const MAX_SIZE = isFastMode ? 1000 : 1600;

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
                                if (blob) imageBlobs.push({ imageName, blob });
                            }
                        } catch (imgErr) {
                            console.warn(`Imagem ${imageName} ignorada.`, imgErr);
                        }

                        imageCounterPage++;
                        await yieldToMain();
                    }
                }

                // Seguro limpar agora: texto extraído, blobs coletados
                page.cleanup();

            } catch (err) {
                console.warn(`Erro na Pág ${pageNum}.`, err);
            }
            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
        }

        // ── Download do TXT ─────────────────────────────────────────────
        if (isSplitMode) {
            updateStatus("Extração concluída! Baixando TXT e gerando ZIP...", false);
            const txtBlob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
            const txtLink = document.createElement("a");
            txtLink.href = URL.createObjectURL(txtBlob);
            txtLink.download = `${baseFileName}_transcrito.txt`;
            txtLink.click();
        } else {
            zip.file(`${baseFileName}_transcrito.txt`, fullText);
        }

        // ── Fase 2: apenas empacotamento dos blobs já coletados ─────────
        if (imageBlobs.length > 0) {
            updateStatus(`Compactando ${imageBlobs.length} imagem(ns)...`, false);
            progressBar.style.width = '88%';
            await yieldToMain();

            for (const { imageName, blob } of imageBlobs) {
                zip.file(imageName, blob);
            }

            const zipBlob = await zip.generateAsync({ type: "blob", compression: ZIP_COMPRESSION }, (meta) => {
                if (meta.percent > 0) {
                    progressBar.style.width = `${88 + (meta.percent / 100) * 12}%`;
                    updateStatus(`Criando ZIP: ${Math.round(meta.percent)}%`, false);
                }
            });

            progressBar.style.width = '100%';
            progressContainer.style.display = 'none';
            downloadActionArea.style.display = 'block';
            updateStatus("Processamento concluído! Clique no botão para baixar as imagens.", false);

            // Listener limpo a cada conversão para evitar downloads duplicados
            btnDownloadZip.onclick = () => {
                const zipLink = document.createElement("a");
                zipLink.href = URL.createObjectURL(zipBlob);
                zipLink.download = isSplitMode ? `${baseFileName}_Imagens.zip` : `${baseFileName}_Extraido.zip`;
                zipLink.click();
            };

        } else {
            // Documento sem imagens
            if (!isSplitMode) {
                const zipBlob = await zip.generateAsync({ type: "blob", compression: ZIP_COMPRESSION });
                const zipLink = document.createElement("a");
                zipLink.href = URL.createObjectURL(zipBlob);
                zipLink.download = `${baseFileName}_Extraido.zip`;
                zipLink.click();
            }
            updateStatus(`Pronto! Processo finalizado (sem imagens detectadas).`, false);
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