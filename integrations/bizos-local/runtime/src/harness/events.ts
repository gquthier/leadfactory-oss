// The runtime's event bus. Everything the renderer learns about a local
// run arrives here first, then goes out over one IPC channel
// (`lbz:event`) as a ProductEvent.
import type { ProductEvent } from "./types.js";

export type ProductEventListener = (event: ProductEvent) => void;

export class EventBus {
  private readonly listeners = new Set<ProductEventListener>();

  subscribe(listener: ProductEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ProductEvent): void {
    // Snapshot: a listener may unsubscribe while the event is dispatched.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One bad subscriber must not stop the rest of the fan-out.
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export interface NotificationSink {
  /** Whether the app window currently has focus. A finished run the user
   * is already watching does not deserve a banner. */
  isFocused(): boolean;
  show(input: { title: string; body?: string; tag?: string }): void;
}

export interface RunFinishNotice {
  botName: string;
  notifyOnFinish: boolean;
  outcome: "completed" | "failed";
  preview?: string;
}

/** Whether a finished run should raise a system notification, and what it
 * should say. Split out from Electron so the rule is testable. */
export function runFinishNotification(
  notice: RunFinishNotice,
  focused: boolean,
): { title: string; body?: string; tag: string } | null {
  if (focused || !notice.notifyOnFinish) return null;
  const preview = notice.preview?.trim();
  return {
    title:
      notice.outcome === "completed" ? `${notice.botName} finished` : `${notice.botName} stopped early`,
    ...(preview ? { body: preview.slice(0, 160) } : {}),
    tag: `lbz-run-${notice.botName}`,
  };
}
