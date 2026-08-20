import fs from 'fs';

let content = fs.readFileSync('index.tsx', 'utf8');

const generateFuncStartPattern = "async function generateAndPrintCards() {";
const generateFuncStart = content.indexOf(generateFuncStartPattern);

if (generateFuncStart === -1) {
    console.error("Could not find start");
    process.exit(1);
}

const originalInputsStr = `            const titleInput = document.getElementById('card-batch-title') as HTMLInputElement;
            const quantityInput = document.getElementById('card-quantity') as HTMLInputElement;
            const colorInput = document.getElementById('card-color') as HTMLInputElement;
            
            if (!titleInput || !quantityInput) return;

            const title = titleInput.value.trim() || "Bingo Amigos";
            const quantity = parseInt(quantityInput.value, 10);
            const cardColor = colorInput ? colorInput.value : '#0ea5e9';
            const isLight = isLightColor(cardColor);`;

const newInputsStr = `            const titleInput = document.getElementById('card-batch-title') as HTMLInputElement;
            const locationInput = document.getElementById('card-batch-location') as HTMLInputElement;
            const dateInput = document.getElementById('card-batch-date') as HTMLInputElement;
            const priceInput = document.getElementById('card-batch-price') as HTMLInputElement;
            const quantityInput = document.getElementById('card-quantity') as HTMLInputElement;
            const colorInput = document.getElementById('card-color') as HTMLInputElement;
            
            if (!quantityInput) return;

            const title = (titleInput && titleInput.value.trim()) || "Bingo Amigos";
            const locationVal = (locationInput && locationInput.value.trim()) || "";
            const dateVal = (dateInput && dateInput.value.trim()) || "";
            const priceVal = (priceInput && priceInput.value.trim()) || "";
            const quantity = parseInt(quantityInput.value, 10);
            const cardColor = colorInput ? colorInput.value : '#0ea5e9';
            const isLight = isLightColor(cardColor);`;

content = content.replace(originalInputsStr, newInputsStr);

// Find the loop start
const loopStartPattern = "for (let i = 0; i < uuids.length; i += 6) {";
const loopStart = content.indexOf(loopStartPattern);

const loopEndPattern = "            }";
const loopEnd = content.indexOf(loopEndPattern, content.indexOf('if (uuids.length > 200) await new Promise(res => setTimeout(res, 5));') + 1);

const originalLoopStr = content.substring(loopStart, loopEnd + loopEndPattern.length);

