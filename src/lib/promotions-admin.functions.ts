/**
 * Edição de uma promoção já criada (Admin › Preços › Campanhas).
 *
 * Confirma a equipe no banco (is_staff, como as demais *.functions.ts) e grava com o cliente de serviço.
 * Regras conferidas aqui, não só na tela:
 *  - fim depois do começo;
 *  - desconto entre 0 e 90%;
 *  - preço final ("por") > 0 e menor que o preço cheio do frasco — vira o percentual exato (5 casas),
 *    o mesmo cálculo da criação, para o preço voltar exato ao centavo em `priceCart`.
 * A loja lê a linha atualizada direto (`public_promotions` / `loadActivePromotions`): nada mais a mudar.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type StaffCtx = {
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => PromiseLike<{ data: unknown }> };
  userId: string;
};

async function requireStaff(context: StaffCtx) {
  const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!isStaff) throw new Error("Sem permissão.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const text = (max: number) => z.string().trim().max(max).nullable();
const isoDate = z
  .string()
  .nullable()
  .refine((v) => v == null || !Number.isNaN(new Date(v).getTime()), "Data inválida.");

const EditPromotion = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome para a promoção.").max(80),
  applies_to: z.enum(["BOTH", "DECANT", "FULL"]),
  decant_sizes: z.array(z.number().int().positive()).max(10),
  product_ids: z.array(z.string().uuid()).max(500),
  /** usado quando não há preço final */
  discount_percent: z.number().positive().max(90),
  /** preço "por" (R$): só com exatamente um perfume; o servidor converte em percentual */
  final_price: z.number().positive().nullable(),
  starts_at: isoDate,
  ends_at: isoDate,
  active: z.boolean(),
  stackable: z.boolean(),
  app_exclusive: z.boolean(),
  app_badge_label: text(28),
  announce: z.boolean(),
  headline: text(120),
  cta_label: text(40),
  announce_title: text(160),
  announce_message: text(600),
  announce_cta: text(40),
  announce_footnote: text(200),
  announce_theme: z.string().max(20),
  /** "Mostrar de novo": o aviso volta a aparecer para quem já viu */
  show_again: z.boolean(),
  /** aplicar período e ativa/pausada às outras promoções com o mesmo nome (ex.: os 5 perfumes da Esquenta Black) */
  same_name_period: z.boolean(),
});

export type EditPromotionInput = z.infer<typeof EditPromotion>;

const pctFromPrice = (base: number, final: number) =>
  Math.round((1 - final / base) * 100 * 1e5) / 1e5;

export const adminUpdatePromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EditPromotion.parse(d))
  .handler(async ({ data, context }) => {
    const db = await requireStaff(context);

    const { data: current, error: readError } = await db
      .from("promotions")
      .select("id, name")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("Promoção não encontrada.");

    if (data.starts_at && data.ends_at && new Date(data.ends_at) <= new Date(data.starts_at)) {
      throw new Error("O fim precisa ser depois do começo.");
    }

    let percent = data.discount_percent;
    if (data.final_price != null) {
      if (data.product_ids.length !== 1) {
        throw new Error("Preço final só vale para promoção de um perfume. Use o percentual.");
      }
      const { data: product } = await db
        .from("products")
        .select("retail_price")
        .eq("id", data.product_ids[0]!)
        .maybeSingle();
      const base = Number(product?.retail_price ?? 0);
      if (!(base > 0)) throw new Error("Este perfume está sem preço de frasco.");
      if (!(data.final_price < base)) {
        throw new Error(
          `O preço final precisa ser menor que o preço cheio (R$ ${base.toFixed(2).replace(".", ",")}).`,
        );
      }
      percent = pctFromPrice(base, data.final_price);
      if (!(percent > 0 && percent <= 90)) throw new Error("O desconto deve ficar entre 1% e 90%.");
    }

    const { error } = await db
      .from("promotions")
      .update({
        name: data.name,
        applies_to: data.applies_to,
        decant_sizes: data.applies_to === "FULL" ? [] : data.decant_sizes,
        product_ids: data.product_ids,
        discount_percent: percent,
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        active: data.active,
        stackable: data.stackable,
        app_exclusive: data.app_exclusive,
        app_badge_label: data.app_badge_label || null,
        announce: data.announce,
        headline: data.headline || null,
        cta_label: data.cta_label || null,
        announce_title: data.announce_title || null,
        announce_message: data.announce_message || null,
        announce_cta: data.announce_cta || null,
        announce_footnote: data.announce_footnote || null,
        announce_theme: data.announce_theme,
        ...(data.show_again ? { announce_reset_at: new Date().toISOString() } : {}),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    let siblings = 0;
    if (data.same_name_period) {
      const { data: updated, error: sibError } = await db
        .from("promotions")
        .update({
          starts_at: data.starts_at,
          ends_at: data.ends_at,
          active: data.active,
          name: data.name,
        })
        .eq("name", current.name)
        .neq("id", data.id)
        .select("id");
      if (sibError) throw new Error(sibError.message);
      siblings = updated?.length ?? 0;
    }

    return { discount_percent: percent, siblings };
  });
