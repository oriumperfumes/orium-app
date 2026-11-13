// Validação pela API (PostgREST) por perfil, com dados fictícios. Uso (ver supabase/tests/api/README.md):
//   node run-api-checks.mjs build <dir> <jwt-secret>     -> grava <dir>/plan.jsonl (tokens HS256 efêmeros)
//   node run-api-checks.mjs verify <dir>                 -> lê <dir>/results.jsonl e confere cada caso
// O cliente HTTP (http.pl) roda DENTRO da rede Docker interna; nada é publicado na máquina.
import fs from "node:fs";
import crypto from "node:crypto";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const C = "00000000-0000-4000-8000-0000000000a3";
const D = "00000000-0000-4000-8000-0000000000a4";
const STAFF = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000002";
const INTERNAL = "suspicious_price gender_confidence brand_review_required raw_name dedupe_key catalog_eligibility_reason canonical_identity_locked identity_source identity_confidence identity_status identity_verified identity_verified_by identity_verified_at identity_key image_signature catalog_excluded_manually base_retail_price base_wholesale_price manual_pricing manual_cost visibility_status decant_ml_consumed public_visible local_stock availability_override supplier_available availability_source local_decant_ml ready_to_deliver stock_tracked image_mode image_manual_url image_source_supplier_id image_source_offer_id image_manual_broken image_manual_set_at image_manual_set_by".split(" ");
const PAGE_COLS = "id,slug,canonical_name,brand,concentration,volume_ml,image_url,in_stock,stock_quantity,retail_price,wholesale_price,gender_norm,product_type,sale_mode,full_bottle_available,decant_available,decant_price_2ml,decant_price_5ml,decant_price_10ml";
const MAINT = "id,canonical_name,raw_name,brand,brand_id,source,sale_mode,gender_norm,product_type,concentration,volume_ml,flanker,image_url,in_stock,stock_quantity,local_stock,availability_override,availability_source,manual_pricing,retail_price,wholesale_price,active,catalog_eligible,identity_status,identity_verified,canonical_identity_locked,brand_review_required,suspicious_price,search_aliases,created_at";
const COMPOSER = "id,canonical_name,brand,volume_ml,image_url,retail_price,wholesale_price,decant_available,decant_price_2ml,decant_price_5ml,decant_price_10ml,local_stock,gender_norm";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const jwt = (secret, claims) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${h}.${p}.${crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};

