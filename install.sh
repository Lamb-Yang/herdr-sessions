#!/usr/bin/env bash
# Herdr Sessions — install this layout into the person's Herdr home.
# Copies layouts/sessions.json and mods/hs-* in, checks each mod, shows it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
LAYOUT="sessions"
MODS=(hs-tabs hs-spaces hs-files hs-changes hs-sessions hs-favorites)
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
die() { printf '\n错误 / error: %s\n' "$*" >&2; exit 1; }

say "Herdr Sessions  安装到 / installing into: $APP_HOME"

command -v herdr-app >/dev/null 2>&1 || die "找不到 herdr-app 命令。先安装 Herdr（https://herdr.dev），再重跑本脚本。
  herdr-app not found. Install Herdr first, then run this again."

[ -d "$APP_HOME" ] || die "$APP_HOME 不存在，Herdr 还没运行过。先打开一次 Herdr。
  $APP_HOME does not exist. Open Herdr once, then run this again."

current="$(herdr-app status 2>/dev/null | sed -n 's/.*"layout": *"\([^"]*\)".*/\1/p' | head -1 || true)"

# Back up anything this package would replace, so uninstall and rollback are safe.
mkdir -p "$APP_HOME/layouts"
backup() { # backup <path>
  [ -e "$1" ] || return 0
  mv "$1" "$1.backup-$STAMP"
  say "  已备份 / backed up: $(basename "$1") -> $(basename "$1").backup-$STAMP"
}

# Leave the layout before its files change: a shown layout keeps its old code.
if [ "$current" = "$LAYOUT" ]; then
  say "  当前正在使用本布局，先切到 main / switching away first"
  herdr-app do layout.switch --name main >/dev/null 2>&1 || true
fi

backup "$APP_HOME/layouts/$LAYOUT.json"
for m in "${MODS[@]}"; do backup "$APP_HOME/mods/$m"; done

cp "$HERE/layouts/$LAYOUT.json" "$APP_HOME/layouts/"
mkdir -p "$APP_HOME/mods"
for m in "${MODS[@]}"; do
  cp -R "$HERE/mods/$m" "$APP_HOME/mods/"
  rm -f "$APP_HOME/mods/$m/mod.json.backup-$STAMP"
  say "  已安装 / installed: mods/$m"
done

say ""
say "检查每个 mod / checking each mod"
fail=0
for m in "${MODS[@]}"; do
  if out="$(herdr-app check "$APP_HOME/mods/$m" 2>&1)"; then
    say "  ok   $m"
  else
    say "  FAIL $m: $out"
    fail=1
  fi
done
[ "$fail" = 0 ] || die "有 mod 没通过检查，布局未切换。/ some mod failed its check; layout not switched."

# Report the programs the panels call, so nothing silently does nothing.
say ""
say "可选程序 / programs the panels use (missing ones only disable their own feature):"
for bin in python3 sqlite3 git pi claude; do
  if command -v "$bin" >/dev/null 2>&1; then
    say "  ok      $bin"
  else
    case "$bin" in
      pi) say "  缺少    pi     — Sessions 的标题、点击恢复会话不可用 / session titles and resume";;
      sqlite3) say "  缺少    sqlite3 — opencode 会话不会列出 / opencode sessions stay hidden";;
      claude) say "  缺少    claude  — Claude Code 会话不能恢复 / cannot resume cc sessions";;
      python3) say "  缺少    python3 — Sessions 列表出不来 / the Sessions list stays empty";;
      *) say "  缺少    $bin";;
    esac
  fi
done

say ""
if herdr-app do layout.switch --name "$LAYOUT" >/dev/null 2>&1; then
  say "完成：已切换到「Herdr Sessions」/ switched to Herdr Sessions."
else
  say "文件已安装。Herdr 窗口没在运行，打开后执行 / files are in place; open Herdr then run:"
  say "  herdr-app do layout.switch --name $LAYOUT"
fi
say ""
say "右侧面板默认收起，点顶栏右侧的 Files / Changes / Sessions / Favorites 打开。"
say "The right panel starts collapsed: click Files / Changes / Sessions / Favorites in the top bar."
say "切回你自己的布局 / back to your own layout:  herdr-app do layout.switch --name main"