// @ts-nocheck  (plain-JS herdr mod: no type annotations by design; herdr-app check is the gate)
// Favorites: remembered folders as a flat two-line list, kept in shared state.
// Opening one selects the space already on that folder (or makes a new one).
// "收藏当前目录" uses the space's own folder, not the focused terminal's cwd.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, focused, run, shared, setShared, pickFolder, home, notify } from "herdr";

const KEY = "hs.favorites";
const read = () => shared(KEY) ?? [];
const same = (a, b) => (a?.folder ?? "") === (b?.folder ?? "") && (a?.machine ?? null) === (b?.machine ?? null);

// The project root this panel looks at: the space's own folder, falling back
// to the focused terminal's cwd only when the space has none.
function projectRoot() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  return { cwd: space?.folder || pane?.cwd || f?.cwd, on: space?.machine ?? null };
}

export default class Favorites extends View {
  open(f) {
    const hit = spaces().find((s) => same(s, f));
    if (hit) run("space.select", { id: hit.id });
    else run("space.new", { folder: f.folder, machine: f.machine ?? "" });
  }

  keep(folder, machine) {
    if (!folder) return;
    const list = read();
    if (list.some((f) => same(f, { folder, machine }))) { notify({ title: "已收藏过", body: folder, level: "info" }); return; }
    const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
    setShared(KEY, [...list, { name, folder, machine: machine ?? null }]);
    notify({ title: "已收藏", body: folder, level: "success" });
  }

  addCurrent() {
    const { cwd, on } = projectRoot();
    if (!cwd) { notify({ title: "当前没有可收藏的目录", level: "warning" }); return; }
    this.keep(cwd, on);
  }

  async browse() {
    const folder = await pickFolder({ prompt: "收藏哪个文件夹？" });
    if (folder) { this.keep(folder, null); this.open({ folder, machine: null }); }
  }

  drop(f, cx) {
    setShared(KEY, read().filter((x) => !same(x, f)));
    cx.notify();
  }

  row(f, i, t, short) {
    const hit = spaces().find((s) => same(s, f));
    return h_flex().id(`fav-${i}`).h(42).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .on_click(() => this.open(f))
      .child(div().size(22).flex_none().flex().items_center().justify_center().rounded(5).bg(t.raised)
        .child(svg("mods/hs-files/folder.svg").size(13).flex_none().text_color(t.muted)))
      .child(div().flex().flex_col().flex_1().min_w(0).gap(1)
        .child(div().w_full().truncate().text_size(12.5).text_color(t.foreground).child(f.name))
        .child(div().w_full().truncate().text_size(10.5).text_color(t.dim).child(`${f.machine ?? "本机"} · ${short(f.folder)}`)))
      .when(Boolean(hit), el => el.child(div().flex_none().px(4).py(1).rounded(3).bg(t.raised).text_size(9.5).text_color(t.ansi2).child("已打开")))
      .child(div().id(`fav-x-${i}`).size(18).flex_none().flex().items_center().justify_center().rounded(4).text_size(11).text_color(t.dim)
        .hover(s => s.text_color(t.ansi1))
        .on_click((_e, cx) => { cx.stop_propagation(); this.drop(f, cx); })
        .child("✕"));
  }

  render() {
    const t = theme(), h = home();
    const short = (p) => (p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p ?? "");
    const list = [...read()].sort((a, b) => String(a.folder).localeCompare(String(b.folder)));
    const rows = list.map((f, i) => this.row(f, i, t, short));
    return v_flex().id("favorites").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Favorites"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${list.length}`))
        .child(div().flex_1())
        .child(h_flex().id("fav-add").h(24).px(8).flex_none().gap(4).items_center().rounded(6).cursor_pointer().text_size(11.5).text_color(t.muted)
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.addCurrent())
          .child(svg("mods/hs-spaces/star.svg").size(11).flex_none())
          .child(div().child("收藏当前目录"))))
      .child(v_flex().id("fav-list").flex_1().min_h(0).p(6).gap(2).overflow_y_scroll().children(rows)
        .when(!rows.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child("还没有收藏"))))
      .child(h_flex().id("fav-browse").h(30).flex_none().mx(6).mb(6).px(8).gap(7).items_center().rounded(7).cursor_pointer().text_size(12).hover(s => s.bg(t.hover))
        .on_click(() => this.browse())
        .child(svg("mods/workspace-chrome/plus.svg").size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).text_color(t.muted).child("浏览文件夹收藏…")));
  }
}