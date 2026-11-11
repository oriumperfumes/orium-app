import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Preços globais dos decants (Admin → Configurações → Decants). */
export function useDecantSettings() {
  const { data } = useQuery({
    queryKey: ["decant-settings"],
    queryFn: async () => (await supabase.from("decant_settings").select("*").maybeSingle()).data,
    staleTime: 10 * 60 * 1000,
  });
  return data;
}
