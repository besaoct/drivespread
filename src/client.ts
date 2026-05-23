import { WsEvent } from './types.js';

export class DriveSpreadClient {
  private url: string;
  private token?: string;
  private ws?: WebSocket;
  private subscriptions = new Map<string, { filter: any; callback: (event: WsEvent) => void }>();
  private reconnectInterval = 3000;
  private isClosed = false;

  constructor(url: string, options?: { token?: string }) {
    this.url = url;
    this.token = options?.token;
    this.connect();
  }

  private connect() {
    if (this.isClosed) return;

    // Use global WebSocket (works in browser or Node with global.WebSocket)
    const WSClass = typeof WebSocket !== 'undefined' ? WebSocket : (global as any).WebSocket;
    if (!WSClass) {
      console.warn('WebSocket class not found in current environment. Subscriptions will not connect.');
      return;
    }

    const socket = new WSClass(this.url);
    this.ws = socket;

    socket.onopen = () => {
      // Re-subscribe all active subscriptions on connection
      for (const [colName, sub] of this.subscriptions.entries()) {
        this.sendSubscribeMessage(colName, sub.filter);
      }
    };

    socket.onmessage = (event: any) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type && data.collection) {
          const sub = this.subscriptions.get(data.collection);
          if (sub) {
            sub.callback(data as WsEvent);
          }
        }
      } catch (err) {
        // Fail silently
      }
    };

    socket.onclose = () => {
      // Automatic reconnection
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private sendSubscribeMessage(collection: string, filter: any) {
    const socket = this.ws;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          collection,
          filter,
          token: this.token,
        })
      );
    }
  }

  /**
   * Subscribe to collection events.
   */
  subscribe(collection: string, filter: any, callback: (event: WsEvent) => void) {
    this.subscriptions.set(collection, { filter, callback });
    this.sendSubscribeMessage(collection, filter);
  }

  /**
   * Unsubscribe from collection events.
   */
  unsubscribe(collection: string) {
    this.subscriptions.delete(collection);
    const socket = this.ws;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: 'unsubscribe', collection }));
    }
  }

  /**
   * Close connection.
   */
  close() {
    this.isClosed = true;
    this.ws?.close();
  }
}
