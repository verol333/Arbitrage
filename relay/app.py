import re, json, httpx, spaces, gradio as gr

# Domaines autorisés (le relais ne sort QUE vers ces hôtes).
# bet9ja ajouté le 2026-11-13 : sports.bet9ja.com (lecture) et
# apigw.bet9ja.com (réservation du coupon).
OK = re.compile(r"(^|\.)(1xbet|1x-bet|megapari|melbet|betwinner|paripesa|ipify|aio-sworl|yellowbet|lnbpari|lnb|bet9ja)\.[a-z.]+$", re.I)

# Bet9ja répond 403 sans l'origine/le referer du site sportif : le relais les
# ajoute lui-même, l'appelant n'a donc rien à envoyer de particulier.
B9_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "fr-FR,fr;q=0.9",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    "origin": "https://sports.bet9ja.com",
    "referer": "https://sports.bet9ja.com/",
}

@spaces.GPU
def _gpu_placeholder():
    return 0

def relay(payload: str) -> str:
    j = json.loads(payload)
    u = httpx.URL(j["url"])
    if not OK.search(u.host or ""):
        return json.dumps({"error": "domaine refuse"})
    headers = dict(j.get("headers") or {})
    if (u.host or "").endswith("bet9ja.com"):
        headers = {**B9_HEADERS, **headers}
        if j.get("method", "GET") == "POST":
            headers["content-type"] = "application/x-www-form-urlencoded"
    try:
        with httpx.Client(timeout=25, follow_redirects=False) as c:
            r = c.request(j.get("method", "GET"), j["url"], headers=headers, content=j.get("body"))
        return json.dumps({"status": r.status_code, "headers": dict(r.headers), "cookies": r.headers.get_list("set-cookie"), "body": r.text})
    except Exception as e:
        return json.dumps({"error": str(e)})

demo = gr.Interface(fn=relay, inputs="text", outputs="text", api_name="relay")
demo.launch()
