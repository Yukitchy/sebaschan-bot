#!/bin/bash
# launchd から呼ばれるラッパー。収集ロボのディレクトリで scrape を回す。
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"  # homebrew優先（/usr/local/bin のnodeは古いv14でPlaywrightが動かない）
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect start =====" >> collector.log
node scrape.mjs >> collector.log 2>&1
echo "===== $(date '+%Y-%m-%d %H:%M:%S') collect end =====" >> collector.log
