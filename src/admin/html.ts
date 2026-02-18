// src/admin/html.ts

function esc(s: unknown) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function layout(args: {
  title: string;
  user: string | null;
  body: string;
  flash?: { kind: "ok" | "err"; message: string } | null;
}) {
  const { title, user, body, flash } = args;

  const flashHtml = flash
    ? `<div class="flash ${flash.kind === "ok" ? "ok" : "err"}">${esc(flash.message)}</div>`
    : "";

  const nav = user
    ? `
    <nav class="nav">
      <div class="nav-left">
        <a href="/admin/tasks">Tasks</a>
        <a href="/admin/projects">Projects</a>
      </div>
      <div class="nav-right">
        <span class="muted">${esc(user)}</span>
        <form method="post" action="/admin/logout" style="display:inline">
          <button class="link" type="submit">Logout</button>
        </form>
      </div>
    </nav>
    `
    : "";

  return `<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>
      :root { --bg:#0b1020; --card:#111833; --muted:#9aa4b2; --text:#e7eaf0; --line:#233056; --ok:#0a7a3d; --err:#a01c2a; }
      body{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--text); }
      a{ color:inherit; text-decoration:none; }
      .wrap{ max-width:1100px; margin:0 auto; padding:22px 16px 60px; }
      .nav{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 16px; border-bottom:1px solid var(--line); background:rgba(17,24,51,.6); position:sticky; top:0; backdrop-filter: blur(8px); }
      .nav a{ padding:8px 10px; border-radius:10px; }
      .nav a:hover{ background:rgba(255,255,255,.06); }
      .muted{ color:var(--muted); font-size:14px; }
      .card{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
      h1{ font-size:22px; margin:0 0 14px; }
      h2{ font-size:16px; margin:22px 0 10px; color:var(--muted); font-weight:600; }
      table{ width:100%; border-collapse:collapse; }
      th, td{ padding:10px 10px; border-bottom:1px solid rgba(35,48,86,.7); font-size:14px; vertical-align:top; }
      th{ color:var(--muted); text-align:left; font-weight:600; }
      .pill{ display:inline-block; padding:3px 8px; border-radius:999px; font-size:12px; border:1px solid rgba(255,255,255,.10); }
      .row{ display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
      @media (max-width: 860px){ .row{ grid-template-columns:1fr; } }
      label{ display:block; font-size:13px; color:var(--muted); margin-bottom:6px; }
      input, select, textarea{ width:100%; box-sizing:border-box; background:rgba(255,255,255,.04); color:var(--text); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:10px 12px; outline:none; }
      textarea{ min-height: 110px; resize: vertical; }
      input:focus, select:focus, textarea:focus{ border-color: rgba(110,180,255,.55); }
      .actions{ display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
      button{ background:rgba(110,180,255,.16); color:var(--text); border:1px solid rgba(110,180,255,.35); border-radius:12px; padding:10px 12px; cursor:pointer; }
      button:hover{ background:rgba(110,180,255,.24); }
      .danger{ background:rgba(255,80,80,.10); border-color:rgba(255,80,80,.35); }
      .danger:hover{ background:rgba(255,80,80,.18); }
      .link{ background:transparent; border:none; color:rgba(110,180,255,.95); padding:8px 10px; border-radius:10px; }
      .link:hover{ background:rgba(255,255,255,.06); }
      .flash{ margin:16px 0; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,.10); }
      .flash.ok{ background:rgba(10,122,61,.18); border-color:rgba(10,122,61,.45); }
      .flash.err{ background:rgba(160,28,42,.18); border-color:rgba(160,28,42,.45); }
      .topbar{ display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
      .filters{ display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
      .filters > div{ min-width:160px; }
      .small{ font-size:12px; color:var(--muted); }
      .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
  </head>
  <body>
    ${nav}
    <div class="wrap">
      ${flashHtml}
      ${body}
    </div>
  </body>
</html>`;
}

export function escHtml(s: unknown) {
  return esc(s);
}

export function fmtDate(d: Date | null | undefined) {
  if (!d) return "";
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

export function fmtDateTime(d: Date | null | undefined) {
  if (!d) return "";
  // YYYY-MM-DD HH:mm
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}
