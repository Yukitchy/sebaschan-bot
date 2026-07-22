"""ポッドキャストまとめページ「bunko」のURL管理・配信モジュール。

正規ドメイン: bunko.yuukipodcast.com
URLルール: /<番組名の英単語スラッグ>/ep<エピソード番号>
例: https://bunko.yuukipodcast.com/sebaschan/ep1

旧ドメイン(bunko.animesenseijp.com)時代のハッシュ形式URL
(例: /be6f59d7c068/)は LEGACY_REDIRECTS に登録すると
新URLへ301リダイレクトされる。
"""
from flask import Blueprint, abort, redirect, render_template

BUNKO_DOMAIN = "bunko.yuukipodcast.com"
BUNKO_BASE_URL = f"https://{BUNKO_DOMAIN}"

bunko = Blueprint("bunko", __name__)

# エピソード登録簿: (番組スラッグ, ep番号) -> ページ情報
EPISODES: dict[tuple[str, int], dict] = {
    # 登録例:
    # ("sebaschan", 1): {
    #     "title": "第1回 タイトル",
    #     "show_name": "番組の表示名",
    #     "summary_html": "<p>まとめ本文…</p>",
    # },
}

# 旧URLのハッシュ -> (番組スラッグ, ep番号)
# TODO: be6f59d7c068 が指す番組スラッグとep番号が確定したら登録する
LEGACY_REDIRECTS: dict[str, tuple[str, int]] = {
    # "be6f59d7c068": ("sebaschan", 1),
}


def episode_url(show_slug: str, ep_number: int) -> str:
    """エピソードページの正規URLを返す"""
    return f"{BUNKO_BASE_URL}/{show_slug}/ep{ep_number}"


@bunko.route("/<show_slug>/ep<int:ep_number>")
def episode_page(show_slug: str, ep_number: int):
    """エピソードまとめページを表示する"""
    episode = EPISODES.get((show_slug, ep_number))
    if episode is None:
        abort(404)
    return render_template(
        "bunko_episode.html",
        episode=episode,
        show_slug=show_slug,
        ep_number=ep_number,
        canonical_url=episode_url(show_slug, ep_number),
    )


@bunko.route("/<legacy_id>/")
def legacy_redirect(legacy_id: str):
    """旧ハッシュ形式URLから新URLへ301リダイレクトする"""
    target = LEGACY_REDIRECTS.get(legacy_id)
    if target is None:
        abort(404)
    return redirect(episode_url(*target), code=301)
