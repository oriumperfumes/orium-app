/**
 * Ícones sólidos do header e da barra inferior, desenhados no traço do Figma
 * (preenchidos, cantos arredondados). currentColor em tudo.
 */
type P = { className?: string };

export const IconHome = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M11.05 2.4a1.5 1.5 0 0 1 1.9 0l9 7.35a1 1 0 0 1-1.27 1.55L19.5 10.3V19a2.5 2.5 0 0 1-2.5 2.5h-2.5a1 1 0 0 1-1-1v-4.25a1.5 1.5 0 0 0-3 0v4.25a1 1 0 0 1-1 1H7A2.5 2.5 0 0 1 4.5 19v-8.7l-1.18.99A1 1 0 0 1 2.05 9.75l9-7.35Z" />
  </svg>
);

export const IconSearch = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.75" />
    <path d="m15.6 15.6 5.4 5.4" />
  </svg>
);

export const IconChat = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path
      fillRule="evenodd"
      d="M12 2.25c5.52 0 10 3.97 10 8.88 0 4.9-4.48 8.87-10 8.87-1.2 0-2.35-.18-3.42-.53l-4.2 1.9a.75.75 0 0 1-1.04-.82l.78-3.73C2.86 15.2 2 13.25 2 11.13 2 6.22 6.48 2.25 12 2.25ZM7.6 12.6a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9Zm4.4 0a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9Zm4.4 0a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9Z"
    />
  </svg>
);

export const IconPerson = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <circle cx="12" cy="6.75" r="4.5" />
    <path d="M3.5 19.6c0-3.6 3.1-6.35 6.9-6.35h3.2c3.8 0 6.9 2.75 6.9 6.35v.65a1.75 1.75 0 0 1-1.75 1.75H5.25A1.75 1.75 0 0 1 3.5 20.25v-.65Z" />
  </svg>
);

/** Sacola (o mesmo objeto do topo da página do perfume), em versão sólida. */
export const IconBag = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
    <path
      fill="currentColor"
      d="M5.2 7.6A1.6 1.6 0 0 1 6.8 6.1h10.4a1.6 1.6 0 0 1 1.6 1.5l.95 11.6A2.6 2.6 0 0 1 17.16 22H6.84a2.6 2.6 0 0 1-2.59-2.8L5.2 7.6Z"
    />
    <path d="M8.6 7V6a3.4 3.4 0 0 1 6.8 0v1" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    <circle cx="8.6" cy="10" r="1.05" fill="#0a0a0a" />
    <circle cx="15.4" cy="10" r="1.05" fill="#0a0a0a" />
  </svg>
);

export const IconHeart = ({ className, filled = true }: P & { filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 2}
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 20.8c-.3 0-.6-.1-.84-.28C6.7 17.17 2.5 13.7 2.5 9.1 2.5 6.1 4.83 3.75 7.75 3.75c1.7 0 3.24.82 4.25 2.13a5.27 5.27 0 0 1 4.25-2.13c2.92 0 5.25 2.35 5.25 5.35 0 4.6-4.2 8.07-8.66 11.42-.24.18-.54.28-.84.28Z" />
  </svg>
);

export const IconSliders = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
    <path d="M3.5 7h9M17.5 7h3M3.5 17h3M11.5 17h9" />
    <circle cx="15" cy="7" r="2.5" />
    <circle cx="9" cy="17" r="2.5" />
  </svg>
);
