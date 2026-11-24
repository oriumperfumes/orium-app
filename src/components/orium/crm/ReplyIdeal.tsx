/**
 * RESPOSTA IDEAL — o "copiloto de vendas" dentro da conversa.
 * Mostra a resposta exatamente como vai sair (balão dourado), editável ali mesmo,
 * com versões, o porquê em uma linha e um botão grande de enviar. O plano
 * (próximo passo, retomada em 24h e o que evitar) fica guardado num "ver mais".
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Copy, Lightbulb, RefreshCw, SendHorizontal, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { crmSuggestReply } from "@/lib/crm-wa.functions";
import { REPLY_GOALS, type ReplyGoal, type ReplySuggestion } from "@/lib/sales-playbook";
import { cn } from "@/lib/utils";

const HEAT: Record<string, { label: string; dot: string }> = {
  frio: { label: "Frio", dot: "#8C8C8C" },
  morno: { label: "Morno", dot: "#F2C46D" },
  quente: { label: "Quente", dot: "#FFB86B" },
  pronto: { label: "Pronto pra comprar", dot: "#7FCF9F" },
};

export function ReplyIdeal({
  jid,
  startKey,
  onClose,
  onSend,
  disabled,
}: {
  jid: string;
  /** muda a cada clique em "Resposta ideal" (gera de novo) */
  startKey: number;
  onClose: () => void;
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [goal, setGoal] = useState<ReplyGoal>("auto");
  const [ai, setAi] = useState<ReplySuggestion | null>(null);
  const [ver, setVer] = useState(0);
  const [text, setText] = useState("");
  const [focusOpen, setFocusOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const gen = useMutation({
    mutationFn: (g: ReplyGoal) => crmSuggestReply({ data: { jid, goal: g } }),
    onMutate: () => {
      setAi(null);
      setVer(0);
      setPlanOpen(false);
    },
    onSuccess: (r) => {
      setAi(r);
      setText(r.reply);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A IA não respondeu agora"),
  });
  useEffect(() => {
    gen.mutate(goal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey]);

  const versions = ai
    ? [
        { label: "Principal", text: ai.reply },
        ...(ai.short ? [{ label: "Curta", text: ai.short }] : []),
        ...ai.alternativas.map((a) => ({ label: a.rotulo || "Outra abordagem", text: a.texto })),
      ].filter((v) => v.text)
    : [];
  const pick = (i: number) => {
    setVer(i);
    setText(versions[i]?.text ?? "");
  };
  // balão cresce com o texto
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(220, t.scrollHeight)}px`;
  }, [text, ai]);

  const heat = ai ? HEAT[ai.temperatura] : null;
  const goalLabel = REPLY_GOALS.find((g) => g.v === goal)?.label ?? "Automático";

  return (
    <section className="relative mb-3 overflow-hidden rounded-[26px] border border-[#FFD599]/25 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(255,213,153,0.10),transparent_60%),#151310] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
      {/* cabeçalho */}
      <header className="flex items-center gap-3 px-4 pt-4 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFE3B8] to-[#E9B865] text-[#15130F] shadow-[0_0_24px_rgba(255,213,153,0.35)]">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-tight font-bold">Resposta ideal</p>
          <p className="truncate text-[12.5px] text-[#A9A9A9]">
            {gen.isPending ? "Lendo a conversa, o perfil e os preços…" : (ai?.situacao ?? "")}
          </p>
        </div>
        {heat ? (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[12px] font-bold text-[#E5E5E5] sm:inline-flex">
            <span className="size-2 rounded-full" style={{ background: heat.dot }} />
            {heat.label}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="press grid size-9 shrink-0 place-items-center rounded-full text-[#A9A9A9] hover:bg-white/[0.06] hover:text-white"
        >
          <X className="size-[18px]" />
        </button>
      </header>

      {/* o balão como vai sair */}
      <div className="px-4 pt-4 sm:px-5">
        {gen.isPending ? (
          <div className="ml-auto w-[88%] rounded-[22px] rounded-tr-[8px] bg-[#FFD599]/15 p-4">
            <div className="admin-skeleton h-3.5 w-[92%] rounded-full" />
            <div className="admin-skeleton mt-2.5 h-3.5 w-[78%] rounded-full" />
            <div className="admin-skeleton mt-2.5 h-3.5 w-[55%] rounded-full" />
          </div>
        ) : ai ? (
          <>
            <div className="ml-auto w-full max-w-[560px] rounded-[22px] rounded-tr-[8px] bg-[#FFD599] px-4 py-3 text-[#15130F] shadow-[0_8px_30px_rgba(255,213,153,0.18)]">
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                aria-label="Texto da resposta (pode editar)"
                className="pk-field block w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#15130F] caret-[#15130F] outline-none placeholder:text-[#15130F]/40"
              />
            </div>
            <p className="mt-1.5 text-right text-[11.5px] text-[#6F6F6F]">
              Toque no texto para ajustar antes de enviar
            </p>
          </>
        ) : (
          <p className="py-4 text-center text-[13.5px] text-[#8C8C8C]">
            Não consegui gerar agora. Tente de novo.
          </p>
        )}
      </div>

      {/* versões */}
      {versions.length > 1 && !gen.isPending ? (
        <div className="adm-scroll flex gap-1.5 overflow-x-auto px-4 pt-3 sm:px-5">
          {versions.map((v, i) => (
            <button
              key={v.label + i}
              type="button"
              aria-pressed={ver === i}
              onClick={() => pick(i)}
              className={cn(
                "press h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-bold transition-colors",
                ver === i
                  ? "bg-white text-[#15130F]"
                  : "bg-white/[0.06] text-[#D4D4D4] hover:bg-white/[0.1] hover:text-white",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* por que funciona */}
      {ai?.por_que && !gen.isPending ? (
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-start gap-2 rounded-[16px] bg-white/[0.04] p-3 text-left sm:mx-5 sm:w-[calc(100%-2.5rem)]"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-[#FFD599]" />
          <span
            className={cn(
              "min-w-0 text-[13px] leading-snug text-[#D4D4D4]",
              !whyOpen && "line-clamp-1",
            )}
          >
            {ai.tecnica ? <span className="font-bold text-[#FFD599]">{ai.tecnica}: </span> : null}
            {ai.por_que}
          </span>
        </button>
      ) : null}

      {/* ações */}
      <footer className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-4 sm:px-5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setFocusOpen((v) => !v)}
            className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-[13px] font-bold text-[#D4D4D4] hover:text-white"
          >
            Foco: {goalLabel} <ChevronDown className="size-4 opacity-70" />
          </button>
          {focusOpen ? (
            <>
              <button
                type="button"
                aria-label="Fechar"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setFocusOpen(false)}
              />
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[210px] rounded-[18px] border border-white/[0.08] bg-[#1C1C1C] p-1.5 shadow-2xl">
                {REPLY_GOALS.map((g) => (
                  <button
                    key={g.v}
                    type="button"
                    onClick={() => {
                      setGoal(g.v);
                      setFocusOpen(false);
                      gen.mutate(g.v);
                    }}
                    className={cn(
                      "flex h-10 w-full items-center rounded-[12px] px-3 text-left text-[13.5px] font-semibold hover:bg-white/[0.06]",
                      goal === g.v && "text-[#FFD599]",
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => gen.mutate(goal)}
          disabled={gen.isPending}
          className="press inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-[13px] font-bold text-[#D4D4D4] hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={cn("size-4", gen.isPending && "animate-spin")} /> Outra
        </button>
        <button
          type="button"
          onClick={() => text.trim() && onSend(text.trim())}
          disabled={!text.trim() || gen.isPending || disabled}
          className="press ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-[#FFD599] px-6 text-[14.5px] font-bold text-[#15130F] shadow-[0_6px_24px_rgba(255,213,153,0.25)] disabled:opacity-40"
        >
          Enviar <SendHorizontal className="size-[18px]" />
        </button>
      </footer>

      {/* plano (guardado) */}
      {ai && !gen.isPending && (ai.next_step || ai.se_nao_responder || ai.evitar) ? (
        <div className="border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setPlanOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12.5px] font-bold text-[#A9A9A9] hover:text-white sm:px-5"
          >
            <ChevronDown className={cn("size-4 transition-transform", !planOpen && "-rotate-90")} />{" "}
            Plano da venda
          </button>
          {planOpen ? (
            <div className="space-y-2.5 px-4 pb-4 text-[13px] leading-snug sm:px-5">
              {ai.next_step ? (
                <p className="text-[#D4D4D4]">
                  <span className="font-bold text-white">Quando responder: </span>
                  {ai.next_step}
                </p>
              ) : null}
              {ai.se_nao_responder ? (
                <div className="flex items-start gap-2 rounded-[14px] bg-white/[0.04] p-3">
                  <p className="min-w-0 flex-1 text-[#D4D4D4]">
                    <span className="font-bold text-white">Se sumir por 24h: </span>
                    {ai.se_nao_responder}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(ai.se_nao_responder);
                      toast.success("Mensagem copiada");
                    }}
                    aria-label="Copiar"
                    className="press grid size-8 shrink-0 place-items-center rounded-full text-[#FFD599] hover:bg-white/[0.06]"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
              ) : null}
              {ai.evitar ? (
                <p className="text-[#FFB3A7]">
                  <span className="font-bold">Evite: </span>
                  {ai.evitar}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
