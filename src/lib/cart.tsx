/**
 * Carrinho da Orium.
 * - guardado no navegador (volta depois de atualizar a página);
 * - quando o cliente está logado, também é salvo na conta e sincronizado ao entrar;
 * - frascos: de 1 a 5 unidades = varejo; 6 ou mais = atacado em todos os frascos;
 * - decants: preço fixo por tamanho (2ml, 5ml, 10ml), cada tamanho é um item próprio;
 * - promoções e cupons: valor exibido é sempre confirmado pelo servidor.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { variantKey, type DecantMl } from "@/lib/decants";
import { useDecantCombos, usePromotions } from "@/lib/use-promotions";
import { applyDecantCombos, type ComboApplied, type ComboProgress } from "@/lib/decant-combos";
import { deviceId, money, priceUnit, type Promotion } from "@/lib/promotions";
import { quoteCart } from "@/lib/promotions.functions";
import type { CouponFeedback } from "@/lib/promotions.server";
import { usePublicPricingSettings } from "@/lib/pricing-settings";
import { track } from "@/lib/analytics";
import { toast } from "sonner";
import { ORIUM_WHATSAPP } from "@/lib/price-on-request";

function warnOnRequest() {
  toast("Preços sob consulta", {
    description: "Fale com a Orium pelo WhatsApp para saber o preço e fazer o pedido.",
    action: {
      label: "WhatsApp",
      onClick: () => {
        window.open(`https://wa.me/${ORIUM_WHATSAPP}?text=${encodeURIComponent("Oi, Orium! Queria saber os preços 😊")}`, "_blank", "noopener");
      },
    },
  });
}

const KEY = "orium-cart";
const COUPON_KEY = "orium-coupon";
const SAVED_COUPON_KEY = "orium-coupon-saved";

export type CartVariant = "FULL" | "DECANT";

export type CartItem = {
  /** productId + variante — identidade real do SKU no carrinho */
  key: string;
  productId: string;
  variant: CartVariant;
  decantMl: DecantMl | null;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  volumeMl: number | null;
  concentration: string | null;
  /** frasco: varejo/atacado · decant: preço fixo do tamanho (nos dois campos) */
  retailPrice: number;
  wholesalePrice: number;
  quantity: number;
};

export type CartItemInput = Omit<CartItem, "quantity" | "key" | "variant" | "decantMl"> & {
  variant?: CartVariant;
  decantMl?: DecantMl | null;
};

type CartContext = {
  items: CartItem[];
  decants: CartItem[];
  bottles: CartItem[];
  totalQuantity: number;
  /** só frascos contam para o atacado */
  bottleQuantity: number;
  decantQuantity: number;
  tier: "varejo" | "atacado";
  minQty: number;
  missingForWholesale: number;
  /** soma dos preços cheios, sem desconto */
  subtotal: number;
  promotionDiscount: number;
  couponDiscount: number;
  /** total a pagar nos produtos (já com promoção e cupom) */
  total: number;
  decantTotal: number;
  bottleTotal: number;
  retailTotal: number;
  savings: number;
  /** preço unitário depois da promoção */
  unitPrice: (item: CartItem) => number;
  /** preço cheio unitário (antes da promoção) */
  baseUnitPrice: (item: CartItem) => number;
  /** total da linha: preço × quantidade, já descontado o combo de decants */
  lineTotal: (item: CartItem) => number;
  /** preço médio unitário da linha com o combo (é o que o servidor confere) */
  finalUnitPrice: (item: CartItem) => number;
  /** economia do combo de decants nesta linha */
  comboOf: (item: CartItem) => number;
  /** quanto os combos de decants economizam no carrinho */
  comboDiscount: number;
  comboApplied: ComboApplied[];
  /** quanto falta para fechar o próximo combo */
  comboProgress: ComboProgress[];
  promotionOf: (item: CartItem) => Promotion | null;
  quantityOf: (productId: string, variant?: CartVariant, decantMl?: DecantMl | null) => number;
  add: (item: CartItemInput, quantity?: number) => void;
  addMany: (items: Array<{ item: CartItemInput; quantity: number }>) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** cupom em uso no carrinho */
  couponCode: string | null;
  couponFeedback: CouponFeedback;
  couponPending: boolean;
  applyCoupon: (code: string) => void;
  removeCoupon: () => void;
  /** cupom recebido em campanha e guardado para usar depois */
  savedCoupon: string | null;
  saveCoupon: (code: string) => void;
  quoting: boolean;
};

const Ctx = createContext<CartContext | null>(null);

/** Itens antigos (sem variante) viram frascos; nada é perdido. */
const normalize = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.productId === "string" && Number(i.quantity) > 0)
    .map((i) => {
      const variant: CartVariant = i.variant === "DECANT" ? "DECANT" : "FULL";
      const decantMl = variant === "DECANT" ? (Number(i.decantMl) as DecantMl) : null;
      return { ...i, variant, decantMl, key: variantKey(i.productId, variant, decantMl) } as CartItem;
    });
};

