import { brl } from "@/lib/format";

export type ExportItem = { name: string; quantity: number; unitCost: number };
export type ExportGroup = { supplier: string; items: ExportItem[] };

const today = () => new Date().toLocaleDateString("pt-BR");

/** Texto limpo para colar no WhatsApp do fornecedor. */
export function restockText(groups: ExportGroup[], withPrices = true) {
  const blocks: string[] = [];
  let grand = 0;
  for (const g of groups) {
    const subtotal = g.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    grand += subtotal;
    const lines = g.items.map((i) =>
      withPrices
        ? `${i.quantity}x ${i.name} — ${brl(i.unitCost)}/un`
        : `${i.quantity}x ${i.name}`,
    );
    blocks.push(
      [`PEDIDO ${g.supplier.toUpperCase()}`, "", ...lines, ...(withPrices ? ["", `Total ${g.supplier}: ${brl(subtotal)}`] : [])].join("\n"),
    );
  }
  if (withPrices && groups.length > 1) blocks.push(`TOTAL GERAL: ${brl(grand)}`);
  return blocks.join("\n\n");
}

/**
 * Documento de ordem de compra gerado do zero (não é captura de tela):
 * fundo branco, sans-serif, tabela alinhada. Abre pronto para salvar em PDF ou imprimir.
 */
export function restockDocument(groups: ExportGroup[], withPrices = true) {
  let grand = 0;
  const sections = groups
    .map((g) => {
      const subtotal = g.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
      grand += subtotal;
      const rows = g.items
        .map(
          (i) => `<tr>
            <td class="qty">${i.quantity}</td>
            <td>${escapeHtml(i.name)}</td>
            ${withPrices ? `<td class="num">${brl(i.unitCost)}</td><td class="num">${brl(i.quantity * i.unitCost)}</td>` : ""}
          </tr>`,
        )
        .join("");
      return `<section>
        <h2>${escapeHtml(g.supplier)}</h2>
        <table>
          <thead><tr><th class="qty">Qtd.</th><th>Produto</th>${
            withPrices ? "<th class='num'>Unitário</th><th class='num'>Subtotal</th>" : ""
          }</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${withPrices ? `<p class="subtotal">Total ${escapeHtml(g.supplier)}: <strong>${brl(subtotal)}</strong></p>` : ""}
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Orium Perfumes — Lista de Reposição</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #fff; color: #111;
    font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .doc { max-width: 760px; margin: 0 auto; }
  header { border-bottom: 1px solid #e5e5e5; padding-bottom: 18px; margin-bottom: 32px; }
  h1 { font-size: 20px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0; }
  .sub { color: #666; font-size: 13px; margin-top: 6px; }
  section { margin-bottom: 34px; page-break-inside: avoid; }
  h2 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: #444; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-weight: 600; color: #666; border-bottom: 1px solid #e5e5e5; padding: 8px 6px; font-size: 11px;
    letter-spacing: 0.06em; text-transform: uppercase; }
  td { padding: 10px 6px; border-bottom: 1px solid #f1f1f1; vertical-align: top; }
  .qty { width: 52px; font-variant-numeric: tabular-nums; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .subtotal { margin: 12px 0 0; text-align: right; font-size: 13px; color: #333; }
  .grand { margin-top: 26px; border-top: 2px solid #111; padding-top: 14px; text-align: right; font-size: 16px; }
  footer { margin-top: 40px; color: #999; font-size: 11px; text-align: center; }
</style></head>
<body><div class="doc">
  <header>
    <h1>Orium Perfumes</h1>
    <p class="sub">Lista de reposição · ${today()}</p>
  </header>
  ${sections || "<p>Nenhum item na lista.</p>"}
  ${withPrices ? `<p class="grand">Total geral <strong>${brl(grand)}</strong></p>` : ""}
  <footer>Documento interno de compra — Orium Perfumes</footer>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;
}

export function openRestockDocument(groups: ExportGroup[], withPrices = true) {
  const win = window.open("", "_blank", "width=860,height=1000");
  if (!win) return false;
  win.document.write(restockDocument(groups, withPrices));
  win.document.close();
  return true;
}

function escapeHtml(v: string) {
  return v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
