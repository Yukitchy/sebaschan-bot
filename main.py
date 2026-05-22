import os
from flask import Flask, request, abort
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    Configuration,
    ApiClient,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
    QuickReply,
    QuickReplyItem,
    MessageAction,
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent
import google.generativeai as genai

app = Flask(__name__)

LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
LINE_CHANNEL_ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

line_config = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)

genai.configure(api_key=GEMINI_API_KEY)

# ユーザーごとの会話履歴を保持（メモリ内。本番はDBを推奨）
conversation_history: dict[str, list] = {}

SEBASCHAN_SYSTEM_PROMPT = """あなたは「せばすちゃん」という名前のAI執事です。
ユーザーが「やりたいこと」や「アイデア」を投げかけてきたとき、
親身になって壁打ち相手になり、実現可能な方法や具体的なステップを提案してください。

## キャラクター設定
- 口調は丁寧で温かみがあるが、どこかユーモラスで親しみやすい執事
- 「〜でございます」「かしこまりました」などの執事らしい言い回しを時々使う
- ユーザーのことを「ご主人様」と呼ぶ
- アイデアに対して否定から入らず、まず「おもしろいですね！」と受け止める

## 壁打ちのやり方
1. ユーザーのアイデアや「やりたいこと」を受け止め、共感する
2. そのアイデアを実現するための具体的な方法・ステップを2〜3個提案する
3. 「もう少し詳しく教えていただけますか？」と深掘りの質問をする
4. ユーザーが詰まっていたら、別角度のアプローチも提示する

## 実装開始モード
ユーザーから「__IMPLEMENT__」というメッセージが来た場合、
直前の提案内容をもとに、以下の形式で具体的な実装計画を出力してください：

【実装計画書】
📋 プロジェクト名：〇〇
🎯 目的：〇〇

【ステップ1】〇〇
- 具体的なアクション
- 必要なツール・リソース
- 目安期間

【ステップ2】〇〇
...

最後に「かしこまりました！いつでもご主人様のご指示をお待ちしております🫡」で締める。

## 注意事項
- 長すぎる回答は避け、LINEで読みやすい長さ（300文字前後）に収める（実装計画書は除く）
- 箇条書きを上手く使い、見やすくする
- 絵文字は控えめに（1〜2個程度）
"""

# 提案が含まれているかどうかを判定するキーワード
PROPOSAL_KEYWORDS = ["提案", "方法", "ステップ", "手順", "やり方", "アプローチ", "①", "②", "1.", "2."]


def has_proposal(text: str) -> bool:
    """返答に提案・手順が含まれているか判定する"""
    return any(keyword in text for keyword in PROPOSAL_KEYWORDS)


def get_gemini_response(user_id: str, user_message: str) -> str:
    """Gemini APIを呼び出してせばすちゃんの返答を生成する"""
    if user_id not in conversation_history:
        conversation_history[user_id] = []

    conversation_history[user_id].append({
        "role": "user",
        "parts": [user_message]
    })
    if len(conversation_history[user_id]) > 20:
        conversation_history[user_id] = conversation_history[user_id][-20:]

    model = genai.GenerativeModel(
        model_name="gemini-2.0-flash",
        system_instruction=SEBASCHAN_SYSTEM_PROMPT,
    )
    chat = model.start_chat(history=conversation_history[user_id][:-1])
    response = chat.send_message(user_message)
    assistant_message = response.text

    conversation_history[user_id].append({
        "role": "model",
        "parts": [assistant_message]
    })

    return assistant_message


@app.route("/callback", methods=["POST"])
def callback():
    """LINEからのWebhookを受け取るエンドポイント"""
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)

    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)

    return "OK"


@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event: MessageEvent):
    """テキストメッセージを受け取って返答する"""
    user_id = event.source.user_id
    user_message = event.message.text

    # 実装開始ボタンが押された場合は専用メッセージに変換
    if user_message == "🚀 この提案で実装を開始する！":
        user_message = "__IMPLEMENT__"

    reply_text = get_gemini_response(user_id, user_message)

    # 提案が含まれている場合はクイックリプライボタンを追加
    quick_reply = None
    if has_proposal(reply_text) and user_message != "__IMPLEMENT__":
        quick_reply = QuickReply(
            items=[
                QuickReplyItem(
                    action=MessageAction(
                        label="🚀 この提案で実装を開始する！",
                        text="🚀 この提案で実装を開始する！"
                    )
                )
            ]
        )

    with ApiClient(line_config) as api_client:
        line_bot_api = MessagingApi(api_client)
        line_bot_api.reply_message_with_http_info(
            ReplyMessageRequest(
                reply_token=event.reply_token,
                messages=[TextMessage(text=reply_text, quick_reply=quick_reply)],
            )
        )


@app.route("/health", methods=["GET"])
def health():
    return {"status": "ok", "bot": "せばすちゃん"}, 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
