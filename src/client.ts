import { WsEvent } from './types.js';

export class DriveSpreadClient {
  private url: string;
  private token?: string;
  public ws?: WebSocket;
  private subscriptions = new Map<string, { filter: any; callback: (event: WsEvent) => void }>();
  private reconnectInterval = 3000;
  private isClosed = false;
  private activeRequests = 0;

  // Connection callbacks that persist across reconnects
  public onOpen?: () => void;
  public onClose?: () => void;
  public onError?: (err: any) => void;
  public onLoadingChange?: (isLoading: boolean) => void;

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
      if (this.onOpen) {
        this.onOpen();
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
      if (this.onClose) {
        this.onClose();
      }
      // Automatic reconnection
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    socket.onerror = (err: any) => {
      if (this.onError) {
        this.onError(err);
      }
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

  private getHttpUrl(): string {
    return this.url.replace(/^ws(s)?:\/\//, 'http$1://');
  }

  private setLoading(isLoading: boolean) {
    if (isLoading) {
      this.activeRequests++;
      if (this.activeRequests === 1 && this.onLoadingChange) {
        this.onLoadingChange(true);
      }
    } else {
      this.activeRequests--;
      if (this.activeRequests === 0 && this.onLoadingChange) {
        this.onLoadingChange(false);
      }
    }
  }

  private async fetchApi(path: string, options: RequestInit = {}) {
    const url = `${this.getHttpUrl()}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as any) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    this.setLoading(true);
    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        let errMsg = res.statusText;
        try {
          const body = await res.json();
          if (body.error) errMsg = body.error;
        } catch { }
        throw new Error(errMsg);
      }
      return await res.json();
    } finally {
      this.setLoading(false);
    }
  }

  async find(collection: string, query?: Record<string, any>) {
    let q = '';
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (typeof v === 'object' && v !== null) {
          for (const [op, opVal] of Object.entries(v)) {
            params.append(`${k}[${op}]`, String(opVal));
          }
        } else {
          params.append(k, String(v));
        }
      }
      const p = params.toString();
      if (p) q = `?${p}`;
    }
    return this.fetchApi(`/api/${collection}${q}`);
  }

  async findById(collection: string, id: string) {
    return this.fetchApi(`/api/${collection}/${id}`);
  }

  async insert(collection: string, data: any) {
    return this.fetchApi(`/api/${collection}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateById(collection: string, id: string, data: any) {
    return this.fetchApi(`/api/${collection}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteById(collection: string, id: string) {
    return this.fetchApi(`/api/${collection}/${id}`, {
      method: 'DELETE',
    });
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
