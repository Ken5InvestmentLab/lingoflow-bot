# GAS（自動スクリーニング）への適用差分

GAS URL: https://script.google.com/u/5/home/projects/1zICR-fzMoQoS3McfR-Kb0DlIuqat5alnjEAfwuKcBy2JpkORA7-Em4a4/edit

VPS の `/relay/discord` 経由で Discord に送るための GAS 側の変更。
**lingoflow-bot が Discord サーバーに参加している必要はない**（HTTP転送するだけなので bot 認証は不要）。

---

## 1. グローバル設定の末尾に追加

GAS のグローバル設定ブロック（`const FINAL_DISCORD_MAX_RETRIES = 3;` の直後）に以下を追加:

```js
// --- VPS中継設定（Cloudflare 1015 回避用）---
const VPS_RELAY_URL = 'http://168.110.60.126:10000/relay/discord';
```

## 2. スクリプトプロパティに追加

GAS Editor で `プロジェクトの設定（歯車アイコン）→ スクリプト プロパティ → スクリプト プロパティを追加`:

| プロパティ | 値 |
|---|---|
| `VPS_RELAY_TOKEN` | VPSの `.env` の `RELAY_TOKEN` と完全に同じ値 |

## 3. 新ヘルパー関数を追加

既存の `sendSimpleDiscordMessage_` の直前あたりに、新しいヘルパー関数を追加:

```js
/**
 * VPS中継経由でDiscord webhookにPOSTする統一ヘルパー。
 * GAS（Google共用IP）から直接Discordを叩くとCloudflare 1015で弾かれるため、
 * VPS（専有IP）を経由させる。
 *
 * @param {string} webhookUrl - Discord webhook URL
 * @param {object} payload - Discord に送るJSONペイロード（{content} or {embeds}）
 * @returns {{ok:boolean, code:number, text:string, is1015:boolean}}
 */
function postToDiscordViaRelay_(webhookUrl, payload) {
  const token = getProp_('VPS_RELAY_TOKEN');
  if (!token) {
    return { ok: false, code: 0, text: 'VPS_RELAY_TOKEN not set', is1015: false };
  }
  try {
    const res = UrlFetchApp.fetch(VPS_RELAY_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ webhookUrl, payload }),
      muteHttpExceptions: true
    });
    const body = res.getContentText();
    try {
      return JSON.parse(body);
    } catch (e) {
      return { ok: false, code: res.getResponseCode(), text: body, is1015: false };
    }
  } catch (e) {
    return { ok: false, code: 0, text: String(e), is1015: false };
  }
}
```

## 4. `sendSimpleDiscordMessage_` を差し替え

既存の `sendSimpleDiscordMessage_` 関数を **まるごと** 以下に置き換える:

```js
function sendSimpleDiscordMessage_(url, message) {
  if (!url) {
    console.error('DiscordのWebhook URLが設定されていません。');
    return { ok: false, code: 0, text: 'missing url', is1015: false };
  }

  const MAX_LENGTH = 2000;

  try {
    for (let i = 0; i < message.length; i += MAX_LENGTH) {
      const chunk = message.substring(i, i + MAX_LENGTH);

      // VPS中継経由でDiscordに送信
      const relayResult = postToDiscordViaRelay_(url, { content: chunk });
      const code = relayResult.code;
      const text = relayResult.text || '';

      if (code === 200 || code === 204 || relayResult.ok) {
        Utilities.sleep(1000);
        continue;
      }

      const is1015 = relayResult.is1015 || /error code:\s*1015/i.test(text);

      console.error(`Discord完了通知エラー (via relay): code=${code}, body=${text}`);

      return { ok: false, code, text, is1015 };
    }

    return { ok: true, code: 204, text: '', is1015: false };

  } catch (e) {
    console.error('Discordへの通知送信中に例外が発生しました: ' + e.message);
    return { ok: false, code: 0, text: e.message, is1015: false };
  }
}
```

## 5. `postOverlapSummaryToDiscord_` 内の `sendEmbeds` を差し替え

