/**
 * ADMIN → WIDGETS
 *
 * Widgets de pedidos para a tela do iPhone (app Scriptable), do Windows 11
 * (painel de widgets via Edge) e do Android (app Orium Widgets). Todos mostram
 * o mesmo resumo do Painel de Pedidos — "5 pedidos para amanhã", próximas
 * entregas, semana, fases, a receber — lido com uma chave por aparelho.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Apple, Check, Copy, Download, KeyRound, Loader2, Monitor, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/orium/AdminShell";
import { WIDGET_MODELS, WidgetPreview, type WidgetModelKey } from "@/components/orium/admin/widgets/WidgetModels";
import { createWidgetKey, listWidgetKeys, revokeWidgetKey, widgetPreview } from "@/lib/widget.functions";
import { scriptableCode } from "@/lib/widget-scriptable";
import { rainmeterPackage } from "@/lib/widget-rainmeter";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/widgets")({
  head: () => ({
    meta: [
      { title: "Widgets — Orium Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WidgetsPage,
});

type Platform = "iphone" | "windows" | "android";
const PLATFORMS: Array<{ key: Platform; label: string; icon: typeof Apple; device: string }> = [
  { key: "iphone", label: "iPhone", icon: Apple, device: "iPhone" },
  { key: "windows", label: "Windows", icon: Monitor, device: "PC Windows" },
  { key: "android", label: "Android", icon: Smartphone, device: "Android" },
];
const APK_URL = "https://github.com/SouzaDz/oriumperfum/releases/download/android-widgets/orium-widgets.apk";
const SIZE_LABEL = { small: "Pequeno", medium: "Médio", large: "Grande" } as const;

function WidgetsPage() {
  const qc = useQueryClient();
  const loadPreview = useServerFn(widgetPreview);
  const loadKeys = useServerFn(listWidgetKeys);
  const create = useServerFn(createWidgetKey);
  const revoke = useServerFn(revokeWidgetKey);
  const preview = useQuery({ queryKey: ["widget-preview"], queryFn: () => loadPreview(), staleTime: 30_000, refetchInterval: 60_000 });
  const keys = useQuery({ queryKey: ["widget-keys"], queryFn: () => loadKeys() });
  const [model, setModel] = useState<WidgetModelKey>("foco");
  const [platform, setPlatform] = useState<Platform>("iphone");
  const [tokens, setTokens] = useState<Partial<Record<Platform | "agenda", string>>>({});
  const [busy, setBusy] = useState(false);
  const token = tokens[platform];
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oriumperfumes.com";

  const generate = async (target: Platform | "agenda" = platform) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await create({ data: { name: target === "agenda" ? "Agenda (Outlook/Google)" : PLATFORMS.find((p) => p.key === target)!.device } });
      setTokens((t) => ({ ...t, [target]: r.token }));
      qc.invalidateQueries({ queryKey: ["widget-keys"] });
      toast.success("Chave gerada. Ela só aparece agora — use logo abaixo.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível gerar a chave.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copiado.`);
    } catch {
      toast.error("Não deu para copiar. Selecione e copie manualmente.");
    }
  };

  const script = useMemo(
    () => (token ? scriptableCode({ endpoint: `${origin}/api/public/widget`, key: token, adminUrl: `${origin}/admin/pedidos`, model }) : ""),
    [token, origin, model],
  );

  const downloadRainmeter = () => {
    if (!token) return;
    const bytes = rainmeterPackage({ endpoint: `${origin}/api/public/widget`, key: token, adminUrl: `${origin}/admin/pedidos` });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Orium.rmskin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activateWindows = async () => {
    if (!token) return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (!reg?.active) throw new Error("Abra o painel pelo app instalado no Edge.");
      reg.active.postMessage({ type: "orium-widget-key", key: token });
      try {
        await (reg as any).periodicSync?.register("orium-pedidos", { minInterval: 15 * 60 * 1000 });
      } catch {
        /* sem atualização em segundo plano: o Windows atualiza ao abrir o painel */
      }
      toast.success("Pronto! Agora abra os widgets do Windows (Win + W) e adicione “Pedidos da Orium”.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível ativar neste computador.");
    }
  };

  return (
    <AdminShell title="Widgets" description="Os pedidos na tela do celular e do computador, sem abrir o app. Escolha o modelo e instale.">
      {/* 1 · modelos */}
      <section aria-label="Modelos">
        <h2 className="px-1 text-[19px] font-bold tracking-[-0.02em]">1. Escolha o modelo</h2>
        <p className="px-1 text-[13.5px] text-[#8C8C8C]">Com os seus pedidos de agora. Você pode usar mais de um.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {WIDGET_MODELS.map((m, i) => {
            const on = model === m.key;
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={on}
                onClick={() => setModel(m.key)}
                className={cn(
                  "press adm-rise flex min-w-0 flex-col rounded-[28px] p-3 text-left transition-colors",
                  on ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] hover:bg-[#1F1F1F]",
                  m.size === "large" && "sm:row-span-2",
                )}
                style={{ ["--i" as string]: i }}
              >
                <span className={cn("grid min-h-[200px] flex-1 place-items-center overflow-hidden rounded-[22px] p-4", on ? "bg-[#101010]" : "bg-[#0C0C0C]")}>
                  {preview.data ? (
                    <span className={cn("block", m.size !== "small" && "max-sm:[zoom:0.84]")}>
                      <WidgetPreview model={m.key} s={preview.data} />
                    </span>
                  ) : (
                    <span className="admin-skeleton h-[170px] w-[170px] rounded-[26px]" />
                  )}
                </span>
                <span className="mt-3 flex items-center gap-2 px-1.5">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{m.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", on ? "bg-[#15130F] text-white" : "bg-[#262626] text-[#A9A9A9]")}>{SIZE_LABEL[m.size]}</span>
                  {on ? <Check className="size-4" strokeWidth={3} /> : null}
                </span>
                <span className={cn("mt-0.5 px-1.5 pb-1 text-[12.5px] leading-snug", on ? "text-[#15130F]/60" : "text-[#8C8C8C]")}>{m.about}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2 · instalar */}
      <section className="mt-8" aria-label="Instalar">
        <h2 className="px-1 text-[19px] font-bold tracking-[-0.02em]">2. Instale no aparelho</h2>
        <div className="mt-3 flex gap-1.5" role="group" aria-label="Aparelho">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={platform === p.key}
              onClick={() => setPlatform(p.key)}
              className={cn(
                "press inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors",
                platform === p.key ? "bg-white text-[#15130F]" : "bg-[#1A1A1A] text-[#A9A9A9] hover:text-white",
              )}
            >
              <p.icon className="size-4" /> {p.label}
            </button>
          ))}
        </div>

        <div className="dash-card mt-3 p-4 lg:p-6">
          <ol className="space-y-5">
            {platform === "iphone" ? (
              <>
                <Step n={1} title="Instale o app Scriptable (grátis)">
                  Na App Store, procure <b>Scriptable</b> (ícone azul escuro). Ele desenha o widget da Orium na tela de início.
                </Step>
                <Step n={2} title="Gere a chave deste iPhone">
                  <KeyButton token={token} busy={busy} onClick={() => generate()} />
                </Step>
                <Step n={3} title="Copie o widget e cole no Scriptable">
                  {token ? (
                    <div className="space-y-2">
                      <button type="button" onClick={() => copy(script, "Widget")} className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599]">
                        <Copy className="size-4" /> Copiar widget ({WIDGET_MODELS.find((m) => m.key === model)?.name})
                      </button>
                      <p>
                        No Scriptable: toque em <b>+</b>, cole, dê o nome <b>Orium</b> e toque em ▶. Quando pedir, <b>permita o Calendário</b>: as entregas, cobranças e compras entram sozinhas na agenda <b>Orium · Pedidos</b>, com lembrete na véspera e 1h antes.
                      </p>
                    </div>
                  ) : (
                    <span className="text-[#6F6F6F]">Gere a chave primeiro.</span>
                  )}
                </Step>
                <Step n={4} title="Coloque na tela de início">
                  Segure na tela → <b>Editar</b> → <b>Adicionar widget</b> → <b>Scriptable</b> → escolha o tamanho. Toque no widget, em <b>Script</b> escolha <b>Orium</b>. Em <b>Parâmetro</b> você pode trocar o modelo:{" "}
                  <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">foco</code> <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">proximas</code>{" "}
                  <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">semana</code> <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">fases</code>{" "}
                  <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">receber</code> <code className="rounded bg-[#262626] px-1.5 py-0.5 text-[12px]">painel</code>.
                </Step>
              </>
            ) : platform === "windows" ? (
              <>
                <Step n={1} title="Instale o Rainmeter (grátis)">
                  É o programa que coloca widgets direto na área de trabalho, junto dos atalhos. Baixe em{" "}
                  <a href="https://www.rainmeter.net" target="_blank" rel="noreferrer" className="font-semibold text-white underline underline-offset-4">rainmeter.net</a> e instale (opção “Standard”).
                </Step>
                <Step n={2} title="Gere a chave deste computador">
                  <KeyButton token={token} busy={busy} onClick={() => generate()} />
                </Step>
                <Step n={3} title="Baixe os widgets da Orium">
                  {token ? (
                    <div className="space-y-2">
                      <button type="button" onClick={downloadRainmeter} className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599]">
                        <Download className="size-4" /> Baixar Orium.rmskin
                      </button>
                      <p>
                        Dê <b>dois cliques</b> no arquivo → <b>Install</b>. O widget <b>Pedidos</b> aparece na área de trabalho — arraste para onde quiser.
                      </p>
                    </div>
                  ) : (
                    <span className="text-[#6F6F6F]">Gere a chave primeiro.</span>
                  )}
                </Step>
                <Step n={4} title="Deixe fixo na área de trabalho">
                  Clique com o botão direito no widget → <b>Configurações</b> → <b>Posição</b>: <b>Na área de trabalho</b>, e marque <b>Carregar ao iniciar</b> no Rainmeter. Quer o número grande também? Botão direito → <b>Orium</b> → <b>Foco</b> → <b>Foco.ini</b>.
                  <p className="mt-2 text-[12.5px] text-[#6F6F6F]">
                    Atualiza sozinho a cada 5 minutos. Clicar no widget abre os pedidos.{" "}
                    <button type="button" onClick={activateWindows} className="font-semibold text-[#A9A9A9] underline underline-offset-4 hover:text-white">
                      Prefere o painel de widgets do Windows (Win + W)?
                    </button>{" "}
                    Instale a Orium pelo Edge, abra esta página por ele e toque no link.
                  </p>
                </Step>
              </>
            ) : (
              <>
                <Step n={1} title="Baixe o app Orium Widgets">
                  <a href={APK_URL} target="_blank" rel="noreferrer" className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599]">
                    <Download className="size-4" /> Baixar orium-widgets.apk
                  </a>
                  <p className="mt-2">Abra o link no celular (entre com a conta do GitHub da Orium). Ao instalar, permita “instalar apps desta fonte”.</p>
                </Step>
                <Step n={2} title="Gere a chave deste Android">
                  <KeyButton token={token} busy={busy} onClick={() => generate()} />
                </Step>
                <Step n={3} title="Conecte o app">
                  {token ? (
                    <div className="flex flex-wrap gap-2">
                      <a href={`orium://widget?key=${encodeURIComponent(token)}`} className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599]">
                        <Smartphone className="size-4" /> Abrir no app (no celular)
                      </a>
                      <button type="button" onClick={() => copy(token, "Chave")} className="press inline-flex h-11 items-center gap-2 rounded-full bg-[#262626] px-5 text-[14px] font-bold">
                        <Copy className="size-4" /> Copiar chave
                      </button>
                    </div>
                  ) : (
                    <span className="text-[#6F6F6F]">Gere a chave primeiro.</span>
                  )}
                </Step>
                <Step n={4} title="Coloque na tela inicial">
                  Segure na tela inicial → <b>Widgets</b> → <b>Orium Widgets</b>: Foco do dia, Próximas entregas e Semana. Tocar no widget abre os pedidos. Ao salvar a chave, permita o <b>Calendário</b>: a agenda <b>Orium · Pedidos</b> aparece no Google Agenda com as entregas e os lembretes, e se atualiza sozinha junto com o widget.
                </Step>
              </>
            )}
          </ol>
        </div>
      </section>

      {/* 3 · agenda no computador */}
      <section className="mt-8" aria-label="Agenda">
        <h2 className="px-1 text-[19px] font-bold tracking-[-0.02em]">Agenda no computador</h2>
        <p className="px-1 text-[13.5px] text-[#8C8C8C]">
          No iPhone e no Android a agenda já vem junto com o widget. Para ver as entregas também no Outlook ou no Google Agenda do PC, assine a agenda da Orium — ela se atualiza sozinha.
        </p>
        <div className="dash-card mt-3 flex flex-wrap items-center gap-2 p-4 lg:p-5">
          {tokens.agenda ? (
            <>
              <a
                href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(`${origin}/api/public/agenda?key=${tokens.agenda}`)}&name=${encodeURIComponent("Orium · Pedidos")}`}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599]"
              >
                <Monitor className="size-4" /> Adicionar no Outlook
              </a>
              <a
                href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`${origin.replace(/^https?:/, "webcal:")}/api/public/agenda?key=${tokens.agenda}`)}`}
                target="_blank"
                rel="noreferrer"
                className="press inline-flex h-11 items-center gap-2 rounded-full bg-[#262626] px-5 text-[14px] font-bold hover:bg-[#2E2E2E]"
              >
                Google Agenda
              </a>
              <button
                type="button"
                onClick={() => copy(`${origin}/api/public/agenda?key=${tokens.agenda}`, "Endereço da agenda")}
                className="press inline-flex h-11 items-center gap-2 rounded-full bg-[#262626] px-5 text-[14px] font-bold hover:bg-[#2E2E2E]"
              >
                <Copy className="size-4" /> Copiar endereço
              </button>
              <p className="w-full pt-1 text-[12.5px] text-[#6F6F6F]">O Outlook atualiza a cada poucas horas; o Google pode levar até um dia. Para avisos na hora, use o widget no celular.</p>
            </>
          ) : (
            <KeyButton busy={busy} onClick={() => generate("agenda")} />
          )}
        </div>
      </section>

      {/* 4 · chaves */}
      <section className="mt-8 mb-6" aria-label="Aparelhos conectados">
        <h2 className="px-1 text-[19px] font-bold tracking-[-0.02em]">Aparelhos conectados</h2>
        <p className="px-1 text-[13.5px] text-[#8C8C8C]">Perdeu o celular ou trocou de aparelho? Desligue a chave e o widget para de mostrar os pedidos.</p>
        <ul className="dash-card mt-3 divide-y divide-white/[0.05] p-2">
          {(keys.data ?? []).length ? (
            keys.data!.map((k) => (
              <li key={k.id} className={cn("flex items-center gap-3 px-3 py-3", k.revoked && "opacity-50")}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#262626]">
                  <KeyRound className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    {k.name} <span className="text-[12px] font-normal text-[#6F6F6F]">{k.hint}</span>
                  </span>
                  <span className="block text-[12.5px] text-[#8C8C8C]">
                    {k.revoked ? "Desligada" : k.lastUsedAt ? `Último uso ${new Date(k.lastUsedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "Ainda não usada"}
                  </span>
                </span>
                {!k.revoked ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await revoke({ data: { id: k.id } });
                      qc.invalidateQueries({ queryKey: ["widget-keys"] });
                      toast.success("Chave desligada.");
                    }}
                    className="press inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-[#8C8C8C] hover:bg-[#2A1A18] hover:text-[#FF9A8A]"
                  >
                    <Trash2 className="size-4" /> Desligar
                  </button>
                ) : null}
              </li>
            ))
          ) : (
            <li className="px-4 py-8 text-center text-[14px] text-[#8C8C8C]">Nenhum aparelho ainda.</li>
          )}
        </ul>
      </section>
    </AdminShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[13px] font-bold text-[#15130F]">{n}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[15.5px] font-bold">{title}</p>
        <div className="mt-1 text-[14px] leading-relaxed text-[#A9A9A9]">{children}</div>
      </div>
    </li>
  );
}

function KeyButton({ token, busy, onClick }: { token?: string; busy: boolean; onClick: () => void }) {
  if (token)
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-[#17251C] px-4 py-2 text-[13.5px] font-semibold text-[#7FCF9F]">
        <Check className="size-4" strokeWidth={3} /> Chave pronta ({token.slice(0, 6)}…{token.slice(-4)})
      </span>
    );
  return (
    <button type="button" disabled={busy} onClick={onClick} className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#15130F] hover:bg-[#FFD599] disabled:opacity-60">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Gerar chave
    </button>
  );
}
