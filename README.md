# Conversor de Petições PJe (PDF para TXT + Imagens)

## Pano de Fundo e Objetivo
No ambiente de análise de processos trabalhistas na segunda instância (TRT), a utilização de Inteligência Artificial para sumarização e análise de recursos (como Recursos Ordinários e Contrarrazões) exige eficiência de processamento. Modelos de linguagem, como o Gemini, processam texto puro (`.txt`) com muito mais velocidade e menor custo de tokens do que arquivos PDF nativos. 

No entanto, as petições modernas são híbridas: advogados frequentemente inserem "prints" de cartões de ponto, tabelas do PJe-Calc e conversas de WhatsApp no meio do texto. A conversão cega para `.txt` destrói essas provas visuais, deixando a IA sem o contexto da tese.

Este projeto resolve esse problema extraindo o texto e isolando as imagens localmente no navegador, sem uso de IA externa ou servidores de terceiros, garantindo o sigilo judicial.

## Inteligência de Conversão e Nomenclatura
O motor JavaScript (utilizando `pdf.js` e `jszip`) realiza uma varredura estrutural em cada página do PDF:

1. **Extração de Texto:** O texto selecionável é capturado e organizado sequencialmente.
2. **Detecção e Recorte de Imagens:** Quando um objeto de imagem é detectado no layout, o script o isola e desenha em um elemento `Canvas`, convertendo-o para um arquivo PNG independente.
3. **Interligação (A "Tag de Contexto"):** No exato momento da extração da imagem, o script injeta uma referência textual no corpo do arquivo `.txt`. 
   * **Exemplo de Nomenclatura:** Se o PDF se chama `Recurso_Ordinario.pdf`, e a primeira imagem aparece na página 4, a imagem será salva como `Recurso_Ordinario_PAG_04_IMG_01.png`.
   * **Injeção no TXT:** O texto final conterá a seguinte marcação exatamente onde a imagem estava: `[IMAGEM EXTRAÍDA: Recurso_Ordinario_PAG_04_IMG_01.png]`.
4. **Empacotamento:** O script compila o arquivo `.txt` e todas as imagens `.png` em um único arquivo `.zip` para download instantâneo.

Dessa forma, o analista judiciário pode alimentar o modelo de IA com o arquivo `.txt` contendo as tags. O modelo compreenderá que há uma referência visual para aquela alegação, e o analista poderá conferir rapidamente a imagem correspondente no arquivo descompactado.
