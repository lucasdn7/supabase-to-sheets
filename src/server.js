require("dotenv").config();

const express = require("express");
const { fetchProcessById } = require("./supabase");
const { upsertProcess } = require("./sheets");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// ── Middleware de autenticação via secret header ────────────────────────────
function validateSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return next(); // sem secret configurado, permite tudo (não recomendado)

  const incoming = req.headers["x-webhook-secret"];
  if (incoming !== WEBHOOK_SECRET) {
    console.warn("⚠️  Webhook recebido com secret inválido.");
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Health check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "supabase-to-sheets webhook server" });
});

// ── Endpoint principal do Webhook ───────────────────────────────────────────
// Configura no Supabase: Database → Webhooks → apontar para /webhook/process
// Disparar nos eventos: INSERT e UPDATE na tabela "processes"
app.post("/webhook/process", validateSecret, async (req, res) => {
  const payload = req.body;

  // O Supabase envia { type: "INSERT"|"UPDATE"|"DELETE", record: {...}, old_record: {...} }
  const eventType = payload?.type;
  const record = payload?.record;

  if (!record?.id) {
    console.warn("⚠️  Payload inválido recebido:", JSON.stringify(payload));
    return res.status(400).json({ error: "Payload inválido" });
  }

  if (eventType === "DELETE") {
    // Opcional: registrar no log, mas não removemos da planilha automaticamente
    console.log(`🗑️  Evento DELETE recebido para ID ${record.id} — ignorado.`);
    return res.json({ status: "ignored", reason: "DELETE not handled" });
  }

  console.log(`📥 Evento ${eventType} recebido para processo ID: ${record.id}`);

  try {
    // Busca o registro completo com os joins (nucleus + municipality)
    const fullRecord = await fetchProcessById(record.id);

    // Faz upsert na planilha
    await upsertProcess(fullRecord);

    return res.json({
      status: "success",
      event: eventType,
      process_number: fullRecord.process_number,
    });
  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Inicia o servidor ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Endpoint webhook: POST /webhook/process`);
  console.log(`   Health check:     GET  /`);
});
