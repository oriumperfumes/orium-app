import { OriumLogoLink } from "@/components/orium/OriumLogo";

/** Marca no header do catálogo: somente o símbolo oficial da Orium. */
export function HeaderBrand({ className }: { className?: string | undefined }) {
  return <OriumLogoLink className={className} />;
}
