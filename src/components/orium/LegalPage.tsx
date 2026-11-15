import { Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/orium/SiteHeader";
import { SiteFooter } from "@/components/orium/SiteFooter";
import type { ReactNode } from "react";

/**
 * RASCUNHO JURIDICO. Enquanto for `true`, as paginas de Privacidade e Termos mostram um aviso de rascunho e
 * mantem `noindex`. Antes de publicar: preencher os campos [PREENCHER] em `src/lib/legal-info.ts`, revisar os
 * textos com quem responde pela Orium (e, se possivel, um advogado) e so entao mudar para `false`.
 */
export const LEGAL_DRAFT = true;

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#101010] text-white">
      <SiteHeader />
      <main className="shell py-10 lg:py-16">
        <article className="mx-auto max-w-[72ch]">
          <p className="text-[13px] text-[#8C8C8C]">
            <Link to="/" search={{} as never} className="hover:text-white">
              Orium Perfumes
            </Link>
          </p>
          <h1 className="mt-3 text-[30px] leading-tight font-semibold tracking-tight lg:text-[40px]">{title}</h1>
          <p className="mt-2 text-[13px] text-[#8C8C8C]">Atualizado em {updated}</p>
          {LEGAL_DRAFT && (
            <p
              role="note"
              className="mt-6 rounded-2xl border border-[#E5B96A]/30 bg-[#E5B96A]/10 px-4 py-3 text-[14px] leading-relaxed text-[#F2D9A6]"
            >
              Rascunho em revisão. Este texto ainda não foi aprovado pela Orium e pode mudar. Os campos entre colchetes
              serão preenchidos antes da publicação.
            </p>
          )}
          <div className="legal mt-8 space-y-8 text-[16px] leading-relaxed text-[#D6D6D6] [&_h2]:mb-3 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-white [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-6">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
