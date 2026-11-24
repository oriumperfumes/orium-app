import { useQuery } from "@tanstack/react-query";
import { waAvatars } from "@/lib/crm-wa.functions";

const EMPTY: Record<string, string> = {};

/** Fotos de perfil do WhatsApp por jid (cache de 1 h; a lista de conversas não carrega mais as fotos). */
export function useWaAvatars(): Record<string, string> {
  const q = useQuery({
    queryKey: ["wa-avatars"],
    queryFn: () => waAvatars(),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  return q.data ?? EMPTY;
}