const newLoopStr = `for (let i = 0; i < uuids.length; i += 6) {
                const batch = uuids.slice(i, i + 6);
                const firstSeriesOfFolha = appStore.state.cardsData[batch[0]].series;
                const folhaNumber = Math.floor((firstSeriesOfFolha - 1) / 6) + 1;

                const batchPromises = batch.map(async (uuid, idx) => {
                    const cardData = appStore.state.cardsData[uuid];
                    if (!cardData) return "";
                    const cardUrl = window.location.origin + window.location.pathname + "?card=" + uuid;
                    let qrDataUrl = "";
                    try {
                        qrDataUrl = await QRCode.toDataURL(cardUrl, { width: 120, margin: 1 });
                    } catch (e) {}
                    
                    const gameInfo = appStore.state.gamesData[idx + 1];
                    let prizeLabel = \`\${idx + 1}º PRÊMIO\`;
                    let prizeDesc = "";
                    
                    if (gameInfo) {
                       const mainPrize = gameInfo.prizes.prize1 || gameInfo.prizes.prize2 || gameInfo.prizes.prize3 || \`Sorteio \${idx + 1}\`;
                       prizeDesc = mainPrize;
                    } else {
                       prizeDesc = \`Sorteio \${idx + 1}\`;
                    }
                    
                    // Specific prizes below QR Code
                    let gridSideParts = [];
                    if (gameInfo) {
                       if (gameInfo.prizes.prize1) gridSideParts.push(\`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block text-[5px]">1º</span>\${gameInfo.prizes.prize1}</div>\`);
                       if (gameInfo.prizes.prize2) gridSideParts.push(\`<div class="mb-0.5"><span class="font-bold border-b border-black/20 block text-[5px]">2º</span>\${gameInfo.prizes.prize2}</div>\`);
                       if (gameInfo.prizes.prize3) gridSideParts.push(\`<div class=""><span class="font-bold border-b border-black/20 block text-[5px]">3º</span>\${gameInfo.prizes.prize3}</div>\`);
                    }
                    const gridSideText = gridSideParts.length > 0 ? \`<div class="text-[5px] sm:text-[6px] leading-[1.1] text-left w-full mt-1 px-0.5 break-words">\${gridSideParts.join('')}</div>\` : '';

                    return \`
                        <div class="border-[2px] border-black flex flex-col bg-white overflow-hidden text-center h-full break-inside-avoid" style="page-break-inside: avoid;">
                            <!-- Grade Header -->
                            <div class="border-b-[2px] border-black py-0.5" style="background-color: \${cardColor}; color: \${headerTextColor};">
                                <div class="font-bold text-[8px] uppercase leading-none mb-0.5 tracking-wider">\${prizeLabel}</div>
                                <div class="font-black text-[10px] uppercase leading-none truncate px-1">\${prizeDesc}</div>
                            </div>
                            
                            <!-- Split Layout -->
                            <div class="flex flex-row flex-grow items-stretch align-middle w-full h-[65mm]">
                                <!-- 5x5 GRID Layout (Left side) -->
                                <div class="w-[72%] flex flex-col border-r-[2px] border-black">
                                    <!-- BINGO Header -->
                                    <div class="grid grid-cols-5 border-b-[2px] border-black bg-gray-100 flex-shrink-0">
                                        \${['B', 'I', 'N', 'G', 'O'].map((letter, colIndex) => \`
                                            <div class="font-black text-[11px] uppercase flex items-center justify-center py-0.5 \${colIndex === 4 ? '' : 'border-r-[2px] border-black'}">\${letter}</div>
                                        \`).join('')}
                                    </div>
                                    <!-- BINGO Numbers -->
                                    <div class="flex-grow flex flex-col">
                                        \${[0,1,2,3,4].map((rowIndex) => \`
                                            <div class="grid grid-cols-5 flex-grow \${rowIndex === 4 ? '' : 'border-b-[2px] border-black'}">
                                                \${[0,1,2,3,4].map((colIndex) => {
                                                    const num = cardData.numbers[colIndex][rowIndex];
                                                    let cellContent = '';
                                                    if (num === 0) cellContent = useLogo ? \\\`<img src="\\\${\`\${logoData}\`}" class="w-full h-full object-contain p-0.5" />\\\` : '★';
                                                    else cellContent = num;
                                                    return \\\`<div class="flex items-center justify-center font-black text-sm sm:text-base leading-none \\\${colIndex === 4 ? '' : 'border-r-[2px] border-black'} \\\${num === 0 && !useLogo ? 'bg-gray-200' : ''}">\\\${cellContent}</div>\\\`;
                                                }).join('')}
                                            </div>
                                        \`).join('')}
                                    </div>
                                </div>
                        
                                <!-- Info Column (Right side) -->
                                <div class="w-[28%] flex flex-col items-center bg-white p-[2px] justify-between flex-shrink-0">
                                    <div class="text-[5px] font-bold leading-tight uppercase mb-[1px] text-center px-1">Escaneie para<br>jogar</div>
                                    <img src="\${qrDataUrl}" alt="QR" class="w-10 h-10 border-[2px] border-black object-contain bg-white" />
                                    <div class="text-[4px] text-gray-500 uppercase tracking-widest break-all font-mono mb-[2px]">ID: \${uuid.substring(0,8)}</div>
                                    
                                    <!-- Premiações abaixo do QR Code -->
                                    <div class="flex-grow w-full border-t-[2px] border-black pt-0.5 px-0 flex flex-col gap-[1px] mt-auto bg-gray-50 overflow-hidden">
                                        <div class="text-[5px] font-black uppercase text-center w-full leading-tight bg-gray-200 border border-black py-[1px]">Premiações</div>
                                        \${gridSideText}
                                    </div>
                                </div>
                            </div>
                        </div>
                    \`;
                });

                const resolvedBatchHTML = await Promise.all(batchPromises);
                
                printHTML += \`
                    <div class="bg-white border-[4px] border-black flex flex-col w-full h-[287mm] max-w-[210mm] mx-auto p-1 box-border print:p-0" style="page-break-after: always; overflow: hidden;">
                        <!-- MASTER HEADER -->
                        <div class="border-[2px] border-black mb-1 flex flex-col flex-shrink-0">
                            <h1 class="text-center font-black text-3xl uppercase py-1.5 m-0 leading-none tracking-widest" style="background-color: \${cardColor}; color: \${headerTextColor};">
                                \${title}
                            </h1>
                            <div class="flex border-t-[2px] border-black text-[9px] font-bold uppercase divide-x-[2px] divide-black">
                                <div class="flex-1 px-1 py-1 flex items-center">ONDE:&nbsp;<span class="font-normal border-b border-black flex-grow ml-1 min-w-[20px] truncate">\${locationVal}</span></div>
                                <div class="w-32 px-1 py-1 flex items-center">DATA:&nbsp;<span class="font-normal border-b border-black flex-grow ml-1 min-w-[20px] truncate">\${dateVal}</span></div>
                                <div class="w-[85px] bg-gray-200 flex flex-col items-center justify-center leading-none p-[2px]">
                                    <span class="text-[7px]">CARTELA Nº</span>
                                    <span class="text-sm font-black">\${String(folhaNumber).padStart(5, '0')}</span>
                                </div>
                            </div>
                        </div>
                    
                        <!-- MAIN GRIDS -->
                        <div class="flex-grow grid grid-cols-2 gap-1 pb-1 relative content-start">
                             \${resolvedBatchHTML.join('')}
                        </div>
                        
                        <!-- MASTER BOTTOM STUB -->
                        <div class="border-[2px] border-black mt-auto flex flex-col uppercase text-[9px] font-bold leading-none flex-shrink-0 bg-white">
                            <div class="flex border-b-[2px] border-black divide-x-[2px] divide-black bg-gray-100">
                                 <div class="flex-1 px-2 py-1 flex items-center justify-center"><span class="font-black text-sm tracking-widest truncate max-w-[250px]">\${title}</span></div>
                                 <div class="w-28 px-2 py-1 flex items-center">VALOR:&nbsp;<span class="font-black text-xs ml-auto min-w-[20px]">\${priceVal}</span></div>
                                 <div class="w-[85px] bg-gray-300 flex flex-col items-center justify-center py-0.5">
                                      <span class="text-[6px]">CARTELA Nº</span>
                                      <span class="text-sm font-black leading-none">\${String(folhaNumber).padStart(5, '0')}</span>
                                 </div>
                            </div>
                            <div class="flex border-b-[2px] border-black">
                                 <div class="flex-1 px-2 py-1 flex items-end">NOME:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                            <div class="flex border-b-[2px] border-black">
                                 <div class="flex-1 px-2 py-1 flex items-end">ENDEREÇO:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                            <div class="flex divide-x-[2px] divide-black">
                                 <div class="flex-[3] px-2 py-1 flex items-end">CIDADE:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                                 <div class="flex-[1] px-2 py-1 flex items-end">UF:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                                 <div class="flex-[3] px-2 py-1 flex items-end">FONE:&nbsp;<div class="border-b border-black flex-grow ml-1 h-3"></div></div>
                            </div>
                        </div>
                    </div>
                \`;

                if (uuids.length > 200) await new Promise(res => setTimeout(res, 5));
            }`;

content = content.replace(originalLoopStr, newLoopStr);

fs.writeFileSync('index.tsx', content);

