import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/orium/AdminShell";
import { optimizeExistingProductImages } from "@/lib/image-pipeline";
import { listImagesToOptimize } from "@/lib/image-pipeline.functions";
import { AdminEmpty, AdminMore, AdminRowsSkeleton, type AdminAction } from "@/components/orium/admin/AdminUI";
import {
  ActiveFilterChips,
  BulkBar,
  ProductFiltersSheet,
  ProductListCard,
  type ProductFilterState,
  type ProductOrder,
} from "@/components/orium/admin/ProductBits";
import { ProductEditSheet, type EditableProduct } from "@/components/orium/admin/ProductEditSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dateBR } from "@/lib/format";
import { TYPE_LABEL, GENDER_LABEL, type ProductType, type Gender } from "@/lib/catalog/classify";
import {
  setProductsBrand,
  bulkCatalogExclusion,
  setProductVisibility,
  deleteCatalogProduct,
  hardDeleteProducts,
  listCatalogBlocklist,
  removeCatalogBlock,
} from "@/lib/admin-catalog.functions";
import { backfillFragranceDetails, reprocessFragranticaV2 } from "@/lib/fragrance.functions";
import { FragranceAuditPanel } from "@/components/orium/FragranceAuditPanel";
import { FragranticaHealthPanel } from "@/components/orium/FragranticaHealthPanel";
import { FragranticaEnginePanel } from "@/components/orium/FragranticaEnginePanel";
import { FragranceStatus } from "@/components/orium/FragranceStatus";
import { IdentityReviewPanel } from "@/components/orium/IdentityReviewPanel";
import { CatalogHygienePanel } from "@/components/orium/CatalogHygienePanel";
import { ManualProductSheet } from "@/components/orium/ManualProductSheet";
import { usePromotions } from "@/lib/use-promotions";
import { priceUnit } from "@/lib/promotions";
import { QuickEditSheet, type QuickKind, type AvailMode } from "@/components/orium/admin/ProductOps";
import { productSetAvailability, productsResetPrice } from "@/lib/product-admin.functions";

/* ------------------------------------------------------------------ *
 * CENTRAL DE MANUTENÇÃO DO CATÁLOGO
 * Buscar → identificar → editar → filtrar → corrigir → agir em massa.
 * Toda a inteligência (canonicalização, sync, duplicados, travas manuais,
 * Fragrantica, precificação) continua igual: aqui só a interface muda.
 * ------------------------------------------------------------------ */

/** Motivos de revisão — usados só dentro da visão "Revisar". */
export const FILTERS = {
  todos: "Todos os produtos",
  revisar: "Precisa revisão",
  "sem-preco": "Sem preço",
  "sem-marca": "Sem marca",
  "sem-tipo": "Sem tipo",
  "sem-genero": "Sem gênero",
  "sem-imagem": "Sem imagem",
  duplicados: "Possível duplicado",
  "preco-suspeito": "Preço suspeito",
  "nome-suspeito": "Nome suspeito",
  "marca-suspeita": "Revisar marca",
  "identidade-pendente": "Identidade não resolvida",
  "piramide-incompleta": "Pirâmide incompleta",
  "sem-acordes": "Sem acordes",
  "importacao-parcial": "Importação incompleta",
  "sem-descricao": "Sem descrição olfativa",
  "olfativo-revisar": "Conferir na Fragrantica",
} as const;

export type MaintenanceFilter = keyof typeof FILTERS;

const OPS_LABEL: Record<NonNullable<ProductFilterState["ops"]>, string> = {
  pronta: "Pronta entrega",
  "sem-local": "Sem estoque local",
  encomenda: "Sob encomenda",
  manual: "Disponibilidade manual",
  "preco-manual": "Preço manual",
};

/** Motivos mostrados como atalho na visão Revisar. */
const REVIEW_REASONS: MaintenanceFilter[] = [
  "sem-marca",
  "sem-tipo",
  "duplicados",
  "sem-imagem",
  "sem-preco",
  "preco-suspeito",
  "identidade-pendente",
  "olfativo-revisar",
];

type SearchParams = {
  filtro?: MaintenanceFilter | undefined;
  q?: string | undefined;
  vista?: Vista | undefined;
};

type Vista = "todos" | "disponiveis" | "indisponiveis" | "revisar";

/** Sigla curta e estável do fornecedor. */
export function supplierAbbrev(name: string) {
  const n = (name ?? "").toLowerCase();
  if (n.includes("mrx")) return "MRX";
  if (n.includes("smart")) return "SMR";
  const letters = (name ?? "").replace(/[^a-zA-ZÀ-ÿ]/g, "");
  return letters.slice(0, 3).toUpperCase() || "FOR";
}

