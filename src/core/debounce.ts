// Trailing-edge debounce: each call resets a timer; the wrapped function
// runs once, `delayMs` after the last call. The returned object exposes
// `cancel()` so daemons can drop pending fires on shutdown.

export interface Debounced {
  (): void;
  cancel(): void;
  flush(): void;
}

export function debounce(fn: () => void, delayMs: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const trigger = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };

  trigger.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  trigger.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn();
    }
  };

  return trigger;
}
