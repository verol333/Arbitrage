# Handoff — Système d'arbitrage combinatoire Alex Verol

**Contexte à donner à la nouvelle IA au démarrage.**  
Tu peux copier ce texte tel quel dans le premier message à l'IA suivante.

---

## 🎯 Objectif du projet

Détecter des arbitrages sportifs **combinatoires** (couverture 100% des issues possibles) cross-bookmakers sur du football, sur les 10 books africains d'Alex Verol : `1xbet`, `1win`, `congobet`, `betpawa`, `apollo`, `sportybet`, `yellowbet`, `casongo`, `betmomo`, `premierbet`, `sportcash`, `maxibet`.

Repo : https://github.com/verol333/Arbitrage (branche `main`).

## 🏗️ Architecture actuelle (état au 2026-08-22)

### Le seul solveur qui marche = **Dictionary Solver**

**Fichiers clés** (tous dans le repo) :

| Fichier | Rôle |
|---|---|
| `src/dictionary/families.js` | Catalogue des ~25 familles de marchés foot avec formule mathématique exacte (MATCH_1X2, DOUBLE_CHANCE, BTTS, OVER_UNDER, CORRECT_SCORE, WINNING_MARGIN, HANDICAP_ASIAN, HANDICAP_1X2, CLEAN_SHEET_HOME, WIN_TO_NIL_HOME, RESULT_AND_BTTS, DC_AND_TOTAL, etc.) |
| `src/dictionary/resolvers.js` | Mapping par book : chaque nom de marché brut → famille + formule. **AUCUN regex heuristique** — que du mapping explicite par book. Contient les resolvers pour `1xbet`, `1win`, `congobet`, `betpawa`. |
| `scripts/dictionary-solver.js` | Le solveur : fetch les cotes, classifie via dictionnaire, cherche coverage sets disjoints, calcule les mises, affiche les arbs. |
| `.github/workflows/dictionary-solver.yml` | Le workflow GitHub Actions pour lancer un scan manuel. |

### Solveurs à ignorer (obsolètes / faux positifs)

- `scripts/combinatorial-solver.js` — l'ancien avec des regex heuristiques. Génère des faux positifs. **NE PAS L'UTILISER.**
- `scripts/pattern-scanner.js` — approche par patterns pré-définis. Limitée.
- `scripts/dump-4books-full.js` — juste un dump JSON, pas un solveur.

### Fichiers utilitaires

| Fichier | Rôle |
|---|---|
| `scripts/dump-single-match.js` | Dump lisible d'UN match : toutes les cotes de tous les marchés sur les 4 books, en markdown. Utile pour vérifier manuellement. |
| `scripts/market-inventory.js` | Inventaire brut des marchés par book (sans interprétation). |
| `scripts/triage-markets.js` | Trie les marchés en 3 catégories : KEEP (utile foot-score) / REJECT (joueurs/corners/cartes/HT) / UNKNOWN (à valider). |
| `docs/coverage-patterns.md` | Cartographie théorique des combinaisons qui couvrent 100% des issues. |
| `docs/market-inventory.md` | Liste brute de tous les marchés par book. |
| `docs/market-triage.md` | Résultat du triage KEEP/REJECT/UNKNOWN. |
| `docs/single-match-dump.md` | Dernier dump d'un match complet pour analyse. |

## 🧮 Comment le solveur fonctionne

1. **Fetch** : récupère les catalogues et les cotes de chaque book (parseurs prod dans `src/bookmakers/`).
2. **Aligne** : matche les mêmes matchs cross-book via `alignCatalogs()`.
3. **Classifie** : pour chaque outcome brut, appelle `resolveOutcome({book, market, selection, homeTeam, awayTeam})` qui retourne `{family, selection, pred, refund?}` ou `null`.
4. **Encode** : convertit chaque prédicat en bitmask sur une grille 15×15 = 225 cellules (scores h,a possibles).
5. **Dedup** : garde le meilleur odds par `(book, family, selection)`.
6. **Cherche coverage sets** : énumère les combos de 2 à 4 items dont l'union des masks = ALL_CELLS_MASK ET disjoints (aucun chevauchement de cellules).
7. **Calcule mises** : `stake_i = bankroll * (1/o_i) / Σ(1/o_j)`. Chaque pick rapporte le même montant si il gagne.
8. **Sort par profit desc** et affiche les opps + les mises.

Grille : 15×15 = scores 0..14 pour home et away. Pas d'overflow (aucun match ne finit avec 15+ buts pour une équipe).

## 🚀 Comment lancer un scan

**Via GitHub Actions** :
```
Repo → Actions → "Solveur Dictionnaire (sans regex, mapping explicite)" → Run workflow → main
```

Variables d'env dans le workflow YAML :
- `SOLVER_TOP_MATCHES` : combien de matchs à scanner (default 100)
- `SOLVER_MIN_PROFIT` : profit minimum (default 0.005 = 0.5%)
- `SOLVER_BANKROLL` : bankroll pour calcul des mises (default 100000 XOF)
- `SOLVER_BOOKS` : books à utiliser (default `1xbet,congobet,betpawa,1win`)
- `SOLVER_EXCLUDE_TOP_LEAGUES` : exclure les ligues majeures (Premier League, Bundesliga, etc.) car les grands matchs sont bien alignés cross-book donc pas d'arbs. Default `1` (exclu).

