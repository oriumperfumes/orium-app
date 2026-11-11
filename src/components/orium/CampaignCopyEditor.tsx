import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN_LIMITS,
  THEME_LABEL,
  THEME_STYLE,
  renderCampaign,
  unknownPlaceholders,
  type CampaignTheme,
  type CampaignVars,
} from "@/lib/campaign-message";

export type CampaignCopyValue = {
  title: string;
  message: string;
  cta: string;
  footnote: string;
  theme: CampaignTheme;
  showAgain: boolean;
};

export const emptyCampaignCopy = (): CampaignCopyValue => ({
  title: "",
  message: "",
  cta: "",
  footnote: "",
  theme: "DEFAULT",
  showAgain: false,
});

/** Variáveis do texto que não têm valor nesta campanha — impedem salvar. */
export function campaignCopyIssues(value: CampaignCopyValue, vars: CampaignVars) {
  const all = [value.title, value.message, value.cta, value.footnote].join(" ");
  return unknownPlaceholders(all, vars);
}

const Counter = ({ value, max }: { value: string; max: number }) => (
  <span className={cn("text-[11px]", value.length > max ? "text-destructive" : "text-muted-foreground")}>
    {value.length}/{max}
  </span>
);

/**
 * Comunicação da campanha: o Admin escreve o que o cliente vai ler,
 * com prévia em tempo real. Nada aqui altera desconto, validade ou regras.
 */
export function CampaignCopyEditor({
  idPrefix,
  value,
  onChange,
  vars,
  badge,
  fallbackMessage,
  withShowAgain = false,
}: {
  idPrefix: string;
  value: CampaignCopyValue;
  onChange: (v: CampaignCopyValue) => void;
  vars: CampaignVars;
  badge: string;
  fallbackMessage: string;
  withShowAgain?: boolean;
}) {
  const set = <K extends keyof CampaignCopyValue>(key: K, v: CampaignCopyValue[K]) =>
    onChange({ ...value, [key]: v });

  const preview = renderCampaign(value, vars, fallbackMessage);
  const style = THEME_STYLE[preview.theme];
  const issues = campaignCopyIssues(value, vars);

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div>
        <p className="text-sm font-semibold">Comunicação da campanha</p>
        <p className="text-xs text-muted-foreground">
          Variáveis disponíveis: {Object.keys(vars).map((k) => `{${k}}`).join(", ") || "nenhuma"}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-title`}>Título</Label>
          <Counter value={value.title} max={CAMPAIGN_LIMITS.title} />
        </div>
        <Input
          id={`${idPrefix}-title`}
          value={value.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Um presente especial pra você"
          className="h-11 rounded-xl"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${idPrefix}-message`}>Mensagem</Label>
          <Counter value={value.message} max={CAMPAIGN_LIMITS.message} />
        </div>
        <Textarea
          id={`${idPrefix}-message`}
          value={value.message}
          onChange={(e) => set("message", e.target.value)}
          placeholder="Aproveite {discount}% OFF nos seus decants favoritos hoje."
          rows={3}
          className="rounded-xl"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-cta`}>Texto do botão</Label>
            <Counter value={value.cta} max={CAMPAIGN_LIMITS.cta} />
          </div>
          <Input
            id={`${idPrefix}-cta`}
            value={value.cta}
            onChange={(e) => set("cta", e.target.value)}
            placeholder="Usar desconto"
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${idPrefix}-foot`}>Texto auxiliar (opcional)</Label>
            <Counter value={value.footnote} max={CAMPAIGN_LIMITS.footnote} />
          </div>
          <Input
            id={`${idPrefix}-foot`}
            value={value.footnote}
            onChange={(e) => set("footnote", e.target.value)}
            placeholder="Válido para decants selecionados."
            className="h-11 rounded-xl"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Destaque</Label>
        <div className="grid grid-cols-4 gap-1 rounded-xl border p-1">
          {(Object.keys(THEME_LABEL) as CampaignTheme[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("theme", t)}
              className={cn(
                "h-10 rounded-lg px-1 text-[11px]",
                value.theme === t ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {withShowAgain ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Mostrar novamente para quem já viu</p>
            <p className="text-xs text-muted-foreground">Por padrão não. Ligue só quando a mudança valer um novo aviso.</p>
          </div>
          <Switch checked={value.showAgain} onCheckedChange={(v) => set("showAgain", v)} />
        </div>
      ) : null}

      {issues.length > 0 ? (
        <p className="text-xs text-destructive">
          Variável sem valor nesta campanha: {issues.map((i) => `{${i}}`).join(", ")}. Corrija antes de salvar.
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Prévia no aplicativo</p>
        <div className={cn("overflow-hidden rounded-2xl border p-4", style.card)}>
          <p className="text-sm leading-snug font-semibold break-words">{preview.title}</p>
          {preview.message ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground break-words">{preview.message}</p>
          ) : null}
          <span
            className={cn(
              "mt-2 inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-semibold break-words",
              style.badge,
            )}
          >
            {badge}
          </span>
          <div className="press mt-3 flex h-11 w-full items-center justify-center rounded-full bg-foreground px-4 text-sm font-semibold text-background">
            {preview.cta}
          </div>
          {preview.footnote ? (
            <p className="mt-2 text-center text-[11px] text-muted-foreground break-words">{preview.footnote}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Colunas gravadas no banco a partir do editor. */
export function campaignCopyPayload(value: CampaignCopyValue) {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  return {
    announce_title: t(value.title),
    announce_message: t(value.message),
    announce_cta: t(value.cta),
    announce_footnote: t(value.footnote),
    announce_theme: value.theme,
  };
}
