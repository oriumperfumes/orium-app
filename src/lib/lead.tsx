/**
 * CAPTAÇÃO SEM ATRITO.
 *
 * O visitante navega, favorita e monta carrinho sem informar nada. Só pedimos
 * nome + WhatsApp quando existe um motivo real (salvar escolhas, ajuda para
 * escolher, aviso de estoque, negociação, finalização) — e nunca duas vezes:
 * quem já informou fica preenchido automaticamente.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { identifyLead } from "@/lib/analytics.functions";
import { deviceId } from "@/lib/promotions";
import { lazyUI, MountWhen } from "@/lib/lazy-ui";

const LeadCaptureSheet = lazyUI(() =>
  import("@/components/orium/LeadCaptureSheet").then((m) => ({ default: m.LeadCaptureSheet })),
);

export type LeadTrigger =
  | "salvar_escolhas"
  | "ajuda_para_escolher"
  | "negociacao"
  | "aviso_estoque"
  | "checkout"
  | "outro";

export type Lead = { name: string; phone: string; customerId: string | null };

export type CaptureRequest = {
  trigger: LeadTrigger;
  title?: string;
  subtitle?: string;
  benefit?: string;
  cta?: string;
  /** Executado depois de salvar (ou imediatamente, se já identificado). */
  onDone?: (lead: Lead) => void;
};

type LeadValue = {
  lead: Lead | null;
  ready: boolean;
  /** Abre a captura curta; se a pessoa já está identificada, segue direto. */
  requestLead: (req: CaptureRequest) => void;
  updateLead: (lead: Lead) => void;
  /** Chamada discreta "Salve suas escolhas" já foi recusada? */
  nudgeDismissed: boolean;
  dismissNudge: () => void;
};

const KEY = "orium-lead";
const NUDGE_KEY = "orium-lead-nudge";
const NUDGE_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

// Mantém o mesmo contexto quando o arquivo é recarregado em desenvolvimento
const g = globalThis as unknown as { __oriumLeadCtx?: import("react").Context<LeadValue | null> };
const Ctx = g.__oriumLeadCtx ?? (g.__oriumLeadCtx = createContext<LeadValue | null>(null));

function readLead(): Lead | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw.name === "string" && raw.name.trim()) {
      return {
        name: raw.name,
        phone: typeof raw.phone === "string" ? raw.phone : "",
        customerId: typeof raw.customerId === "string" ? raw.customerId : null,
      };
    }
  } catch {
    /* modo privado */
  }
  return null;
}

export function LeadProvider({ children }: { children: ReactNode }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [ready, setReady] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(true);
  const [request, setRequest] = useState<CaptureRequest | null>(null);

  useEffect(() => {
    setLead(readLead());
    try {
      const at = Number(window.localStorage.getItem(NUDGE_KEY) ?? 0);
      setNudgeDismissed(!!at && Date.now() - at < NUDGE_COOLDOWN);
    } catch {
      setNudgeDismissed(false);
    }
    setReady(true);
  }, []);

  const updateLead = useCallback((next: Lead) => {
    setLead(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* modo privado: segue só em memória */
    }
  }, []);

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true);
    try {
      window.localStorage.setItem(NUDGE_KEY, String(Date.now()));
    } catch {
      /* modo privado */
    }
  }, []);

  const requestLead = useCallback(
    (req: CaptureRequest) => {
      if (lead?.name && lead.phone) {
        req.onDone?.(lead);
        return;
      }
      setRequest(req);
    },
    [lead],
  );

  const submit = useCallback(
    async (values: { name: string; phone: string; marketingOptin: boolean }) => {
      const req = request;
      const res = await identifyLead({
        data: {
          visitorId: deviceId() ?? "",
          name: values.name,
          phone: values.phone,
          trigger: req?.trigger ?? "outro",
          marketingOptin: values.marketingOptin,
        },
      });
      const next: Lead = { name: values.name, phone: values.phone, customerId: res.customerId };
      updateLead(next);
      dismissNudge();
      setRequest(null);
      req?.onDone?.(next);
    },
    [request, updateLead, dismissNudge],
  );

  const value = useMemo<LeadValue>(
    () => ({ lead, ready, requestLead, updateLead, nudgeDismissed, dismissNudge }),
    [lead, ready, requestLead, updateLead, nudgeDismissed, dismissNudge],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <MountWhen when={!!request}>
        <LeadCaptureSheet
          request={request}
          lead={lead}
          onOpenChange={(open) => {
            if (!open) setRequest(null);
          }}
          onSubmit={submit}
        />
      </MountWhen>
    </Ctx.Provider>
  );
}

export function useLead(): LeadValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLead precisa estar dentro de LeadProvider");
  return ctx;
}
