# Cartographie des patterns de coverage combinatoire

Objectif : lister toutes les combinaisons de sélections qui **couvrent 100 % des scores possibles d'un match de foot**. Chaque pattern indique :
- **Marchés requis** (clés normalisées comme dans le dump JSON étape 1)
- **Sélections** (par outcome)
- **Preuve de coverage** (démonstration exhaustive sur la grille `(home_goals, away_goals)`)
- **Books nécessaires** — un pattern peut se jouer sur 1, 2, 3 ou 4 books différents ; l'intérêt du multi-book c'est de prendre la MEILLEURE cote de chaque book pour chaque outcome.

Notation :
- `h` = buts home, `a` = buts away
- `h+a` = total buts, `h-a` = écart (home dominant si > 0)
- Un pattern est un arbitrage si `Σ (1/cote_i) < 1`

---

## Famille A — patterns basiques (marchés simples, on les exploite déjà en prod)

### A1 — 1X2 tri-way
- **Marchés** : `match_1`, `match_X`, `match_2`
- **Coverage** : `{h>a}` ∪ `{h=a}` ∪ `{h<a}` = **tous les scores** ✅
- **Books** : 3 (un par sélection) — plus il y a de books plus on trouve les meilleures cotes

### A2 — Over/Under ligne X.5 (complémentaires)
- **Marchés** : `match_over_X.5` + `match_under_X.5` (même ligne)
- **Coverage** : `{h+a > X.5}` ∪ `{h+a < X.5}` = **tous les scores** ✅
- **Books** : 2 (un pour Over, un pour Under)
- Décliner sur toutes les lignes : 0.5, 1.5, 2.5, 3.5, 4.5, 5.5

### A3 — BTTS 2-way
- **Marchés** : `btts_yes` + `btts_no`
- **Coverage** : `{h≥1 ∧ a≥1}` ∪ `{h=0 ∨ a=0}` = **tous** ✅
- **Books** : 2

### A4 — Double Chance complémentaire
- **DC 1X + match_2** : `{h≥a}` ∪ `{h<a}` = tous ✅
- **DC X2 + match_1** : `{h≤a}` ∪ `{h>a}` = tous ✅
- **DC 12 + match_X** : `{h≠a}` ∪ `{h=a}` = tous ✅
- **Books** : 2

### A5 — DNB + Draw
- **Marchés** : `dnb_1` (rembourse si nul) + `dnb_2` + `match_X`
- Cas nul : dnb_1 et dnb_2 remboursent tous les 2, match_X gagne → profit dépend du montant misé
- Attention : DNB ce n'est pas un "vrai" outcome (mise remboursée) — traitement spécial

---

## Famille B — Score exact (marchés que NOUS N'EXPLOITONS PAS)

### B1 — 3 scores + Over 1.5 (le pattern classique du user)
- **Marchés** : `score_0_0`, `score_1_0`, `score_0_1`, `match_over_1.5`
- **Coverage** : {0-0} ∪ {1-0} ∪ {0-1} ∪ {h+a ≥ 2} = **tous** ✅
- **Books** : 1 à 4 (on prend la meilleure cote sur chaque)

### B2 — 5 scores + Over 2.5
- **Marchés** : `score_0_0`, `score_1_0`, `score_0_1`, `score_1_1`, `score_2_0`, `score_0_2`, `match_over_2.5`
- **Coverage** : tous les scores avec h+a ≤ 2 (soit 6 cellules : 0-0, 1-0, 0-1, 1-1, 2-0, 0-2) ∪ {h+a ≥ 3} = **tous** ✅
- **Books** : 1 à 4

### B3 — Score home + Score away + Score nul + Over N.5
- **Marchés** : `score_1_0`, `score_0_1`, `score_1_1`, `match_over_1.5` (couvre le reste avec 2+ buts sauf 1-1 déjà pris)
- **Coverage** : {1-0} ∪ {0-1} ∪ {1-1} ∪ {h+a ≥ 2} — manque {0-0} → **NE COUVRE PAS** ❌
- **Correctif** : ajouter `match_under_0.5` (= score 0-0)

### B4 — Score 1-0 + Score 0-1 + Under 0.5 + Over 1.5
- **Marchés** : `score_1_0`, `score_0_1`, `match_under_0.5`, `match_over_1.5`
- **Coverage** : {1-0} ∪ {0-1} ∪ {0-0} ∪ {h+a≥2} = **tous** ✅
- **Books** : 1 à 4 — équivalent à B1

### B5 — Tous les scores exacts + "Autre score"
- **Marchés** : les 26 cellules Correct Score classiques (0-0 à 5-4 + reverse) + `score_other_home_win` / `score_other_away_win` / `score_other_draw`
- **Coverage** : par construction = tous ✅
- **Books** : le book fournit tous ces marchés dans un même "Correct Score" — se joue idéalement sur 1 seul book (mais on peut mixer les meilleures cotes cross-book)