`postOverlapSummaryToDiscord_` 関数の中にある `sendEmbeds = (embeds, url) => { ... }` の中身を以下に置き換える（外側のラッパー `sendEmbedsToAllWebhooks` 等はそのまま）:

```js
  // --- 送信処理をまとめたヘルパー関数（VPS中継版）---
  const sendEmbeds = (embeds, url) => {
    if (embeds.length === 0) {
      console.log(`[Debug] embedsが空のため送信スキップ`);
      return false;
    }
    if (!url) {
      console.error(`[Debug] URLが無効です。送信をスキップします。`);
      return false;
    }

    console.log(`[Debug] Embeds送信試行 (via relay): ${embeds.length} 件, URL末尾: ${url.slice(-20)}`);

    try {
      const relayResult = postToDiscordViaRelay_(url, { embeds: embeds });
      const responseCode = relayResult.code;
      const responseText = relayResult.text || '';

      console.log(`[Debug] Discord API レスポンスコード (via relay): ${responseCode}`);

      if (responseCode === 429) {
        console.error(`[Debug] Discord rate limited (via relay): ${responseText}`);

        let waitMs = DISCORD_RATE_LIMIT_WAIT_MS;

        if (relayResult.is1015) {
          // CloudflareのIP単位レートリミット。VPSのIPも汚染された可能性
          waitMs = DISCORD_1015_COOLDOWN_MS; // 1時間
          console.error(`[Debug] Cloudflare 1015 をVPS経由でも検出。${Math.ceil(waitMs / 60000)}分待機します。`);
        } else {
          try {
            const parsed = JSON.parse(responseText);
            if (parsed.retry_after) {
              waitMs = Math.ceil(Number(parsed.retry_after) * 1000) + 1000;
            }
          } catch (e) {}
          console.log(`[Debug] Discord本体の429。${Math.ceil(waitMs / 1000)} 秒待機します。`);
        }

        Utilities.sleep(waitMs);
        return false;
      }

      if (responseCode !== 200 && responseCode !== 204 && !relayResult.ok) {
        console.error(`[Debug] Discord API エラー (via relay): ${responseText}`);
        Utilities.sleep(DISCORD_SEND_INTERVAL_MS);
        return false;
      }

      console.log(`[Debug] Embed送信成功 (${embeds.length}件 via relay)`);
      Utilities.sleep(DISCORD_SEND_INTERVAL_MS);
      return true;

    } catch (e) {
      console.error(`[Debug] Embed一括送信中に例外発生 (via relay): ${e.message}`);
      Utilities.sleep(DISCORD_SEND_INTERVAL_MS);
      return false;
    }
  };
```

---

## 適用順序（推奨）

1. **STEP 1**: VPS で `test-vps-discord.sh` を実行 → 全部 204 を確認
2. VPS の `~/lingoflow-bot/index.js` を更新（`/relay/discord` 追加版）
3. VPS の `.env` に `RELAY_TOKEN=<長いランダム文字列>` を追加
4. VPS で `pm2 restart lingoflow-bot && pm2 logs lingoflow-bot --lines 30` でエラーがないか確認
5. VPS自身から疎通確認:
   ```bash
   curl -i -X POST "http://localhost:10000/relay/discord" \
     -H "Authorization: Bearer $(grep RELAY_TOKEN ~/lingoflow-bot/.env | cut -d= -f2)" \
     -H "Content-Type: application/json" \
     -d '{"webhookUrl":"<本番WebhookURL>","payload":{"content":"relay test"}}'
   ```
   → Discord にメッセージが届けばOK
6. GAS Editor 側で上記 1〜5 の変更を適用
7. GAS のスクリプトプロパティに `VPS_RELAY_TOKEN` を VPS の `.env` と同じ値で設定
8. GAS Editor で `sendIntegratedDiscordNotifications` を手動実行 → Discord着信を確認
9. 翌日の自動実行ログで 429/1015 が消えていることを確認
