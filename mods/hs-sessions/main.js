// @ts-nocheck  (plain-JS herdr mod: no type annotations by design; herdr-app check is the gate)
// Session records for pi, Claude Code, and opencode in this folder (or every
// folder): titled from each tool's own records, tagged by hand, resumed in a
// new terminal with one click.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, theme, home, run, shared, setShared, notify } from "herdr";

const TAGS = "hs.sessions.tags";
const PI = "pi", CC = "cc", OC = "oc";
const AGENTS = {
  [PI]: { label: "pi", color: "ansi5", argv: () => [`${home()}/.npm-global/bin/pi`, "--session"] },
  [CC]: { label: "cc", color: "ansi3", argv: () => ["claude", "--resume"] },
  [OC]: { label: "oc", color: "ansi4", argv: () => [`${home()}/.npm-global/bin/opencode`] },
};

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on: space?.machine ?? null };
}

// What the list is filtered by: active space identity, its folder, and where
// the focused terminal sits. One string, so a timer can compare cheaply.
function where() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  return [space?.id ?? "", space?.folder ?? "", space?.machine ?? "", pane?.cwd ?? "", f?.cwd ?? ""].join("\u0000");
}

// "This project" is the space's own folder. It is used even when the space is
// rooted at home: falling back to the focused terminal there made switching
// spaces look like it did nothing, because both spaces' terminals sat in the
// same folder. Only a space with no folder at all follows the focused terminal.
function projectRoot() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  return space?.folder || pane?.cwd || f?.cwd || "";
}

// One Python pass for both file-based tools: id, cwd, mtime, and the title.
// pi's own display name (set by renaming a session) wins over its first user
// message, and pi's real session id lives in the file's first JSONL line — the
// filename's `<timestamp>_<id>` prefix is not something `pi --session` accepts.
const SCAN = String.raw`
import json, glob, os
def text_of(content):
    if isinstance(content, str): return content
    parts = []
    for part in content or []:
        if isinstance(part, dict):
            if part.get("type") == "text" or "text" in part: parts.append(part.get("text") or "")
        elif isinstance(part, str): parts.append(part)
    return " ".join(parts)
def read_first(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f: return json.loads(f.readline() or "{}")
    except Exception: return {}
def first_user(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                try: o = json.loads(line)
                except Exception: continue
                msg = o.get("message") or {}
                if o.get("type") == "user" or msg.get("role") == "user":
                    t = text_of(msg.get("content") or o.get("content"))
                    if t.strip(): return t
    except Exception: pass
    return ""
def first_cwd(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if '"cwd"' not in line: continue
                try: o = json.loads(line)
                except Exception: continue
                if o.get("cwd"): return o["cwd"]
    except Exception: pass
    return ""
def session_name(path):
    name = ""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if "session_info" not in line: continue
                try: o = json.loads(line)
                except Exception: continue
                if o.get("type") == "session_info" and o.get("name"): name = o["name"]
    except Exception: pass
    return name
def row(agent, ident, cwd, path, title):
    return {"agent": agent, "id": ident, "file": os.path.basename(path), "cwd": cwd or "", "mtime": int(os.path.getmtime(path) * 1000), "title": " ".join((title or "").split())[:200]}
out = []
for path in glob.glob(os.path.expanduser("~/.pi/agent/sessions/*/*.jsonl")):
    head = read_first(path)
    ident = head.get("id") or os.path.basename(path).rsplit("_", 1)[-1].replace(".jsonl", "")
    out.append(row("pi", ident, head.get("cwd") or first_cwd(path), path, session_name(path) or first_user(path)))
for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
    head = read_first(path)
    out.append(row("cc", os.path.basename(path).replace(".jsonl", ""), head.get("cwd") or first_cwd(path), path, first_user(path)))
print(json.dumps(out))
`;

function when(millis) {
  const s = Math.max(0, Date.now() - millis) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}

