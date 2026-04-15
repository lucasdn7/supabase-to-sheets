require("dotenv").config();

const { fetchAllProcesses } = require("./supabase");
const { upsertProcess } = require("./sheets");

async function main() {
  console.log("🔄 Iniciando sincronização completa Supabase → Google Sheets...");

  const processes = await fetchAllProcesses();
  console.log(`📦 ${processes.length} processo(s) encontrado(s).`);

  let successCount = 0;
  let errorCount = 0;

  for (const process of processes) {
    try {
      await upsertProcess(process);
      successCount += 1;
    } catch (err) {
      errorCount += 1;
      console.error(
        `❌ Falha ao sincronizar processo ID ${process.id} (SGPE: ${process.process_number}): ${err.message}`
      );
    }
  }

  console.log(
    `✅ Sincronização concluída. Sucesso: ${successCount} | Falhas: ${errorCount}`
  );
  if (errorCount > 0) {
    console.warn(
      "⚠️ A sincronização terminou com falhas parciais. Verifique os logs acima."
    );
  }
}

main().catch((err) => {
  console.error("❌ Erro fatal na sincronização:", err.message);
  process.exit(1);
});
