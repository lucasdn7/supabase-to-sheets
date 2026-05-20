const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PROCESS_SELECT = `
  id,
  process_number,
  object,
  tipo_de_repasse,
  total_concedente_value,
  total_proponente_value,
  licitado_value,
  vigencia_date,
  portaria_number,
  contrato_assinado,
  link_plataforma_governo,
  regional_nuclei!regional_nucleus_id ( acronym ),
  municipalities!municipality_id ( name )
`;

/**
 * Busca um processo completo pelo ID, com joins nas tabelas de referência.
 */
async function fetchProcessById(id) {
  const { data, error } = await supabase
    .from("processes")
    .select(PROCESS_SELECT)
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
    .select(PROCESS_SELECT)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erro ao buscar processos: ${error.message}`);
  return data;
}

module.exports = { fetchProcessById, fetchAllProcesses };
