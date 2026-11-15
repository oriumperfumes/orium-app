/**
 * Dados do responsavel que aparecem nas paginas de Privacidade e Termos.
 * NAO invente valores: preencha com os dados reais antes de publicar (LEGAL_DRAFT em LegalPage.tsx).
 */
export const LEGAL = {
  /** Nome ou razao social de quem opera a loja */
  responsavel: "ORIUM PERFUMES LTDA",
  /** CNPJ ou CPF */
  documento: "67.753.866/0001-44",
  /** Endereco da loja / ponto de retirada (hoje: Itaguai, RJ) */
  endereco: "Avenida Nilo Peçanha, 156, Centro, Itaguaí/RJ, CEP 23810-505",
  /** Canal para pedidos sobre dados pessoais (LGPD) */
  contatoDados: "oriumperfumesrj@gmail.com",
  /** WhatsApp ja usado no site */
  whatsapp: "(21) 97717-4508",
  site: "https://oriumperfumes.com",
} as const;

export const LEGAL_UPDATED = "15/11/2026";
