# holon-slackbot

このリポジトリは、Google Apps Script (以下、GAS) 上で動作し、Slackからのイベントを受信してOpenAI APIへ問い合わせる一連のスクリプト群です。主に以下の構成要素で成り立ちます。

---
## 構成ファイル概要
1. **main.gs (doPost 処理)** 
   - Slackのイベント (Event API) を受け取り、メッセージや添付ファイルの有無に応じて処理を分岐します。 
   - AIへの問い合わせ、Bot自身の投稿かどうかの判別、およびレスポンスの投稿を行います。
2. **utility.gs** 
   - イベントを処理するうえで必要な補助関数群です。 
   - 例： 
     - isCachedId(id) : 同じメッセージIDを短時間内に何度も処理しないためのチェック (重複排除)。 
     - shouldRespond(triggerMsg) : Botが応答すべき状況かを判定 (DMかメンションか、スレッドかどうかなど)。 
     - fetchMsgsInThread(channel, thread_ts) : スレッドに含まれるメッセージを取得。 
     - fetchAIAnswerText(triggerMsg) : SlackでのやりとりをChatGPT向けメッセージに整形してOpenAIに問い合わせ、レスポンスを取得。 
     - 各種Slack POST用関数 (slackPostMessage, addReaction, removeReactionなど)。
3. **universalMessage.gs / functionMessage.gs** 
   - このスクリプト全体で使うシステムメッセージや固定的なユーザ文脈を定義する想定のファイル。 
4. **appscript.json** 
   - GAS プロジェクトの設定ファイル。 
   - ライブラリ依存 (SlackApp, SlackApi) が記載されています。 
   - Webアプリとしてデプロイする際の設定 (timeZone, runtimeVersion, webappアクセスなど) もここに含まれます。
---

## Slack側の設定
### 1. Slack App Manifest (例)

```json
{
  "display_information": {
    "name": "holon2",
    "description": "holon2",
    "background_color": "#000000"
  },
  "features": {
    "bot_user": {
      "display_name": "holon 2",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "channels:history",
        "channels:join",
        "channels:manage",
        "channels:read",
        "chat:write",
        "commands",
        "emoji:read",
        "files:read",
        "files:write",
        "groups:history",
        "groups:read",
        "groups:write",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "mpim:write",
        "reactions:read",
        "reactions:write",
        "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://script.google.com/macros/s/...",
      "bot_events": [
        "app_mention",
        "channel_created",
        "emoji_changed",
        "message.channels",
        "message.groups",
        "message.im"
      ]
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

- Slack管理画面 (Your Apps > holon2 > Settings > App Manifest) にて上記のような構成で作成。 
- request_url にはGASデプロイURLを設定します (デプロイ後に入手可能)。
### 2. Event Subscriptions
- botがListenするイベントを指定します。 
- 上記Manifestでは: 
  - message.channels, message.groups, message.im などのメッセージイベント 
  - app_mention (botがメンションされたとき) 
- Event Subscription エンドポイントとしてGASのWebアプリURLを指定し、`url_verification`イベン トにも対応できるようにします (doPost(e)で type === "url_verification" をハンドリング)。
---

## Google Apps Script (GAS) 側の設定
### 1. プロジェクトのファイル構成
- doPost() を含むメインスクリプト (例: main.gs) 
- utility.gs : 補助関数 (イベント判定・キャッシュ処理・Slack API操作・OpenAI API呼び出し等) 
- system.message.gs / CGCMessage.gs : 定型メッセージ的な文脈 
- appscript.json : ライブラリ・webapp設定
### 2. Script Properties (スクリプトプロパティ)
- **必須項目例** 
  - APP_ID : (任意で使う場合) Slack App ID 
  - BOT_DM_CHANNEL_ID : Bot user一対一DMチャンネルID 
  - BOT_USER_ID : Bot自身のユーザID (U...) 
  - MAX_TOKENS : OpenAI APIへ投げるときの max_completion_tokens 
  - MODEL : OpenAIのモデル指定 (例: o1) 
  - OPENAI_KEY : OpenAI APIキー 
  - REACTION_NAME : Botが処理中につけるリアクション (例:conga_parrot) 
  - SLACK_TOKEN : Slack Bot User OAuth トークン
### 3. デプロイ手順
1. **コードエディタ** で必要ファイルを作成し、スクリプトプロパティを上記の通り設定。 
2. メニューから **[Deploy] > [New deployment]** を開き、**Web app** としてデプロイ。 
   - Execute as: USER_DEPLOYING 
   - Who has access: Anyone (Slackからイベントを受け取るため、Publicにする場合あり) 
3. デプロイURLをコピーして、Slackの Event Subscriptions の Request URL に設定。

---
## 実行フロー
1. Slack発: ユーザーがチャンネルやDMでメッセージ送信 
2. イベント受信: doPost(e) にて reqObj.event を確認 
3. Bot判定: Bot自身のメッセージ、または既に処理済みの重複メッセージはスルー 
4. メタ判定: DMや <@bot> メンションなど、応答すべき状況か判定 (shouldRespond)
08:18
5. AI問い合わせ: 必要であれば fetchAIAnswerText() を呼び出し、OpenAIへ投げる 
6. レスポンス: Slackに返信 (slackPostMessage) 
7. エラー時: sendErrorLogToSlack() でエラーをSlackの特定チャンネルに報告可能 

---
## 注意事項
- イベント発火が同一メッセージで複数回飛んでくる場合があるため、`msgId` (client_msg_id) をキャッシュして重複排除 (isCachedId) を行っています。 
- Botがスレッド内で応答すべきかどうかの判断には、 
  - Botがすでにそのスレッドに参加しているか 
  - もしくは新規にメンションされているか 
  という仕組みを使います。 
- 画像ファイルやFile共有イベントは本例では対応していません (imagehandler.gs は省かれているため)。
---
## 参考
- [参考にした記事](https://qiita.com/noritsune/items/17c20dccb0eb00f2622e)
- [Slack API Official Docs](https://api.slack.com/) 
- [OpenAI API](https://platform.openai.com/docs/introduction) 
