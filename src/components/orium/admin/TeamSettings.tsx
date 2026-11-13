import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AdminConfirm } from "@/components/orium/admin/AdminUI";
import { addTeamMember, listTeam, removeTeamMember, setTeamRole, type TeamMember, type TeamRole } from "@/lib/team.functions";
import { cn } from "@/lib/utils";

const ROLE_INFO: Record<TeamRole, { label: string; hint: string }> = {
  owner: { label: "Dono", hint: "Tudo, inclusive custos, lucro e a equipe." },
  admin: { label: "Admin", hint: "Pedidos, produtos e estoque. Não mexe na equipe." },
};

/** Configurações › Equipe: quem entra no painel Admin. */
export function TeamSettings() {
  const load = useServerFn(listTeam);
  const add = useServerFn(addTeamMember);
  const setRole = useServerFn(setTeamRole);
  const remove = useServerFn(removeTeamMember);
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["admin-team"], queryFn: () => load() });
  const [email, setEmail] = useState("");
  const [role, setRoleDraft] = useState<TeamRole>("admin");
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const canManage = !!data?.canManage;
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-team"] });

  const submit = async () => {
    if (busy || !email.trim()) return;
    setBusy("add");
    try {
      const r = await add({ data: { email, role, origin: window.location.origin } });
      toast.success(r.invited ? `Convite enviado para ${email.trim()}. Ao criar a senha, já entra no Admin.` : `${email.trim()} agora acessa o Admin.`);
      setEmail("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível dar acesso.");
    } finally {
      setBusy(null);
    }
  };
  const changeRole = async (m: TeamMember, r: TeamRole) => {
    if (busy || m.role === r) return;
    setBusy(m.userId);
    try {
      await setRole({ data: { userId: m.userId, role: r } });
      toast.success(`${m.name ?? m.email} agora é ${ROLE_INFO[r].label}.`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível mudar o acesso.");
    } finally {
      setBusy(null);
    }
  };
  const confirmRemove = async () => {
    const m = removing;
    setRemoving(null);
    if (!m) return;
    setBusy(m.userId);
    try {
      await remove({ data: { userId: m.userId } });
      toast.success(`${m.name ?? m.email} não acessa mais o Admin.`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível tirar o acesso.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div>
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Quem acessa o Admin</h2>
        <p className="mt-1 text-[14px] text-[#A9A9A9]">Dono vê tudo e cuida da equipe. Admin opera pedidos, produtos e estoque.</p>
      </div>

      {canManage ? (
        <section className="rounded-[24px] bg-[#1A1A1A] p-4 sm:p-5" aria-label="Dar acesso">
          <p className="text-[15px] font-bold">Dar acesso</p>
          <p className="mt-0.5 text-[13px] text-[#8C8C8C]">Se a pessoa ainda não tem conta, ela recebe um convite no e-mail.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="flex h-12 min-w-0 shrink-0 items-center rounded-full sm:flex-1 bg-[#1F1F1F] px-4 focus-within:ring-2 focus-within:ring-[#FFD599]/50">
              <span className="sr-only">E-mail</span>
              <input
                data-slot="input-group-control"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="email@exemplo.com"
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#6F6F6F]"
              />
            </label>
            <div className="grid h-12 shrink-0 grid-cols-2 rounded-full bg-[#1F1F1F] p-1 sm:flex" role="group" aria-label="Papel">
              {(["admin", "owner"] as TeamRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRoleDraft(r)}
                  className={cn("press min-w-[76px] rounded-full px-4 text-[14px] font-bold transition-colors", role === r ? "bg-white text-[#15130F]" : "text-[#A9A9A9] hover:text-white")}
                >
                  {ROLE_INFO[r].label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={submit}
              disabled={!email.trim() || busy === "add"}
              className="press flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 text-[15px] font-bold text-[#15130F] disabled:opacity-50"
            >
              {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" strokeWidth={2.4} />}
              Dar acesso
            </button>
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-[#8C8C8C]">{ROLE_INFO[role].hint}</p>
        </section>
      ) : (
        <p className="rounded-[20px] bg-[#1A1A1A] px-4 py-3 text-[14px] text-[#A9A9A9]">Só o dono adiciona ou tira pessoas da equipe.</p>
      )}

      <section className="rounded-[24px] bg-[#1A1A1A] p-2" aria-label="Equipe">
        {isPending ? (
          <div className="admin-skeleton m-2 h-16 rounded-[18px]" />
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {(data?.members ?? []).map((m) => {
              const initials = (m.name ?? m.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-bold", m.role === "owner" ? "bg-[#FFD599] text-[#15130F]" : "bg-[#262626] text-white")}>
                    {initials || "?"}
                  </span>
                  <span className="min-w-0 flex-1 max-sm:basis-[calc(100%-56px)]">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-bold">{m.name ?? m.email.split("@")[0]}</span>
                      {m.isMe ? <span className="shrink-0 rounded-full bg-[#262626] px-2 py-px text-[11px] font-bold text-[#D4D4D4]">Você</span> : null}
                    </span>
                    <span className="block truncate text-[13px] text-[#8C8C8C]">{m.email}</span>
                  </span>
                  {canManage && !m.isMe ? (
                    <span className="flex items-center gap-2 max-sm:ml-14">
                      <span className="flex h-10 rounded-full bg-[#1F1F1F] p-1" role="group" aria-label={`Papel de ${m.email}`}>
                        {(["admin", "owner"] as TeamRole[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            aria-pressed={m.role === r}
                            disabled={busy === m.userId}
                            onClick={() => changeRole(m, r)}
                            className={cn("press rounded-full px-3.5 text-[13px] font-bold transition-colors", m.role === r ? "bg-white text-[#15130F]" : "text-[#A9A9A9] hover:text-white")}
                          >
                            {ROLE_INFO[r].label}
                          </button>
                        ))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRemoving(m)}
                        disabled={busy === m.userId}
                        aria-label={`Tirar acesso de ${m.email}`}
                        title="Tirar acesso"
                        className="press grid size-10 place-items-center rounded-full bg-[#2A1A18] text-[#FF9A8A] hover:bg-[#33201D]"
                      >
                        {busy === m.userId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </button>
                    </span>
                  ) : (
                    <span className={cn("shrink-0 rounded-full px-3 py-1 text-[12.5px] font-bold max-sm:ml-14", m.role === "owner" ? "bg-[#2A2418] text-[#FFD599]" : "bg-[#262626] text-[#D4D4D4]")}>
                      {ROLE_INFO[m.role].label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AdminConfirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Tirar o acesso de ${removing?.name ?? removing?.email ?? ""}?`}
        description="A pessoa deixa de entrar no Admin. A conta dela continua existindo como cliente."
        confirmLabel="Tirar acesso"
        danger
        onConfirm={confirmRemove}
      />
    </div>
  );
}
