/**
 * Conta — tela cheia, no mesmo vocabulário da Sacola.
 *
 * Perfil (foto, nome, WhatsApp, e-mail), atalhos e, só para a equipe
 * (dono/admin), as opções internas: ver custos e lucro no catálogo, nos
 * perfumes e na pesquisa, e o acesso ao painel de administração.
 * Abre pelo evento `orium:open-account` (botão "Conta" da barra inferior).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Check, ChevronLeft, ChevronRight, Heart, LayoutGrid, Loader2, LogOut, MessageCircle, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useLead } from "@/lib/lead";
import { useFavorites } from "@/lib/favorites";
import { useAdminInsightView } from "@/lib/use-admin-insight-view";
import { uploadAvatar } from "@/lib/account.functions";
import { isValidPhoneBR, maskPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { navigatingFromLayer, useBackToClose } from "@/hooks/use-back-to-close";

const WHATSAPP = "5521977174508";
export { OPEN_ACCOUNT, useProfile, Avatar } from "@/components/orium/account-shared";
import { OPEN_ACCOUNT, useProfile, Avatar } from "@/components/orium/account-shared";

export default AccountScreen;

export function AccountScreen({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const { session, isStaff, role, signOut } = useAuth();
  const [open, setOpen] = useState(initialOpen);
  const [visible, setVisible] = useState(initialOpen);
  const [view, setView] = useState<"home" | "edit">("home");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const on = () => {
      setView("home");
      setOpen(true);
    };
    window.addEventListener(OPEN_ACCOUNT, on);
    return () => window.removeEventListener(OPEN_ACCOUNT, on);
  }, []);
  useEffect(() => {
    if (open) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // gesto de voltar do celular fecha a conta
  // e, se a conta levou o cliente para outra página (Favoritos, Painel), ela
  // reabre quando ele volta
  useBackToClose(open, () => setOpen(false), {
    onReopen: () => {
      setView("home");
      setOpen(true);
    },
  });
  // "Editar perfil" é um passo dentro da conta: voltar volta para a conta
  useBackToClose(open && view === "edit", () => setView("home"));
  // saiu da conta: a tela fecha
  useEffect(() => {
    if (!session) setOpen(false);
  }, [session]);

  if (!mounted || !session || (!open && !visible)) return null;
  const close = () => setOpen(false);

  return createPortal(
    <>
    <div
      aria-hidden
      onClick={close}
      className={cn("side-scrim fixed inset-0 z-[59] hidden bg-black/55 lg:block", open ? "is-in" : "is-out")}
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sua conta"
      className={cn("cart-page fixed inset-0 z-[60] flex flex-col bg-[#101010] text-white", open ? "is-in" : "is-out")}
    >
      <div className="header-safe sticky top-0 z-10 border-b border-white/[0.06] bg-[#0A0A0A]">
        <div className="mx-auto flex h-[52px] max-w-xl items-center px-3">
          <button
            type="button"
            onClick={view === "edit" ? () => setView("home") : close}
            className="press inline-flex h-10 items-center gap-1 rounded-full pr-3 pl-1.5 text-[16px] font-semibold text-white"
          >
            <ChevronLeft className="size-[22px]" strokeWidth={2.4} />
            Voltar
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          key={view}
          className={cn(
            "mx-auto w-full max-w-xl px-5 pt-3 pb-[calc(2.5rem+env(safe-area-inset-bottom))]",
            view === "edit" ? "cart-step-in" : "cart-step-back",
          )}
        >
          {view === "home" ? (
            <AccountHome
              isStaff={isStaff}
              role={role}
              onEdit={() => setView("edit")}
              onClose={close}
              onSignOut={async () => {
                await signOut();
                close();
                toast.success("Você saiu da sua conta.", { duration: 1800 });
              }}
            />
          ) : (
            <EditProfile onDone={() => setView("home")} />
          )}
        </div>
      </div>
    </div>
    </>,
    document.body,
  );
}

function AccountHome({
  isStaff,
  role,
  onEdit,
  onClose,
  onSignOut,
}: {
  isStaff: boolean;
  role: string | null;
  onEdit: () => void;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const { name, email } = useProfile();
  const cart = useCart();
  const { count } = useFavorites();
  const { visible, toggle } = useAdminInsightView();
  const navigate = useNavigate();
  const first = name.split(/\s+/)[0] ?? "";

  return (
    <>
      <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Conta</h1>

      {/* perfil */}
      <button
        type="button"
        onClick={onEdit}
        className="acc-card press mt-5 flex w-full items-center gap-4 rounded-[24px] bg-[#1A1A1A] p-4 text-left"
      >
        <Avatar size={64} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[20px] font-bold tracking-[-0.01em] text-white">
            {first ? `Olá, ${first}` : "Seu perfil"}
          </span>
          <span className="block truncate text-[14px] text-[#A9A9A9]">{email}</span>
          <span className="mt-1 block text-[14px] font-semibold text-[#FFD599]">Editar perfil</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
      </button>

      {/* atalhos */}
      <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Atalhos</p>
      <div className="acc-card overflow-hidden rounded-[20px] bg-[#1A1A1A]">
        <MenuRow
          icon={<Heart className="size-[18px]" strokeWidth={2.2} />}
          title="Meus favoritos"
          detail={count ? `${count}` : undefined}
          onClick={() => {
            navigatingFromLayer();
            onClose();
            void navigate({ to: "/favoritos" });
          }}
        />
        <MenuRow
          icon={<ShoppingBag className="size-[18px]" strokeWidth={2.2} />}
          title="Minha sacola"
          detail={cart.totalQuantity ? `${cart.totalQuantity}` : undefined}
          divider
          onClick={() => {
            onClose();
            window.setTimeout(() => cart.setOpen(true), 200);
          }}
        />
        <MenuRow
          icon={<MessageCircle className="size-[18px]" strokeWidth={2.2} />}
          title="Falar com a Orium"
          detail="WhatsApp"
          divider
          href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Olá! Sou ${first || "cliente"} e queria falar com a Orium.`)}`}
        />
      </div>

      {/* equipe Orium: só dono/admin */}
      {isStaff ? (
        <section aria-label="Equipe Orium" className="mt-8">
          <div className="mb-2.5 flex items-center gap-2">
            <p className="text-[15px] font-semibold text-[#CFCFCF]">Equipe Orium</p>
            <span className="rounded-full bg-[#2A2217] px-2.5 py-1 text-[11px] font-bold text-[#FFD599]">
              {role === "owner" ? "Dono" : "Admin"}
            </span>
          </div>
          <div className="acc-card overflow-hidden rounded-[20px] bg-[#1A1A1A]">
            <button
              type="button"
              role="switch"
              aria-checked={visible}
              onClick={toggle}
              className="press flex w-full items-center gap-3.5 px-4 py-4 text-left"
            >
              <span className="o-pop-icon size-10">
                <span className="text-[15px] font-extrabold">R$</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold text-white">Ver custos e lucro</span>
                <span className="block text-[13px] leading-snug text-[#A9A9A9]">
                  Custo, fornecedor e margem nos cards do catálogo, nos perfumes e na pesquisa. Só a equipe vê.
                </span>
              </span>
              <Switch on={visible} />
            </button>
            <Link
              to="/admin"
              onClick={() => {
                navigatingFromLayer();
                onClose();
              }}
              className="press flex items-center gap-3.5 border-t border-white/10 px-4 py-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FFD599] text-[#15130F]">
                <LayoutGrid className="size-[18px]" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-bold text-white">Painel de administração</span>
                <span className="block text-[13px] text-[#A9A9A9]">Pedidos, produtos, preços e clientes</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
            </Link>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onSignOut}
        className="press mt-8 flex h-[56px] w-full items-center justify-center gap-2 rounded-full bg-[#1A1A1A] text-[16px] font-bold text-[#FF9A8A]"
      >
        <LogOut className="size-[18px]" strokeWidth={2.2} /> Sair da conta
      </button>
    </>
  );
}

