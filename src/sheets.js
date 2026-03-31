const { google } = require("googleapis");

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME;

// Cabeçalhos na ordem exata das colunas da planilha
const HEADERS = [
  "SGPE",
  "NÚCLEO ORIGEM",
  "MUNICÍPIO",
  "OBJETO",
  "VALOR CONCEDENTE",
  "CONTRAPARTIDA",
  "VALOR LICITADO",
  "VIGÊNCIA PT",
  "PORTARIA",
];

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Converte um registro do Supabase em uma linha para a planilha.
 * O SGPE vira uma fórmula HYPERLINK clicável.
 */
function recordToRow(record) {
  const nucleus = record.regional_nuclei?.acronym ?? "";
  const municipality = record.municipalities?.name ?? "";

  const sgpe = record.process_number ?? "";
  const link = record.link_plataforma_governo ?? "";

  // Célula clicável: ao clicar no número do processo abre o link da plataforma
  const hyperlinkFormula = link
    ? `=HYPERLINK("${link}","${sgpe}")`
    : sgpe;

  const formatCurrency = (val) =>
    val != null ? Number(val) : "";

  const formatDate = (val) => {
    if (!val) return "";
    // Aceita formato ISO ou string — devolve DD/MM/AAAA
    const d = new Date(val);
    if (isNaN(d)) return val;
    return d.toLocaleDateString("pt-BR");
  };

  return [
    hyperlinkFormula,                              // SGPE (link clicável)
    nucleus,                                       // NÚCLEO ORIGEM
    municipality,                                  // MUNICÍPIO
    record.object ?? "",                           // OBJETO
    formatCurrency(record.total_concedent_value),  // VALOR CONCEDENTE
    formatCurrency(record.total_proponente_value), // CONTRAPARTIDA
    formatCurrency(record.licitado_value),         // VALOR LICITADO
    formatDate(record.vigencia_date),              // VIGÊNCIA PT
    record.portaria_number ?? "",                  // PORTARIA
  ];
}

/**
 * Garante que o cabeçalho existe na primeira linha da aba.
 * Se a aba estiver vazia, escreve os cabeçalhos.
 */
async function ensureHeaders(sheets) {
  const range = `'${SHEET_NAME}'!A1:I1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });

  const firstRow = res.data.values?.[0] ?? [];
  if (firstRow.length === 0 || firstRow[0] !== "SGPE") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] },
    });
    console.log("✅ Cabeçalhos gravados na planilha.");
  }
}

/**
 * Lê todas as linhas existentes e retorna um Map de process_number → rowIndex (1-based).
 * A linha 1 é o cabeçalho, dados começam na linha 2.
 */
async function buildProcessIndex(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:A`,
    valueRenderOption: "FORMULA",
  });

  const rows = res.data.values ?? [];
  const index = new Map();

  for (let i = 1; i < rows.length; i++) {
    const cellValue = rows[i]?.[0] ?? "";
    // Extrai o número do processo tanto de texto simples quanto de fórmula HYPERLINK
    const match = cellValue.match(/HYPERLINK\("[^"]+","([^"]+)"\)/) 
      || cellValue.match(/^(.+)$/);
    if (match) {
      index.set(match[1].trim(), i + 1); // rowIndex é 1-based
    }
  }

  return index;
}

/**
 * Faz upsert de um único processo na planilha:
 * - Se já existe uma linha com o mesmo SGPE → atualiza
 * - Se não existe → adiciona no final
 */
async function upsertProcess(record) {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  await ensureHeaders(sheets);

  const row = recordToRow(record);
  const processNumber = record.process_number;

  const index = await buildProcessIndex(sheets);

  if (index.has(processNumber)) {
    // ── ATUALIZAÇÃO ──────────────────────────────────────────
    const rowNumber = index.get(processNumber);
    const range = `'${SHEET_NAME}'!A${rowNumber}:I${rowNumber}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    console.log(`✏️  Processo ${processNumber} atualizado na linha ${rowNumber}.`);
  } else {
    // ── INSERÇÃO ─────────────────────────────────────────────
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A:I`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    console.log(`➕ Processo ${processNumber} inserido na planilha.`);
  }
}

module.exports = { upsertProcess };
