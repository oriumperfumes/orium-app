import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BackLink } from '@/components/orium/BackLink';
import { Gem, MessageCircle } from "lucide-react";
import { productTitle } from "@/lib/format";
import { NEGOTIATION_TAGLINE, negotiationPhoto, useNegotiationItem } from "@/lib/negotiation";
import { FragranceStory } from "@/components/orium/FragranceStory";
import { OtherNegotiations } from "@/components/orium/OtherNegotiations";
import { PhotoFade } from "@/components/orium/PhotoFade";
import { NegotiationContactSheet } from "@/components/orium/NegotiationContactSheet";

export const Route = createFileRoute("/negociacao/$id")({
  head: () => ({
    meta: [
      { title: "Negociação · Orium Perfumes" },
      {
        name: "description",
        content:
          "Perfumes deslacrados e praticamente cheios da Orium, disponíveis para negociar direto pelo WhatsApp.",
      },
      { property: "og:title", content: "Negociação · Orium Perfumes" },
      {
        property: "og:description",
        content: "Oportunidades especiais em perfumes deslacrados e muito bem conservados.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NegotiationDetail,
});

function NegotiationDetail() {
  const { id } = Route.useParams();
  const { data: item, isLoading } = useNegotiationItem(id);
  const [contact, setContact] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="aspect-[4/5] w-full rounded-3xl bg-surface-3" />
        <div className="mt-4 h-5 w-2/3 rounded-full bg-surface-3" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="display text-2xl">Item não disponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Este perfume de negociação não está mais na vitrine.
        </p>
        <Link
          to="/"
          className="press mt-6 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-semibold text-background"
        >
          Voltar ao catálogo
        </Link>
      </div>
    );
  }

  const photo = negotiationPhoto(item.image_url);

  return (
    <div className="mx-auto max-w-lg px-4 pt-4 pb-[calc(11rem+env(safe-area-inset-bottom))] tab:max-w-3xl tab:px-6 wide:max-w-4xl">
      <BackLink label="Voltar" />

      {/* tablet: foto e informações lado a lado, sem esticar a foto */}
      <div className="tab:grid tab:grid-cols-2 tab:items-start tab:gap-8">
        <div className="mt-3 overflow-hidden rounded-3xl border border-gold/25 bg-surface-2">
          <div className="relative aspect-[4/5] w-full">
            {photo ? (
              <PhotoFade src={photo} alt={`${item.brand ?? "Orium"} ${item.name}`} priority />

            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <Gem className="size-8" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 tab:mt-3">
          <span className="rounded-full border border-gold/40 px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.14em] text-gold-foreground uppercase dark:text-gold">
            {item.status === "NEGOTIATING" ? "Em negociação" : "Negociação"}
          </span>
          <p className="mt-2.5 text-[11px] tracking-wide text-muted-foreground uppercase">
            {item.brand ?? "Orium"}
          </p>
          <h1 className="display text-2xl leading-tight tab:text-3xl">{productTitle(item.name)}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Deslacrado · {item.condition_note}
            {item.volume_ml ? ` · ${item.volume_ml}ml` : ""}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{NEGOTIATION_TAGLINE}</p>
        </div>
      </div>


      {/* Mesmo bloco olfativo dos perfumes do catálogo */}
      {item.product_id ? (
        <FragranceStory productId={item.product_id} descriptionOverride={item.description} />
      ) : item.description ? (
        <p className="mt-6 text-sm leading-relaxed whitespace-pre-line">{item.description}</p>
      ) : null}

      <p className="mt-7 text-sm text-muted-foreground">
        Uma oportunidade para levar essa fragrância por um valor negociável. Fale com a Orium e faça
        sua proposta.
      </p>

      {/* Um item negociável sempre puxa os outros da mesma área. */}
      <OtherNegotiations currentId={item.id} />


      {/* Fica acima da navegação inferior no mobile (que tem 56px + safe area). */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 px-4 pb-3 tab:bottom-0 tab:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setContact(true)}
          className="press mx-auto flex h-14 w-full max-w-lg items-center justify-center gap-2 rounded-[22px] bg-gradient-to-b from-gold-soft to-gold text-[15px] font-semibold text-gold-foreground shadow-soft tab:max-w-md"
        >
          <MessageCircle className="size-[18px]" /> Negociar no WhatsApp
        </button>
      </div>

      <NegotiationContactSheet item={item} open={contact} onOpenChange={setContact} />
    </div>
  );
}
