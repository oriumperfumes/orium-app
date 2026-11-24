/**
 * Junta rajadas de eventos de tempo real: no máximo uma chamada por chave a cada `wait` ms.
 * (Ao conectar o WhatsApp chegam milhares de eventos; sem isso cada aba recarrega milhares de vezes.)
 */
export function throttleByKey(fn: (key: string) => void, wait = 2000) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const call = (key = "") => {
    if (timers.has(key)) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn(key);
      }, wait),
    );
  };
  call.cancel = () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
  return call;
}