/** [id, perfil, descrição, request, checagem] — a ordem importa (a equipe age no meio e a loja é relida no fim). */
function cases(tok) {
  const V = "", CL = tok.client, ST = tok.staff, SV = tok.service;
  const get = (path, token) => ({ method: "GET", path, token });
  const post = (path, body, token, headers) => ({ method: "POST", path, body: JSON.stringify(body ?? {}), token, headers });
  const patch = (path, body, token, headers) => ({ method: "PATCH", path, body: JSON.stringify(body), token, headers });
  const del = (path, token) => ({ method: "DELETE", path, token });
  const ids = (b) => JSON.parse(b).map((r) => r.id ?? r).sort();
  const noInternal = (b) => { const t = b; return !INTERNAL.some((c) => new RegExp(`"${c}"`).test(t)); };
  const denied = (r) => [401, 403].includes(r.status) && /42501|permission denied/i.test(r.body);
  const out = [];
  const add = (id, who, what, req, check) => out.push({ id, who, what, req, check });

  for (const [who, tk] of [["visitante", V], ["cliente", CL]]) {
    const p = who === "visitante" ? "V" : "C";
    add(`${p}1`, who, "pronta entrega: RPC devolve só os ids do catálogo (A)", post("/rpc/public_ready_to_deliver_ids", {}, tk), (r) => r.status === 200 && JSON.stringify(JSON.parse(r.body)) === JSON.stringify([A]));
    add(`${p}2`, who, "catálogo: colunas públicas, ativos e elegíveis (A e C)", get(`/products?select=id,canonical_name,retail_price&active=eq.true&catalog_eligible=eq.true`, tk), (r) => r.status === 200 && JSON.stringify(ids(r.body)) === JSON.stringify([A, C]));
    add(`${p}3`, who, "página do perfume: PUBLIC_PRODUCT_COLUMNS por slug", get(`/products?select=${PAGE_COLS}&slug=eq.perfume-ficticio-a&active=eq.true`, tk), (r) => r.status === 200 && ids(r.body).length === 1 && noInternal(r.body));
    add(`${p}4`, who, "facetas do catálogo", get(`/products?select=brand,product_type,gender_norm,in_stock,decant_available&active=eq.true&catalog_eligible=eq.true`, tk), (r) => r.status === 200 && JSON.parse(r.body).length === 2);
    add(`${p}5`, who, "acordes: embed products!inner com filtros no embed", get(`/fragrance_accords?select=accord_name,products!inner(active,catalog_eligible)&position=lte.2&products.active=eq.true&products.catalog_eligible=eq.true`, tk), (r) => r.status === 200 && JSON.parse(r.body).length === 2);
    add(`${p}6`, who, "busca do catálogo (RPC) sem coluna interna", post("/rpc/search_catalog", { p_q: "ficticio" }, tk), (r) => r.status === 200 && JSON.parse(r.body).length >= 2 && noInternal(r.body));
    add(`${p}7`, who, "NEGADO: select=manual_cost", get(`/products?select=manual_cost`, tk), denied);
    add(`${p}8`, who, "NEGADO: select=*", get(`/products?select=*`, tk), denied);
    add(`${p}9`, who, "NEGADO: filtro na coluna interna ready_to_deliver (consulta antiga)", get(`/products?select=id&ready_to_deliver=eq.true&active=eq.true`, tk), denied);
    add(`${p}10`, who, "NEGADO: local_stock, base_retail_price, identity_key, dedupe_key (uma a uma)", { multi: ["local_stock", "base_retail_price", "identity_key", "dedupe_key", "supplier_available"].map((c) => get(`/products?select=${c}`, tk)) }, (rs) => rs.every(denied));
    add(`${p}11`, who, "NEGADO: PATCH, POST e DELETE em products (inclusive pedindo a linha de volta)", { multi: [patch(`/products?id=eq.${A}&select=manual_cost`, { retail_price: 1 }, tk, { Prefer: "return=representation" }), post("/products", { canonical_name: "x", slug: "x" }, tk), del(`/products?id=eq.${A}`, tk)] }, (rs) => rs.every(denied));
    add(`${p}12`, who, "NEGADO: RPCs internas (store_product_cost, store_sale_apply_stock)", { multi: [post("/rpc/store_product_cost", { p_product_id: A }, tk), post("/rpc/store_sale_apply_stock", { p_product_id: A, p_bottles: 1, p_ml: 0 }, tk)] }, (rs) => rs.every((r) => [401, 403, 404].includes(r.status)));
  }
  add("C13", "cliente", "login: ensure_profile devolve client", post("/rpc/ensure_profile", {}, CL), (r) => r.status === 200 && JSON.parse(r.body) === "client");
  add("C14", "cliente", "carrinho próprio: salvar e reler em profiles", { multi: [patch(`/profiles?id=eq.${CLIENT}`, { cart: [{ productId: A, qty: 1 }] }, CL), get(`/profiles?select=cart&id=eq.${CLIENT}`, CL)] }, (rs) => rs[0].status === 204 && JSON.parse(rs[1].body)[0].cart[0].productId === A);
  add("C15", "cliente", "ações de equipe recusadas (estoque, disponibilidade, venda)", { multi: [post("/rpc/inventory_adjust", { p_product_id: A, p_mode: "add", p_qty: 1 }, CL), post("/rpc/set_availability_override", { p_product_id: C, p_override: "available" }, CL), post("/rpc/store_sale_commit", { p_payload: { items: [{ product_id: A, quantity: 1, unit_price: 1 }] } }, CL)] }, (rs) => rs.every((r) => r.status >= 400));
  add("C16", "cliente", "is_staff do cliente = false", post("/rpc/is_staff", { _user_id: CLIENT }, CL), (r) => r.status === 200 && JSON.parse(r.body) === false);

  add("S1", "equipe", "portão: is_staff(equipe) = true (o que as server functions chamam)", post("/rpc/is_staff", { _user_id: STAFF }, ST), (r) => r.status === 200 && JSON.parse(r.body) === true);
  add("S2", "equipe", "NEGADO no papel do navegador: manual_cost e escrita em products (leitura/edição interna vai pelo servidor)", { multi: [get(`/products?select=manual_cost`, ST), patch(`/products?id=eq.${A}`, { decant_price_5ml: 1 }, ST)] }, (rs) => rs.every(denied));
  add("S3", "equipe", "Admin (navegador): busca de produtos para comparar (colunas públicas)", get(`/products?select=id,canonical_name,brand,volume_ml,image_url&canonical_name=ilike.*ficticio*&limit=12`, ST), (r) => r.status === 200 && JSON.parse(r.body).length >= 1);
  add("S4", "equipe", "Admin (navegador): view fragrance_pyramid_status e custos em product_costs", { multi: [get(`/fragrance_pyramid_status?select=product_id,status`, ST), get(`/product_costs?select=best_cost`, ST)] }, (rs) => rs.every((r) => r.status === 200));
  add("S5", "equipe", "estoque (+2 em A), disponibilidade (C = available) e venda pela equipe", { multi: [post("/rpc/inventory_adjust", { p_product_id: A, p_mode: "add", p_qty: 2, p_reason: "api ficticio", p_source: "painel" }, ST), post("/rpc/set_availability_override", { p_product_id: C, p_override: "available", p_reason: "api ficticio" }, ST), post("/rpc/store_sale_commit", { p_payload: { entry_method: "manual", payment_method: "pix", customer_name: "Cliente Ficticio", idempotency_key: "api-sale-1", items: [{ product_id: A, variant: "FULL", quantity: 1, unit_price: 250 }] } }, ST)] }, (rs) => rs.every((r) => r.status === 200) && JSON.parse(rs[2].body).duplicate === false && !/manual_cost|local_stock/.test(rs[2].body));

  add("R1", "equipe (servidor)", "adminMaintenanceProducts: colunas internas (4 produtos)", get(`/products?select=${MAINT}&order=canonical_name`, SV), (r) => r.status === 200 && JSON.parse(r.body).length === 4 && "local_stock" in JSON.parse(r.body)[0]);
  add("R2", "equipe (servidor)", "adminComposerProducts: catálogo visível com local_stock", get(`/products?select=${COMPOSER}&active=eq.true&catalog_eligible=eq.true&order=canonical_name&limit=3000`, SV), (r) => r.status === 200 && JSON.parse(r.body).length === 2 && JSON.parse(r.body).every((x) => "local_stock" in x));
  add("R3", "equipe (servidor)", "getAdminProductRow: linha inteira com manual_cost = 100 e local_stock = 4", get(`/products?select=*&id=eq.${A}`, SV), (r) => r.status === 200 && JSON.parse(r.body)[0].manual_cost == 100 && JSON.parse(r.body)[0].local_stock === 4);
  add("R4", "equipe (servidor)", "adminSetProductDecants: edição e releitura", { multi: [patch(`/products?id=eq.${A}`, { decant_available: true, decant_price_2ml: 19.9, decant_price_5ml: 44.9, decant_price_10ml: 69.9 }, SV), get(`/products?select=decant_price_5ml&id=eq.${A}`, SV)] }, (rs) => rs[0].status === 204 && JSON.parse(rs[1].body)[0].decant_price_5ml == 44.9);

  add("V13", "visitante", "depois da ação da equipe: pronta entrega passa a {A, C} (catálogo e carrinho)", post("/rpc/public_ready_to_deliver_ids", {}, V), (r) => r.status === 200 && JSON.stringify(JSON.parse(r.body).sort()) === JSON.stringify([A, C]));
  add("C17", "cliente", "depois da ação da equipe: mesma pronta entrega {A, C}", post("/rpc/public_ready_to_deliver_ids", {}, CL), (r) => r.status === 200 && JSON.stringify(JSON.parse(r.body).sort()) === JSON.stringify([A, C]));
  add("V14", "visitante", "depois da ação da equipe: custos continuam negados e B/D continuam fora", { multi: [get(`/products?select=manual_cost`, V), post("/rpc/public_ready_to_deliver_ids", {}, V)] }, (rs) => denied(rs[0]) && !JSON.parse(rs[1].body).includes(B) && !JSON.parse(rs[1].body).includes(D));

  // ===== Objetos novos do snapshot de 13/11: price_on_request, busca atualizada, pedidos a fornecedor, reposição, chaves de widget, pago por item =====
  const RL = "00000000-0000-4000-8000-0000000000e1", SO = "00000000-0000-4000-8000-0000000000f1", OR = "00000000-0000-4000-8000-0000000000d1", OI = "00000000-0000-4000-8000-0000000000d2";
  const rep = { Prefer: "return=representation" };
  add("N1", "equipe (servidor)", "price_on_request: marca A como 'Consultar no WhatsApp'", patch(`/products?id=eq.${A}`, { price_on_request: true }, SV), (r) => r.status === 204);
  for (const [who, tk] of [["visitante", V], ["cliente", CL]]) {
    const p = who === "visitante" ? "v" : "c";
    add(`N2${p}`, who, "price_on_request: useConsultIds (select id, price_on_request=true, active) devolve só A", get(`/products?select=id&price_on_request=eq.true&active=eq.true&limit=2000`, tk), (r) => r.status === 200 && JSON.stringify(ids(r.body)) === JSON.stringify([A]));
    add(`N3${p}`, who, "price_on_request: página do perfume lê o campo; custo continua negado", { multi: [get(`/products?select=${PAGE_COLS},price_on_request&slug=eq.perfume-ficticio-a`, tk), get(`/products?select=manual_cost,price_on_request`, tk)] }, (rs) => rs[0].status === 200 && JSON.parse(rs[0].body)[0].price_on_request === true && denied(rs[1]));
    add(`N4${p}`, who, "busca atualizada (hype_fast): vazia, com texto, decant e ordenação; sem coluna interna", { multi: [post("/rpc/search_catalog", { p_q: "", p_limit: 5, p_sort: "relevance" }, tk), post("/rpc/search_catalog", { p_q: "ficticio", p_decant: true }, tk), post("/rpc/search_catalog", { p_q: "ficticio", p_only_available: true, p_limit: 24, p_offset: 0 }, tk), post("/rpc/search_catalog", { p_q: "nao-existe-xyz" }, tk)] }, (rs) => rs.every((r) => r.status === 200 && noInternal(r.body)) && JSON.parse(rs[0].body).length >= 2 && JSON.parse(rs[3].body).length === 0);
  }
  for (const [who, tk] of [["visitante", V], ["cliente", CL], ["equipe (navegador)", ST]]) {
    const p = who === "visitante" ? "v" : who === "cliente" ? "c" : "s";
    add(`N5${p}`, who, "NEGADO: widget_keys, supplier_orders, supplier_order_items (leitura e escrita)", { multi: ["widget_keys", "supplier_orders", "supplier_order_items"].flatMap((t) => [get(`/${t}?select=id`, tk), post(`/${t}`, {}, tk)]) }, (rs) => rs.every(denied));
  }
  add("N6", "equipe (servidor)", "pedido a fornecedor: criar pedido (seq automático) e item", { multi: [post("/supplier_orders", { id: SO, supplier_name: "Fornecedor Ficticio", units: 2, total: 200, message: "pedido ficticio" }, SV, rep), post("/supplier_order_items", { supplier_order_id: SO, product_id: A, name: "Perfume Ficticio A", quantity: 2, unit_cost: 100 }, SV, rep)] }, (rs) => rs.every((r) => r.status === 201) && Number.isInteger(JSON.parse(rs[0].body)[0].seq));
  add("N7", "equipe (servidor)", "reposição: linha aberta única (duplicada recusada) e nova linha depois de 'pedido feito'", { multi: [post("/restock_lists", { id: RL, name: "Lista ficticia" }, SV), post("/restock_items", { restock_list_id: RL, product_id: A, quantity: 1 }, SV), post("/restock_items", { restock_list_id: RL, product_id: A, quantity: 1 }, SV), patch(`/restock_items?restock_list_id=eq.${RL}&product_id=eq.${A}`, { status: "pedido feito", purchased_at: "2026-11-13T12:00:00Z" }, SV), post("/restock_items", { restock_list_id: RL, product_id: A, quantity: 1 }, SV)] }, (rs) => rs[0].status === 201 && rs[1].status === 201 && rs[2].status === 409 && /23505/.test(rs[2].body) && rs[3].status === 204 && rs[4].status === 201);
  add("N8", "equipe (servidor)", "conferência: item recebido, pedido conferido e leitura com embed dos itens", { multi: [patch(`/supplier_order_items?supplier_order_id=eq.${SO}`, { result: "ok", received_qty: 2 }, SV), patch(`/supplier_orders?id=eq.${SO}`, { status: "conferido", checked_at: "2026-11-13T13:00:00Z" }, SV), get(`/supplier_orders?select=id,seq,status,supplier_order_items(name,quantity,result,received_qty)&id=eq.${SO}`, SV)] }, (rs) => rs[0].status === 204 && rs[1].status === 204 && JSON.parse(rs[2].body)[0].status === "conferido" && JSON.parse(rs[2].body)[0].supplier_order_items[0].result === "ok");
  add("N9", "equipe (servidor)", "widget_keys: criar (só hash + dica), listar sem segredo e revogar", { multi: [post("/widget_keys", { name: "Aparelho ficticio", token_hash: "hash-ficticio-api", token_hint: "abcd" }, SV, rep), get(`/widget_keys?select=id,name,token_hint,revoked_at&order=created_at.desc`, SV), patch(`/widget_keys?token_hash=eq.hash-ficticio-api`, { revoked_at: "2026-11-13T14:00:00Z" }, SV)] }, (rs) => rs[0].status === 201 && rs[1].status === 200 && !/token_hash/.test(rs[1].body) && rs[2].status === 204);
  add("N10", "cliente / equipe", "pago por item e fornecedor escolhido: cliente não altera; equipe altera; servidor confere", { multi: [post("/catalog_orders", { id: OR }, SV), post("/catalog_order_items", { id: OI, order_id: OR, product_name_snapshot: "Perfume Ficticio A" }, SV, rep), patch(`/catalog_order_items?id=eq.${OI}`, { paid: true }, CL), get(`/catalog_order_items?select=id,paid,supplier_chosen&id=eq.${OI}`, SV), patch(`/catalog_order_items?id=eq.${OI}`, { paid: true, supplier_chosen: true }, ST), get(`/catalog_order_items?select=id,paid,supplier_chosen&id=eq.${OI}`, SV)] }, (rs) => rs[0].status === 201 && rs[1].status === 201 && JSON.parse(rs[1].body)[0].paid === false && JSON.parse(rs[1].body)[0].supplier_chosen === false && (denied(rs[2]) || rs[2].status === 204) && JSON.parse(rs[3].body)[0].paid === false && rs[4].status === 204 && JSON.parse(rs[5].body)[0].paid === true && JSON.parse(rs[5].body)[0].supplier_chosen === true);
  return out;
}

