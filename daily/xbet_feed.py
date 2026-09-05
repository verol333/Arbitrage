# -*- coding: utf-8 -*-
"""
Lecture du flux 1xBet (flux public LineFeed) pour les matchs de FOOTBALL du jour.

Objectif : récupérer TOUS les matchs du jour, sans exception, avec TOUS
leurs marchés (principaux, mi-temps, totaux par équipe, corners, tirs
cadrés, fautes, hors-jeu, touches, dégagements, cartons jaunes).

Accès direct (les runners GitHub sont acceptés par 1xbet.cg / megapari).
Plusieurs hôtes miroirs partagent exactement les mêmes identifiants de
match et de compétition : en cas d'échec sur l'un, on bascule sur l'autre.
"""
import math
import random
import re
import time
from datetime import datetime, timezone

import requests

HOSTS = [
    ("https://1xbet.cg", "/service-api"),
    ("https://megapari.africa", "/service-api"),
    ("https://c7121luoxkyiox.com", ""),
]
COUNTRY = 93
PARTNER = 192
HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "fr-FR,fr;q=0.9",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
}

_session = requests.Session()


class FeedError(Exception):
    pass


def get(path, attempts=5):
    """GET avec bascule d'hôte et pauses croissantes (406/429 = trop vite)."""
    last = None
    for i in range(attempts):
        host, prefix = HOSTS[i % len(HOSTS)]
        try:
            r = _session.get(host + prefix + path, headers=HEADERS, timeout=25)
            if r.status_code == 200:
                d = r.json()
                if isinstance(d, dict) and d.get("Success", True) is not False:
                    return d
                last = "Success=false"
            else:
                last = "HTTP %s" % r.status_code
        except Exception as e:  # réseau / JSON
            last = str(e)[:100]
        time.sleep(0.7 + 0.8 * i + random.random() * 0.5)
    raise FeedError("%s -> %s" % (path[:70], last))


# ── Filtres : seuls les vrais matchs (pas de paris spéciaux / virtuels) ──
EXCLUDE = [
    "paris spéciaux", "paris speciaux", "special", "spécia", "virtual", "virtuel",
    "esport", "cyber", "simulation", "statistic", "outright", "vainqueur du",
    "futsal", "beach", "indoor", "alternatif", "alternative",
]
FAKE_SIDES = [
    "domicile", "extérieur", "exterieur", "home team", "away team", "oui", "non",
    "pair", "impair", "équipe 1", "equipe 1", "équipe 2", "equipe 2", "n'importe", "aucun",
]
POPULAR = [
    (re.compile(r"uefa|ligue des champions|champions league|europa league|conference", re.I), 100),
    (re.compile(r"premier league|la ?liga|serie a\b|bundesliga|ligue 1|eredivisie|primeira liga|süper lig|super lig", re.I), 95),
    (re.compile(r"coupe du monde|world cup|copa (libertadores|america)|\bcan\b|\bcaf\b|euro\b|nations league|ligue des nations", re.I), 85),
    (re.compile(r"championship|coupe de france|copa del rey|coppa italia|dfb|fa cup|carabao|jupiler|pro league|premiership", re.I), 75),
    (re.compile(r"ligue 2|serie b|liga 2|2\. bundesliga|segunda|mls|brasileir|liga mx|saudi", re.I), 55),
]


def _low(s):
    return str(s or "").lower()


def excluded(text):
    s = _low(text)
    return any(x in s for x in EXCLUDE)


def real_team(name):
    n = str(name or "").strip()
    if len(n) < 3 or not re.search(r"[a-zA-ZÀ-ÿ]{3}", n):
        return False
    if re.search(r"[+%]|\btotal\b|\bstat", n, re.I) or "/" in n:
        return False
    l = n.lower()
    return not any(k in l for k in FAKE_SIDES)


def popularity(league):
    for rx, score in POPULAR:
        if rx.search(str(league or "")):
            return score
    return 10


# ── Toutes les compétitions de football ayant des matchs ─────────────────
def list_champs():
    d = get("/LineFeed/GetChampsZip?sport=1&lng=fr&country=%d&partner=%d" % (COUNTRY, PARTNER))
    out = {}

    def add(c):
        cid = c.get("LI") or c.get("CI")
        name = str(c.get("L") or "").strip()
        games = int(c.get("GC") or 0)
        if cid and games > 0 and not excluded(name):
            out[int(cid)] = {"id": int(cid), "name": name, "games": games, "popularity": popularity(name)}
        for sub in c.get("SC") or []:  # sous-compétitions éventuelles
            add(sub)

    for c in d.get("Value") or []:
        add(c)
    return sorted(out.values(), key=lambda c: -c["popularity"])


