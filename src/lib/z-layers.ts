/**
 * Hierarquia única de camadas da loja. Sempre usar estes números — nunca
 * z-index solto (z-50, z-999) espalhado pelos componentes.
 *
 * conteúdo (0) → header (40) → barra encaixada (30/45) → prévia da busca (60/61)
 * → sheets/modais do Radix (50) fecham a prévia antes de abrir.
 */
export const Z = {
  content: 0,
  floatingCart: 50,
  bottomNav: 40,
  header: 40,
  searchDock: 45,
  searchBackdrop: 60,
  searchPanel: 61,
  /** Copilot: acima do conteúdo e do drawer (50); seus diálogos usam Radix (50+ via portal) */
  copilot: 55,
} as const;
