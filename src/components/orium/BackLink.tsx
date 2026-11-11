import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Voltar respeitando de onde o cliente veio: busca, catálogo filtrado,
 * Queridinhos, negociação ou recomendações. Sem histórico (link direto),
 * cai com segurança no catálogo.
 */
export function BackLink({ label = "Catálogo", className }: { label?: string; className?: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const cls = cn(
    "press inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground",
    className,
  );

  if (canGoBack) {
    return (
      <button type="button" onClick={() => router.history.back()} className={cls}>
        <ArrowLeft className="size-4" /> {label}
      </button>
    );
  }

  return (
    <Link to="/" className={cls}>
      <ArrowLeft className="size-4" /> {label}
    </Link>
  );
}
