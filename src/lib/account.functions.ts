import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Foto de perfil do cliente.
 *
 * A imagem já chega pequena (recortada e comprimida no aparelho) e fica no
 * mesmo armazenamento privado das fotos de produto, servida pela rota pública
 * `/api/public/produto-foto` — que só entrega imagens desse espaço.
 * O endereço curto vai para o perfil (user_metadata), nunca a imagem em si.
 */
export const uploadAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { base64: string; contentType: string }) => {
    if (!data?.base64) throw new Error("Escolha uma foto.");
    if (!/^image\/(jpeg|webp)$/.test(data.contentType)) throw new Error("Use uma foto JPG ou WEBP.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    if (!userId) throw new Error("Entre na sua conta para trocar a foto.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.byteLength > 700 * 1024) throw new Error("Foto muito grande.");
    const ext = data.contentType === "image/webp" ? "webp" : "jpg";
    const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, "");
    const path = `avatar-${safeUser}-${Date.now()}.${ext}`;

    const { error } = await db.storage.from("produtos").upload(path, bytes, {
      contentType: data.contentType,
      upsert: false,
    });
    if (error) throw new Error("Não conseguimos salvar a foto agora.");

    return { url: `/api/public/produto-foto?path=${path}` };
  });
