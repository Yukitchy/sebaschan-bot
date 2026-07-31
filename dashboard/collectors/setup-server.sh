#!/bin/bash
# 常時起動サーバー（例: yuki-srv.local）に収集ロボをデプロイする一発スクリプト。
# ノートPCのlaunchdは蓋を閉じて寝ていると6:30に発火しない → 常時起動機で回すのが正解。
#
# 前提: このリポジトリがサーバー上に clone 済みで、ヘッドレスなので storageState.json と .env は
#       ノートPC側で作成済みのものを scp で持ち込む（サーバーでブラウザ手ログインはできないため）。
# 冪等: 何度流しても安全。
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
echo "==================================================="
echo " 収集ロボ サーバーセットアップ"
echo " path : $HERE"
echo " user : $(whoami)   home: $HOME"
echo "==================================================="

# 1) node を確定（launchdはPATHが最小なので絶対パスで押さえる）
NODE_BIN=""
for c in "$HOME/node/bin/node" "/opt/homebrew/bin/node" "/usr/local/bin/node" "$(command -v node 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then NODE_BIN="$c"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  echo "❌ node が見つかりません。先に node を入れてください（例: ~/node/bin/node）。"
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"
echo "✓ node: $NODE_BIN"

# 2) 依存インストール
echo "--- npm install ---"
"$NODE_DIR/npm" install || { echo "❌ npm install 失敗"; exit 1; }
echo "--- playwright chromium install ---"
"$NODE_DIR/npx" playwright install chromium || echo "⚠️ chromium install 失敗（ネット/権限を確認。後で再実行可）"

# 3) 必須ファイル（ヘッドレスなのでノートPCから持ち込む）
MISS=0
if [ ! -f "$HERE/.env" ]; then
  echo "⚠️ .env が無い（SHEET_ENDPOINT / SHEET_SECRET）"; MISS=1
fi
if [ ! -f "$HERE/storageState.json" ]; then
  echo "⚠️ storageState.json が無い（保存済みログイン）"; MISS=1
fi

# 4) launchd plist を「今のユーザー・今のパス」で生成（固定パスのズレを排除）
LA_DIR="$HOME/Library/LaunchAgents"
PLIST="$LA_DIR/com.yuki.taisaku-collector.plist"
mkdir -p "$LA_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.yuki.taisaku-collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/tmp/taisaku-collector.out</string>
  <key>StandardErrorPath</key><string>/tmp/taisaku-collector.err</string>
</dict>
</plist>
EOF
echo "✓ plist 生成: $PLIST （毎朝6:30 / run.sh=$HERE/run.sh）"

# 5) 登録し直し（ssh越しの launchctl load は環境で失敗しうるが、その場合もGUIログイン時に自動ロードされる）
launchctl unload "$PLIST" 2>/dev/null
if launchctl load "$PLIST" 2>/dev/null; then
  echo "✅ launchd 登録OK"
else
  echo "⚠️ launchctl load が効かず。GUI自動ログインが有効なら次回ログイン/再起動で自動ロードされます。"
fi

echo ""
if [ "$MISS" = "1" ]; then
  echo "▲ .env / storageState.json が未配置のため、収集テストはスキップします。"
  echo "  ノートPCで下記を実行して持ち込み → もう一度このスクリプトを流してください:"
  echo "  scp ~/sebaschan-bot/dashboard/collectors/.env ~/sebaschan-bot/dashboard/collectors/storageState.json $(whoami)@$(hostname -s).local:$HERE/"
  exit 0
fi

echo "=== 動作確認：今すぐ1回収集します（⚙️設定確認 と 反映結果 に注目）==="
"$NODE_BIN" "$HERE/scrape.mjs"
