import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Avisos do app — mesmo material dos pop-ups: cartão escuro sólido,
 * cantos grandes, ícone dourado e ação em pílula dourada. Sem brilho.
 * Descem logo abaixo do header, sem cobrir o logo nem os ícones.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      offset={{ top: 84 }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 62px)", left: 16, right: 16 }}
      gap={10}
      swipeDirections={["top", "left", "right"]}
      style={
        {
          "--normal-bg": "#161616",
          "--normal-border": "rgb(255 255 255 / 0.07)",
          "--normal-text": "#ffffff",
          "--success-bg": "#161616",
          "--success-border": "rgb(255 255 255 / 0.07)",
          "--success-text": "#ffffff",
          "--error-bg": "#161616",
          "--error-border": "rgb(255 120 120 / 0.25)",
          "--error-text": "#ffffff",
          "--border-radius": "22px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "o-toast group toast !gap-3 !px-4 !py-3.5 !text-[14px] !font-semibold !shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_30px_60px_-24px_rgb(0_0_0/0.9)]",
          title: "!font-semibold !leading-snug",
          description: "!text-[12.5px] !font-normal !text-[#A9A9A9] !leading-snug",
          icon: "!text-[#FFD599]",
          actionButton:
            "!h-8 !rounded-full !bg-[#FFD599] !px-3.5 !text-[12.5px] !font-bold !text-[#15130F]",
          cancelButton: "!h-8 !rounded-full !bg-white/10 !px-3.5 !text-[12.5px] !text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
