<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep one debounced catalog-search value shared by the inline bar, sticky bar, preview, intent, URL, and result grid; this prevents stale or contradictory results.
- Keep automatic global route preloading disabled and use explicit stable link preloads only; this avoids route-match races in the Admin.
- Motion: use only `--motion-fast/standard/emphasis` + `--ease-orium` from styles.css; one easing app-wide for consistency.
- QueryClient defaults: staleTime 30s, no refetch on focus; screens with critical freshness set their own staleTime.
- Product photos: resize/encode in the Admin browser (Worker has no image libs); `product_image_cache` + trigger `products_zz_optimized_image` swap supplier URLs for Orium WebP variants; render via `imgVariant`/`imgSrcSet`.
- All app AI calls go through src/lib/ai/engine.server.ts (OpenAI, OPENAI_API_KEY, usage logged to ai_usage, budgets from ai_settings); never call the Lovable AI gateway or another provider directly — keeps cost control and one failure policy.
- Copilot price answers/quotes come only from src/lib/copilot/pricing-tools.server.ts, which reuses priceCart (the cart/checkout engine); never put prices in prompts or a separate AI price table — keeps one source of truth.
- AI model choice per task goes through routeTask() + prepare(profile) in engine.server.ts (profiles: economy/copilot/advanced/voice/vision, models stored in ai_settings); features never hardcode a model — lets the owner swap models in the AI Center.
- Orders link to CRM by catalog_orders.crm_customer_id (trigger crm_link_order_customer fills it by phone only when empty); order name/phone are a per-order snapshot and never overwrite the linked crm_customers row — keeps one customer record and stable history.
- Supplier Hub: priority/permission/logistics flags live on `suppliers`; `recompute_product_pricing` (pricing/availability) and `purchase/compare.server.ts` (Restock) must honor them plus `supplier_product_preferences`; suppliers with `creates_catalog_products=false` never create public products and only auto-link via `strictSameProduct` — keeps reference suppliers from changing prices or polluting the catalog.
- Any Kyte store goes through `src/lib/suppliers/kyte-connector.server.ts` (adapter `kyte-connector`, store id in `adapter_config.aid`), and supplier URLs pass `url-guard.server.ts` — one reusable reader, SSRF-safe.
- Public-catalog permission is per supplier offer: `suppliers.catalog_mode` + `supplier_offer_catalog` (allow/deny, never written by sync) gate only `supplier_available` in `recompute_product_pricing`; pricing, comparison and purchasing ignore it — blocking an offer never hides a product another source can supply.
- Supply freight (supplier → Orium) lives in `src/lib/suppliers/freight(.server).ts`: one quote per shipment via `superfreteQuote` with the supplier's own origin CEP, allocated by units/value/weight; never reuse the customer-shipping origin and never invent package data or freight values.
- Storefront overlays/sheets (sacola, conta, filtros, folhas de compra, kit, lead) load on demand via `lazyUI` + `MountWhen` from src/lib/lazy-ui.tsx and prefetch on idle; import light pieces (e.g. `account-shared`, `filters-options`) statically, never the heavy module — keeps them out of the first load.
- Storefront layout: page frame is the `shell` utility (max `--shell-max`, gutters from `--page-gutter`: 20/32/40/48px); product lists use `product-grid` (2/3/4/5 cols); from `lg` (64rem) navigation lives in SiteHeader and the bottom bar hides; Sacola/Conta become a right panel and store sheets float (admin excluded via `html.is-admin`) — keeps tablet/desktop consistent.
- Overlays close on the phone back gesture via `useBackToClose` (built into ui/drawer, ui/dialog, ui/sheet; used by CartDrawer, AccountScreen, OfferPopup). When navigating from inside an overlay, call `navigatingFromLayer()` and navigate with `replace: true` — otherwise the closing overlay can undo the navigation.
- Admin look: tokens/overrides live in the "ADMIN — mesma linguagem da loja" block of styles.css (scoped to `.admin-theme`/`body.admin-mode`): #101010 page, #0A0A0A bars, #1A1A1A cards, #1F1F1F controls, selected = white, gold only as accent, no gradients/blur/glow. Pages use `AdminShell` (big title + optional description/action; `bare` hides it) and AdminUI primitives — keeps every admin screen consistent with the store. Desktop nav = pill top bar (`AdminTopBar`, Ctrl K palette); Início/Pedidos use `.dash-card`/`.dash-hero` cards and `components/orium/admin/orders/*` (board, panel, composer).
- Orders control: Pedidos tabs Hoje (alerts) · Quadro · Lista · Compras; supplier purchases read/write only via `src/lib/orders-control.functions.ts` (status transitions guarded server-side: a comprar → pedido feito → recebido, never twice); `catalog_orders.payment_due_date` and `restock_items.planned_purchase_date/purchased_at/received_at` drive the alerts; manual/edited prices travel as `unitPrice` and are never overwritten by priceCart.