function MenuRow({
  icon,
  title,
  detail,
  divider,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string | undefined;
  divider?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <span className="o-pop-icon size-10">{icon}</span>
      <span className="min-w-0 flex-1 text-[16px] font-semibold text-white">{title}</span>
      {detail ? <span className="text-[14px] font-semibold text-[#A9A9A9] tabular-nums">{detail}</span> : null}
      <ChevronRight className="size-5 shrink-0 text-[#8C8C8C]" strokeWidth={2.2} />
    </>
  );
  const cls = cn("press flex w-full items-center gap-3.5 px-4 py-3.5 text-left", divider && "border-t border-white/10");
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-300",
        on ? "bg-[#FFD599]" : "bg-[#3A3A3A]",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] left-[3px] size-6 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]",
          on && "translate-x-5",
        )}
      />
    </span>
  );
}

/** Recorta a foto no centro e reduz para 320px (rápido de enviar e de abrir). */
async function squareImage(file: File): Promise<{ base64: string; contentType: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 320, 320);
  const type = "image/jpeg";
  const dataUrl = canvas.toDataURL(type, 0.86);
  return { base64: dataUrl.split(",")[1] ?? "", contentType: type };
}

function EditProfile({ onDone }: { onDone: () => void }) {
  const profile = useProfile();
  const { updateLead, lead } = useLead();
  const upload = useServerFn(uploadAvatar);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ? maskPhone(profile.phone) : lead?.phone ? maskPhone(lead.phone) : "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const changed = name.trim() !== profile.name || phone.replace(/\D/g, "") !== profile.phone.replace(/\D/g, "");
  const phoneOk = !phone || isValidPhoneBR(phone);

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    setPhotoBusy(true);
    try {
      const img = await squareImage(f);
      const { url } = await upload({ data: img });
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: url } });
      if (error) throw error;
      toast.success("Foto atualizada", { duration: 1800 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não conseguimos trocar a foto agora.");
    } finally {
      setPhotoBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const save = async () => {
    if (!changed || !phoneOk || name.trim().length < 2) return;
    setSaving(true);
    try {
      const digits = phone.replace(/\D/g, "");
      const { error } = await supabase.auth.updateUser({ data: { name: name.trim(), phone: digits } });
      if (error) throw error;
      if (digits) updateLead({ name: name.trim(), phone: digits, customerId: lead?.customerId ?? null });
      toast.success("Perfil salvo", { duration: 1800 });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não conseguimos salvar agora.");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (pass.length < 6 || pass !== pass2) return;
    setPassBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pass });
      if (error) throw error;
      setPass("");
      setPass2("");
      toast.success("Senha alterada", { duration: 1800 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não conseguimos alterar a senha.");
    } finally {
      setPassBusy(false);
    }
  };

  return (
    <>
      <h1 className="text-[40px] leading-[1.15] font-bold tracking-[-0.035em] text-white">Editar perfil</h1>

      <div className="mt-6 flex flex-col items-center">
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="press relative"
          aria-label="Trocar foto de perfil"
        >
          <Avatar size={112} className={cn(photoBusy && "opacity-50")} />
          <span className="absolute right-0 bottom-0 grid size-9 place-items-center rounded-full bg-[#FFD599] text-[#15130F] ring-4 ring-[#101010]">
            {photoBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-[17px]" strokeWidth={2.2} />}
          </span>
        </button>
        <button type="button" onClick={() => file.current?.click()} className="press mt-3 text-[15px] font-semibold text-[#FFD599]">
          {profile.avatar ? "Trocar foto" : "Adicionar foto"}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
      </div>

      <p className="mt-8 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Seus dados</p>
      <div className="cart-page-fields overflow-hidden rounded-[20px] bg-[#1A1A1A]">
        <label className="g-field block px-4 pt-3 pb-2.5">
          <span className="text-[13px] text-[#A9A9A9]">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como devemos te chamar" autoComplete="name" className="g-input" />
        </label>
        <label className="g-field block border-t border-white/10 px-4 pt-3 pb-2.5">
          <span className="text-[13px] text-[#A9A9A9]">WhatsApp com DDD</span>
          <input
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            placeholder="(21) 90000-0000"
            inputMode="tel"
            autoComplete="tel"
            className="g-input tabular-nums"
          />
        </label>
        <div className="border-t border-white/10 px-4 pt-3 pb-2.5">
          <span className="text-[13px] text-[#A9A9A9]">E-mail</span>
          <p className="mt-0.5 truncate text-[18px] leading-[1.5] text-[#8C8C8C]">{profile.email}</p>
        </div>
      </div>
      {!phoneOk ? <p className="mt-2 text-[13px] text-[#FFB4A8]">Confira o DDD e o número.</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={!changed || !phoneOk || saving || name.trim().length < 2}
        className={cn(
          "press mt-5 flex h-[56px] w-full items-center justify-center gap-2 rounded-full text-[16px] font-bold transition-colors duration-300",
          changed && phoneOk && name.trim().length >= 2 ? "bg-[#FFD599] text-[#15130F]" : "bg-[#2A2A2A] text-[#8C8C8C]",
        )}
      >
        {saving ? <Loader2 className="size-[18px] animate-spin" /> : <Check className="size-[18px]" strokeWidth={2.6} />}
        Salvar alterações
      </button>

      <p className="mt-10 mb-2.5 text-[15px] font-semibold text-[#CFCFCF]">Senha</p>
      <div className="overflow-hidden rounded-[20px] bg-[#1A1A1A]">
        <label className="g-field block px-4 pt-3 pb-2.5">
          <span className="text-[13px] text-[#A9A9A9]">Nova senha</span>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Mínimo de 6 caracteres" autoComplete="new-password" className="g-input" />
        </label>
        <label className="g-field block border-t border-white/10 px-4 pt-3 pb-2.5">
          <span className="text-[13px] text-[#A9A9A9]">Confirmar senha</span>
          <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Repita a nova senha" autoComplete="new-password" className="g-input" />
        </label>
      </div>
      {pass2 && pass !== pass2 ? <p className="mt-2 text-[13px] text-[#FFB4A8]">As senhas não são iguais.</p> : null}
      <button
        type="button"
        onClick={changePassword}
        disabled={pass.length < 6 || pass !== pass2 || passBusy}
        className="press mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-bold text-[#15130F] transition-opacity disabled:opacity-35"
      >
        {passBusy ? <Loader2 className="size-4 animate-spin" /> : null}
        Alterar senha
      </button>
    </>
  );
}
