/**
 * Script collecteur, injecté par l'appli Android dans la page bet261 (et ses iframes)
 * avant ses propres scripts. Il ne modifie rien à la page : il recopie ce qu'elle
 * reçoit déjà (méthode C : réponses JSON, WebSocket, flux SSE) et le texte affiché
 * (méthode D), puis l'envoie à l'appli via le pont MSBridge.
 * Les adresses liées au compte (solde, paiement, connexion…) sont ignorées.
 */

interface Bridge {
  postMessage(message: string): void;
}

type MSWindow = typeof globalThis & {
  __msHooked?: boolean;
  __msReplay?: (urls: string[]) => Promise<void>;
  MSBridge?: Bridge;
};

(() => {
  const w = window as unknown as MSWindow;
  if (w.__msHooked) return;
  w.__msHooked = true;

  const MAX_BODY = 1_000_000;
  const MAX_DOM = 300_000;
  // Jamais d'informations de compte ni de paiement
  const PRIVATE = /(auth|login|logout|signin|signup|register|account|wallet|balance|payment|deposit|withdraw|cashout|profile|kyc|otp|password|token|session|customer\/me|my-?bets|ticket|betslip|bonus|transaction|sms|phone)/i;
  const SECRET_PARAMS = /^(token|access_token|auth|key|apikey|api_key|session|sid|sig|signature|jwt|password)$/i;

  const send = (msg: Record<string, unknown>) => {
    try {
      w.MSBridge?.postMessage(JSON.stringify(msg));
    } catch {
      /* pont indisponible */
    }
  };

  const cleanUrl = (raw: string) => {
    try {
      const u = new URL(raw, location.href);
      for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.set(k, "***");
      return u.toString();
    } catch {
      return String(raw);
    }
  };

  const looksJson = (s: string) => /^\s*(\d+)?\s*[[{]/.test(s);

  const post = (kind: string, url: string, body: string, status?: number, method?: string) => {
    if (!body || PRIVATE.test(url)) return;
    send({ t: "capture", kind, url: cleanUrl(url), status, method, body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body, frame: location.href, at: Date.now() });
  };

  /* ----- fetch ----- */
  const origFetch = w.fetch ? w.fetch.bind(w) : undefined;
  if (origFetch) {
    w.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const p = origFetch(input, init);
      p.then((res) => {
        try {
          const url = res.url || (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          const type = res.headers.get("content-type") ?? "";
          if (type && !/json|text|javascript/i.test(type)) return;
          res
            .clone()
            .text()
            .then((t) => {
              if (/json/i.test(type) || looksJson(t)) post("xhr", url, t, res.status, (init?.method ?? "GET").toUpperCase());
            })
            .catch(() => {});
        } catch {
          /* ne jamais casser la page */
        }
      }).catch(() => {});
      return p;
    } as typeof fetch;
  }

  /* ----- XMLHttpRequest ----- */
  const XHR = w.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const sendXhr = XHR.prototype.send;
    XHR.prototype.open = function (this: XMLHttpRequest & { __ms?: { m: string; u: string } }, method: string, url: string | URL) {
      this.__ms = { m: String(method).toUpperCase(), u: String(url) };
      // eslint-disable-next-line prefer-rest-params
      return (open as (...a: unknown[]) => void).apply(this, arguments as unknown as unknown[]);
    } as typeof XHR.prototype.open;
    XHR.prototype.send = function (this: XMLHttpRequest & { __ms?: { m: string; u: string } }, body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener("load", () => {
        try {
          let text: string | undefined;
          if (this.responseType === "" || this.responseType === "text") text = this.responseText;
          else if (this.responseType === "json") text = JSON.stringify(this.response);
          if (!text) return;
          const type = this.getResponseHeader("content-type") ?? "";
          if (/json/i.test(type) || looksJson(text)) post("xhr", this.responseURL || this.__ms?.u || "", text, this.status, this.__ms?.m);
        } catch {
          /* ignoré */
        }
      });
      return sendXhr.call(this, body);
    };
  }

  /* ----- WebSocket ----- */
  const WS = w.WebSocket;
  if (WS) {
    const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      const ws = protocols === undefined ? new WS(url) : new WS(url, protocols);
      const u = String(url);
      let windowStart = Date.now();
      let count = 0;
      let dropped = 0;
      let binary = 0;
      send({ t: "meta", what: "ws-open", url: cleanUrl(u), frame: location.href });
      ws.addEventListener("message", (ev: MessageEvent) => {
        if (typeof ev.data !== "string") {
          // Trames binaires (protobuf, msgpack…) : signalées pour le relevé de diagnostic
          if (++binary % 50 === 1) send({ t: "meta", what: "ws-binary", url: cleanUrl(u), count: binary });
          return;
        }
        const now = Date.now();
        if (now - windowStart > 1000) {
          windowStart = now;
          count = 0;
        }
        if (++count > 10) {
          if (++dropped % 100 === 1) send({ t: "meta", what: "ws-throttled", url: cleanUrl(u), dropped });
          return;
        }
        if (looksJson(ev.data) || ev.data.includes("\x1e")) post("ws", u, ev.data);
      });
      return ws;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = WS.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const) Object.defineProperty(Wrapped, k, { value: WS[k] });
    w.WebSocket = Wrapped;
  }

  /* ----- EventSource (SSE) ----- */
  const ES = w.EventSource;
  if (ES) {
    const WrappedES = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      const es = new ES(url, init);
      es.addEventListener("message", (ev: MessageEvent) => {
        if (typeof ev.data === "string" && looksJson(ev.data)) post("sse", String(url), ev.data);
      });
      return es;
    } as unknown as typeof EventSource;
    WrappedES.prototype = ES.prototype;
    w.EventSource = WrappedES;
  }

  /* ----- Texte affiché (méthode D) ----- */
  type VisibleElement = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  /**
   * Texte visible, un morceau par ligne (innerText colle les éléments en ligne :
   * « 1 » + « 1.85 » deviendrait « 11.85 »). Les lignes de tableau sont gardées
   * ensemble, cellules séparées par des tabulations.
   */
  const visibleText = (): string => {
    if (!document.body) return "";
    const out: string[] = [];
    const cache = new Map<Element, boolean>();
    const visible = (el: Element) => {
      let v = cache.get(el);
      if (v === undefined) {
        const e = el as VisibleElement;
        v = typeof e.checkVisibility === "function" ? e.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) : el.getClientRects().length > 0;
        cache.set(el, v);
      }
      return v;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || !n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let row: string[] = [];
    let rowEl: Element | null = null;
    const flush = () => {
      if (row.length) out.push(row.join("\t"));
      row = [];
      rowEl = null;
    };
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement!;
      if (!visible(p)) continue;
      const t = n.nodeValue!.replace(/\s+/g, " ").trim();
      const tr = p.closest("tr");
      if (tr) {
        if (tr !== rowEl) {
          flush();
          rowEl = tr;
        }
        row.push(t);
      } else {
        flush();
        out.push(t);
      }
    }
    flush();
    return out.join("\n");
  };

  let lastText = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = () => {
    timer = undefined;
    try {
      const text = visibleText();
      if (text.trim().length < 20 || text === lastText) return;
      lastText = text;
      post("dom", location.href, text.slice(0, MAX_DOM));
    } catch {
      /* ignoré */
    }
  };
  const schedule = () => {
    if (timer === undefined) timer = w.setTimeout(snapshot, 2500);
  };
  const startObserver = () => {
    try {
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch {
      /* ignoré */
    }
    schedule();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startObserver);
  else startObserver();
  w.setInterval(schedule, 15000);

  /* ----- Méthode B : relecture des adresses JSON repérées (3 tentatives, délai croissant) ----- */
  if (window === window.top && origFetch) {
    w.__msReplay = async (urls: string[]) => {
      for (const url of urls) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await origFetch(url, { credentials: "include" });
            const text = await res.text();
            if (res.ok) {
              post("replay", url, text, res.status, "GET");
              break;
            }
            send({ t: "meta", what: "replay-error", url: cleanUrl(url), status: res.status, attempt });
          } catch (e) {
            send({ t: "meta", what: "replay-error", url: cleanUrl(url), error: String(e), attempt });
          }
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    };
  }

  send({ t: "meta", what: "page", url: cleanUrl(location.href), title: document.title, top: window === window.top });
})();
