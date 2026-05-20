require("dotenv").config();

const { fetchProcessById } = require("./supabase");
const { upsertProcessGeinfra } = require("./sheets");

async function main() {
  const processId = process.env.PROCESS_ID;

  if (!processId) {
    console.error("❌ Variável de ambiente PROCESS_ID não definida.");
    process.exit(1);
  }

  console.log(`🔄 Sincronizando processo ID: ${processId}`);

  try {
    const record = await fetchProcessById(processId);

    if (!record) {
      console.error(`❌ Processo ${processId} não encontrado no Supabase.`);
      process.exit(1);
    }

    console.log(`📋 SGPE: ${record.process_number} | Município: ${record.municipalities?.name}`);

    await upsertProcessGeinfra(record);

    console.log(`✅ Processo ${record.process_number} sincronizado com sucesso.`);
  } catch (err) {
    console.error(`❌ Erro ao sincronizar processo ${processId}:`, err.message);
    process.exit(1);
  }
}

main();