# ── Matchs d'un lot de compétitions pour un jour (YYYY-MM-DD, UTC) ──────
def day_matches(champ_ids, day, meta):
    ids = ",".join(str(i) for i in champ_ids)
    d = get("/LineFeed/Get1x2_VZip?sports=1&champs=%s&count=300&lng=fr&mode=2&country=%d&partner=%d&getEmpty=true"
            % (ids, COUNTRY, PARTNER))
    now = time.time()
    out = []
    for m in d.get("Value") or []:
        if not (m.get("I") and m.get("S") and m.get("O1") and m.get("O2")):
            continue
        ts = int(m["S"])
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        if dt.strftime("%Y-%m-%d") != day or ts <= now:
            continue
        if excluded(m["O1"]) or excluded(m["O2"]) or excluded(m.get("L")):
            continue
        if not real_team(m["O1"]) or not real_team(m["O2"]):
            continue
        li = int(m.get("LI") or 0)
        league = str(m.get("L") or (meta.get(li) or {}).get("name") or "").strip()
        out.append({
            "match_id": int(m["I"]),
            "champ_id": li,
            "team_home": str(m["O1"]).strip(),
            "team_away": str(m["O2"]).strip(),
            "team_home_id": int(m.get("O1I") or 0),
            "team_away_id": int(m.get("O2I") or 0),
            "league": league,
            "country": str(m.get("CN") or "").strip(),
            "kickoff_ts": ts,
            "kickoff_iso": dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "popularity": popularity(league),
            "day_date": day,
        })
    return out


# ── Décodage des marchés d'un jeu (match principal, mi-temps, statistique) ─
STAT_FAMILIES = [
    (re.compile(r"^corners?$", re.I), "CORNERS"),
    (re.compile(r"^tirs cadr[ée]s$", re.I), "SHOTS_ON"),
    (re.compile(r"^tirs vers le but$", re.I), "SHOTS"),
    (re.compile(r"^fautes$", re.I), "FOULS"),
    (re.compile(r"^d[ée]gagements de but$", re.I), "GOALKICKS"),
    (re.compile(r"^hors-jeu$", re.I), "OFFSIDES"),
    (re.compile(r"^touches$", re.I), "THROWINS"),
    (re.compile(r"^cartons jaunes$", re.I), "YELLOW"),
]


def half_number(pn):
    s = _low(pn)
    if not s:
        return None
    if re.search(r"1|premi|1ère|1ere", s) and "mi-temps" in s:
        return 1
    if re.search(r"2|deuxi|2ème|2eme|seconde", s) and "mi-temps" in s:
        return 2
    return None


def fmt_line(p):
    try:
        v = float(p)
    except Exception:
        return ""
    s = ("%.2f" % v).rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def decode(groups, game_id, prefix, total_pre, main, odds, meta):
    for g in groups or []:
        G = g.get("G")
        for sub in g.get("E") or []:
            for it in (sub if isinstance(sub, list) else [sub]):
                try:
                    c = float(it.get("C"))
                except Exception:
                    continue
                if not c > 1:
                    continue
                t = int(it.get("T") or 0)
                p = it.get("P")
                ps = fmt_line(p) if p is not None else ""
                key = None
                if G == 1:
                    key = {1: "WIN_HOME", 2: "WIN_DRAW", 3: "WIN_AWAY"}.get(t)
                elif G == 8:
                    key = {4: "DC_1X", 5: "DC_12", 6: "DC_X2"}.get(t)
                elif G == 17 and p is not None:
                    key = {9: total_pre + "OVER_" + ps, 10: total_pre + "UNDER_" + ps}.get(t)
                elif G == 2 and p is not None:
                    key = {7: "AH_HOME_" + ps, 8: "AH_AWAY_" + ps}.get(t)
                elif G == 19:
                    key = {180: "BTTS_YES", 181: "BTTS_NO"}.get(t)
                elif main and G == 15 and p is not None:
                    key = {11: "TT_HOME_OVER_" + ps, 12: "TT_HOME_UNDER_" + ps}.get(t)
                elif main and G == 62 and p is not None:
                    key = {13: "TT_AWAY_OVER_" + ps, 14: "TT_AWAY_UNDER_" + ps}.get(t)
                if not key:
                    continue
                k = prefix + key
                odds[k] = round(c, 3)
                meta[k] = {"t": t, "p": float(p) if p is not None else 0, "g": game_id}


def game_path(gid, sub_games):
    return ("/LineFeed/GetGameZip?id=%d&lng=fr&isSubGames=%s&GroupEvents=true&countevents=600&grMode=4"
            "&country=%d&partner=%d&marketType=1&isNewBuilder=true"
            % (gid, "true" if sub_games else "false", COUNTRY, PARTNER))


def full_markets(match_id, max_subgames=12):
    """Tous les marchés d'un match : principal + mi-temps + statistiques."""
    d = get(game_path(match_id, True))
    V = d.get("Value") or {}
    odds, meta = {}, {}
    decode(V.get("GE"), match_id, "", "OU_", True, odds, meta)

    subs = []
    for s in V.get("SG") or []:
        sid = s.get("I")
        if not sid:
            continue
        tg = str(s.get("TG") or "").strip()
        pn = str(s.get("PN") or "").strip()
        half = half_number(pn)
        if not tg and half:
            subs.append((int(sid), "H%d_" % half, ""))
            continue
        if tg and not pn:
            fam = next((f for rx, f in STAT_FAMILIES if rx.match(tg)), None)
            if fam:
                subs.append((int(sid), "ST_%s_" % fam, ""))
    for sid, prefix, total_pre in subs[:max_subgames]:
        try:
            sd = get(game_path(sid, False), attempts=3)
        except FeedError:
            continue
        decode((sd.get("Value") or {}).get("GE"), sid, prefix, total_pre, False, odds, meta)
    return odds, meta
