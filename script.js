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

        // ─────────────────────────────────────────────────────────────────
        // FASE 1: Leitura de Texto e Mapeamento Estrutural de Imagens
        // ─────────────────────────────────────────────────────────────────
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
                    }
                }
                // CRÍTICO: page.cleanup() limpa page.objs junto com a memória.
                // A Fase 2 vai re-popular os objetos chamando getOperatorList()
                // novamente — por isso o cleanup aqui é seguro.
                page.cleanup();
            } catch (err) {
                console.warn(`Erro estrutural Pág ${pageNum}.`, err);
            }
            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n${pageText.trim()}\n\n`;
        }

        // FIM DA FASE 1: Download imediato do TXT
        if (isSplitMode) {
            updateStatus("Texto extraído! O TXT foi baixado. Iniciando processamento de imagens...", false);
            const txtBlob = new Blob([fullText], { type: "text/plain;charset=utf-8" });
            const txtLink = document.createElement("a");
            txtLink.href = URL.createObjectURL(txtBlob);
            txtLink.download = `${baseFileName}_transcrito.txt`;
            txtLink.click();
        } else {
            zip.file(`${baseFileName}_transcrito.txt`, fullText);
        }

        // ─────────────────────────────────────────────────────────────────
        // FASE 2: Extração de Imagens
        //
        // CORREÇÃO DO BUG:
        // O page.cleanup() da Fase 1 destrói page.objs. Ao chamar
        // pdf.getPage() novamente, o PDF.js retorna a mesma instância
        // em cache — com objs vazio. A Promise de page.objs.get() ficava
        // pendente para sempre porque nenhum getOperatorList() era chamado
        // para re-popular os objetos, travando o loop silenciosamente.
        //
        // Solução: chamar getOperatorList() no início de cada novo pageNum
        // na Fase 2, re-disparando o carregamento dos objetos da página.
        // Otimização: agrupar tasks por página para evitar chamadas
        // redundantes (uma página com N imagens precisa de apenas 1 chamada).
        // ─────────────────────────────────────────────────────────────────
        if (imageTasks.length > 0) {
            const renderCanvas = document.createElement('canvas');
            const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
            const extractCanvas = document.createElement('canvas');
            const extractCtx = extractCanvas.getContext('2d', { willReadFrequently: true });

            let currentPageNum = -1;
            let currentPage = null;

            for (let i = 0; i < imageTasks.length; i++) {
                const task = imageTasks[i];
                updateStatus(`Fase 2 - Processando imagem ${i + 1} de ${imageTasks.length}...`, false);
                progressBar.style.width = `${50 + ((i / imageTasks.length) * 50)}%`;
                await yieldToMain();

                try {
                    // FIX: Só busca e re-processa a página quando ela muda.
                    // getOperatorList() re-popula page.objs (destruído pelo
                    // cleanup da Fase 1), permitindo que page.objs.get() resolva.
                    if (task.pageNum !== currentPageNum) {
                        if (currentPage) currentPage.cleanup();

                        currentPage = await pdf.getPage(task.pageNum);

                        // Esta é a linha que estava faltando: re-dispara o
                        // carregamento dos objetos de imagem da página.
                        await withTimeout(
                            currentPage.getOperatorList(),
                            10000,
                            `Timeout ao recarregar objetos da página ${task.pageNum}`
                        );
                        currentPageNum = task.pageNum;
                    }

                    // FIX: withTimeout evita que um objeto problemático
                    // trave o loop indefinidamente.
                    const img = await withTimeout(
                        new Promise((resolve, reject) => {
                            currentPage.objs.get(task.imgId, (obj) => {
                                if (obj) resolve(obj);
                                else reject(new Error(`Objeto nulo para imgId: ${task.imgId}`));
                            });
                        }),
                        8000,
                        `Timeout ao obter imagem ${task.imageName}`
                    );

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
                } catch (err) {
                    // Falha isolada: loga e continua o loop normalmente.
                    console.warn(`Imagem ${task.imageName} ignorada.`, err);
                }
            }

            // Cleanup da última página ativa
            if (currentPage) currentPage.cleanup();

            // Geração final do ZIP
            updateStatus(`Compactando arquivo de imagens...`, false);
            const zipBlob = await zip.generateAsync({ type: "blob", compression: ZIP_COMPRESSION }, (metadata) => {
                if (metadata.percent > 0) updateStatus(`Criando ZIP: ${Math.round(metadata.percent)}%`, false);
            });

            progressBar.style.width = '100%';
            progressContainer.style.display = 'none';
            downloadActionArea.style.display = 'block';
            updateStatus("Processamento concluído! Clique no botão para baixar as imagens.", false);

            // Reseta listeners para evitar downloads duplicados
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