const read = (): CartItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
};

const readString = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeString = (key: string, value: string | null) => {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* modo privado */
  }
};

export function CartProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [savedCoupon, setSavedCoupon] = useState<string | null>(null);
  const promotions = usePromotions();
  const quote = useServerFn(quoteCart);

  useEffect(() => {
    setItems(read());
    setCouponCode(readString(COUPON_KEY));
    setSavedCoupon(readString(SAVED_COUPON_KEY));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* modo privado: segue só em memória */
    }
  }, [items, hydrated]);

  // conta logada: o carrinho acompanha o cliente entre dispositivos
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!hydrated || !userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("cart").eq("id", userId).maybeSingle();
      const remote = normalize((data as { cart?: unknown } | null)?.cart);
      if (!cancelled && remote.length && items.length === 0) setItems(remote);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hydrated]);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const t = setTimeout(() => {
      void supabase.from("profiles").update({ cart: items as never }).eq("id", userId);
    }, 600);
    return () => clearTimeout(t);
  }, [items, userId, hydrated]);

  const { data: settings } = usePublicPricingSettings();
  const minQty = settings?.wholesale_min_quantity ?? 6;

  const bottles = useMemo(() => items.filter((i) => i.variant === "FULL"), [items]);
  const decants = useMemo(() => items.filter((i) => i.variant === "DECANT"), [items]);

  const bottleQuantity = bottles.reduce((s, i) => s + i.quantity, 0);
  const decantQuantity = decants.reduce((s, i) => s + i.quantity, 0);
  const totalQuantity = bottleQuantity + decantQuantity;
  const tier: "varejo" | "atacado" = bottleQuantity >= minQty ? "atacado" : "varejo";

  const baseUnitPrice = useCallback(
    (item: CartItem) => {
      if (item.variant === "DECANT") return item.retailPrice || 0;
      return (bottleQuantity >= minQty ? item.wholesalePrice : item.retailPrice) || 0;
    },
    [bottleQuantity, minQty],
  );

  const promotionOf = useCallback(
    (item: CartItem) =>
      priceUnit(baseUnitPrice(item), promotions, {
        productId: item.productId,
        variant: item.variant,
        decantMl: item.decantMl,
      }).promotion,
    [baseUnitPrice, promotions],
  );

  const unitPrice = useCallback(
    (item: CartItem) =>
      priceUnit(baseUnitPrice(item), promotions, {
        productId: item.productId,
        variant: item.variant,
        decantMl: item.decantMl,
      }).finalPrice,
    [baseUnitPrice, promotions],
  );

  // combos de decants ("leve 3 por R$ 100"): mesma regra que o servidor confirma
  const combos = useDecantCombos();
  const comboResult = useMemo(
    () =>
      applyDecantCombos(
        items.map((i) => ({ key: i.key, variant: i.variant, ml: i.decantMl, unit: unitPrice(i), quantity: i.quantity })),
        combos,
      ),
    [items, combos, unitPrice],
  );
  const comboOf = useCallback((item: CartItem) => comboResult.byLine.get(item.key) ?? 0, [comboResult]);
  const lineTotal = useCallback(
    (item: CartItem) => money(unitPrice(item) * item.quantity - comboOf(item)),
    [unitPrice, comboOf],
  );
  const finalUnitPrice = useCallback(
    (item: CartItem) => money(lineTotal(item) / Math.max(1, item.quantity)),
    [lineTotal],
  );

  const bottleTotal = money(bottles.reduce((s, i) => s + unitPrice(i) * i.quantity, 0));
  const decantTotal = money(decants.reduce((s, i) => s + lineTotal(i), 0));
  const subtotal = money(items.reduce((s, i) => s + baseUnitPrice(i) * i.quantity, 0));
  const afterPromotions = money(bottleTotal + decantTotal);
  const promotionDiscount = money(Math.max(0, subtotal - afterPromotions));
  const retailTotal = money(items.reduce((s, i) => s + (i.retailPrice || 0) * i.quantity, 0));

  // confirmação oficial de promoção + cupom no servidor
  const quoteKey = useMemo(
    () => items.map((i) => `${i.key}x${i.quantity}`).join("|"),
    [items],
  );
  const { data: quoted, isFetching: quoting } = useQuery({
    queryKey: ["cart-quote", quoteKey, couponCode ?? "", userId ?? ""],
    enabled: hydrated && items.length > 0,
    staleTime: 20_000,
    queryFn: () =>
      quote({
        data: {
          items: items.map((i) => ({
            productId: i.productId,
            variant: i.variant,
            decantMl: i.decantMl,
            quantity: i.quantity,
          })),
          couponCode,
          userId,
          deviceId: deviceId(),
        },
      }),
  });

  const couponDiscount = quoted?.couponDiscount ?? 0;
  const couponFeedback: CouponFeedback = quoted?.coupon ?? { status: "NONE" };
  const total = money(Math.max(0, afterPromotions - couponDiscount));
  const savings = money(Math.max(0, retailTotal - total));

  const merge = (prev: CartItem[], input: CartItemInput, quantity: number): CartItem[] => {
    const variant = input.variant ?? "FULL";
    const decantMl = variant === "DECANT" ? (input.decantMl ?? null) : null;
    const key = variantKey(input.productId, variant, decantMl);
    const hit = prev.find((i) => i.key === key);
    const { variant: _v, decantMl: _d, ...rest } = input;
    if (hit) {
      return prev.map((i) => (i.key === key ? { ...i, ...rest, quantity: Math.min(999, i.quantity + quantity) } : i));
    }
    return [...prev, { ...rest, key, variant, decantMl, quantity }];
  };

  /** Registro da jornada: sempre em segundo plano, nunca atrasa o carrinho. */
  const trackAdd = (item: CartItemInput, quantity: number) => {
    const variant = item.variant ?? "FULL";
    track("cart_item_added", {
      productId: item.productId,
      variant,
      decantMl: variant === "DECANT" ? (item.decantMl ?? null) : null,
      price: item.retailPrice ?? null,
      meta: { quantity },
    });
  };

  // Admin → Precificação → "Preços sob consulta": nada entra na sacola.
  const onRequestAll = settings?.prices_on_request === true;

  const add: CartContext["add"] = useCallback(
    (item, quantity = 1) => {
      if (onRequestAll) return warnOnRequest();
      setItems((prev) => merge(prev, item, quantity));
      trackAdd(item, quantity);
    },
    [onRequestAll],
  );

  const addMany: CartContext["addMany"] = useCallback(
    (list) => {
      if (onRequestAll) return warnOnRequest();
      setItems((prev) => list.reduce((acc, { item, quantity }) => merge(acc, item, quantity), prev));
      list.forEach(({ item, quantity }) => trackAdd(item, quantity));
    },
    [onRequestAll],
  );

  const applyCoupon = useCallback((code: string) => {
    const clean = code.trim().toUpperCase();
    setCouponCode(clean || null);
    writeString(COUPON_KEY, clean || null);
  }, []);

  const removeCoupon = useCallback(() => {
    setCouponCode(null);
    writeString(COUPON_KEY, null);
  }, []);

  const saveCoupon = useCallback((code: string) => {
    const clean = code.trim().toUpperCase();
    setSavedCoupon(clean || null);
    writeString(SAVED_COUPON_KEY, clean || null);
  }, []);

  const value = useMemo<CartContext>(
    () => ({
      items,
      decants,
      bottles,
      totalQuantity,
      bottleQuantity,
      decantQuantity,
      tier,
      minQty,
      missingForWholesale: Math.max(0, minQty - bottleQuantity),
      subtotal,
      promotionDiscount,
      couponDiscount,
      total,
      decantTotal,
      bottleTotal,
      retailTotal,
      savings,
      unitPrice,
      baseUnitPrice,
      lineTotal,
      finalUnitPrice,
      comboOf,
      comboDiscount: comboResult.total,
      comboApplied: comboResult.applied,
      comboProgress: comboResult.progress,
      promotionOf,
      quantityOf: (productId, variant = "FULL", decantMl = null) =>
        items.find((i) => i.key === variantKey(productId, variant, decantMl))?.quantity ?? 0,
      add,
      addMany,
      setQuantity: (key, quantity) =>
        setItems((prev) =>
          quantity <= 0
            ? prev.filter((i) => i.key !== key)
            : prev.map((i) => (i.key === key ? { ...i, quantity: Math.min(999, quantity) } : i)),
        ),
      remove: (key) => setItems((prev) => prev.filter((i) => i.key !== key)),
      clear: () => setItems([]),
      open,
      setOpen: (v: boolean) => {
        if (v && !open) track("cart_opened", { price: total, meta: { items: totalQuantity } });
        setOpen(v);
      },
      couponCode,
      couponFeedback,
      couponPending: quoting && !!couponCode,
      applyCoupon,
      removeCoupon,
      savedCoupon,
      saveCoupon,
      quoting,
    }),
    [
      items,
      decants,
      bottles,
      totalQuantity,
      bottleQuantity,
      decantQuantity,
      tier,
      minQty,
      subtotal,
      promotionDiscount,
      couponDiscount,
      total,
      decantTotal,
      bottleTotal,
      retailTotal,
      savings,
      unitPrice,
      baseUnitPrice,
      lineTotal,
      finalUnitPrice,
      comboOf,
      comboResult,
      promotionOf,
      add,
      addMany,
      open,
      couponCode,
      couponFeedback,
      quoting,
      applyCoupon,
      removeCoupon,
      savedCoupon,
      saveCoupon,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart precisa estar dentro de CartProvider");
  return ctx;
}
