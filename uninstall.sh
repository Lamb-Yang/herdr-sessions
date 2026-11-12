#!/usr/bin/env bash
# Herdr Sessions — remove the layout and its mods again.
set -euo pipefail

APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
LAYOUT="sessions"
MODS=(hs-tabs hs-spaces hs-files hs-changes hs-sessions hs-favorites)

say() { printf '%s\n' "$*"; }
die() { printf '\n错误 / error: %s\n' "$*" >&2; exit 1; }

command -v herdr-app >/dev/null 2>&1 || die "找不到 herdr-app 命令。/ herdr-app not found."
[ -d "$APP_HOME" ] || die "$APP_HOME 不存在。/ $APP_HOME does not exist."

current="$(herdr-app status 2>/dev/null | sed -n 's/.*"layout": *"\([^"]*\)".*/\1/p' | head -1 || true)"
if [ "$current" = "$LAYOUT" ]; then
  say "先切回 main / switching back to main first"
  herdr-app do layout.switch --name main >/dev/null 2>&1 || true
fi

for m in "${MODS[@]}"; do
  if [ -d "$APP_HOME/mods/$m" ]; then
    rm -rf "$APP_HOME/mods/$m"
    say "  已删除 / removed: mods/$m"
  fi
done

if [ -f "$APP_HOME/layouts/$LAYOUT.json" ]; then
  rm -f "$APP_HOME/layouts/$LAYOUT.json"
  say "  已删除 / removed: layouts/$LAYOUT.json"
fi

# A backup from install.sh, if there was one, comes back.
shopt -s nullglob
for b in "$APP_HOME/layouts/$LAYOUT.json".backup-*; do
  mv "$b" "${b%.backup-*}"
  say "  已恢复备份 / restored backup: $(basename "${b%.backup-*}")"
done

say ""
say "完成。你收藏的目录和标签还留在 shared.json 里（键 hs.favorites、hs.sessions.tags），"
say "想一并清掉可以在 Herdr 里删，或忽略。 / Your saved folders and tags stay in shared.json"
say "under hs.favorites and hs.sessions.tags; delete or ignore them as you like."