Résultat = artifact `dictionary-scan` (JSON avec les opps) et logs GitHub.

## ✅ Résultats validés (2026-08-22)

Le solveur a trouvé des **vraies opportunités** sur `Luzern vs Lausanne-Sport` (Super League Suisse) :

- **10.42%** — 3 sélections : `betpawa DC "X2" @3.00` + `congobet H eur "1 (0:1)" @3.20` + `congobet H eur "X (0:1)" @4.00`  
  Alex Verol a vérifié : **couvre 100% des issues, arbitrage réel confirmé chez les books.**
- **7.40%** — 2 sélections : `betpawa Asian Handicap [-1.5] "2" @1.63` + `congobet H eur "1 (0:1)" @3.20`
- Plusieurs autres opps sur ce même match.

## 🐛 Bugs qui ont été corrigés (à ne pas ré-introduire)

Chaque bug corrigé est documenté dans les commits git récents (`git log --oneline scripts/dictionary-solver.js src/dictionary/`) :

1. **Handicap 1xbet et 1win** : la ligne est **PORTÉE par la sélection** (pas convention betpawa où la ligne est au home). Ex : `"Home (-2.5)"` chez 1xbet = home avec -2.5, pas la même chose que betpawa `"Asian Handicap [-2.5] Home"`.
2. **Handicap Européen congobet** : format `"1 (0:1)"` = handicap 0:1 (H:A séparés par `:`), PAS `"1 (+1)"`. Deux nombres, pas un.
3. **1win Handicap** : format `"Bayern Munchen -1.25"` (nom équipe + ligne), PAS `"W1 (-1.25)"`. Ma resolver doit accepter les 2 formats.
4. **Clean Sheet ≠ Win to Nil** : `"Clean Sheet Home Yes"` = away n'a pas marqué (`a=0`), PAS home wins to nil (`h>0 AND a=0`). Erreur classique qui donne des faux positifs 30-80%.
5. **Marchés combinés "X gagne ou Y"** chez congobet : SKIP TOTAL — ne PAS les classifier comme simple Clean Sheet à cause du `endsWith("n'encaisse pas de but")`.
6. **Marchés mi-temps chez congobet** : préfixés `"1ère mi-temps - X n'encaisse pas..."`. SKIP TOTAL AVANT le handler Clean Sheet à cause du même bug `endsWith`.
7. **Filtre disjoint OBLIGATOIRE** : deux picks ne doivent JAMAIS avoir de cellule mask commune, sinon la formule `1-sumInv` ne représente pas le vrai profit garanti.
8. **Quart-lines rejetées** : lignes 0.25, 0.75, 1.25, etc. → SKIP (demi-gains non représentables en bitmask binaire).

## 📋 Prochaines étapes attendues

1. **Ajouter les resolvers pour d'autres books** : `apollo` (Velisports), `sportybet` (UOF), `yellowbet` (BetConstruct), `casongo` (Velisports), `betmomo` (SWARM), `premierbet` (Guinée-tech). Chaque resolver = ~40 lignes de mapping. Voir `src/dictionary/resolvers.js` pour la structure.

2. **Compléter le mapping 1xbet** : actuellement seulement 11 marchés mappés sur 226 (à cause des noms bruts `G10032`, `G10033` non résolus). Il faut enrichir `XBET_GROUP_MAP` dans `scripts/dictionary-solver.js` (et dans les extracteurs `src/bookmakers/xbet/`).

3. **Système de re-fetch avant placement** : entre la détection et le placement manuel (30-60 sec), les cotes bougent. Ajouter une étape "revérifier les cotes juste avant" pour confirmer que l'arb tient toujours.

4. **Élargir le dictionnaire de familles** : ajouter les marchés HT/FT (nécessite passer d'une grille (h,a) à (h_ht, a_ht, h_ft, a_ft)) et Race to N Goals.

5. **Automatiser le placement** : côté backend Base44, générer des coupons pré-remplis avec les mises calculées pour placement rapide.

## 📞 Message à donner à l'IA suivante

> Salut, je continue un travail sur un système d'arbitrage combinatoire sportif pour Alex Verol (10 bookmakers africains).
>
> Le solveur qui marche est `scripts/dictionary-solver.js` avec `src/dictionary/families.js` (formules) et `src/dictionary/resolvers.js` (mapping par book). Il a été validé : trouve des arbs réels de 3-10%+ sur des matchs de ligues secondaires.
>
> **NE PAS UTILISER** `scripts/combinatorial-solver.js` (ancien, buggé, faux positifs).
>
> Lis `docs/HANDOFF-IA.md` en priorité. Il contient :
> - L'architecture des fichiers
> - Le fonctionnement du solveur
> - Les 8 bugs déjà corrigés (à ne pas ré-introduire)
> - Les prochaines étapes attendues
>
> Repo : https://github.com/verol333/Arbitrage (branche `main`).
>
> Pour lancer un scan : GitHub Actions → workflow "Solveur Dictionnaire" → Run workflow. Résultats dans les logs + artifact JSON.
>
> Prochaine étape prioritaire : ajouter les resolvers pour `apollo`, `sportybet`, `yellowbet` dans `src/dictionary/resolvers.js`. Chaque book = ~40 lignes de mapping en s'inspirant de la structure de `resolveCongobet` ou `resolveBetpawa`.

---

**Fichier généré le 2026-08-22 par Claude Opus 4.7 pour Alex Verol.**