---

## Famille C — Winning Margin (Marge du vainqueur)

### C1 — Winning Margin tri-way complet
- **Marchés** : `wm_home_1`, `wm_home_2`, `wm_home_3+`, `wm_draw_0`, `wm_draw_1`, `wm_draw_2+`, `wm_away_1`, `wm_away_2`, `wm_away_3+`
- **Coverage** : par construction = tous ✅ (chaque score tombe dans exactement une case)
- **Books** : 1 à 9 (idéalement mix cross-book)
- Note : sur betpawa on a vu `Home by 1`, `Home by 2`, `Home by 3+`, etc. — 6 à 9 sélections selon le book

### C2 — Winning Margin partiel + Complément
- **Marchés** : `wm_home_1`, `wm_home_2`, `wm_home_3+`, `match_X`, `match_2`
- **Coverage** : {h-a=1} ∪ {h-a=2} ∪ {h-a≥3} ∪ {h=a} ∪ {a>h} = **tous** ✅
- **Books** : 2 (Winning Margin + 1X2)

### C3 — Home by N + Away by N + Draw exact scores
- **Marchés** : Home by 1 / 2 / 3+, Away by 1 / 2 / 3+, `score_0_0`, `score_1_1`, `score_2_2`, `score_3_3+`
- **Coverage** : tous les écarts non-nuls + toutes les cases nul → **tous** ✅
- **Books** : 1 à N

---

## Famille D — HT/FT (Mi-temps / Fin de match)

### D1 — HT/FT complet (9 selections)
- **Marchés** : `htft_1_1`, `htft_1_X`, `htft_1_2`, `htft_X_1`, `htft_X_X`, `htft_X_2`, `htft_2_1`, `htft_2_X`, `htft_2_2`
- **Coverage** : chaque match tombe dans exactement 1 case (état mi-temps × état final) → **tous** ✅
- **Books** : 1 à 9
- Note : nécessite que le score MT soit défini, ce qui est toujours le cas

### D2 — HT/FT partiel + 1X2 FT
- Ex : `htft_1_1`, `htft_1_X`, `htft_1_2` (couvre : home wins MT) + `match_X` + `match_2` (couvre : nul MT et away MT)
- Attention : chevauchement possible entre `htft_X_2` et `match_2` — non problématique pour arb mais à vérifier
- **Coverage** : à valider case par case

---

## Famille E — Multigoals / Nombre exact de buts

### E1 — Nombre exact partition
- **Marchés** : `exact_goals_0`, `exact_goals_1`, `exact_goals_2`, `exact_goals_3`, `exact_goals_4`, `exact_goals_5+`
- **Coverage** : {h+a=0} ∪ {h+a=1} ∪ ... ∪ {h+a≥5} = **tous** ✅
- **Books** : 1 à 6

### E2 — Multigoals ranges (SportyBet, Congobet, Apollo)
- **Marchés** : `multigoals_0` (=0-0) + `multigoals_1_2` + `multigoals_3_5` + `multigoals_6+`
- **Coverage** : partition du total buts → **tous** ✅
- **Books** : 1 à 4
- Attention : les ranges varient selon les books (1-2, 1-3, 1-4, 2-3, 4-6...) — vérifier compatibilité

### E3 — Multigoals 1-2 + 3+ + 0
- **Marchés** : `multigoals_0`, `multigoals_1_2`, `multigoals_3+`
- **Coverage** : {h+a=0} ∪ {h+a=1 ∨ 2} ∪ {h+a≥3} = **tous** ✅
- **Books** : 1 à 3

---

## Famille F — Marchés combinés (les plus rentables potentiellement)

### F1 — 1X2 & Over/Under (SportyBet, Apollo)
- **Marchés** : `match_1_over_2.5`, `match_1_under_2.5`, `match_X_over_2.5`, `match_X_under_2.5`, `match_2_over_2.5`, `match_2_under_2.5`
- **Coverage** : partition (1X2 × O/U) → **tous** ✅
- **6 cellules** possibles au total
- **Books** : 1 à 6

### F2 — DC & Total (SportyBet)
- **Marchés** : `dc_1X_over_1.5`, `dc_1X_under_1.5`, `dc_X2_over_1.5`, `dc_X2_under_1.5`, `dc_12_over_1.5`, `dc_12_under_1.5`
- Attention : DC overlappent (X compté par 1X et X2) — chevauchement mais coverage OK
- **Books** : 1 à 6

### F3 — HT/FT & Total (SportyBet)
- 48 combinaisons possibles — très granulaire, potentiellement très rentable
- Coverage : chaque match tombe dans une case unique (HT × FT × O/U line)

