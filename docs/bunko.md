# bunko — ポッドキャストまとめページのURL管理

## ドメイン

まとめページの正規ドメインは **`bunko.yuukipodcast.com`** です
(旧: `bunko.animesenseijp.com`)。

DNS側の設定(コード外の作業):

1. `yuukipodcast.com` のDNSに、サブドメイン `bunko` のレコード(CNAMEまたはA)を追加し、このアプリのホスティング先へ向ける
2. ホスティングサービス側でカスタムドメイン `bunko.yuukipodcast.com` を登録し、SSL証明書を発行する
3. 旧ドメイン `bunko.animesenseijp.com` は、移行期間中はこのアプリへ向けたままにしておくと、下記のリダイレクトで新URLへ転送される

※ 旧ページがNotion系サービス(Wraptas / Super.so 等)で配信されている場合は、そのサービスの管理画面でカスタムドメインを `bunko.yuukipodcast.com` に変更する必要があります。

## URLルール

```
https://bunko.yuukipodcast.com/<番組名の英単語スラッグ>/ep<エピソード番号>
```

例: `https://bunko.yuukipodcast.com/sebaschan/ep1`

- 番組名スラッグは英小文字の単語(必要ならハイフン区切り)
- エピソード番号は `ep` + 数字

## エピソードの追加方法

`bunko.py` の `EPISODES` に登録します:

```python
EPISODES = {
    ("sebaschan", 1): {
        "title": "第1回 タイトル",
        "show_name": "番組の表示名",
        "summary_html": "<p>まとめ本文…</p>",
    },
}
```

## 旧URLからのリダイレクト

旧ハッシュ形式URL(例: `/be6f59d7c068/`)は、`bunko.py` の
`LEGACY_REDIRECTS` に対応表を登録すると新URLへ301リダイレクトされます:

```python
LEGACY_REDIRECTS = {
    "be6f59d7c068": ("sebaschan", 1),
}
```

`be6f59d7c068` がどの番組・エピソードに対応するかは未確定のため、
確定後に登録してください。
