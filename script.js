// Configuração do PDF.js Web Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// ============================================================================
// STATE & CONFIG
// ============================================================================
let pdfDoc = null;
let currentPageNum = 1;
let currentRenderTask = null;
let activePageReference = null; // Guarda a referência para limpeza (Memory Leak Fix)
let capturedSnippets = [];
let pendingSelectionText = "";

// Elementos DOM
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const configPanel = document.getElementById('config-panel');
const workspace = document.getElementById('curation-workspace');
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');
const pageContainer = document.getElementById('pdf-page-container');
const textLayerDiv = document.getElementById('text-layer');
const tooltip = document.getElementById('selection-tooltip');
const snippetsList = document.getElementById('snippets-list');
const emptyState = document.getElementById('empty-state');
const btnExport = document.getElementById('btn-export-txt');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// ============================================================================
// INICIALIZAÇÃO DO ARQUIVO
// ============================================================================
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== "application/pdf") return alert("Por favor, selecione um arquivo PDF.");
    
    dropZone.style.display = 'none';
    configPanel.style.display = 'block';
    workspace.style.display = 'block';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        document.getElementById('page-indicator').textContent = `Página 1 / ${pdfDoc.numPages}`;
        renderPage(1);
    } catch (err) {
        console.error("Erro ao ler PDF:", err);
        alert("Erro ao processar o arquivo PDF.");
    }
});

// ============================================================================
// MOTOR DE RENDERIZAÇÃO E GERENCIAMENTO DE MEMÓRIA (Core Fix)
// ============================================================================
async function renderPage(num) {
    if (currentRenderTask) {
        currentRenderTask.cancel(); // Cancela renderização pendente se usuário clicou rápido
    }

    // MEMORY LEAK FIX: Limpa a página anterior da memória
    if (activePageReference) {
        activePageReference.cleanup();
    }

    try {
        const page = await pdfDoc.getPage(num);
        activePageReference = page;
        
        // Escala responsiva baseada em um tamanho confortável
        const viewport = page.getViewport({ scale: 1.4 }); 
        
        // Dimensiona os contêineres lógicos (O CSS cuidará do visual na tela)
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        pageContainer.style.width = `${viewport.width}px`;
        pageContainer.style.height = `${viewport.height}px`;

        // Renderiza o visual
        const renderContext = { canvasContext: ctx, viewport: viewport };
        currentRenderTask = page.render(renderContext);
        await currentRenderTask.promise;

        // Renderiza a Camada de Texto Otimizada (Alinhamento Correto)
        const textContent = await page.getTextContent();
        textLayerDiv.innerHTML = ''; // Limpa camada DOM anterior
        
        pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        // Atualiza UI
        currentPageNum = num;
        document.getElementById('page-indicator').textContent = `Página ${num} / ${pdfDoc.numPages}`;
        btnPrev.disabled = num <= 1;
        btnNext.disabled = num >= pdfDoc.numPages;

    } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
            console.error("Erro de renderização:", err);
        }
    }
}

// Navegação de Páginas
btnPrev.addEventListener('click', () => { if (currentPageNum > 1) renderPage(currentPageNum - 1); });
btnNext.addEventListener('click', () => { if (currentPageNum < pdfDoc.numPages) renderPage(currentPageNum + 1); });

// ============================================================================
// MOTOR DE SELEÇÃO E UX (Eventos de Mouse Confiáveis)
// ============================================================================
pageContainer.addEventListener('mouseup', (e) => {
    // Usamos setTimeout(0) para garantir que o navegador atualizou a seleção
    setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 2 && textLayerDiv.contains(selection.anchorNode)) {
            // Sanitização Inteligente (Limpeza de Ruído para a IA)
            // Remove quebras de linha que possuem hífen (ex: traba-\nlhador -> trabalhador)
            pendingSelectionText = selectedText.replace(/-\s*\n\s*/g, '').replace(/\n/g, ' ');

            // Posicionamento do Tooltip baseado no retângulo da seleção
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            tooltip.style.top = `${rect.top + window.scrollY - 45}px`;
            tooltip.style.left = `${rect.left + window.scrollX + (rect.width/2) - 60}px`; // Centralizado na seleção
            tooltip.style.display = 'block';
        } else {
            tooltip.style.display = 'none';
        }
    }, 0);
});

// Oculta tooltip se clicar em qualquer lugar fora do texto selecionado
document.addEventListener('mousedown', (e) => {
    if (e.target !== tooltip && !tooltip.contains(e.target)) {
        tooltip.style.display = 'none';
    }
});

// ============================================================================
// CRIAÇÃO SEGURA NO DOM (Prevenção XSS) E INLINE EDITING
// ============================================================================
tooltip.addEventListener('click', () => {
    if (!pendingSelectionText) return;
    
    // Oculta tooltip e limpa seleção visual
    tooltip.style.display = 'none';
    window.getSelection().removeAllRanges();

    // Adiciona ao estado e atualiza UI
    const newSnippet = { titulo: "Tópico em Análise", texto: pendingSelectionText };
    capturedSnippets.push(newSnippet);
    
    renderSnippetsList();
    
    // Auto-focus no último card criado (Inline Editing UX)
    const inputs = snippetsList.querySelectorAll('.snippet-input-title');
    if(inputs.length > 0) {
        inputs[inputs.length - 1].select();
    }
});

function renderSnippetsList() {
    emptyState.style.display = capturedSnippets.length > 0 ? 'none' : 'block';
    btnExport.disabled = capturedSnippets.length === 0;
    
    // Limpa os cards anteriores para reconstrução segura
    Array.from(snippetsList.children).forEach(child => {
        if (child.id !== 'empty-state') child.remove();
    });

    capturedSnippets.forEach((snippet, index) => {
        // PREVENÇÃO XSS: Usando createElement ao invés de innerHTML
        const card = document.createElement('div');
        card.className = 'snippet-card';

        const inputTitle = document.createElement('input');
        inputTitle.type = 'text';
        inputTitle.className = 'snippet-input-title';
        inputTitle.value = snippet.titulo;
        inputTitle.addEventListener('input', (e) => {
            capturedSnippets[index].titulo = e.target.value; // Vincula alteração ao estado
        });

        const textContent = document.createElement('div');
        textContent.className = 'snippet-text-content';
        textContent.textContent = snippet.texto; // Injeção segura de nós de texto

        const btnRemove = document.createElement('button');
        btnRemove.className = 'btn-remove-snippet';
        btnRemove.textContent = 'Excluir Trecho';
        btnRemove.onclick = () => {
            capturedSnippets.splice(index, 1);
            renderSnippetsList();
        };

        card.appendChild(inputTitle);
        card.appendChild(textContent);
        card.appendChild(btnRemove);
        
        snippetsList.appendChild(card);
    });
}

// ============================================================================
// EXPORTAÇÃO FINAL
// ============================================================================
btnExport.addEventListener('click', () => {
    let finalTxt = "=== ARQUIVO DE CURADORIA PARA ANÁLISE IA ===\n\n";
    capturedSnippets.forEach(s => {
        finalTxt += `[TÓPICO: ${s.titulo.toUpperCase()}]\n${s.texto}\n\n`;
    });

    const blob = new Blob([finalTxt], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Curadoria_Peticao_Flash_IA.txt`;
    link.click();
});