import { Link } from "@tanstack/react-router";
import { OriumLogoLink } from "@/components/orium/OriumLogo";
import { HelpChooseSheetTrigger } from "@/components/orium/HelpChooseButton";

const WHATSAPP = "5521977174508";
const PHONE_LABEL = "(21) 97717-4508";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Olá! Vim pelo site da Orium e queria tirar uma dúvida.")}`;

/**
 * Rodapé da loja. Celular e tablet: uma linha discreta logo abaixo do conteúdo
 * (com o espaço da barra inferior). Computador: marca, atalhos e atendimento.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const link = "text-[15px] text-[#A9A9A9] transition-colors duration-200 hover:text-white";
  return (
    <footer className="text-[#8C8C8C]">
      {/* celular e tablet */}
      <p className="shell pt-2 pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-center text-[12px] leading-relaxed lg:hidden">
        Orium Perfumes · Perfumes árabes em decants e frascos · WhatsApp {PHONE_LABEL}
      </p>

      {/* computador */}
      <div className="hidden border-t border-white/[0.06] lg:block">
        <div className="shell grid grid-cols-[1.6fr_1fr_1fr] gap-12 pt-14 pb-10">
          <div>
            <OriumLogoLink className="[&_span]:h-[40px] [&_span]:w-[30px]" />
            <p className="mt-5 max-w-[34ch] text-[15px] leading-relaxed text-[#A9A9A9]">
              Perfumes árabes em decants e frascos. Prove em 2, 5 ou 10 ml antes de levar o frasco.
            </p>
          </div>
          <nav aria-label="Loja">
            <p className="text-[13px] font-semibold tracking-[0.06em] text-white uppercase">Loja</p>
            <ul className="mt-4 space-y-3">
              <li>
                <Link to="/" search={{} as never} className={link}>
                  Início
                </Link>
              </li>
              <li>
                <Link to="/" search={{ ver: "catalogo" } as never} className={link}>
                  Catálogo
                </Link>
              </li>
              <li>
                <Link to="/favoritos" className={link}>
                  Favoritos
                </Link>
              </li>
            </ul>
          </nav>
          <div>
            <p className="text-[13px] font-semibold tracking-[0.06em] text-white uppercase">Atendimento</p>
            <ul className="mt-4 space-y-3">
              <li>
                <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={link}>
                  WhatsApp {PHONE_LABEL}
                </a>
              </li>
              <li>
                <HelpChooseSheetTrigger source="rodape" className={`${link} text-left`}>
                  Ajuda para escolher
                </HelpChooseSheetTrigger>
              </li>
              <li className="text-[15px] text-[#8C8C8C]">Atacado a partir de 6 peças</li>
            </ul>
          </div>
        </div>
        <div className="shell flex items-center justify-between border-t border-white/[0.06] py-6 text-[13px]">
          <span>© {year} Orium Perfumes</span>
          <span>Pedidos finalizados pelo WhatsApp</span>
        </div>
      </div>
    </footer>
  );
}
