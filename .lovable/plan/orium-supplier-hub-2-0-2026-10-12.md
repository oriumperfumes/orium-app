# Orium Supplier Hub 2.0

## What I already checked on the real Amado Fragrance site
- The shop page and the `/feed/google` and `/feed/facebook` addresses are behind a "Just a moment..." anti-bot wall (HTTP 403). The feeds are not reachable, and we will not try to get around that wall.
- The public read service already used for Smart Mania/KL works for Amado. The catalog reports **1011 products**. A single read returns 958 of them, so we have to keep reading page by page to get the rest. All 958 have a photo. Only 69 have stock control turned on, so for most items availability is "unknown", not "available".
- Category names come back empty on this read, so categories will be taken from the store's category list when it is available. If it isn't, we infer them from the product name (brand, gender, ml) and mark them as inferred.

## Delivery in phases (each phase tested before the next one starts)

**Phase 1 - Kyte connector + Amado (top priority)**
- One reusable `KyteConnector` with detect, read and validate steps: work out which store a link points to, read every page, and parse the price, sale price, photos, ml, concentration (EDP/EDT/Parfum/Elixir), gender and brand from the product name.
- An **Add supplier** screen: paste the link, then **Analyze site**. It shows a preview with real numbers only: platform, connection status, products found, how many have a price or photo, and a sample list. Then **Confirm integration**.
- Create Amado Fragrance (São Paulo/SP, ships to Itaguaí/RJ, shipping "a consultar"), set as **reference only** by default.
- Sync reads every page and never runs twice at the same time for one supplier. Products that disappear move to "not found this time" and are not deleted.

**Phase 2 - One Suppliers area in the Admin**
- Merge Sincronização and Fornecedores into **Admin → Fornecedores** with these tabs: Visão geral, Fornecedores, Sincronização, Comparação, Configurações.
- Supplier cards and a supplier detail page with these sections: Configurações, Produtos, Preços, Logística, Histórico de sincronização, Diagnóstico.

**Phase 3 - Priority, permissions and logistics**
- Each supplier gets a priority: preferred, secondary, price reference only, or inactive.
- Each supplier gets on/off switches: purchases/restock, automatic pricing cost, show in comparison, availability for orders, and auto-sync.
- Logistics per supplier: state, city, address, delivery mode (own pickup / carrier / supplier delivers / a combinar), preparation and transit time in business days, shipping cost, minimum order, operating days, travel cost and notes.
- Per-perfume choices: a preferred supplier or a blocked supplier. Syncs never overwrite these.

**Phase 4 - Comparison, Restock, Pricing and orders**
- Price comparison on the product page and in Restock: listed price, availability, shipping ("Frete a consultar" when unknown), estimated cost per unit and lead time. Labels for **Mais barato**, **Preferencial** and **Menor prazo**. The supplier is never switched silently.
- The Pricing Engine only uses suppliers with "automatic pricing cost" turned on. Reference-only suppliers never change the public price.
- Local stock is never touched. The availability order stays: manual block, then sealed stock in the shop, then manual rules, then suppliers enabled for orders, then unavailable.
- An internal supply forecast on orders, in business days and Brasília time. It never changes the delivery date promised to the customer on its own.

**Phase 5 - Duplicates, photos, diagnostics, Copilot**
- Duplicate check: brand, line, flanker, ml and concentration must all match. Doubtful matches go to review, and nothing is merged automatically.
- Amado photos join the existing photo picker. A photo you choose by hand stays locked.
- Diagnostics screen: how the catalog was read, feed status, categories found, totals, rejected items, missing prices and photos, and time taken.
- Copilot tools that answer straight from the database (cheapest supplier, broken syncs, set the preferred supplier with confirmation).

**Later (no compatibility promised until tested):** Shopify, WooCommerce, generic feed and generic website connectors, plus CSV/XML import.

## Technical details
- Migration (only adds columns, keeps existing data): on `suppliers`, the priority, permission flags, logistics fields, `platform` and `kyte_aid`. New tables `supplier_product_preferences` (product_id, supplier_id, mode preferred/blocked) and `supplier_sync_changes` (run_id, kind, offer_id, old/new). Offer status values: active, not_found, unavailable, review. RLS is staff-only.
- Security: URL checks to block internal addresses (https only, no private or local addresses, limited redirects), timeouts, limited retries, and the existing sync lock.
- I'll reuse `makeKyteAdapter`, `engine.server.ts`, `compare.server.ts` and `priceCart`. The existing adapter is changed so it keeps reading pages (skip/limit) until the total `count` is reached.
- Tests: an Amado parse/paging test, a real sync run twice, checks that prices match the source, that the reference-only setting leaves public prices unchanged, and that local stock is untouched. Then the same connector against Smart Mania and KL.
