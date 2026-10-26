import { token } from './api.js';
import { dispatch } from './store.js';

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, PRESENCE_UPDATE: 3, VOICE_STATE_UPDATE: 4, HELLO: 10, HEARTBEAT_ACK: 11, VOICE_SIGNAL: 30 };

class Gateway {
  ws = null;
  heartbeat = null;
  acked = true;
  retries = 0;
  stopped = true;
  handlers = new Set();

  connect(authToken) {
    this.token = authToken;
    this.stopped = false;
    this.open();
  }

  close() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  send(op, d) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  // Assinantes de baixo nível (a voz usa para receber VOICE_SIGNAL).
  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  open() {
    dispatch({ type: 'CONNECTION', d: this.retries ? 'reconnecting' : 'connecting' });
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${protocol}://${location.host}/gateway`));
    ws.onmessage = (e) => ws === this.ws && this.onPacket(JSON.parse(e.data));
    ws.onclose = (e) => ws === this.ws && this.onClose(e);
  }

  onPacket({ op, d, t }) {
    switch (op) {
      case OP.HELLO:
        this.startHeartbeat(d.heartbeat_interval);
        this.send(OP.IDENTIFY, { token: this.token });
        break;
      case OP.HEARTBEAT_ACK:
        this.acked = true;
        break;
      case OP.HEARTBEAT:
        this.send(OP.HEARTBEAT, null);
        break;
      case OP.DISPATCH:
        if (t === 'READY') this.retries = 0;
        dispatch({ type: t, d });
        for (const handler of this.handlers) handler(t, d);
        break;
    }
  }

  startHeartbeat(interval) {
    clearInterval(this.heartbeat);
    this.acked = true;
    this.heartbeat = setInterval(() => {
      // Sem ACK desde o último heartbeat: conexão "zumbi", reconecta.
      if (!this.acked) return this.ws?.close(4000);
      this.acked = false;
      this.send(OP.HEARTBEAT, null);
    }, interval);
  }

  onClose(event) {
    clearInterval(this.heartbeat);
    this.ws = null;
    if (this.stopped) return;
    if (event.code === 4004) {
      token.clear();
      this.stopped = true;
      dispatch({ type: 'CONNECTION', d: 'unauthorized' });
      return;
    }
    dispatch({ type: 'CONNECTION', d: 'reconnecting' });
    const delay = Math.min(1000 * 2 ** this.retries++, 15000);
    setTimeout(() => !this.stopped && this.open(), delay);
  }
}

export const gateway = new Gateway();
export { OP };
