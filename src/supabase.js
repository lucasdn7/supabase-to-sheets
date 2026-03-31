const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Busca um processo completo pelo ID, com joins nas tabelas de referência.
 */
async function fetchProcessById(id) {
  const { data, error } = await supabase
    .from("processes")
    .select(
      `
      id,
      process_number,
      object,
      total_concedent_value,
      total_proponente_value,
      licitado_value,
      vigencia_date,
      portaria_number,
      link_plataforma_governo,
      regional_nuclei!regional_nucleus_id ( acronym ),
      municipalities!municipality_id ( name )
    `
    )
    .eq("id", id)
    .single();

  if (error) throw new Error(`Erro ao buscar processo ${id}: ${error.message}`);
  return data;
}

/**
 * Busca todos os processos (usado para sincronização completa se necessário).
 */
async function fetchAllProcesses() {
  const { data, error } = await supabase
    .from("processes")
    .select(
      `
      id,
      process_number,
      object,
      total_concedent_value,
      total_proponente_value,
      licitado_value,
      vigencia_date,
      portaria_number,
      link_plataforma_governo,
      regional_nuclei!regional_nucleus_id ( acronym ),
      municipalities!municipality_id ( name )
    `
    )
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erro ao buscar processos: ${error.message}`);
  return data;
}

module.exports = { fetchProcessById, fetchAllProcesses };
