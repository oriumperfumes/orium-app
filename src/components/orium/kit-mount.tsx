import { useKit } from "@/lib/kit";
import { lazyUI, MountWhen } from "@/lib/lazy-ui";

const KitSheet = lazyUI(() => import("@/components/orium/KitSheet").then((m) => ({ default: m.KitSheet })));

/** O kit de decants só baixa o código quando o cliente abre o kit. */
export function KitSheetMount() {
  const kit = useKit();
  return (
    <MountWhen when={kit.open}>
      <KitSheet />
    </MountWhen>
  );
}
