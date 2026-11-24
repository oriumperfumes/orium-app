/**
 * Leitura de mídia GRÁTIS, no próprio servidor da ponte (sem IA paga):
 * - áudio e vídeo → texto com whisper.cpp (modelo local, português);
 * - foto do cliente → texto escrito na imagem com Tesseract (comprovante de Pix, rótulo do frasco, valores).
 * O texto vai em wa_messages.transcript e entra na análise e na Resposta ideal.
 *
 * Liga só quando WHISPER_BIN e WHISPER_MODEL existem no .env (no PC fica desligado).
 * Uma mídia por vez, em segundo plano: nunca atrasa a entrega das mensagens.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_SECONDS = 600; // nada acima de 10 min
// lidos na hora do uso: o index.mjs carrega o .env depois dos imports
const cfg = () => ({
  bin: process.env.WHISPER_BIN || "",
  model: process.env.WHISPER_MODEL || "",
  threads: String(Math.max(1, Number(process.env.WHISPER_THREADS) || 3)),
});
export function midiaLocalAtiva() {
  const c = cfg();
  return !!(c.bin && c.model && existsSync(c.bin) && existsSync(c.model));
}

function run(cmd, args, { input, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} saiu com ${code}: ${err.slice(-200)}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

const limpa = (t) =>
  String(t ?? "")
    .replace(/\[(BLANK_AUDIO|MÚSICA|Música|música|MUSIC|Music)[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Áudio ou vídeo → texto falado. */
async function transcrever(buf) {
  const dir = await mkdtemp(join(tmpdir(), "orium-midia-"));
  try {
    const src = join(dir, "in");
    const wav = join(dir, "a.wav");
    await writeFile(src, buf);
    // só a trilha de áudio, 16 kHz mono (formato do whisper); vídeo sem som sai vazio
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vn", "-t", String(MAX_SECONDS), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeoutMs: 120_000 });
    } catch {
      return "";
    }
    if (!existsSync(wav)) return "";
    const c = cfg();
    const out = await run(c.bin, ["-m", c.model, "-f", wav, "-l", "pt", "-t", c.threads, "-nt", "-np"], { timeoutMs: 600_000 });
    return limpa(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Foto → texto escrito nela (Tesseract, português). */
async function lerFoto(buf) {
  const out = await run("tesseract", ["stdin", "stdout", "-l", "por", "--psm", "3"], { input: buf, timeoutMs: 60_000 });
  const t = limpa(out);
  // ruído de foto sem texto (letras soltas) não vale nada
  return t.replace(/[^\p{L}\p{N}]/gu, "").length >= 6 ? t.slice(0, 600) : "";
}

/**
 * Fila de leitura. `gravar(id, texto)` grava no banco; `baixar(path)` traz o arquivo
 * (usado para mídias antigas já guardadas).
 */
export function criarFilaMidia({ gravar, baixar, pendentes, log = console }) {
  const fila = [];
  const naFila = new Set();
  let rodando = false;

  async function processar(job) {
    const buf = job.buf ?? (await baixar(job.media_path));
    if (!buf) return;
    let texto = "";
    if (job.kind === "image") texto = await lerFoto(buf);
    else texto = await transcrever(buf);
    // vazio vira "(sem fala)" no banco: não tenta de novo
    await gravar(job.id, texto);
  }

  async function girar() {
    if (rodando) return;
    rodando = true;
    try {
      while (fila.length) {
        const job = fila.shift();
        try {
          await processar(job);
        } catch (e) {
          log.error("leitura de mídia:", e?.message ?? e);
        } finally {
          naFila.delete(job.id);
        }
      }
    } finally {
      rodando = false;
    }
  }

  function adicionar(job) {
    if (!midiaLocalAtiva() || !job?.id || naFila.has(job.id)) return;
    if (job.kind === "image" && job.from_me) return; // foto da própria loja (divulgação) não precisa
    if (!["audio", "video", "image"].includes(job.kind)) return;
    if ((job.media_seconds ?? 0) > MAX_SECONDS) return;
    naFila.add(job.id);
    // mensagem nova passa na frente das antigas
    if (job.buf) fila.unshift(job);
    else fila.push(job);
    void girar();
  }

  /** Busca mídias antigas ainda não lidas (aos poucos, quando a fila está vazia). */
  async function buscarAntigas() {
    if (!midiaLocalAtiva() || fila.length || rodando) return;
    try {
      const rows = await pendentes(5);
      for (const r of rows ?? []) adicionar(r);
    } catch (e) {
      log.error("mídias pendentes:", e?.message ?? e);
    }
  }

  return { adicionar, buscarAntigas };
}
