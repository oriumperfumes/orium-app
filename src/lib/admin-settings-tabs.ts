/** Categorias existentes em Admin → Configurações. Não criar abas vazias. */
export const SETTINGS_TABS = [
  { id: "entregas", label: "Entregas", description: "Origem, retirada, frete e embalagens." },
  { id: "equipe", label: "Equipe", description: "Quem acessa o painel Admin: donos e admins." },
  { id: "integracoes", label: "Integrações", description: "Conexões externas já disponíveis." },
  { id: "ia", label: "Inteligência Artificial", description: "OpenAI, modelos, consumo e Copilot." },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
export type AiSection = "openai" | "copilot";
export type SettingsSearch = { aba?: SettingsTab; secao?: AiSection };

export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const tab = SETTINGS_TABS.find((item) => item.id === search["aba"])?.id;
  const section = search["secao"] === "copilot" || search["secao"] === "openai"
    ? search["secao"] : undefined;

  // Links antigos com aba=vendas são tratados como categoria não reconhecida.
  // Links diretos anteriores do Copilot, sem aba, continuam indo para IA.
  if (tab === "ia" || (search["aba"] == null && section)) {
    return { aba: "ia", ...(section ? { secao: section } : {}) };
  }
  return tab ? { aba: tab } : {};
}