export const Route = createFileRoute("/_authenticated/admin/produtos")({
  head: () => ({
    meta: [
      { title: "Produtos — Orium Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    filtro: (search["filtro"] as MaintenanceFilter) ?? undefined,
    q: typeof search["q"] === "string" ? search["q"] : undefined,
    vista: (["todos", "disponiveis", "indisponiveis", "revisar"] as string[]).includes(String(search["vista"]))
      ? (search["vista"] as Vista)
      : undefined,
  }),
  component: CatalogMaintenance,
});

type Product = EditableProduct & {
  local_stock: number;
  availability_override: string;
  availability_source: string;
  manual_pricing: boolean;
  brand_id: string | null;
  source: string | null;
  suspicious_price: boolean;
  brand_review_required: boolean;
  created_at: string | null;
};

type Offer = {
  id: string;
  product_id: string | null;
  supplier_id: string;
  supplier_product_name: string;
  supplier_sku: string | null;
  ean: string | null;
  price: number | null;
  in_stock: boolean;
};

/** Nome que provavelmente veio torto do fornecedor. */
export function suspiciousName(p: { canonical_name: string; raw_name: string | null }) {
  const n = p.canonical_name ?? "";
  if (n.length < 4 || n.length > 60) return true;
  if (/\d{4,}/.test(n)) return true;
  if (/(kit|promo|combo|atacado|frete|oferta|lacrado|original\s*100)/i.test(n)) return true;
  if (/[|/\\*#@]/.test(n)) return true;
  if (n === n.toUpperCase() && n.replace(/[^A-Z]/g, "").length > 12) return true;
  if (p.raw_name && n.trim().toLowerCase() === p.raw_name.trim().toLowerCase() && n.split(/\s+/).length > 6) return true;
  return false;
}

type Issue = {
  key: MaintenanceFilter;
  severity: 1 | 2 | 3;
  label: string;
  reason?: string;
  olfactory?: boolean;
};

/** Busca tolerante: "club d nuit" encontra "Club de Nuit". */
function fuzzyMatch(haystack: string, term: string) {
  const hay = haystack.toLowerCase();
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
}

const EMPTY_FILTERS: ProductFilterState = {
  brandId: undefined,
  type: undefined,
  gender: undefined,
  supplierId: undefined,
  stock: undefined,
  manualOnly: false,
  customPriceOnly: false,
  hiddenOnly: false,
  reviewOnly: false,
  order: "nome",
};

function CatalogMaintenance() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const promotions = usePromotions();

  const bulkExclusion = useServerFn(bulkCatalogExclusion);
  const hardDelete = useServerFn(hardDeleteProducts);
  const visibility = useServerFn(setProductVisibility);
  const remove = useServerFn(deleteCatalogProduct);
  const reprocess = useServerFn(reprocessFragranticaV2);
  const listToOptimize = useServerFn(listImagesToOptimize);

  const vista: Vista = search.vista ?? "todos";
  const reason: MaintenanceFilter = search.filtro ?? "todos";

  const [term, setTerm] = useState(search.q ?? "");
  const [filters, setFilters] = useState<ProductFilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editTab, setEditTab] = useState<"Geral" | "Olfativo">("Geral");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualId, setManualId] = useState<string | null>(null);
  const [brandBulkOpen, setBrandBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<"ocultar" | "publicar" | "excluir" | null>(null);
  const [hardOpen, setHardOpen] = useState(false);
  const [blocklistOpen, setBlocklistOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ id: string; name: string; kind: QuickKind } | null>(null);
  const [bulkAvail, setBulkAvail] = useState<AvailMode | "PRICE_AUTO" | null>(null);
  const setAvailFn = useServerFn(productSetAvailability);
  const resetPriceFn = useServerFn(productsResetPrice);
  const [limit, setLimit] = useState(60);

  const { data, isLoading } = useQuery({
    queryKey: ["maintenance-data"],
    queryFn: async () => {
      const [products, offers, brands, suppliers, costs, pyramid, overrides] = await Promise.all([
        supabase
          .from("products")
          .select(
            "id, canonical_name, raw_name, brand, brand_id, source, sale_mode, gender_norm, product_type, concentration, volume_ml, flanker, image_url, in_stock, stock_quantity, local_stock, availability_override, availability_source, manual_pricing, retail_price, wholesale_price, active, catalog_eligible, identity_status, identity_verified, canonical_identity_locked, brand_review_required, suspicious_price, search_aliases, created_at",
          )
          .order("canonical_name"),
        supabase
          .from("supplier_products")
          .select("id, product_id, supplier_id, supplier_product_name, supplier_sku, ean, price, in_stock"),
        supabase.from("brands").select("id, canonical_name").order("canonical_name"),
        supabase.from("suppliers").select("id, name"),
        supabase.from("product_costs").select("product_id, best_cost"),
        supabase
          .from("fragrance_pyramid_status")
          .select("product_id, status, locked, has_description, accords_count, top_count, heart_count, base_count"),
        supabase.from("pricing_overrides").select("product_id, fixed_retail_price"),
      ]);
      return {
        products: (products.data ?? []) as unknown as Product[],
        offers: (offers.data ?? []) as Offer[],
        brands: brands.data ?? [],
        suppliers: suppliers.data ?? [],
        costs: costs.data ?? [],
        pyramid: pyramid.data ?? [],
        overrides: overrides.data ?? [],
      };
    },
  });

  const products = data?.products ?? [];
  const brands = data?.brands ?? [];
  const suppliers = data?.suppliers ?? [];

  const customPriceIds = useMemo(
    () => new Set((data?.overrides ?? []).filter((o) => o.fixed_retail_price != null).map((o) => o.product_id)),
    [data],
  );

  const offersByProduct = useMemo(() => {
    const map = new Map<string, Offer[]>();
    for (const o of data?.offers ?? []) {
      if (!o.product_id) continue;
      map.set(o.product_id, [...(map.get(o.product_id) ?? []), o]);
    }
    return map;
  }, [data]);

  const pyramidById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["pyramid"][number]>();
    for (const row of data?.pyramid ?? []) if (row.product_id) map.set(row.product_id, row);
    return map;
  }, [data]);

  const { data: duplicates } = useQuery({
    queryKey: ["maintenance-duplicates"],
    queryFn: async () =>
      (
        await supabase
          .from("product_duplicates")
          .select("*")
          .eq("status", "pendente")
          .order("score", { ascending: false })
          .limit(60)
      ).data ?? [],
  });

  const duplicateIds = useMemo(
    () => new Set((duplicates ?? []).flatMap((d) => [d.product_a, d.product_b])),
    [duplicates],
  );

  /** Fonte única de verdade: os problemas de cada produto (regra inalterada). */
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const p of products) {
      const published = p.active && p.catalog_eligible;
      const perfume = published && p.product_type === "PERFUME";
      const f = pyramidById.get(p.id);
      const pyramidIncomplete = !f ? true : f.status === "completo" ? false : !f.top_count || !f.heart_count || !f.base_count;
      const list: Issue[] = [];
      const add = (key: MaintenanceFilter, severity: 1 | 2 | 3, label: string, reasonText?: string, olfactory?: boolean) =>
        list.push({ key, severity, label, ...(reasonText ? { reason: reasonText } : {}), ...(olfactory ? { olfactory } : {}) });

      const decantOnly = p.sale_mode === "DECANT";
      if (published && !decantOnly && !p.retail_price) add("sem-preco", 1, "Sem preço", "O cliente não consegue comprar.");
      if (p.suspicious_price) add("preco-suspeito", 1, "Preço suspeito", "O valor parece fora do padrão.");
      if (duplicateIds.has(p.id)) add("duplicados", 1, "Possível duplicado", "Pode estar aparecendo duas vezes na loja.");
      if (perfume && pyramidIncomplete) {
        const missing = [
          !f?.top_count ? "notas de saída" : null,
          !f?.heart_count ? "notas de coração" : null,
          !f?.base_count ? "notas de fundo" : null,
        ]
          .filter(Boolean)
          .join(", ");
        add("piramide-incompleta", 1, "Pirâmide incompleta", f ? `Faltando: ${missing}.` : "Nenhuma nota importada ainda.", true);
      }
      if (perfume && f?.status === "parcial")
        add("importacao-parcial", 1, "Importação incompleta", "Acordes encontrados, mas faltam notas.", true);
      if (perfume && !(f?.accords_count ?? 0)) add("sem-acordes", 2, "Sem acordes", "Nenhum acorde principal salvo.", true);
      if (perfume && !f?.locked && (!f || f.status === "revisar" || f.status === "nao_encontrado" || f.status === "pendente"))
        add("olfativo-revisar", 2, "Conferir na Fragrantica", "Os dados olfativos ainda não foram confirmados.", true);
      if (published && !p.brand_id) add("sem-marca", 2, "Sem marca", "O produto não aparece nos filtros por marca.");
      if (p.brand_review_required) add("marca-suspeita", 2, "Revisar marca");
      if (p.identity_status === "revisar") add("identidade-pendente", 2, "Identidade não resolvida");
      if (perfume && (!p.gender_norm || p.gender_norm === "UNKNOWN")) add("sem-genero", 2, "Sem gênero");
      if (published && !p.image_url) add("sem-imagem", 2, "Sem imagem");
      if (!p.product_type || p.product_type === "UNKNOWN") add("sem-tipo", 2, "Sem tipo");
      if (published && suspiciousName(p)) add("nome-suspeito", 2, "Nome suspeito");
      if (perfume && !f?.has_description) add("sem-descricao", 3, "Sem descrição olfativa", undefined, true);

      if (list.length) map.set(p.id, list.sort((a, b) => a.severity - b.severity));
    }
    return map;
  }, [products, duplicateIds, pyramidById]);

  const needsReview = useCallback(
    (id: string) => (issuesById.get(id) ?? []).some((i) => i.severity <= 2),
    [issuesById],
  );

  const counts = useMemo(() => {
    const available = products.filter((p) => p.active && p.catalog_eligible && p.in_stock).length;
    const unavailable = products.filter((p) => p.active && p.catalog_eligible && !p.in_stock).length;
    let review = 0;
    const byReason = new Map<MaintenanceFilter, number>();
    for (const [id, list] of issuesById) {
      if (needsReview(id)) review++;
      for (const key of new Set(list.map((i) => i.key))) byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    return { total: products.length, available, unavailable, review, byReason };
  }, [products, issuesById, needsReview]);

  /** Preço final que o cliente vê hoje (base → promoção). */
  const priceOf = useCallback(
    (p: Product) => {
      const base = p.retail_price == null ? null : Number(p.retail_price);
      if (base == null) return { price: null as number | null, from: null as number | null };
      const unit = priceUnit(base, promotions, { productId: p.id, variant: "FULL" });
      return { price: unit.finalPrice, from: unit.promotion ? unit.basePrice : null };
    },
    [promotions],
  );

  const filtered = useMemo(() => {
    const t = term.trim();
    let list = products.filter((p) => {
      const issues = issuesById.get(p.id) ?? [];
      const published = p.active && p.catalog_eligible;
      if (vista === "disponiveis" && !(published && p.in_stock)) return false;
      if (vista === "indisponiveis" && !(published && !p.in_stock)) return false;
      if (vista === "revisar" && !needsReview(p.id)) return false;
      if (vista === "revisar" && reason !== "todos" && !issues.some((i) => i.key === reason)) return false;
      if (vista !== "revisar" && reason !== "todos" && reason !== "revisar" && !issues.some((i) => i.key === reason)) return false;
      return true;
    });

    if (filters.brandId) list = list.filter((p) => p.brand_id === filters.brandId);
    if (filters.type) list = list.filter((p) => p.product_type === filters.type);
    if (filters.gender) list = list.filter((p) => p.gender_norm === filters.gender);
    if (filters.supplierId)
      list = list.filter((p) => (offersByProduct.get(p.id) ?? []).some((o) => o.supplier_id === filters.supplierId));
    if (filters.stock) list = list.filter((p) => (filters.stock === "em" ? p.in_stock : !p.in_stock));
    if (filters.ops === "pronta") list = list.filter((p) => p.in_stock && (p.availability_source === "local" || p.availability_source === "manual"));
    if (filters.ops === "sem-local") list = list.filter((p) => (p.local_stock ?? 0) <= 0);
    if (filters.ops === "encomenda") list = list.filter((p) => p.availability_source === "supplier");
    if (filters.ops === "manual") list = list.filter((p) => p.availability_override !== "none");
    if (filters.ops === "preco-manual") list = list.filter((p) => customPriceIds.has(p.id) || p.manual_pricing);
    if (filters.manualOnly) list = list.filter((p) => p.source === "manual");
    if (filters.customPriceOnly) list = list.filter((p) => customPriceIds.has(p.id));
    if (filters.hiddenOnly) list = list.filter((p) => !(p.active && p.catalog_eligible));
    if (filters.reviewOnly) list = list.filter((p) => needsReview(p.id));

    if (t) {
      list = list.filter((p) => {
        const own = [p.canonical_name, p.raw_name, p.brand, ...(p.search_aliases ?? [])].filter(Boolean).join(" ");
        if (fuzzyMatch(own, t)) return true;
        return (offersByProduct.get(p.id) ?? []).some((o) =>
          fuzzyMatch([o.supplier_product_name, o.supplier_sku, o.ean].filter(Boolean).join(" "), t),
        );
      });
    }

    const order: ProductOrder = filters.order;
    if (order !== "nome") {
      const dir = order === "preco-asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (order === "recentes") return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
        if (order === "estoque") return (b.stock_quantity ?? (b.in_stock ? 1 : 0)) - (a.stock_quantity ?? (a.in_stock ? 1 : 0));
        const va = a.retail_price == null ? null : Number(a.retail_price);
        const vb = b.retail_price == null ? null : Number(b.retail_price);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va - vb) * dir;
      });
    }
    return list;
  }, [products, vista, reason, term, filters, issuesById, offersByProduct, customPriceIds, needsReview]);

  const rows = filtered.slice(0, limit);
  const allSelected = filtered.length > 0 && selected.length >= filtered.length;

  const setVista = (v: Vista) =>
    navigate({
      search: () => ({ ...(v === "todos" ? {} : { vista: v }), ...(term ? { q: term } : {}) }),
    });

  const setReason = (r: MaintenanceFilter) =>
    navigate({ search: (prev) => ({ ...prev, filtro: r === "todos" ? undefined : r }) });

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    navigate({ search: () => ({}) });
  };

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusyId(null);
    }
  };

  const applyBulk = async (mode: "ocultar" | "publicar" | "excluir") => {
    setBulkBusy(true);
    try {
      const r = await bulkExclusion({
        data: {
          productIds: selected,
          mode: mode === "publicar" ? "restaurar" : mode,
          ...(mode === "excluir" ? { blockBrands: true } : {}),
        },
      });
      toast.success(`${r.updated} produto${r.updated === 1 ? "" : "s"} atualizado${r.updated === 1 ? "" : "s"}.`);
      setBulkAction(null);
      setSelected([]);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir agora.");
    } finally {
      setBulkBusy(false);
    }
  };

  const applyHardDelete = async () => {
    setBulkBusy(true);
    try {
      const r = await hardDelete({ data: { productIds: selected } });
      toast.success(`${r.deleted} produto${r.deleted === 1 ? "" : "s"} excluído${r.deleted === 1 ? "" : "s"}.`);
      setHardOpen(false);
      setSelected([]);
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir agora.");
    } finally {
      setBulkBusy(false);
    }
  };

  const onCheck = useCallback(
    (id: string, v: boolean) => setSelected((s) => (v ? [...s, id] : s.filter((x) => x !== id))),
    [],
  );

  const rowActions = useCallback(
    (p: Product): AdminAction[] => {
      const published = p.active && p.catalog_eligible;
      return [
        { label: "Editar", onSelect: () => { setEditTab("Geral"); setEditing(p); } },
        ...(p.source === "manual"
          ? [{ label: "Editar cadastro manual", onSelect: () => { setManualId(p.id); setManualOpen(true); } }]
          : []),
        ...(p.product_type === "PERFUME"
          ? [{ label: "Informações olfativas", onSelect: () => { setEditTab("Olfativo"); setEditing(p); } }]
          : []),
        { label: "Ajustar estoque", onSelect: () => setQuick({ id: p.id, name: p.canonical_name, kind: "stock" }) },
        { label: "Alterar disponibilidade", onSelect: () => setQuick({ id: p.id, name: p.canonical_name, kind: "availability" }) },
        { label: "Alterar preço", onSelect: () => setQuick({ id: p.id, name: p.canonical_name, kind: "price" }) },
        { label: "Informações internas", href: `/admin/produtos/${p.id}` },
        {
          label: published ? "Ocultar do catálogo" : "Publicar no catálogo",
          onSelect: () => run(p.id, () => visibility({ data: { productId: p.id, visible: !published } }), published ? "Produto ocultado do catálogo." : "Produto publicado."),
        },
        {
          label: "Excluir definitivamente",
          danger: true,
          separated: true,
          onSelect: () => {
            if (!confirm(`Excluir "${p.canonical_name}" definitivamente? A sincronização não vai trazê-lo de volta.`)) return;
            void run(p.id, () => remove({ data: { productId: p.id, permanent: true } }), "Produto excluído.");
          },
        },
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibility, remove],
  );

  const chips = [
    ...(filters.brandId
      ? [{ label: `Marca: ${brands.find((b) => b.id === filters.brandId)?.canonical_name ?? "—"}`, onRemove: () => setFilters((f) => ({ ...f, brandId: undefined })) }]
      : []),
    ...(filters.type
      ? [{ label: TYPE_LABEL[filters.type as ProductType] ?? filters.type, onRemove: () => setFilters((f) => ({ ...f, type: undefined })) }]
      : []),
    ...(filters.gender
      ? [{ label: GENDER_LABEL[filters.gender as Gender] ?? filters.gender, onRemove: () => setFilters((f) => ({ ...f, gender: undefined })) }]
      : []),
    ...(filters.supplierId
      ? [{ label: suppliers.find((s) => s.id === filters.supplierId)?.name ?? "Fornecedor", onRemove: () => setFilters((f) => ({ ...f, supplierId: undefined })) }]
      : []),
    ...(filters.stock
      ? [{ label: filters.stock === "em" ? "Disponíveis" : "Indisponíveis", onRemove: () => setFilters((f) => ({ ...f, stock: undefined })) }]
      : []),
    ...(filters.ops ? [{ label: OPS_LABEL[filters.ops], onRemove: () => setFilters((f) => ({ ...f, ops: undefined })) }] : []),
    ...(filters.manualOnly ? [{ label: "Produto manual", onRemove: () => setFilters((f) => ({ ...f, manualOnly: false })) }] : []),
    ...(filters.customPriceOnly
      ? [{ label: "Preço personalizado", onRemove: () => setFilters((f) => ({ ...f, customPriceOnly: false })) }]
      : []),
    ...(filters.hiddenOnly ? [{ label: "Oculto", onRemove: () => setFilters((f) => ({ ...f, hiddenOnly: false })) }] : []),
    ...(filters.reviewOnly ? [{ label: "Para revisar", onRemove: () => setFilters((f) => ({ ...f, reviewOnly: false })) }] : []),
    ...(filters.order !== "nome" ? [{ label: "Ordenação", onRemove: () => setFilters((f) => ({ ...f, order: "nome" })) }] : []),
    ...(reason !== "todos" ? [{ label: FILTERS[reason], onRemove: () => setReason("todos") }] : []),
  ];

  return (
    <AdminShell
      title="Produtos"
      description={isLoading ? "carregando…" : `${counts.total} produtos`}
      action={
        <div className="flex items-center gap-1">
          <Button
            className="press h-11 rounded-full px-5 text-sm font-semibold"
            onClick={() => {
              setManualId(null);
              setManualOpen(true);
            }}
          >
            <Plus className="size-4" /> Adicionar
          </Button>
          <AdminMore
            label="Ferramentas do catálogo"
            actions={[
              { label: "Diagnóstico do catálogo", onSelect: () => setDiagOpen(true) },
              {
                label: "Otimizar fotos existentes",
                onSelect: async () => {
                  const t = toast.loading("Procurando fotos pesadas…");
                  try {
                    const r = await optimizeExistingProductImages(
                      () => listToOptimize(),
                      (d, total, f) => toast.loading(`Otimizando fotos… ${d}/${total}${f ? ` · ${f} com erro` : ""}`, { id: t }),
                    );
                    toast.success(
                      r.total
                        ? `✓ ${r.total - r.failed} fotos otimizadas${r.failed ? ` · ${r.failed} para reprocessar` : ""}`
                        : "Todas as fotos já estão otimizadas.",
                      { id: t },
                    );
                    await qc.invalidateQueries();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Não foi possível otimizar agora.", { id: t });
                  }
                },
              },
              { label: "Bloqueios permanentes", onSelect: () => setBlocklistOpen(true) },
              {
                label: "Reprocessar Fragrantica",
                onSelect: async () => {
                  try {
                    const r = await reprocess({ data: { scope: "accords-without-pyramid", limit: 5 } });
                    toast.success(r.processed ? `${r.processed} perfumes reprocessados.` : "Nada na fila.");
                    await qc.invalidateQueries();
                  } catch {
                    toast.error("Não foi possível reprocessar agora.");
                  }
                },
              },
            ]}
          />
        </div>
      }
    >
      <div className={"min-w-0 space-y-4 " + (selected.length ? "pb-32" : "")}>
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar produto ou marca"
            aria-label="Buscar produto ou marca"
            className="h-12 rounded-2xl pl-9 text-base"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(
            [
              ["todos", "Todos"],
              ["disponiveis", "Disponíveis"],
              ["indisponiveis", "Indisponíveis"],
              ["revisar", "Revisar"],
            ] as Array<[Vista, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setVista(key)}
              className={
                "press min-h-10 rounded-full border px-4 text-sm transition-colors " +
                (vista === key ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground")
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="press min-h-10 rounded-full border border-border/60 px-4 text-sm text-muted-foreground"
          >
            Filtros{chips.length ? ` (${chips.length})` : ""}
          </button>
        </div>

        <p className="min-w-0 text-xs text-muted-foreground">
          Disponíveis <span className="font-medium text-foreground tabular-nums">{counts.available}</span> · Indisponíveis{" "}
          <span className="font-medium text-foreground tabular-nums">{counts.unavailable}</span> · Revisar{" "}
          <span className="font-medium text-foreground tabular-nums">{counts.review}</span>
        </p>

        <ActiveFilterChips chips={chips} onClear={clearAll} />

        {vista === "revisar" ? (
          <div className="min-w-0 space-y-3">
            <div className="-mx-4 min-w-0 overflow-x-auto px-4">
              <div className="flex w-max gap-2">
                <ReasonPill active={reason === "todos"} onClick={() => setReason("todos")} label="Todos os motivos" count={counts.review} />
                {REVIEW_REASONS.filter((r) => (counts.byReason.get(r) ?? 0) > 0).map((r) => (
                  <ReasonPill
                    key={r}
                    active={reason === r}
                    onClick={() => setReason(r)}
                    label={FILTERS[r]}
                    count={counts.byReason.get(r) ?? 0}
                  />
                ))}
              </div>
            </div>
            {reason === "duplicados" ? <CatalogHygienePanel /> : null}
            {reason === "identidade-pendente" ? <IdentityReviewPanel /> : null}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${filtered.length} encontrado${filtered.length === 1 ? "" : "s"}`}
          </p>
          {filtered.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="press h-10 rounded-full px-4 text-xs"
              onClick={() => setSelected(allSelected ? [] : filtered.map((p) => p.id))}
            >
              {allSelected ? "Limpar seleção" : `Selecionar os ${filtered.length} encontrados`}
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <AdminRowsSkeleton rows={5} height={132} />
        ) : rows.length === 0 ? (
          <div className="space-y-3">
            <AdminEmpty>Nenhum produto encontrado.</AdminEmpty>
            <Button variant="outline" className="press h-11 w-full rounded-full text-sm" onClick={clearAll}>
              Limpar filtros
            </Button>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            {rows.map((p) => {
              const { price, from } = priceOf(p);
              return (
                <ProductListCard
                  key={p.id}
                  product={p}
                  issues={issuesById.get(p.id) ?? []}
                  price={price}
                  promoFrom={from}
                  customPrice={customPriceIds.has(p.id)}
                  ops={{ source: p.availability_source, localStock: p.local_stock ?? 0, manual: p.availability_override !== "none" }}
                  checked={selected.includes(p.id)}
                  busy={busyId === p.id}
                  onCheck={(v) => onCheck(p.id, v)}
                  onEdit={() => {
                    setEditTab("Geral");
                    setEditing(p);
                  }}
                  actions={rowActions(p)}
                />
              );
            })}
            {filtered.length > rows.length ? (
              <Button
                variant="outline"
                className="press h-12 w-full rounded-full text-sm"
                onClick={() => setLimit((l) => l + 60)}
              >
                Mostrar mais ({filtered.length - rows.length})
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <ProductFiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        state={filters}
        set={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        brands={brands}
        suppliers={suppliers}
        total={filtered.length}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      {editing ? (
        <ProductEditSheet
          product={editing}
          brands={brands}
          startTab={editTab}
          onClose={() => setEditing(null)}
          onManualEdit={() => {
            setManualId(editing.id);
            setManualOpen(true);
          }}
        />
      ) : null}

      {selected.length > 0 ? (
        <BulkBar
          count={selected.length}
          onClear={() => setSelected([])}
          onBrand={() => setBrandBulkOpen(true)}
          onHide={() => setBulkAction("ocultar")}
          onDelete={() => setHardOpen(true)}
          more={[
            { label: "Marcar pronta entrega", onSelect: () => setBulkAvail("FORCE_AVAILABLE") },
            { label: "Marcar indisponível", onSelect: () => setBulkAvail("FORCE_UNAVAILABLE") },
            { label: "Disponibilidade automática", onSelect: () => setBulkAvail("AUTO") },
            { label: "Voltar ao preço automático", onSelect: () => setBulkAvail("PRICE_AUTO") },
            { label: "Alterar marca", onSelect: () => setBrandBulkOpen(true), separated: true },
            { label: "Ocultar do catálogo", onSelect: () => setBulkAction("ocultar") },
            { label: "Publicar no catálogo", onSelect: () => setBulkAction("publicar") },
            { label: "Excluir definitivamente", danger: true, separated: true, onSelect: () => setHardOpen(true) },
          ]}
        />
      ) : null}

      <Dialog open={bulkAction !== null} onOpenChange={(o) => !o && setBulkAction(null)}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[24px]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">
              {bulkAction === "publicar"
                ? `Publicar ${selected.length} produto(s)?`
                : `Ocultar ${selected.length} produto(s) do catálogo?`}
            </DialogTitle>
            <DialogDescription className="text-left">
              {bulkAction === "publicar"
                ? "Eles voltam a aparecer para os clientes."
                : "Ocultar é reversível: nada de custo, fornecedor ou histórico é apagado, e a sincronização não os publica de novo."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="h-12 flex-1 rounded-full" onClick={() => setBulkAction(null)}>
              Cancelar
            </Button>
            <Button
              className="h-12 flex-1 rounded-full"
              disabled={bulkBusy}
              onClick={() => bulkAction && applyBulk(bulkAction)}
            >
              {bulkBusy ? "Aplicando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hardOpen} onOpenChange={(o) => !o && setHardOpen(false)}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[24px]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">
              Excluir definitivamente {selected.length} produto{selected.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription className="text-left">
              Eles saem da Orium e a sincronização não os recria. Pedidos antigos continuam intactos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="h-12 flex-1 rounded-full" onClick={() => setHardOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="h-12 flex-1 rounded-full" disabled={bulkBusy} onClick={applyHardDelete}>
              {bulkBusy ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {quick ? <QuickEditSheet productId={quick.id} name={quick.name} kind={quick.kind} onClose={() => setQuick(null)} /> : null}

      <Dialog open={bulkAvail !== null} onOpenChange={(o) => !o && setBulkAvail(null)}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[24px]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">
              {bulkAvail === "PRICE_AUTO"
                ? `Voltar ${selected.length} produto(s) ao preço automático?`
                : `${bulkAvail === "FORCE_AVAILABLE" ? "Pronta entrega" : bulkAvail === "FORCE_UNAVAILABLE" ? "Indisponível" : "Disponibilidade automática"} em ${selected.length} produto(s)?`}
            </DialogTitle>
            <DialogDescription className="text-left">
              {bulkAvail === "PRICE_AUTO"
                ? "Preços fixados são removidos e a regra global volta a valer."
                : "O estoque Orium de cada produto não muda. Tudo fica registrado no histórico."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="h-12 flex-1 rounded-full" onClick={() => setBulkAvail(null)}>
              Cancelar
            </Button>
            <Button
              className="h-12 flex-1 rounded-full"
              disabled={bulkBusy}
              onClick={async () => {
                if (!bulkAvail) return;
                setBulkBusy(true);
                try {
                  const r =
                    bulkAvail === "PRICE_AUTO"
                      ? await resetPriceFn({ data: { productIds: selected } })
                      : await setAvailFn({ data: { productIds: selected, mode: bulkAvail } });
                  toast.success(`${r.ok} produto(s) atualizado(s).`);
                  setBulkAvail(null);
                  setSelected([]);
                  await qc.invalidateQueries();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
                } finally {
                  setBulkBusy(false);
                }
              }}
            >
              {bulkBusy ? "Aplicando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkBrandDialog
        open={brandBulkOpen}
        onOpenChange={setBrandBulkOpen}
        brands={brands}
        productIds={selected}
        onDone={() => setSelected([])}
      />

      <BlocklistDialog open={blocklistOpen} onOpenChange={setBlocklistOpen} />

      <Drawer open={diagOpen} onOpenChange={setDiagOpen}>
        <DrawerContent className="max-h-[92vh] border-border/60">
          <DrawerTitle className="px-5 pt-3 text-lg">Diagnóstico do catálogo</DrawerTitle>
          <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
            <FragranceStatus />
            <FragranceAuditPanel />
            <FragranticaEnginePanel />
            <FragranticaHealthPanel />
            <FragranceBackfillButton />
          </div>
        </DrawerContent>
      </Drawer>

      <ManualProductSheet
        open={manualOpen}
        productId={manualId}
        onClose={() => setManualOpen(false)}
        onSaved={() => void qc.invalidateQueries()}
      />
    </AdminShell>
  );
}

function ReasonPill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "press min-h-9 shrink-0 rounded-full border px-3.5 text-xs transition-colors " +
        (active ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground")
      }
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function BulkBrandDialog({
  open,
  onOpenChange,
  brands,
  productIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brands: Array<{ id: string; canonical_name: string }>;
  productIds: string[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const setBrand = useServerFn(setProductsBrand);
  const [brandId, setBrandId] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const list = brands.filter((b) => b.canonical_name.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 40);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[24px]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base">Alterar marca</DialogTitle>
          <DialogDescription className="text-left text-xs">
            {productIds.length} produto(s) receberão a mesma marca. A correção fica travada contra a sincronização.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Pesquisar marca..."
          className="h-12 rounded-xl text-base"
        />
        <div className="max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-border/60">
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBrandId(b.id)}
              className={
                "flex min-h-11 w-full items-center border-b border-border/50 px-3 text-left text-sm last:border-b-0 " +
                (brandId === b.id ? "font-semibold" : "text-muted-foreground")
              }
            >
              <span className="truncate">{b.canonical_name}</span>
            </button>
          ))}
          {list.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">Nenhuma marca com esse nome.</p> : null}
        </div>
        <DialogFooter>
          <Button
            className="h-12 w-full rounded-full"
            disabled={busy || !brandId}
            onClick={async () => {
              setBusy(true);
              try {
                await setBrand({ data: { productIds, brandId } });
                toast.success(`${productIds.length} produto${productIds.length === 1 ? "" : "s"} atualizado${productIds.length === 1 ? "" : "s"}.`);
                await qc.invalidateQueries();
                onDone();
                onOpenChange(false);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Não foi possível aplicar.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Aplicar marca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Preenche acordes, descrição e pirâmide dos perfumes que ainda não têm, em blocos. */
function FragranceBackfillButton() {
  const run = useServerFn(backfillFragranceDetails);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const r = await run({ data: { cursor, limit: 5 } });
      const ok = r.results.filter((x) => x.status === "completo").length;
      setCursor(r.done ? 0 : r.cursor);
      toast.success(`Informações olfativas: ${ok} de ${r.results.length} concluídas`, {
        description: r.done ? "Fim do catálogo." : "Toque novamente para continuar.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível buscar agora.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" className="press h-11 w-full rounded-full text-xs" disabled={busy} onClick={go}>
      {busy ? "Buscando informações olfativas…" : "Buscar informações olfativas (próximos 5)"}
    </Button>
  );
}

/** Bloqueios permanentes: revisar e liberar produtos excluídos definitivamente. */
function BlocklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const listBlocks = useServerFn(listCatalogBlocklist);
  const removeBlock = useServerFn(removeCatalogBlock);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-blocklist"],
    queryFn: () => listBlocks(),
    enabled: open,
  });
  const rows = data?.rows ?? [];

  const release = async (id: string) => {
    try {
      await removeBlock({ data: { blockId: id } });
      toast.success("Bloqueio liberado.");
      await qc.invalidateQueries({ queryKey: ["catalog-blocklist"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível liberar agora.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-md rounded-[24px]">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base">Bloqueios permanentes</DialogTitle>
          <DialogDescription className="text-left">
            Produtos excluídos definitivamente. Enquanto estiverem aqui, a sincronização não os recria.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] min-w-0 space-y-2 overflow-y-auto">
          {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
          {!isLoading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum bloqueio no momento.</p>
          ) : null}
          {rows.map((b) => (
            <div key={b.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.canonical_name ?? b.normalized_name ?? "—"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[b.brand, b.supplier_sku, dateBR(b.created_at)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button variant="outline" className="h-10 shrink-0 rounded-full text-xs" onClick={() => release(b.id)}>
                Liberar
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