const [mode, dir, secret] = process.argv.slice(2);
if (mode === "build") {
  const tok = { client: jwt(secret, { role: "authenticated", sub: CLIENT }), staff: jwt(secret, { role: "authenticated", sub: STAFF }), service: jwt(secret, { role: "service_role" }) };
  const lines = [];
  for (const c of cases(tok)) {
    if (c.req.multi) c.req.multi.forEach((r, i) => lines.push(JSON.stringify({ id: `${c.id}#${i}`, ...r })));
    else lines.push(JSON.stringify({ id: c.id, ...c.req }));
  }
  fs.writeFileSync(`${dir}/plan.jsonl`, lines.join("\n") + "\n");
  console.log(`plan: ${lines.length} requests`);
} else if (mode === "verify") {
  const res = new Map(fs.readFileSync(`${dir}/results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  const tok = { client: "x", staff: "x", service: "x" };
  let fail = 0, pass = 0;
  const rows = [];
  for (const c of cases(tok)) {
    let ok = false, detail = "";
    try {
      if (c.req.multi) { const rs = c.req.multi.map((_, i) => res.get(`${c.id}#${i}`)); ok = !!c.check(rs); detail = rs.map((r) => r.status).join("/"); }
      else { const r = res.get(c.id); ok = !!c.check(r); detail = String(r.status); }
    } catch (e) { ok = false; detail = "error: " + e.message; }
    ok ? pass++ : fail++;
    rows.push(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(4)} ${c.who.padEnd(18)} HTTP ${detail.padEnd(12)} ${c.what}`);
  }
  console.log(rows.join("\n"));
  console.log(`\nTOTAL: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
