/**
 * NEGOCIAÇÃO — perfumes da própria Orium, deslacrados e praticamente cheios,
 * negociados um a um pelo WhatsApp.
 *
 * Estes itens são independentes do catálogo: não entram em estoque, reposição,
 * fornecedor, precificação, atacado nem decants, e nunca têm preço.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { productTitle } from "@/lib/format";

export const NEGOTIATION_WHATSAPP = "5521977174508";

export const NEGOTIATION_TAGLINE =
  "Perfumes deslacrados e praticamente cheios, disponíveis para negociar.";

export type NegotiationStatus = "AVAILABLE" | "NEGOTIATING" | "SOLD" | "HIDDEN";

export const NEGOTIATION_STATUS_LABEL: Record<NegotiationStatus, string> = {
  AVAILABLE: "Disponível",
  NEGOTIATING: "Negociando",
  SOLD: "Vendido",
  HIDDEN: "Oculto",
};

export type NegotiationNote = { level: "TOP" | "HEART" | "BASE" | "FLAT"; label: string };
export type NegotiationAccord = { name: string; intensity?: number | null };

export type NegotiationItem = {
  id: string;
  /** Ficha olfativa interna, no mesmo sistema dos perfumes do catálogo. */
  product_id: string | null;
  name: string;
  brand: string | null;
  volume_ml: number | null;
  description: string | null;
  condition_note: string;
  status: NegotiationStatus;
  show_when_negotiating: boolean;
  image_url: string | null;
  fragrantica_url: string | null;
  olfactory_family: string | null;
  accords: NegotiationAccord[];
  notes: NegotiationNote[];
  priority: number;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, product_id, name, brand, volume_ml, description, condition_note, status, show_when_negotiating, image_url, fragrantica_url, olfactory_family, accords, notes, priority, created_at, updated_at";

const parse = (row: Record<string, unknown>): NegotiationItem => ({
  ...(row as unknown as NegotiationItem),
  accords: Array.isArray(row["accords"]) ? (row["accords"] as NegotiationAccord[]) : [],
  notes: Array.isArray(row["notes"]) ? (row["notes"] as NegotiationNote[]) : [],
});

/** Foto real do item: caminho no armazenamento privado servido por rota pública. */
/**
 * URL da foto. `variant: "card"` pede a versão leve do carrossel; quando ela
 * não existe (fotos antigas), quem serve devolve a principal.
 */
export function negotiationPhoto(
  path: string | null | undefined,
  variant: "full" | "card" = "full",
): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const wanted = variant === "card" ? path.replace(/\.webp$/i, "-card.webp") : path;
  return `/api/public/negociacao-foto?path=${encodeURIComponent(wanted)}`;
}


export function negotiationWhatsappLink(
  item: Pick<NegotiationItem, "id" | "name">,
  customerName?: string | null,
) {
  const name = (customerName ?? "").trim();
  const hello = name ? `Olá! Meu nome é ${name}.` : "Olá!";
  const text = `${hello} Vi o ${productTitle(item.name)} na área de Negociação da Orium e queria saber se ele ainda está disponível e qual valor conseguimos negociar.`;
  return `https://wa.me/${NEGOTIATION_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

export const NOTE_LEVEL_LABEL: Record<NegotiationNote["level"], string> = {
  TOP: "Notas de topo",
  HEART: "Notas de coração",
  BASE: "Notas de fundo",
  FLAT: "Notas",
};

/** Lista pública: só o que a regra de visibilidade do banco permite mostrar. */
export function useNegotiationItems(limit = 12) {
  const query = useQuery({
    queryKey: ["negotiation-public", limit],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_items")
        .select(COLUMNS)
        .in("status", ["AVAILABLE", "NEGOTIATING"])
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r) => parse(r as Record<string, unknown>));
    },
  });
  return { items: query.data ?? [], isLoading: query.isLoading };
}

/** Ficha pública de um item negociável. */
export function useNegotiationItem(id: string) {
  return useQuery({
    queryKey: ["negotiation-item", id],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiation_items")
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? parse(data as Record<string, unknown>) : null;
    },
  });
}
