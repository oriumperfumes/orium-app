# Admin → Produtos: controle manual completo

Goal: everything the Copilot can do to a product is also available in the panel, and both paths use the same backend services.

## What already exists (and will be reused)
- Separate `local_stock`, `supplier_available`, `availability_override` (none/available/blocked), and one central rule (`compute_availability_source`) that sets `in_stock` and `availability_source`.
- `inventory_adjust` and `set_availability_override` RPCs, which write `inventory_movements` and audit entries. The Copilot already calls them.
- Supplier sync writes only `supplier_available`, never local stock or the override.
- Store sales take from `local_stock` (bottles) and `decant_ml_consumed` (ml).

## 1. Shared product services (one place)
- New `src/lib/product-admin.server.ts`: `setLocalStock` (set/add/remove, reason, no negative values), `setAvailabilityMode` (AUTO / FORCE_AVAILABLE / FORCE_UNAVAILABLE, mapped to none/available/blocked), `updateProductPrice` (custom Pix price, wholesale, decant overrides; card price comes from the existing central formula), `resetToAutomaticPrice` (with automatic-price preview), and `getProductHistory` (stock, availability and price changes, with who and when).
- `product-admin.functions.ts`: server functions for staff only (owner/admin checked on the backend).
- Copilot `registry.server.ts` changes its stock, availability and price execution to call these same functions. Result: identical outcomes.
- Small migration if needed: a `price_change` audit row with before/after and actor, plus a `products_list_admin` view or RPC that returns availability source, local stock and manual flags for filters.

## 2. Product editor with tabs
Tabs: Geral · Venda · Estoque · Fornecedores · Olfativo · Avançado. They scroll sideways on mobile. On tablet and desktop, a two-column layout shows a summary on the right.
- **Venda**: pricing mode (Automática / Preço personalizado), Pix, wholesale, custom bottle price, decant overrides. Shows live cost, gross profit, margin and the calculated card price. "Voltar ao preço automático" shows current vs automatic before you confirm.
- **Estoque (Estoque da Orium)**: sealed bottles with [-] qty [+], and Definir / Adicionar / Remover. Optional reason chips (Reposição chegou, Ajuste de inventário, Contagem física, Devolução, Outro). Stops you from going below zero. Shows ml opened for decants from the existing volume control. Reminds you to record a sale instead of removing stock. Includes a "Disponibilidade pública" segmented control (Automática / Pronta entrega / Indisponível), status, source ("Disponível por: Estoque local / Override manual / Fornecedor X"), and warnings ("Disponibilidade manual ativa sem estoque registrado", "Bloqueado manualmente").
- **Fornecedores**: one card per supplier with cost and availability, with the lowest cost highlighted. Visually separated from Orium stock.
- **Histórico**: timeline of stock, availability and price changes, with the admin's name.
- Every save shows "Salvando…" then "Salvo". If the save fails, the change is undone on screen and an error message appears.

## 3. Product list
- Clean card: photo, name, brand, Pix price, and an internal badge (PRONTA ENTREGA · 3 un. / SOB ENCOMENDA / INDISPONÍVEL / MANUAL).
- Filters: Pronta entrega, Sem estoque local, Disponível, Indisponível, Preço manual, Disponibilidade manual, Sob encomenda.
- `⋯` menu opens bottom sheets: Ajustar estoque, Alterar disponibilidade, Alterar preço (with profit preview).
- Bulk actions: Alterar disponibilidade, Marcar pronta entrega, Voltar ao automático. Quantity cannot be changed in bulk.

## 4. Public side
- No change. Shoppers still see only Disponível or Indisponível. Quantities, suppliers and overrides are never shown publicly.

## 5. Verification
- SQL/transaction test of the critical Liquid Brun scenario: 0 → set 3 in the panel → available from local stock → supplier recompute (sync) keeps it → sale of 1 → 2 → set to 0 → unavailable. Also FORCE_AVAILABLE and FORCE_UNAVAILABLE.
- The same scenario run through the Copilot's execution path, compared with the panel result.
- Playwright check for overflow at 320–1024px on the list and editor.
- Authenticated screen checks need an admin test login. The current test account is not an admin, so if none is available those checks will be reported as pending.
