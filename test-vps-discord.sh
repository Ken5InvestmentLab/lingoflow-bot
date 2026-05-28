#!/usr/bin/env bash
# =============================================================
# STEP 1: VPS（168.110.60.126）のIPが Cloudflare 1015 に汚染されて
# いないかを確認するためのスクリプト。
#
# 使い方:
#   1. VPSにSSH/PuTTYでログイン
#   2. このファイルをVPSに転送、または貼り付けて保存
#   3. WEBHOOK_URL を本番Discord Webhook URLに書き換え
#   4. chmod +x test-vps-discord.sh && ./test-vps-discord.sh
#
# 期待結果:
#   - 全リクエストが "HTTP 204" を返す → クリーン。STEP 2 へ進む
#   - "HTTP 429" + 本文に "error code: 1015" → VPSのIPも汚染。別案検討
# =============================================================

WEBHOOK_URL="https://discord.com/api/webhooks/XXXXXXXXXX/YYYYYYYYYY"

if [[ "$WEBHOOK_URL" == *"XXXXXXXXXX"* ]]; then
  echo "WEBHOOK_URL を本番URLに書き換えてから実行してください。"
  exit 1
fi

echo "=== 送信元IP確認 ==="
curl -s https://api.ipify.org
echo

echo
echo "=== Test 1: 単発テキストPOST ==="
curl -i -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"VPS IP健全性チェック (test1)"}'
echo

echo
echo "=== Test 2: embeds形式POST ==="
curl -i -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"embeds":[{"title":"VPSテストEmbed1","color":3447003},{"title":"VPSテストEmbed2","color":3447003}]}'
echo

echo
echo "=== Test 3: 連投耐性（5回 / 2秒間隔）==="
for i in 1 2 3 4 5; do
  CODE=$(curl -s -o /tmp/.discord_test_body -w "%{http_code}" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"content\":\"連投テスト $i\"}")
  echo "Request $i: HTTP $CODE"
  if [[ "$CODE" == "429" ]]; then
    echo "  body: $(cat /tmp/.discord_test_body)"
  fi
  sleep 2
done

echo
echo "=== 結果の見方 ==="
echo "全て 204 → クリーン。STEP 2 (relay実装) に進んで OK"
echo "429 + 'error code: 1015' → VPSのIPも汚染。プラン7章の代替案へ"
