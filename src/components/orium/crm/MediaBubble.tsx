/**
 * Mídia das conversas do WhatsApp no CRM: foto (com tela cheia), vídeo, GIF,
 * figurinha, documento e áudio com player próprio (ondas, velocidade e transcrição).
 * Os arquivos ficam no armazenamento privado "wa-media"; a equipe vê por link assinado.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { waTranscribe, type WaMessage } from "@/lib/crm-wa.functions";
import { cn } from "@/lib/utils";

/** Link assinado (1 h) para um arquivo do bucket privado. */
export function useMediaUrl(path?: string | null) {
  return useQuery({
    queryKey: ["wa-media-url", path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from("wa-media").createSignedUrl(path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

const fmtTime = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const fmtSize = (b?: number | null) =>
  !b
    ? ""
    : b > 1_048_576
      ? `${(b / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Placeholder enquanto a ponte ainda não baixou a mídia. */
function Pending({ label, mine }: { label: string; mine: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[14px] px-3 py-2.5 text-[13px]",
        mine ? "bg-[#15130F]/10 text-[#15130F]/70" : "bg-white/[0.05] text-[#A9A9A9]",
      )}
    >
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function MediaContent({ m, mine }: { m: WaMessage; mine: boolean }) {
  if (m.kind === "audio") return <AudioPlayer m={m} mine={mine} />;
  if (m.kind === "image") return <ImageMedia m={m} mine={mine} />;
  if (m.kind === "sticker") return <StickerMedia m={m} mine={mine} />;
  if (m.kind === "video" || m.kind === "gif") return <VideoMedia m={m} mine={mine} />;
  if (m.kind === "document") return <DocMedia m={m} mine={mine} />;
  return null;
}

export const isMediaKind = (k: string) =>
  ["audio", "image", "sticker", "video", "gif", "document"].includes(k);

function boxFor(w?: number | null, h?: number | null, max = 300) {
  if (!w || !h) return { width: max, height: Math.round(max * 0.75) };
  const r = h / w;
  const width = Math.min(max, w);
  return { width, height: Math.min(Math.round(width * r), 420) };
}

function ImageMedia({ m, mine }: { m: WaMessage; mine: boolean }) {
  const url = useMediaUrl(m.media_path);
  const [open, setOpen] = useState(false);
  if (!m.media_path) return <Pending label="Baixando foto…" mine={mine} />;
  const box = boxFor(m.media_w, m.media_h);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-[16px] bg-black/20"
        style={{ width: box.width, maxWidth: "100%", aspectRatio: `${box.width} / ${box.height}` }}
        aria-label="Ver foto"
      >
        {url.data ? (
          <img
            src={url.data}
            alt="Foto enviada"
            className="size-full object-cover transition-transform duration-300 hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <span className="admin-skeleton block size-full" />
        )}
      </button>
      {open && url.data ? <Lightbox src={url.data} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function StickerMedia({ m, mine }: { m: WaMessage; mine: boolean }) {
  const url = useMediaUrl(m.media_path);
  if (!m.media_path) return <Pending label="Figurinha" mine={mine} />;
  return url.data ? (
    <img
      src={url.data}
      alt="Figurinha"
      className="size-[140px] object-contain drop-shadow-lg"
      loading="lazy"
    />
  ) : (
    <span className="admin-skeleton block size-[140px] rounded-[20px]" />
  );
}

function VideoMedia({ m, mine }: { m: WaMessage; mine: boolean }) {
  const url = useMediaUrl(m.media_path);
  if (!m.media_path)
    return <Pending label={m.kind === "gif" ? "Baixando GIF…" : "Baixando vídeo…"} mine={mine} />;
  const box = boxFor(m.media_w, m.media_h);
  if (!url.data)
    return (
      <span
        className="admin-skeleton block rounded-[16px]"
        style={{ width: box.width, maxWidth: "100%", aspectRatio: `${box.width} / ${box.height}` }}
      />
    );
  return m.kind === "gif" ? (
    <video
      src={url.data}
      autoPlay
      loop
      muted
      playsInline
      className="rounded-[16px]"
      style={{ width: box.width, maxWidth: "100%" }}
    />
  ) : (
    <video
      src={url.data}
      controls
      preload="metadata"
      playsInline
      className="rounded-[16px] bg-black"
      style={{ width: box.width, maxWidth: "100%" }}
    />
  );
}

function DocMedia({ m, mine }: { m: WaMessage; mine: boolean }) {
  const url = useMediaUrl(m.media_path);
  const name = m.file_name || "Documento";
  return (
    <a
      href={url.data ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex min-w-[220px] items-center gap-3 rounded-[16px] p-2.5",
        mine ? "bg-[#15130F]/10" : "bg-white/[0.05] hover:bg-white/[0.08]",
        !url.data && "pointer-events-none opacity-70",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-[12px]",
          mine ? "bg-[#15130F] text-[#FFD599]" : "bg-[#FFD599] text-[#15130F]",
        )}
      >
        <FileText className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">{name}</span>
        <span className={cn("block text-[11.5px]", mine ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>
          {m.media_path
            ? [fmtSize(m.media_size), (name.split(".").pop() || "").toUpperCase()]
                .filter(Boolean)
                .join(" · ")
            : "Baixando…"}
        </span>
      </span>
      {url.data ? <Download className="size-4 shrink-0 opacity-70" /> : null}
    </a>
  );
}

/** Tela cheia para fotos, com baixar e fechar (Esc). */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Foto"
    >
      <img
        src={src}
        alt=""
        className="max-h-[88dvh] max-w-[92vw] rounded-[18px] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="fixed top-4 right-4 flex gap-2">
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="press grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Abrir original"
        >
          <Download className="size-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="press grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Fechar"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────────────── áudio ───────────────────────── */

const BARS = 42;
const waveCache = new Map<string, number[]>();

/** Ondas de verdade (lidas do áudio); se o navegador não decodificar, ondas suaves fixas. */
function useWaveform(id: string, url?: string) {
  const [peaks, setPeaks] = useState<number[] | null>(() => waveCache.get(id) ?? null);
  useEffect(() => {
    if (!url || waveCache.has(id)) return;
    let dead = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const step = Math.floor(data.length / BARS) || 1;
        const raw = Array.from({ length: BARS }, (_, i) => {
          let sum = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16)
            sum += Math.abs(data[j] ?? 0);
          return sum / (step / 16);
        });
        const max = Math.max(...raw, 0.0001);
        const p = raw.map((v) => Math.max(0.12, Math.min(1, v / max)));
        waveCache.set(id, p);
        if (!dead) setPeaks(p);
      } catch {
        // fallback: ondas estáveis a partir do id
        let h = 0;
        for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        const p = Array.from(
          { length: BARS },
          (_, i) => 0.25 + 0.75 * Math.abs(Math.sin((h % 97) + i * 0.7) * Math.cos(i * 0.31)),
        );
        waveCache.set(id, p);
        if (!dead) setPeaks(p);
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, url]);
  return peaks;
}

const SPEEDS = [1, 1.5, 2] as const;

function AudioPlayer({ m, mine }: { m: WaMessage; mine: boolean }) {
  const qc = useQueryClient();
  const url = useMediaUrl(m.media_path);
  const peaks = useWaveform(m.id, url.data);
  const ref = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(m.media_seconds ?? 0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [showText, setShowText] = useState(!!m.transcript);
  const transcribe = useMutation({
    mutationFn: () => waTranscribe({ data: { id: m.id } }),
    onSuccess: () => {
      setShowText(true);
      void qc.invalidateQueries({ queryKey: ["wa-thread", m.jid] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui transcrever"),
  });
  const text = m.transcript ?? transcribe.data?.transcript ?? null;

  useEffect(() => {
    const a = ref.current;
    if (a) a.playbackRate = speed;
  }, [speed]);
  // só um áudio tocando por vez
  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== m.id) ref.current?.pause();
    };
    window.addEventListener("orium-audio-play", stop);
    return () => window.removeEventListener("orium-audio-play", stop);
  }, [m.id]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      window.dispatchEvent(new CustomEvent("orium-audio-play", { detail: m.id }));
      void a.play().catch(() => toast.error("Esse navegador não conseguiu tocar o áudio"));
    } else a.pause();
  };
  const seek = (e: RPointerEvent<HTMLDivElement>) => {
    const a = ref.current;
    const el = barRef.current;
    if (!a || !el || !dur) return;
    const r = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    a.currentTime = pct * dur;
    setTime(a.currentTime);
  };

  const progress = dur ? time / dur : 0;
  const bars = useMemo(() => peaks ?? Array.from({ length: BARS }, () => 0.3), [peaks]);
  const ready = !!url.data;

  return (
    <div className="w-[min(300px,72vw)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
          className={cn(
            "press grid size-11 shrink-0 place-items-center rounded-full shadow-sm transition-transform disabled:opacity-50",
            mine ? "bg-[#15130F] text-[#FFD599]" : "bg-[#FFD599] text-[#15130F]",
          )}
        >
          {!m.media_path ? (
            <Loader2 className="size-5 animate-spin" />
          ) : playing ? (
            <Pause className="size-5" fill="currentColor" />
          ) : (
            <Play className="ml-0.5 size-5" fill="currentColor" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div
            ref={barRef}
            onPointerDown={seek}
            role="slider"
            aria-label="Posição do áudio"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur)}
            aria-valuenow={Math.round(time)}
            className="flex h-8 cursor-pointer items-center gap-[2px]"
          >
            {bars.map((p, i) => {
              const on = i / bars.length < progress;
              return (
                <span
                  key={i}
                  className={cn(
                    "w-[3px] shrink-0 rounded-full transition-colors duration-150",
                    on
                      ? mine
                        ? "bg-[#15130F]"
                        : "bg-[#FFD599]"
                      : mine
                        ? "bg-[#15130F]/25"
                        : "bg-white/25",
                  )}
                  style={{ height: `${Math.round(6 + p * 22)}px` }}
                />
              );
            })}
          </div>
          <div
            className={cn(
              "mt-0.5 flex items-center justify-between text-[11px] font-semibold tabular-nums",
              mine ? "text-[#15130F]/60" : "text-[#8C8C8C]",
            )}
          >
            <span>{playing || time > 0 ? fmtTime(time) : fmtTime(dur)}</span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)}
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10.5px] font-bold",
                  mine ? "bg-[#15130F]/10" : "bg-white/[0.08] text-[#D4D4D4]",
                )}
                aria-label="Velocidade"
              >
                {speed}x
              </button>
              {m.media_path ? (
                <button
                  type="button"
                  onClick={() => (text ? setShowText((v) => !v) : transcribe.mutate())}
                  disabled={transcribe.isPending}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10.5px] font-bold",
                    mine ? "bg-[#15130F]/10" : "bg-white/[0.08] text-[#D4D4D4]",
                  )}
                >
                  {transcribe.isPending
                    ? "Transcrevendo…"
                    : text
                      ? showText
                        ? "Ocultar texto"
                        : "Ver texto"
                      : "Transcrever"}
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </div>
      {showText && text ? (
        <p
          className={cn(
            "mt-2 rounded-[12px] px-2.5 py-2 text-[13px] leading-snug italic",
            mine ? "bg-[#15130F]/8 text-[#15130F]/85" : "bg-white/[0.05] text-[#D4D4D4]",
          )}
        >
          “{text}”
        </p>
      ) : null}
      {url.data ? (
        <audio
          ref={ref}
          src={url.data}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDur(d);
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          className="hidden"
        />
      ) : null}
    </div>
  );
}
