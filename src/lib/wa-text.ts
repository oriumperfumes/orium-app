/**
 * Texto de uma mensagem do WhatsApp para a IA (análise e Resposta ideal).
 * Áudio e vídeo entram com o que foi falado e foto com o texto escrito nela —
 * tudo lido de graça no servidor da ponte (whisper.cpp + Tesseract).
 */
export type WaMsgForAi = {
  body: string | null;
  kind: string;
  transcript?: string | null;
};

const lida = (t?: string | null) => (t && t !== "(sem fala)" ? t.trim().slice(0, 600) : "");

export function waTextForAi(m: WaMsgForAi): string {
  const t = lida(m.transcript);
  const body = (m.body ?? "").trim();
  if (m.kind === "audio") return t ? `[áudio] ${t}` : "[áudio]";
  if (m.kind === "video" || m.kind === "gif")
    return [body, t && `[fala no vídeo] ${t}`].filter(Boolean).join(" ") || "[vídeo]";
  if (m.kind === "image")
    return [body, t && `[texto na foto] ${t}`].filter(Boolean).join(" ") || "[foto]";
  return body || `[${m.kind}]`;
}
