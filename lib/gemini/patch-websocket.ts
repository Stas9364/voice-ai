/**
 * Патч глобального WebSocket: send() при CLOSING/CLOSED тихо игнорируется.
 * SDK @google/genai (_browser_websocket.ts) бросает при send() на закрытом сокете —
 * патч перехватывает вызов до исключения внутри SDK.
 */

let patched = false;

export function patchWebSocketForClosedState() {
  if (patched || typeof window === "undefined") return;
  patched = true;

  const OriginalWebSocket = window.WebSocket;

  class PatchedWebSocket extends OriginalWebSocket {
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (
        this.readyState === WebSocket.CLOSING ||
        this.readyState === WebSocket.CLOSED
      ) {
        return;
      }
      super.send(data);
    }
  }

  // @ts-expect-error patching global
  window.WebSocket = PatchedWebSocket;
}
