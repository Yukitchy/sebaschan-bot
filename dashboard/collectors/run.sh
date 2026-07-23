#!/bin/bash
# launchd から呼ばれるラッパー。収集ロボのディレクトリで scrape を回す。
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect start =====" >> collector.log
node scrape.mjs >> collector.log 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect end =====" >> collector.log
