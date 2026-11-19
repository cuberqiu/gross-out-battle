// WebSocket-first transport with an automatic HTTP long-polling fallback.
export class Realtime {
  constructor({ token, onState, onEvent, onStatus, onError, onFatal }) {
    this.token = token;
    this.onState = onState || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    this.onFatal = onFatal || (() => {});
    this.ws = null;
    this.polling = false;
    this.active = false;
    this.cursor = 0;
    this.helloReceived = false;
    this.attempt = 0;
    this.pollHadSuccess = false;
    this.pollFailures = 0;
    this.retryTimer = null;
    this.currentTransport = null;
    this.stoppedByFatal = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.openSocket();
  }

  stop() {
    this.active = false;
    this.attempt += 1;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPolling();
    if (this.ws) {
      try {
        this.ws.close(1000, 'client_close');
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  openSocket() {
    if (!this.active) return;
    this.attempt += 1;
    const attempt = this.attempt;
    this.helloReceived = false;
    this.onStatus({
      state: this.pollHadSuccess ? 'reconnecting' : 'connecting',
      transport: 'ws',
    });
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws;
    try {
      ws = new WebSocket(`${protocol}//${location.host}/ws`);
    } catch {
      this.startPolling('ws_failed');
      return;
    }
    this.ws = ws;
    let fallbackTimer = setTimeout(() => {
      if (!this.active || attempt !== this.attempt || this.helloReceived) return;
      this.startPolling('ws_timeout');
    }, 3000);

    ws.addEventListener('open', () => {
      if (!this.active || attempt !== this.attempt) return;
      try {
        ws.send(JSON.stringify({ type: 'auth', token: this.token, since: this.cursor }));
      } catch {
        /* close event will follow */
      }
    });

    ws.addEventListener('message', (messageEvent) => {
      if (!this.active || attempt !== this.attempt) return;
      let msg;
      try {
        msg = JSON.parse(messageEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        clearTimeout(fallbackTimer);
        this.helloReceived = true;
        this.currentTransport = 'ws';
        this.pollHadSuccess = true;
        this.cursor = Number.isFinite(msg.cursor) ? msg.cursor : this.cursor;
        this.stopPolling();
        if (msg.snapshot) this.onState(msg.snapshot);
        this.onStatus({ state: 'online', transport: 'ws' });
        return;
      }
      if (msg.type === 'state') {
        if (msg.snapshot) this.onState(msg.snapshot);
        return;
      }
      if (msg.type === 'auth_error') {
        clearTimeout(fallbackTimer);
        this.fatal(msg.message || '房间连接失效');
        return;
      }
      if (msg.type === 'error') {
        this.onError(msg.message || '操作没有成功');
        return;
      }
      if (msg.type === 'pong' || msg.type === 'ack') return;
      if (Number.isFinite(msg.seq) && msg.seq > this.cursor) this.cursor = msg.seq;
      if (msg.type) this.onEvent(msg);
    });

    ws.addEventListener('error', () => {
      // A close event always follows; fallback is handled there.
    });

    ws.addEventListener('close', () => {
      clearTimeout(fallbackTimer);
      if (!this.active || attempt !== this.attempt) return;
      if (this.ws === ws) this.ws = null;
      if (this.polling) return;
      this.helloReceived = false;
      this.onStatus({ state: 'reconnecting', transport: 'ws' });
      // Do not sit in a reconnect loop: the long-poll fallback is the safety net.
      this.startPolling('socket_closed');
    });
  }

  startPolling() {
    if (!this.active || this.polling) return;
    this.attempt += 1;
    this.helloReceived = false;
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try {
        old.close(1000, 'fallback');
      } catch {
        /* ignore */
      }
    }
    this.polling = true;
    this.onStatus({ state: this.pollHadSuccess ? 'reconnecting' : 'connecting', transport: 'poll' });
    this.pollLoop();
  }

  stopPolling() {
    this.polling = false;
  }

  async pollLoop() {
    while (this.active && this.polling) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(
          `/api/poll?token=${encodeURIComponent(this.token)}&since=${this.cursor}`,
          { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' },
        );
        clearTimeout(timeout);
        if (!this.active || !this.polling) return;
        if (response.status === 401) {
          let message = '房间连接失效，请重新进入';
          try {
            const data = await response.json();
            if (data?.error) message = data.error;
          } catch {
            /* ignore */
          }
          this.fatal(message);
          return;
        }
        if (!response.ok) throw new Error(`poll_http_${response.status}`);
        const data = await response.json();
        if (!this.active || !this.polling) return;
        if (Number.isFinite(data.cursor)) this.cursor = data.cursor;
        if (data.snapshot) this.onState(data.snapshot);
        if (Array.isArray(data.events)) {
          for (const event of data.events) {
            if (Number.isFinite(event.seq) && event.seq > this.cursor) this.cursor = event.seq;
            this.onEvent(event);
          }
        }
        this.pollFailures = 0;
        const first = !this.pollHadSuccess;
        this.pollHadSuccess = true;
        this.currentTransport = 'poll';
        this.onStatus({ state: 'online', transport: 'poll', first });
      } catch (error) {
        clearTimeout(timeout);
        if (!this.active || !this.polling) return;
        this.pollFailures += 1;
        this.onStatus({ state: 'reconnecting', transport: 'poll' });
        const wait = Math.min(4000, 600 + this.pollFailures * 500);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  send(action) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.helloReceived) {
      try {
        this.ws.send(JSON.stringify({ type: 'action', action }));
        return true;
      } catch {
        /* fall through */
      }
    }
    if (this.polling) {
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, action }),
      })
        .then(async (response) => {
          if (response.status === 401) {
            this.fatal('房间连接失效，请重新进入');
            return;
          }
          if (!response.ok) {
            let message = '操作没有成功';
            try {
              const data = await response.json();
              if (data?.error) message = data.error;
            } catch {
              /* ignore */
            }
            this.onError(message);
          }
        })
        .catch(() => this.onError('网络抖了一下，再试一次'));
      return true;
    }
    this.onError('还在连线，稍等一下下');
    return false;
  }

  fatal(message) {
    if (this.stoppedByFatal) return;
    this.stoppedByFatal = true;
    this.onFatal(message);
  }
}
