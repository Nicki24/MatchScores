export const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.panel{width:340px;max-width:calc(100vw - 32px);color:#e7ecf5;background:rgba(10,14,26,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.18);border-radius:18px;box-shadow:0 20px 60px -10px rgba(0,0,0,.6),0 0 0 1px rgba(34,197,94,.08);overflow:hidden}
.head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;cursor:grab;background:linear-gradient(135deg,rgba(34,197,94,.18),rgba(56,189,248,.10));border-bottom:1px solid rgba(148,163,184,.12);touch-action:none}
.brand{display:flex;gap:10px;align-items:center}
.brand b{display:block;font-size:14px;letter-spacing:.2px}
.brand small{display:block;font-size:11px;color:#94a3b8}
.logo{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;font-weight:800;font-size:13px;color:#04120a;background:linear-gradient(135deg,#4ade80,#22d3ee)}
.actions{display:flex;gap:4px}
.icon{width:28px;height:28px;border-radius:8px;border:0;background:rgba(255,255,255,.06);color:#cbd5e1;font-size:16px;cursor:pointer}
.icon:hover{background:rgba(255,255,255,.12)}
.mini .body{display:none}
.body{padding:12px 14px 14px;max-height:70vh;overflow:auto}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:rgba(255,255,255,.04);border-radius:12px;margin-bottom:10px}
.tabs button{border:0;padding:8px;border-radius:9px;background:transparent;color:#94a3b8;font-weight:600;font-size:13px;cursor:pointer}
.tabs button.on{background:rgba(34,197,94,.16);color:#86efac}
.row{display:flex;gap:8px;align-items:center}
.row button{flex:1;padding:9px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.2);background:rgba(255,255,255,.05);color:#e2e8f0;font-size:12.5px;font-weight:600;cursor:pointer}
.row button:hover{background:rgba(255,255,255,.1)}
.row button:disabled{opacity:.4;cursor:not-allowed}
.row button.primary{border:0;color:#03140a;background:linear-gradient(135deg,#4ade80,#22d3ee)}
.auto{font-size:12px;color:#94a3b8;display:flex;gap:4px;align-items:center;white-space:nowrap}
.status{margin:10px 0;font-size:12px;color:#94a3b8}
.results{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.card{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(148,163,184,.12)}
.m{font-size:12px;color:#cbd5e1}
.m span{color:#64748b}
.p{display:flex;justify-content:space-between;gap:8px;margin:4px 0 6px;font-size:13.5px}
.p em{font-style:normal;font-weight:700;color:#86efac;white-space:nowrap}
.bar{height:5px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px}
.meta{margin-top:5px;font-size:11px;color:#94a3b8}
.empty{font-size:12.5px;color:#cbd5e1;padding:12px;border-radius:12px;background:rgba(245,158,11,.08);border:1px dashed rgba(245,158,11,.3)}
.foot button{font-size:12px}
.warn{margin:10px 0 0;font-size:10.5px;color:#64748b;text-align:center}
`;
