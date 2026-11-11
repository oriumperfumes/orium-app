/**
 * ORIUM VOICE ENGINE — fala → texto (servidor), via Orium AI Engine (OpenAI).
 * A chave nunca sai do servidor; o áudio não é guardado.
 */
import { aiTranscribe } from "@/lib/ai/engine.server";

export async function transcribeAudio(file: File, vocabulary: string[] = []): Promise<string> {
  if (!file.size || file.size > 12 * 1024 * 1024) throw new Error("Gravação inválida.");
  const prompt = vocabulary.length
    ? `Comandos de uma perfumaria árabe no Brasil (vendas, estoque, preços, cupons, pedidos). Nomes que podem aparecer: ${vocabulary.slice(0, 90).join(", ")}.`
    : undefined;
  return aiTranscribe(file, prompt);
}
