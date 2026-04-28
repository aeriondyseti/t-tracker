import { describe, expect, test } from "bun:test";
import { debounce } from "./debounce.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("debounce", () => {
  test("fires once after the trailing call", async () => {
    let n = 0;
    const d = debounce(() => n++, 50);
    d();
    d();
    d();
    expect(n).toBe(0);
    await sleep(80);
    expect(n).toBe(1);
  });

  test("each call resets the timer (10 quick calls = 1 fire)", async () => {
    let n = 0;
    const d = debounce(() => n++, 30);
    for (let i = 0; i < 10; i++) {
      d();
      await sleep(10);
    }
    await sleep(50);
    expect(n).toBe(1);
  });

  test("cancel() drops a pending fire", async () => {
    let n = 0;
    const d = debounce(() => n++, 30);
    d();
    d.cancel();
    await sleep(50);
    expect(n).toBe(0);
  });

  test("flush() runs the pending callback synchronously", () => {
    let n = 0;
    const d = debounce(() => n++, 1000);
    d();
    expect(n).toBe(0);
    d.flush();
    expect(n).toBe(1);
  });

  test("flush() with no pending call is a no-op", () => {
    let n = 0;
    const d = debounce(() => n++, 50);
    d.flush();
    expect(n).toBe(0);
  });
});
