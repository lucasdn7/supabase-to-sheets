const { google } = require("googleapis");
 
const SPREADSHEET_ID = "1WNv8peVjLwu-iJ4vvQFJM5HwpRg8YEBlfchCTWtSojA";
const SHEET_NAME = "GEINFRA (Obras)";
 
// ── Helpers ──────────────────────────────────────────────────────────────────
 
function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}
 
/**
 * Extrai o ano de uma data ISO (ex: "2026-12-31" → 2026).
 */
function extractYear(vigenciaDate) {
  if (!vigenciaDate) return null;
  const d = new Date(vigenciaDate);
  if (isNaN(d)) return null;
  return d.getUTCFullYear();
}
 
/**
 * Formata data ISO para DD/MM/AAAA.
 */
function formatDate(val) {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
 
/**
 * Formata valor monetário em número puro (a planilha formata como moeda).
 */
function formatCurrency(val) {
  return val != null ? Number(val) : "";
}
 
/**
 * Formata campo booleano de contrato assinado.
 */
function formatContrato(val) {
  if (val == null) return "";
  if (typeof val === "boolean") return val ? "SIM" : "NÃO";
  return String(val);
}
 
/**
 * Converte registro do Supabase em linha da planilha.
 * Ordem: A=SGPE, B=NÚCLEO ORIGEM, C=MUNICÍPIO, D=OBJETO, E=TIPO DE REPASSE,
 *        F=CONCEDENTE, G=CONTRAPARTIDA, H=VIGÊNCIA PT, I=PORTARIA, J=CONTRATO ASSINADO
 */
function recordToRow(record) {
  const nucleus = record.regional_nuclei?.acronym ?? "";
  const municipality = record.municipalities?.name ?? "";
  const sgpe = record.process_number ?? "";
  const link = record.link_plataforma_governo ?? "";
 
  // SGPE vira link clicável se houver URL cadastrada
  const sgpeCell = link ? `=HYPERLINK("${link}","${sgpe}")` : sgpe;
 
  return [
    sgpeCell,                                        // A – SGPE
    nucleus,                                         // B – NÚCLEO ORIGEM
    municipality,                                    // C – MUNICÍPIO
    record.object ?? "",                             // D – OBJETO
    record.tipo_de_repasse ?? "",                    // E – TIPO DE REPASSE
    formatCurrency(record.total_concedente_value),    // F – CONCEDENTE
    formatCurrency(record.total_proponente_value),   // G – CONTRAPARTIDA
    formatDate(record.vigencia_date),                // H – VIGÊNCIA PT
    record.portaria_number ?? "",                    // I – PORTARIA
    formatContrato(record.contrato_assinado),        // J – CONTRATO ASSINADO
  ];
}
 
// ── Leitura da planilha ──────────────────────────────────────────────────────
 
/**
 * Lê todas as linhas da aba e retorna array de arrays (todas as colunas A:J).
 * Inclui fórmulas brutas para poder extrair o SGPE de dentro do HYPERLINK.
 */
async function readAllRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:J`,
    valueRenderOption: "FORMULA",
  });
  return res.data.values ?? [];
}
 
/**
 * Extrai o número do processo de uma célula que pode ser texto simples
 * ou fórmula =HYPERLINK("url","SGPE").
 */
function extractSgpe(cellValue) {
  if (!cellValue) return "";
  const match = String(cellValue).match(/HYPERLINK\("[^"]+","([^"]+)"\)/);
  return match ? match[1].trim() : String(cellValue).trim();
}
 
// ── Localização de blocos por ano ────────────────────────────────────────────
 
/**
 * Analisa todas as linhas e retorna um mapa de estrutura por ano:
 * {
 *   2026: {
 *     headerRow: 5,         // índice 0-based da linha "OBRAS 2026"
 *     totalRow: 185,        // índice 0-based da linha "TOTAL 2026"
 *     dataStart: 6,         // primeira linha de dados do bloco (0-based)
 *     dataEnd: 184,         // última linha de dados do bloco (0-based, inclusive)
 *   }
 * }
 *
 * A detecção busca na coluna D ou A por texto contendo "OBRAS {ANO}".
 * A linha de total é detectada por "TOTAL {ANO}" em qualquer coluna.
 */
function buildYearStructure(rows) {
  const structure = {};
 
  for (let i = 0; i < rows.length; i++) {
    const rowText = (rows[i] ?? []).join(" ").toUpperCase();
 
    // Detecta sub-cabeçalho de ano (ex: "OBRAS 2026")
    const headerMatch = rowText.match(/OBRAS\s+(\d{4})/);
    if (headerMatch) {
      const year = parseInt(headerMatch[1], 10);
      if (!structure[year]) structure[year] = {};
      structure[year].headerRow = i;
      structure[year].dataStart = i + 1;
    }
 
    // Detecta linha de total (ex: "TOTAL 2026")
    const totalMatch = rowText.match(/TOTAL\s+(\d{4})/);
    if (totalMatch) {
      const year = parseInt(totalMatch[1], 10);
      if (!structure[year]) structure[year] = {};
      structure[year].totalRow = i;
      structure[year].dataEnd = i - 1;
    }
  }
 
  return structure;
}
 
// ── Upsert principal ─────────────────────────────────────────────────────────
 
/**
 * Faz upsert de um processo na aba "GEINFRA (Obras)":
 * - Atualiza a linha existente se o SGPE já estiver na planilha
 * - Insere no bloco do ano correto (antes da linha TOTAL do ano) se for novo
 * - Recalcula o TOTAL do ano após qualquer alteração
 */
async function upsertProcessGeinfra(record) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
 
  const sgpe = record.process_number;
  if (!sgpe) throw new Error("Processo sem process_number (SGPE).");
 
  const row = recordToRow(record);
  const year = extractYear(record.vigencia_date);
 
  console.log(`🔍 Processando SGPE: ${sgpe} | Ano vigência: ${year}`);
 
  // Lê todas as linhas atuais
  const rows = await readAllRows(sheets);
 
  // Monta mapa SGPE → índice de linha (0-based)
  const sgpeIndex = new Map();
  for (let i = 0; i < rows.length; i++) {
    const val = extractSgpe(rows[i]?.[0]);
    if (val) sgpeIndex.set(val, i);
  }
 
  // Monta estrutura de blocos por ano
  const yearStructure = buildYearStructure(rows);
 
  let targetRowIndex; // índice 0-based da linha que será escrita
 
  if (sgpeIndex.has(sgpe)) {
    // ── ATUALIZAÇÃO ──────────────────────────────────────────────────────────
    targetRowIndex = sgpeIndex.get(sgpe);
    const sheetRow = targetRowIndex + 1; // Google Sheets é 1-based
    const range = `'${SHEET_NAME}'!A${sheetRow}:J${sheetRow}`;
 
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
 
    console.log(`✏️  SGPE ${sgpe} atualizado na linha ${sheetRow}.`);
  } else {
    // ── INSERÇÃO ─────────────────────────────────────────────────────────────
    const bloc = year ? yearStructure[year] : null;
 
    if (bloc?.totalRow != null) {
      // Insere logo antes da linha TOTAL do ano usando batchUpdate (insertDimension)
      const totalSheetRow = bloc.totalRow + 1; // 1-based
 
      // 1. Insere linha vazia antes do TOTAL
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: await getSheetId(sheets),
                  dimension: "ROWS",
                  startIndex: bloc.totalRow, // 0-based: insere ANTES do total
                  endIndex: bloc.totalRow + 1,
                },
                inheritFromBefore: true,
              },
            },
          ],
        },
      });
 
      // 2. Escreve os dados na linha recém-inserida
      const insertRange = `'${SHEET_NAME}'!A${totalSheetRow}:J${totalSheetRow}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: insertRange,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
 
      targetRowIndex = bloc.totalRow; // a linha inserida ficou nesse índice (0-based)
      console.log(`➕ SGPE ${sgpe} inserido na linha ${totalSheetRow} (bloco ${year}).`);
    } else {
      // Ano não encontrado na planilha → append no final
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:J`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });
 
      console.log(`➕ SGPE ${sgpe} inserido no final da aba (ano ${year} sem bloco definido).`);
      return; // sem bloco estruturado, não recalcula total
    }
  }
 
  // ── RECALCULO DO TOTAL DO ANO ─────────────────────────────────────────────
  if (year && yearStructure[year]?.totalRow != null) {
    await recalcularTotal(sheets, rows, yearStructure, year, sgpeIndex.has(sgpe));
  }
}
 
/**
 * Recalcula os totais de CONCEDENTE (col F) e CONTRAPARTIDA (col G)
 * para o bloco do ano indicado e atualiza a linha TOTAL.
 *
 * Lê os dados novamente para garantir valores atualizados após a inserção.
 */
async function recalcularTotal(sheets, _rows, yearStructure, year, wasUpdate) {
  // Relê a planilha com valores calculados (não fórmulas) para somar
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:J`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const freshRows = res.data.values ?? [];
 
  // Recalcula estrutura com as linhas atualizadas (a inserção deslocou índices)
  const freshStructure = buildYearStructure(freshRows);
  const bloc = freshStructure[year];
 
  if (!bloc || bloc.dataStart == null || bloc.totalRow == null) {
    console.warn(`⚠️  Não foi possível localizar bloco do ano ${year} para recalcular total.`);
    return;
  }
 
  let somaF = 0;
  let somaG = 0;
 
  for (let i = bloc.dataStart; i <= bloc.dataEnd; i++) {
    const row = freshRows[i] ?? [];
    // Colunas F e G são índices 5 e 6 (0-based)
    const valF = parseFloat(String(row[5] ?? "").replace(/[^0-9,.-]/g, "").replace(",", ".")) || 0;
    const valG = parseFloat(String(row[6] ?? "").replace(/[^0-9,.-]/g, "").replace(",", ".")) || 0;
    somaF += valF;
    somaG += valG;
  }
 
  const totalSheetRow = bloc.totalRow + 1; // 1-based
 
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!F${totalSheetRow}:G${totalSheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[somaF, somaG]] },
  });
 
  console.log(`📊 Total ${year} recalculado → Concedente: R$${somaF.toLocaleString("pt-BR")} | Contrapartida: R$${somaG.toLocaleString("pt-BR")}`);
}
 
/**
 * Busca o sheetId numérico da aba pelo nome (necessário para insertDimension).
 */
async function getSheetId(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets.find(
    (s) => s.properties.title === SHEET_NAME
  );
  if (!sheet) throw new Error(`Aba "${SHEET_NAME}" não encontrada na planilha.`);
  return sheet.properties.sheetId;
}
 
// ── Exports ──────────────────────────────────────────────────────────────────
 
module.exports = { upsertProcessGeinfra };
