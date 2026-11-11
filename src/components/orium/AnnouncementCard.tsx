import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Check, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { deviceId } from "@/lib/promotions";
import { getAnnouncement, markAnnouncementSeen, type Announcement } from "@/lib/promotions.functions";
import { THEME_STYLE } from "@/lib/campaign-message";
import { CELEBRATION, ConfettiBurst, CountUp, useCelebrateOnce } from "@/lib/celebration";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";


/**
 * Comunicação da campanha — texto definido pelo Admin, exibido uma única vez
 * por pessoa. Entra como uma recompensa discreta: card sobe, conteúdo aparece,
 * o desconto surge por último. Sai suavemente e nunca volta na mesma campanha.
 */
export function AnnouncementCard({ onExplore }: { onExplore?: () => void }) {
  const { session } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const load = useServerFn(getAnnouncement);
  const mark = useServerFn(markAnnouncementSeen);
  const [item, setItem] = useState<Announcement>(null);
  const [leaving, setLeaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await load({ data: { deviceId: deviceId(), userId: session?.user.id ?? null } });
        if (!cancelled) setItem(res);
      } catch {
        /* aviso é opcional: nunca atrapalha o catálogo */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  // Desbloqueio da vantagem: burst leve depois do código aparecer, uma única
  // vez por campanha/cupom.
  const celebrate = useCelebrateOnce(
    item ? `announce:${item.kind}:${item.id}` : null,
    CELEBRATION.reveal + CELEBRATION.stagger * 3,
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);



  if (!item) return null;

  const style = THEME_STYLE[item.theme];

  /** Fecha com animação para baixo e registra a exibição (não volta nessa campanha). */
  const close = (clicked: boolean, delay = 0) => {
    const current = item;
    const go = () => {
      setLeaving(true);
      timers.current.push(setTimeout(() => setItem(null), 240));
      void mark({
        data: {
          kind: current.kind,
          id: current.id,
          deviceId: deviceId(),
          userId: session?.user.id ?? null,
          clicked,
        },
      });
    };
    if (delay) timers.current.push(setTimeout(go, delay));
    else go();
  };

  const act = () => {
    if (item.code) {
      cart.saveCoupon(item.code);
      cart.applyCoupon(item.code);
      setSaved(true);
      toast.success(`Cupom ${item.code} guardado na sua sacola.`);
    }
    const target = item.target;
    if (target) {
      // Campanha de produto específico abre exatamente esse produto (pelo ID real).
      void navigate({
        to: "/perfume/$slug",

        params: { slug: target.slug },
        search: target.variant === "DECANT" ? (target.decantMl ? { ml: target.decantMl } : {}) : { frasco: 1 },
      });
    } else if (!item.code) {
      onExplore?.();
    }
    close(true, item.code ? 950 : 0);
  };

  return (
    <div
      className={cn(
        "reward-card relative mb-4 overflow-hidden rounded-[28px] bg-[#161616] p-4 text-white ring-1 ring-white/[0.07] tab:p-5 lg:mx-auto lg:max-w-[760px]",
        leaving ? "reward-out" : "reward-in",
      )}
    >
      <ConfettiBurst active={celebrate} intensity="soft" />
      <div className="flex items-start gap-3.5">
        <span className="reward-step grid size-[52px] shrink-0 place-items-center rounded-[16px] bg-[#FFD599] text-[#15130F]" style={{ "--d": "20ms" } as React.CSSProperties}>
          {saved ? <Check className="check-pop size-[22px]" strokeWidth={2.6} /> : <Ticket className="size-[22px]" strokeWidth={2.2} />}
        </span>
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "reward-value inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-bold break-words",
              style.badge,
            )}
          >
            <PercentBadge badge={item.badge} percent={item.percent} />
          </span>
          <p className="reward-step mt-1.5 pr-2 text-[17px] leading-snug font-bold tracking-[-0.015em] break-words" style={{ "--d": "60ms" } as React.CSSProperties}>
            {item.title}
          </p>
          {item.message ? (
            <p className="reward-step mt-0.5 text-[13.5px] leading-snug text-[#A9A9A9] break-words" style={{ "--d": "140ms" } as React.CSSProperties}>
              {item.message}
            </p>
          ) : null}
        </div>
        <button className="pop-close press -mt-1 -mr-1" aria-label="Fechar aviso" onClick={() => close(false)}>
          <X className="size-[15px]" strokeWidth={2.4} />
        </button>
      </div>

      {item.code ? (
        /* o cupom como um ticket: picote, código grande e o recorte dos lados */
        <div className="reward-step relative mt-4 flex items-center justify-between gap-3 rounded-[16px] border border-dashed border-[#FFD599]/45 bg-[#FFD599]/[0.06] px-4 py-3" style={{ "--d": "260ms" } as React.CSSProperties}>
          <span aria-hidden className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full bg-[#161616]" />
          <span aria-hidden className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full bg-[#161616]" />
          <span className="text-[12px] font-semibold text-[#A9A9A9]">Seu cupom</span>
          <span className="font-mono text-[17px] font-bold tracking-[0.14em] text-[#FFD599] uppercase">{item.code}</span>
        </div>
      ) : null}

      <button
        className="press reward-step mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#FFD599] px-4 text-[15px] font-bold text-[#15130F] transition-colors hover:bg-[#FFDDAA]"
        style={{ "--d": "380ms" } as React.CSSProperties}
        onClick={act}
      >
        {saved ? (
          <>
            <Check className="check-pop size-4" /> Cupom guardado na sacola
          </>
        ) : (
          item.ctaLabel
        )}
      </button>
      {item.footnote ? (
        <p className="reward-step mt-2 text-center text-[11.5px] text-[#8C8C8C] break-words" style={{ "--d": "420ms" } as React.CSSProperties}>
          {item.footnote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * O percentual real da vantagem cresce de 0% até o valor verdadeiro dentro do
 * texto escrito no Admin. Se o texto não citar o percentual, mostra o texto tal
 * como está — nada é inventado.
 */
function PercentBadge({ badge, percent }: { badge: string; percent: number }) {
  const rounded = Math.round(percent);
  const token = `${rounded}%`;
  const at = rounded > 0 ? badge.indexOf(token) : -1;
  if (at < 0) return <>{badge}</>;
  return (
    <>
      {badge.slice(0, at)}
      <CountUp value={rounded} format={(n) => `${Math.round(n)}%`} />
      {badge.slice(at + token.length)}
    </>
  );
}
