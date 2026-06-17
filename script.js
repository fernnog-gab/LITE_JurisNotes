// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusArea = document.getElementById('status-area');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

// Eventos de Drag & Drop (Mantidos do original)
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

// FUNÇÃO DE SEGURANÇA: Normalização de Canais de Cor para compatibilidade com Canvas
function normalizeImageData(rawData, width, height) {
    const expectedLength = width * height * 4;
    if (rawData.length === expectedLength) return new Uint8ClampedArray(rawData);

    const normalized = new Uint8ClampedArray(expectedLength);
    let j = 0;

    // Se a imagem for RGB (3 canais)
    if (rawData.length === width * height * 3) {
        for (let i = 0; i < rawData.length; i += 3) {
            normalized[j++] = rawData[i];     // R
            normalized[j++] = rawData[i + 1]; // G
            normalized[j++] = rawData[i + 2]; // B
            normalized[j++] = 255;            // A (Opacidade Total)
        }
    } 
    // Se a imagem for Grayscale (1 canal)
    else if (rawData.length === width * height) {
        for (let i = 0; i < rawData.length; i++) {
            normalized[j++] = rawData[i];     // R
            normalized[j++] = rawData[i];     // G
            normalized[j++] = rawData[i];     // B
            normalized[j++] = 255;            // A
        }
    } else {
        throw new Error(`Formato de matriz de cor desconhecido: ${rawData.length} bytes`);
    }
    
    return normalized;
}

async function handleFile(file) {
    if (file.type !== "application/pdf") {
        updateStatus("Por favor, envie um arquivo PDF válido.", true);
        return;
    }

    const baseFileName = file.name.replace(/\.[^/.]+$/, "");
    updateStatus("Iniciando leitura do documento...", false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '5%';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const zip = new JSZip();
        
        let fullText = "";
        let imageCounterTotal = 0;

        // ESTRATÉGIA DE MEMÓRIA (SINGLETON):
        // Criação de contextos únicos fora do loop para evitar Memory Leaks
        const renderCanvas = document.createElement('canvas');
        const renderCtx = renderCanvas.getContext('2d');
        const extractCanvas = document.createElement('canvas');
        const extractCtx = extractCanvas.getContext('2d');

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`Processando página ${pageNum} de ${pdf.numPages}...`, false);
            progressBar.style.width = `${(pageNum / pdf.numPages) * 100}%`;

            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            let pageText = textContent.items.map(item => item.str).join(' ');

            const operatorList = await page.getOperatorList();
            let imageCounterPage = 1;

            for (let i = 0; i < operatorList.fnArray.length; i++) {
                const fn = operatorList.fnArray[i];
                
                if (fn === pdfjsLib.OPS.paintImageXObject) {
                    const imgId = operatorList.argsArray[i][0];
                    const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                    
                    pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;

                    try {
                        const img = await new Promise(resolve => page.objs.get(imgId, resolve));
                        if (img) {
                            // Limite estipulado pelo relatório para preservar planilhas PJe-Calc sem inchar o ZIP
                            const MAX_SIZE = 1600;
                            let drawWidth = img.width;
                            let drawHeight = img.height;

                            // Upper-Bound Limit: Só reduz se for maior que o limite. Nunca amplia (upscaling).
                            if (drawWidth > MAX_SIZE || drawHeight > MAX_SIZE) {
                                const ratio = Math.min(MAX_SIZE / drawWidth, MAX_SIZE / drawHeight);
                                drawWidth = drawWidth * ratio;
                                drawHeight = drawHeight * ratio;
                            }

                            renderCanvas.width = drawWidth;
                            renderCanvas.height = drawHeight;

                            if (img.bitmap) {
                                // Formatos já desenháveis nativamente (ImageBitmap)
                                renderCtx.drawImage(img.bitmap, 0, 0, drawWidth, drawHeight);
                            } else if (img.data) {
                                // Array bruto de pixels (Requer normalização de canais)
                                extractCanvas.width = img.width;
                                extractCanvas.height = img.height;
                                
                                const safePixelArray = normalizeImageData(img.data, img.width, img.height);
                                const imageData = new ImageData(safePixelArray, img.width, img.height);
                                
                                extractCtx.putImageData(imageData, 0, 0);
                                renderCtx.drawImage(extractCanvas, 0, 0, drawWidth, drawHeight);
                            }

                            // Qualidade ajustada para 85% conforme "Sweet Spot" de legibilidade para IA
                            const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', 0.85));
                            zip.file(imageName, blob);

                            // Liberação de memória (Garbage Collection Assist)
                            renderCtx.clearRect(0, 0, drawWidth, drawHeight);
                            extractCtx.clearRect(0, 0, img.width, img.height);
                        }
                    } catch (err) {
                        console.warn(`Aviso: Falha isolada na imagem ${imageName}. O PDF pode estar corrompido neste ponto.`, err);
                    }

                    imageCounterPage++;
                    imageCounterTotal++;
                }
            }

            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n`;
            fullText += pageText + "\n\n";

            // YIELD PARA A UI THREAD: 
            // Libera a thread principal para evitar aviso de "Página Congelada" no navegador.
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Empacotamento
        updateStatus("Empacotando e compactando arquivos...", false);
        zip.file(`${baseFileName}_transcrito.txt`, fullText);
        zip.file("LEIA-ME.txt", "Texto extraído com marcações de imagens. Preparado para análise por modelos de IA (Gemini, ChatGPT, Groq). Resolução nativa de segurança: Máx 1600px.");

        const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `${baseFileName}_Extraido.zip`;
        downloadLink.click();

        updateStatus(`Concluído! ${pdf.numPages} páginas processadas e ${imageCounterTotal} provas visuais preservadas.`, false);
        setTimeout(() => { progressContainer.style.display = 'none'; progressBar.style.width = '0%'; }, 3000);

    } catch (error) {
        console.error(error);
        updateStatus("Erro catastrófico ao processar o PDF. Verifique o console.", true);
    }
}

function updateStatus(message, isError) {
    statusArea.textContent = message;
    statusArea.style.color = isError ? "#dc2626" : "var(--text-muted)";
}
