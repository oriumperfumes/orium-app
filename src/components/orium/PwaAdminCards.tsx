/**
 * Cartões da Dashboard para ADMIN/OWNER: instalar a Orium neste dispositivo e
 * ligar/desligar as notificações deste aparelho.
 *
 * Cliente comum nunca vê estes cartões, e nada é pedido automaticamente: a
 * permissão de notificação só é solicitada depois de um toque explícito.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Download,
  Plus,
  Share,
  SquarePlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useAuth } from "@/lib/auth";
import { OriumLogo } from "@/components/orium/OriumLogo";
import {
  currentPushEndpoint,
  deviceLabel,
  iosDevice,
  iosShareBarPosition,
  isIOS,
  isIOSSafari,
  isStandalone,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  usePwaInstall,
} from "@/lib/pwa";
import { getPushState, savePushDevice, disablePushDevice } from "@/lib/push.functions";


export function PwaAdminCards() {
  const { isStaff } = useAuth();
  if (!isStaff) return null;
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <InstallCard />
      <NotificationsCard />
    </div>
  );
}

function InstallCard() {
  const { installed, ready, hasPrompt, install, platform } = usePwaInstall();
  const [sheet, setSheet] = useState(false);

  if (!ready || installed) return null;

  const onInstall = async () => {
    // Prompt nativo sempre que o navegador oferecer (Android, Windows, Chromium).
    if (hasPrompt) {
      const result = await install();
      if (result !== "unsupported") return;
      setSheet(true);
      return;
    }
    setSheet(true);
  };


  const iosTitle = iosDevice() === "ipad" ? "Instale a Orium no seu iPad" : "Instale a Orium no seu iPhone";

  return (
    <>
      <div
        className="admin-card admin-in rounded-2xl bg-card p-4 shadow-soft sm:p-5"
        style={{ "--i": 0 } as CSSProperties}
      >
        <div className="flex items-start gap-3">
          <OriumLogo size="sm" />
          <div className="min-w-0">
            <p className="font-semibold">Leve a Orium com você</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Instale neste dispositivo e receba novos pedidos e interesses de clientes.
            </p>
          </div>
        </div>
        <button
          onClick={onInstall}
          className="press mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-semibold text-background"
        >
          <Download className="size-4" strokeWidth={1.75} />{" "}
          {platform === "ios" ? "Instalar Orium" : "Instalar aplicativo"}
        </button>
      </div>

      <Drawer open={sheet} onOpenChange={setSheet}>
        <DrawerContent className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-md">
            <div className="flex items-start justify-between gap-3">
              <DrawerTitle className="text-xl leading-tight">
                {platform === "ios"
                  ? iosTitle
                  : platform === "android"
                    ? "Instalar Orium no Android"
                    : platform === "windows"
                      ? "Instalar Orium no Windows"
                      : "Instalar Orium neste computador"}
              </DrawerTitle>
              <button onClick={() => setSheet(false)} aria-label="Fechar" className="press p-1">
                <X className="size-5" strokeWidth={1.75} />
              </button>
            </div>

            {platform === "ios" ? (
              <IosInstallGuide />
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  {platform === "android"
                    ? "Este navegador não ofereceu a instalação automática agora. Abra a Orium no Chrome ou no Edge do Android e toque em Instalar aplicativo."
                    : "Este navegador não ofereceu a instalação automática agora. Abra a Orium no Chrome ou no Edge e toque em Instalar aplicativo."}
                </p>
                <ol className="mt-4 space-y-3 text-sm">
                  <Step icon={<Download className="size-4" strokeWidth={1.75} />} n={1}>
                    {platform === "android" ? (
                      <>
                        No Chrome, abra o menu <strong>⋮</strong> e escolha{" "}
                        <strong>Instalar aplicativo</strong>.
                      </>
                    ) : (
                      <>
                        Na barra de endereço, clique no ícone de <strong>instalar</strong> ou use o
                        menu <strong>⋮</strong> → <strong>Instalar Orium</strong>.
                      </>
                    )}
                  </Step>
                  <Step icon={<Plus className="size-4" strokeWidth={1.75} />} n={2}>
                    Confirme <strong>Instalar</strong> e abra a Orium pelo ícone.
                  </Step>
                </ol>
                <p className="mt-4 text-xs text-muted-foreground">
                  A instalação vale para este dispositivo. Depois de instalada, este aviso
                  desaparece aqui.
                </p>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

/**
 * Guia de instalação do iOS/iPadOS: três passos grandes, ilustração mostrando
 * onde está o botão Compartilhar neste Safari e uma ajuda discreta.
 */