---

## Famille G — Handicap Asian (les "middle arbs")

### G1 — Handicap +0.5 complémentaire
- **Marchés** : `hcp_home_+0.5` + `hcp_away_-0.5`
- Coverage : Home +0.5 gagne si `{h≥a}`, Away -0.5 gagne si `{a>h}` → **tous** ✅
- **Books** : 2

### G2 — Handicap Middle (rare mais très rentable)
- **Marchés** : `hcp_home_-0.5` (book A) + `hcp_home_+1.5` (book B)
- **Coverage** : `{h>a}` ∪ `{h+1.5 > a}` = home wins par ≥1 OR home ne perd pas par 2+ → **manque : home perd par 2+**
- ❌ ne couvre pas tout — donc pas un arb classique. Mais si home wins par exactement 1, LES DEUX gagnent → bonus profit
- Structure "middle arb" : chevauchement sur cas frontière = bonus

### G3 — Handicap Européen complet (Handicap 0:1 tri-way)
- **Marchés** : `heur_0_1_1`, `heur_0_1_X`, `heur_0_1_2`
- Coverage : après application du handicap européen (donne 1 but à away), les 3 issues 1X2 couvrent tout → **tous** ✅
- **Books** : 1 à 3

---

## Famille H — Team Totals

### H1 — Home Team Total O/U 1.5 combiné avec Away Team Total O/U 1.5
- 4 cellules : (home ≤ 1, away ≤ 1) ∪ (home ≤ 1, away ≥ 2) ∪ (home ≥ 2, away ≤ 1) ∪ (home ≥ 2, away ≥ 2)
- **Coverage** : partition du (h, a) par seuil 1.5 → **tous** ✅
- **Books** : 1 à 4

---

## Famille I — Patterns exotiques mixtes

### I1 — Score 0-0 + BTTS Yes + Under 1.5
- **Coverage** : {0-0} ∪ {h≥1 ∧ a≥1} ∪ {h+a≤1} = {0-0} ∪ {(1,1), (1,2), (2,1), (2,2)...} ∪ {(0,0), (1,0), (0,1)} = **tous** sauf {(≥2,0), (0,≥2)}
- ❌ ne couvre pas — manque cleansheets 2-0, 3-0, 0-2, 0-3, etc.

### I2 — Score 0-0 + BTTS Yes + `hcp_home_-1.5` + `hcp_away_-1.5`
- Complexe à valider — nécessite check case par case
- Potentiel intéressant si Hcp -1.5 sur les 2 côtés cross-book

### I3 — Clean Sheet home Yes + Clean Sheet away Yes + BTTS Yes
- Clean Sheet home Yes = {a=0}
- Clean Sheet away Yes = {h=0}
- BTTS Yes = {h≥1 ∧ a≥1}
- **Coverage** : {a=0} ∪ {h=0} ∪ {h≥1 ∧ a≥1} — un score comme 0-0 est dans les 2 premiers (chevauchement OK), les scores avec buts des 2 côtés dans le 3ème
- Ne manque rien → **tous** ✅
- **Books** : 1 à 3 (idéalement les 3 outcomes chez 3 books différents)

---

## Résumé des patterns par nombre de sélections

| # sel | Pattern examples | Nb combinaisons |
|---|---|---|
| **2** | A2 (O/U), A3 (BTTS), A4 (DC+match), G1 (Hcp +0.5) | ~20 combinaisons |
| **3** | A1 (1X2), C2 (WM partiel), I3 (CS+BTTS), G3 (Hcp Eur) | ~30 combinaisons |
| **4** | B1 (3 scores + Over 1.5), E3 (Multigoals) | ~40 combinaisons |
| **5-9** | B2, C1 (WM complet), D1 (HT/FT), E1 (exact goals) | ~50 combinaisons |

## Ce qu'on va faire à l'étape 3

Charger le JSON de l'étape 1, et pour CHAQUE pattern ci-dessus :
1. Vérifier que les marchés requis sont présents chez au moins 1 book
2. Pour chaque sélection, prendre la meilleure cote cross-book
3. Calculer `Σ (1/cote)` 
4. Émettre l'opp si `< 1` (arbitrage) avec profit `1 - Σ`
5. Trier par profit descendant

Note : chaque book couvre différents patterns :
- **1xbet** : très riche en marchés simples (Over/Under multi-lignes, DC, Team Totals)
- **1win** : idem 1xbet, un peu moins de granularité
- **congobet** : LE plus riche en exotiques (score exact, HT/FT, Winning Margin, Team wins-both-halves, wins-to-nil)
- **betpawa** : le plus faible en exotique, mais quelques marchés uniques

**En attente de ton feu vert pour l'étape 3.**
