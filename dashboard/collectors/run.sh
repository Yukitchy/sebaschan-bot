#!/bin/bash
# launchd から呼ばれるラッパー。収集ロボのディレクトリで scrape を回す。
cd "$(dirname "$0")" || exit 1
# launchd はPATHが最小なので node の場所を自前で通す。
#   $HOME/node/bin … サーバー(yuki-srv)のnode / homebrew … ノートPC / /usr/local/bin の古いnode(v14)は避ける。
export PATH="$HOME/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# node を絶対パスで確定（PATHでも見つからない環境向けの保険）。
NODE_BIN="$(command -v node || echo node)"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect start (node=$NODE_BIN) =====" >> collector.log
"$NODE_BIN" scrape.mjs >> collector.log 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect end =====" >> collector.log