function IosInstallGuide() {
  const [help, setHelp] = useState(false);
  const safari = isIOSSafari();
  const device = iosDevice();
  const barAtBottom = iosShareBarPosition() === "bottom";

  return (
    <>
      <p className="mt-2 text-sm text-muted-foreground">
        Leva menos de um minuto e você poderá abrir a Orium como um aplicativo e ativar notificações
        de novos pedidos.
      </p>

      {!safari ? (
        <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
          Abra a Orium no <strong>Safari</strong> para poder adicioná-la à Tela de Início.
        </p>
      ) : null}

      <SafariIllustration bottom={barAtBottom} />

      <ol className="mt-5 space-y-3">
        <BigStep n={1} icon={<Share className="size-5" strokeWidth={1.75} />}>
          Toque em <strong>Compartilhar</strong>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {device === "ipad"
              ? "Fica na barra de cima do Safari, ao lado do endereço."
              : barAtBottom
                ? "Fica na barra de baixo do Safari, no centro."
                : "Fica na barra de cima do Safari, ao lado do endereço."}
          </span>
        </BigStep>
        <BigStep n={2} icon={<SquarePlus className="size-5" strokeWidth={1.75} />}>
          Escolha <strong>Adicionar à Tela de Início</strong>
        </BigStep>
        <BigStep n={3} icon={<Check className="size-5" strokeWidth={1.75} />}>
          Toque em <strong>Adicionar</strong>
        </BigStep>
      </ol>

      <button
        onClick={() => setHelp((v) => !v)}
        className="press mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Não encontrou a opção?
        <ChevronDown
          className={`size-4 transition-transform ${help ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {help ? (
        <p className="mt-2 rounded-xl bg-surface-2 p-3 text-sm text-muted-foreground">
          Role a lista de ações do compartilhamento para baixo — a opção{" "}
          <strong>Adicionar à Tela de Início</strong> costuma aparecer mais abaixo.
        </p>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        Depois de abrir pelo ícone, este aviso desaparece neste dispositivo.
      </p>
    </>
  );
}

/** Mini interface do Safari destacando o ícone de compartilhar no lugar certo. */
function SafariIllustration({ bottom }: { bottom: boolean }) {
  const bar = (
    <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-2">
      <span className="h-2 flex-1 rounded-full bg-border" />
      <span className="orium-share-pulse flex size-8 items-center justify-center rounded-full bg-foreground text-background">
        <Share className="size-4" strokeWidth={2} />
      </span>
      <span className="h-2 w-6 rounded-full bg-border" />
    </div>
  );
  return (
    <div
      aria-hidden
      className="mt-5 flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-3"
    >
      {bottom ? null : bar}
      <div className="flex h-16 items-center justify-center rounded-xl bg-card">
        <OriumLogo size="sm" />
      </div>
      {bottom ? bar : null}
    </div>
  );
}

function BigStep({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        {icon}
      </span>
      <span className="min-w-0 pt-1 leading-relaxed">
        <span className="text-muted-foreground">{n}. </span>
        {children}
      </span>
    </li>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        {icon}
      </span>
      <span className="leading-relaxed">
        <span className="text-muted-foreground">{n}. </span>
        {children}
      </span>
    </li>
  );
}


function NotificationsCard() {
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [needsInstall, setNeedsInstall] = useState(false);

  const load = useCallback(async () => {
    // No iOS a permissão só existe dentro da PWA instalada.
    const iosNeedsInstall = isIOS() && !isStandalone();
    setSupported(pushSupported());
    setNeedsInstall(iosNeedsInstall || (!isStandalone() && !pushSupported()));

    const endpoint = await currentPushEndpoint();
    try {
      const state = await getPushState({ data: { endpoint } });
      setPublicKey(state.publicKey);
      setEnabled(state.enabled);
    } catch {
      /* sem sessão válida: o cartão simplesmente não liga nada */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = async () => {
    setBusy(true);
    try {
      const result = await subscribeToPush(publicKey);
      if (!result.ok) {
        const message =
          result.reason === "denied"
            ? "Permissão de notificação negada neste dispositivo."
            : result.reason === "unsupported"
              ? "Este navegador não recebe notificações. No iPhone, adicione a Orium à Tela de Início primeiro."
              : "Não foi possível ativar as notificações agora.";
        toast.error(message);
        return;
      }
      await savePushDevice({
        data: {
          endpoint: result.endpoint,
          p256dh: result.p256dh,
          auth: result.auth,
          deviceLabel: deviceLabel(),
          userAgent: navigator.userAgent,
        },
      });
      setEnabled(true);
      toast.success("Notificações ativadas neste dispositivo.");
    } catch {
      toast.error("Não foi possível ativar as notificações agora.");
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const endpoint = (await currentPushEndpoint()) ?? "";
      await unsubscribeFromPush();
      if (endpoint) await disablePushDevice({ data: { endpoint } });
      setEnabled(false);
      toast.success("Notificações desativadas neste dispositivo.");
    } catch {
      toast.error("Não foi possível desativar agora.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="admin-card admin-in rounded-2xl bg-card p-4 shadow-soft sm:p-5"
      style={{ "--i": 1 } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3">
          {enabled ? (
            <Bell className="size-4" strokeWidth={1.75} />
          ) : (
            <BellOff className="size-4" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            {enabled ? "Notificações" : "Receba novos pedidos na hora"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {needsInstall
              ? `Instale a Orium na Tela de Início primeiro para ativar notificações neste ${iosDevice() === "ipad" ? "iPad" : "iPhone"}.`
              : enabled
                ? "Ativadas neste dispositivo — novos pedidos e interesses chegam aqui."
                : "Ative as notificações da Orium neste dispositivo."}
          </p>
        </div>

      </div>

      {supported && !needsInstall ? (
        <button
          onClick={enabled ? deactivate : activate}
          disabled={busy}
          className="press mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border text-sm font-semibold disabled:opacity-60"
        >
          {enabled ? "Desativar" : "Ativar notificações"}
        </button>
      ) : null}
    </div>
  );
}
