// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusArea = document.getElementById('status-area');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

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

// FUNÇÃO DE ARQUITETURA: Circuit Breaker (Timeout)
// Impede que o sistema congele se o PDF.js travar ao ler um arquivo corrompido do PJe.
const withTimeout = (promise, ms, errorMsg) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
};

// FUNÇÃO DE SEGURANÇA: Normalização de Canais de Cor
function normalizeImageData(rawData, width, height) {
    const expectedLength = width * height * 4;
    if (rawData.length === expectedLength) return new Uint8ClampedArray(rawData);

    const normalized = new Uint8ClampedArray(expectedLength);
    let j = 0;

    if (rawData.length === width * height * 3) {
        for (let i = 0; i < rawData.length; i += 3) {
            normalized[j++] = rawData[i];     // R
            normalized[j++] = rawData[i + 1]; // G
            normalized[j++] = rawData[i + 2]; // B
            normalized[j++] = 255;            // A
        }
    } else if (rawData.length === width * height) {
        for (let i = 0; i < rawData.length; i++) {
            normalized[j++] = rawData[i];     // R
            normalized[j++] = rawData[i];     // G
            normalized[j++] = rawData[i];     // B
            normalized[j++] = 255;            // A
        }
    } else {
        throw new Error(`Matriz de cor inválida: ${rawData.length} bytes`);
    }
    
    return normalized;
}

async function handleFile(file) {
    if (file.type !== "application/pdf") {
        updateStatus("Por favor, envie um arquivo PDF válido.", true);
        return;
    }

    const baseFileName = file.name.replace(/\.[^/.]+$/, "");
    updateStatus("Iniciando leitura do documento... (Pode demorar em PDFs grandes)", false);
    progressContainer.style.display = 'block';
    progressBar.style.width = '2%';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const zip = new JSZip();
        
        let fullText = "";
        let imageCounterTotal = 0;

        // Contextos únicos para evitar Memory Leaks
        const renderCanvas = document.createElement('canvas');
        const renderCtx = renderCanvas.getContext('2d');
        const extractCanvas = document.createElement('canvas');
        const extractCtx = extractCanvas.getContext('2d');

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`Processando página ${pageNum} de ${pdf.numPages}...`, false);
            progressBar.style.width = `${(pageNum / pdf.numPages) * 100}%`;

            let pageText = "";
            let operatorList = null;

            try {
                const page = await pdf.getPage(pageNum);
                
                // Protegemos a extração de texto com o Timeout de 5 segundos
                const textContent = await withTimeout(page.getTextContent(), 5000, "Timeout no texto");
                pageText = textContent.items.map(item => item.str).join(' ');

                // Protegemos a lista de objetos (imagens/desenhos)
                operatorList = await withTimeout(page.getOperatorList(), 5000, "Timeout na lista de operadores");

                let imageCounterPage = 1;

                // Percorre a lista buscando imagens (paintImageXObject ou paintJpegXObject)
                const OPS = pdfjsLib.OPS;
                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    
                    if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
                        const imgId = operatorList.argsArray[i][0];
                        const imageName = `${baseFileName}_PAG_${String(pageNum).padStart(2, '0')}_IMG_${String(imageCounterPage).padStart(2, '0')}.jpg`;
                        
                        try {
                            // Envolvemos a extração da imagem numa Promise com Timeout de 3 segundos
                            const getImgPromise = new Promise((resolve) => {
                                try {
                                    page.objs.get(imgId, (data) => resolve(data));
                                } catch (e) {
                                    resolve(null);
                                }
                            });

                            const img = await withTimeout(getImgPromise, 3000, `Worker travou na imagem ${imgId}`);
                            
                            if (img) {
                                pageText += `\n\n[IMAGEM EXTRAÍDA: ${imageName}]\n\n`;

                                const MAX_SIZE = 1600;
                                let drawWidth = img.width || 800;
                                let drawHeight = img.height || 800;

                                if (drawWidth > MAX_SIZE || drawHeight > MAX_SIZE) {
                                    const ratio = Math.min(MAX_SIZE / drawWidth, MAX_SIZE / drawHeight);
                                    drawWidth = drawWidth * ratio;
                                    drawHeight = drawHeight * ratio;
                                }

                                renderCanvas.width = drawWidth;
                                renderCanvas.height = drawHeight;

                                if (img.bitmap) {
                                    renderCtx.drawImage(img.bitmap, 0, 0, drawWidth, drawHeight);
                                } else if (img.data) {
                                    extractCanvas.width = img.width;
                                    extractCanvas.height = img.height;
                                    
                                    const safePixelArray = normalizeImageData(img.data, img.width, img.height);
                                    const imageData = new ImageData(safePixelArray, img.width, img.height);
                                    
                                    extractCtx.putImageData(imageData, 0, 0);
                                    renderCtx.drawImage(extractCanvas, 0, 0, drawWidth, drawHeight);
                                }

                                const blob = await new Promise(res => renderCanvas.toBlob(res, 'image/jpeg', 0.85));
                                if (blob) zip.file(imageName, blob);

                                renderCtx.clearRect(0, 0, drawWidth, drawHeight);
                                extractCtx.clearRect(0, 0, img.width, img.height);

                                imageCounterPage++;
                                imageCounterTotal++;
                            }
                        } catch (err) {
                            console.warn(`PJe: Imagem ignorada na Pág ${pageNum}. Motivo: Arquivo corrompido ou muito pesado.`, err);
                            // Apenas registra e continua o loop sem congelar a tela!
                        }
                    }
                }
            } catch (pageError) {
                console.warn(`PJe: Erro ao processar estruturalmente a página ${pageNum}.`, pageError);
                pageText += `\n\n[AVISO DO SISTEMA: Erro ao ler a página ${pageNum} devido a fontes corrompidas no PDF original]\n\n`;
            }

            fullText += `--- INÍCIO DA PÁGINA ${pageNum} ---\n`;
            fullText += pageText + "\n\n";

            // YIELD: Impede que o navegador acuse "A página não está respondendo"
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        updateStatus("Empacotando e compactando arquivos para download...", false);
        zip.file(`${baseFileName}_transcrito.txt`, fullText);
        zip.file("LEIA-ME.txt", "Texto extraído com marcações. Preparado para análise por modelos de IA.");

        const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `${baseFileName}_Extraido.zip`;
        downloadLink.click();

        updateStatus(`Pronto! ${pdf.numPages} páginas processadas. ${imageCounterTotal} imagens extraídas.`, false);
        setTimeout(() => { progressContainer.style.display = 'none'; progressBar.style.width = '0%'; }, 5000);

    } catch (error) {
        console.error("Erro fatal:", error);
        updateStatus("Ocorreu um erro crítico ao ler o PDF. Tente recarregar a página.", true);
    }
}

function updateStatus(message, isError) {
    statusArea.textContent = message;
    statusArea.style.color = isError ? "#dc2626" : "var(--text-muted)";
}