export default class Sessions extends View {
  init(_props, cx) {
    this.sessions = []; this.error = null; this.loading = false;
    this.scope = "current"; this.tagOnly = null; this.filter = ""; this.tagging = null;
    this.input = InputState.new({ placeholder: "搜索标题/路径， #标签 只按标签过滤" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); cx.notify(); });
    this.refresh(cx);
    cx.timer.every(30000, cx => this.refresh(cx));
    // A panel is not re-rendered when the person switches space or focuses
    // another terminal, so watch what the list depends on and re-render on
    // change: without this the list keeps showing the previous project.
    this.watch = null;
    cx.timer.every(500, (cx) => {
      const seen = where();
      if (seen === this.watch) return;
      const first = this.watch === null;
      this.watch = seen;
      if (first) return;
      this.refresh(cx);
      cx.notify();
    });
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.context = {};
    const context = this.context;
    cx.spawn(async cx => {
      try {
        const [scan, oc, claude] = await Promise.all([
          exec("python3", ["-c", SCAN]).catch(() => null),
          exec("sqlite3", ["-json", `${home()}/.local/share/opencode/opencode.db`, "select id, title, directory, time_updated/1000 as mtime from session where time_archived is null order by time_updated desc limit 300"]).catch(() => null),
          exec("sh", ["-c", "command -v claude || true"]).catch(() => null),
        ]);
        if (this.context !== context) return;
        this.claude = Boolean(claude?.code === 0 && claude.stdout?.trim());
        let out = [];
        if (scan?.code === 0 && scan.stdout?.trim()) { try { out = JSON.parse(scan.stdout); } catch { out = []; } }
        if (oc?.code === 0 && oc.stdout?.trim()) {
          for (const s of JSON.parse(oc.stdout)) out.push({ agent: OC, id: s.id, cwd: s.directory, mtime: s.mtime * 1000, title: String(s.title ?? "") });
        }
        this.sessions = out.filter(s => s.title || s.cwd).sort((a, b) => b.mtime - a.mtime).slice(0, 400);
        this.error = null;
      } catch (e) { if (this.context === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  // Tags are keyed on the session's file name: it is stable and it is what the
  // tags already stored in shared state use. `id` is only for resuming.
  keyOf(session) {
    return `${session.agent}:${session.file || session.id}`;
  }

  tagsOf(session) {
    const all = shared(TAGS) ?? {};
    return all[this.keyOf(session)] ?? all[`${session.agent}:${session.id}`] ?? [];
  }

  setTags(session, tags, cx) {
    const all = { ...(shared(TAGS) ?? {}) }, key = this.keyOf(session);
    if (tags.length) all[key] = tags; else delete all[key];
    setShared(TAGS, all);
    cx.notify();
  }

  visible(root) {
    // `#tag` filters by tag only, `#tag word` requires both, several `#tags`
    // must all match. A tag matches on substring, so `#数据` finds 数据对账.
    const raw = this.filter.trim();
    const wanted = [...raw.matchAll(/#([^\s#]+)/g)].map(m => m[1].toLowerCase());
    const q = raw.replace(/#[^\s#]+/g, " ").trim().toLowerCase();
    return this.sessions.filter(s => {
      if (!(root && s.cwd && (s.cwd === root || s.cwd.startsWith(root + "/")))) return false;
      const own = this.tagsOf(s).map(x => String(x).toLowerCase());
      if (this.tagOnly && !own.includes(String(this.tagOnly).toLowerCase())) return false;
      if (wanted.some(tag => !own.some(x => x.includes(tag)))) return false;
      if (!q) return true;
      return `${s.title} ${own.join(" ")} ${s.cwd}`.toLowerCase().includes(q);
    });
  }

  // Opens the session where it was recorded; opencode's TUI picks the session
  // itself, and Claude Code needs its CLI on the PATH.
  resume(session) {
    const agent = AGENTS[session.agent];
    if (session.agent === CC && !this.claude) { notify({ title: "claude 未安装", body: "找不到 claude 命令，无法 resume 这个会话", level: "warning" }); return; }
    const folder = session.cwd || location().cwd;
    if (!folder) { notify({ title: "会话没有记录目录", level: "warning" }); return; }
    run("terminal.open", { argv: [...agent.argv(), ...(session.agent === OC ? [] : [session.id])], folder, place: "tab" });
  }

  tagInputFor(key) {
    // One InputState per tagging session, kept so re-renders never rebuild it.
    if (this.tagKey !== key) {
      this.tagKey = key;
      this.tagInput = InputState.new({ placeholder: "标签，逗号分隔" });
      this.tagInput.on("submit", (_e, cx) => this.commitTag(cx));
    }
    return this.tagInput;
  }

  startTag(session, cx) {
    const key = this.keyOf(session);
    this.tagging = key;
    this.tagInputFor(key);
    cx.notify();
  }

  commitTag(cx) {
    const session = this.sessions.find((s) => this.keyOf(s) === this.tagging);
    const typed = (this.tagInput?.value() ?? "").split(/[,，]/).map(t => t.trim()).filter(Boolean);
    if (session && typed.length) this.setTags(session, [...new Set([...this.tagsOf(session), ...typed])], cx);
    this.tagging = null;
    this.tagInput = null;
    this.tagKey = null;
    cx.notify();
  }

  tagChip(session, tag, j, i, t) {
    const on = this.tagOnly === tag;
    return h_flex().id(`tag-${i}-${j}`).h(16).px(5).gap(3).flex_none().items_center().rounded(4)
      .bg(on ? t.selected : t.raised).text_size(10).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.tagOnly = on ? null : tag; cx.notify(); })
      .child(div().max_w(90).truncate().child(tag))
      .child(div().id(`tag-x-${i}-${j}`).text_size(10).text_color(t.dim).hover(s => s.text_color(t.ansi1))
        .on_click((_e, cx) => { cx.stop_propagation(); if (this.tagOnly === tag) this.tagOnly = null; this.setTags(session, this.tagsOf(session).filter(x => x !== tag), cx); })
        .child("✕"));
  }

  // Three lines: the title, then time + folder, then this session's tags.
  row(session, i, t, short, root) {
    const tags = this.tagsOf(session), agent = AGENTS[session.agent];
    const tagging = this.tagging === this.keyOf(session);
    const away = session.cwd && root && !session.cwd.startsWith(root);
    return div().id(`session-${i}`).flex().flex_col().flex_none().w_full().min_w(0).gap(3).px(8).py(6).rounded(7)
      .when(!tagging, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click(() => this.resume(session)))
      .when(tagging, el => el.bg(t.selected))
      .child(h_flex().w_full().min_w(0).gap(7).items_center()
        .child(div().id(`agent-${i}`).min_w(22).h(15).px(3).flex_none().flex().items_center().justify_center().rounded(4).bg(t.raised).text_size(9).text_color(t[agent.color]).child(agent.label))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(session.title || "(无标题)"))
        .when(!tagging, el => el.child(div().id(`tag-add-${i}`).size(15).flex_none().flex().items_center().justify_center().rounded(4).text_size(11).text_color(t.dim)
          .hover(s => s.text_color(t.accent).bg(t.raised))
          .on_click((_e, cx) => { cx.stop_propagation(); this.startTag(session, cx); })
          .child("+"))))
      .child(h_flex().w_full().min_w(0).pl(29).gap(6).items_center()
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(when(session.mtime)))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child("·"))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).when(Boolean(away), el => el.text_color(t.dim)).child(short(session.cwd) || "未记录目录")))
      .when(tagging, el => el.child(h_flex().w_full().min_w(0).pl(29).gap(4).items_center()
        .child(Input.new(this.tagInputFor(this.keyOf(session))).flex_1().min_w(0).h(22).text_size(11).text_color(t.foreground))
        .child(div().id("tag-save").h(22).px(6).flex_none().flex().items_center().rounded(5).bg(t.raised).cursor_pointer().text_size(10.5).text_color(t.accent)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); this.commitTag(cx); }).child("保存"))))
      .when(!tagging && tags.length, el => el.child(h_flex().w_full().min_w(0).pl(29).gap(4).items_center().overflow_hidden()
        .children(tags.slice(0, 6).map((tag, j) => this.tagChip(session, tag, j, i, t)))
        .when(tags.length > 6, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(`+${tags.length - 6}`)))));
  }

  // Only the space's own project is listed, so no scope toggle: the header
  // shows which folder is being filtered instead.
  render(cx) {
    const t = theme(), h = home(), root = projectRoot();
    const short = (p) => p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p ?? "";
    const list = this.visible(root);
    const counts = { [PI]: 0, [CC]: 0, [OC]: 0 };
    for (const s of list) counts[s.agent]++;
    return v_flex().id("sessions").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Sessions"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${list.length}`))
        .child(div().flex_1())
        .child(div().id("sess-root").max_w(150).truncate().text_size(10.5).text_color(t.dim).child(short(root) || "无目录"))
        .when(Boolean(this.tagOnly), el => el.child(h_flex().id("sess-tagonly").h(20).px(6).gap(4).flex_none().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.accent)
          .child(div().max_w(80).truncate().child(`#${this.tagOnly}`))
          .child(div().text_size(10).text_color(t.dim).hover(s => s.text_color(t.ansi1))
            .on_click(() => { this.tagOnly = null; cx.notify(); }).child("✕")))))
      .child(h_flex().h(30).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`pi ${counts[PI]} · cc ${counts[CC]} · oc ${counts[OC]}`)))
      .child(v_flex().id("session-list").flex_1().min_h(0).p(6).gap(2).overflow_y_scroll()
        .children(list.map((s, i) => this.row(s, i, t, short, root))))
      .when(!list.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading sessions…" : !root ? "当前 space 没有目录" : this.filter.trim().startsWith("#") ? "没有匹配这个标签的会话（先用行右侧 + 给会话加标签）" : "当前项目没有会话"))));
  }
}
