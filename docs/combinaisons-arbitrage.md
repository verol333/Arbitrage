# Combinaisons d'arbitrage a partir des marches inexploites

Source : docs/foot-market-census.md (15 matchs, 1xbet / congobet / betpawa / 1win)
et docs/marches-inexploites-1xbet.md (inventaire 1xBet).

Regle de base : une opportunite existe seulement si l'ensemble des jambes
couvre TOUTES les issues possibles une fois et une seule (partition fermee).
Chaque combinaison ci-dessous est decrite dans l'espace des scores par
mi-temps (grille 625 deja en place dans le solveur).

---

## 1. Marque a chaque mi-temps (BOTH_HALVES_SCORE) x Total buts
Books : betpawa 15/15, 1win 15/15 — total buts deja lu partout.

"Les deux equipes marquent dans chaque mi-temps" impose au moins 4 buts.
Donc : jambe A = BOTH_HALVES_SCORE Oui (book 1), jambe B = Under 3.5 (book 2).
Partition fermee : tout score a moins de 4 buts tombe dans Under 3.5, tout
score compatible avec A a 4 buts ou plus. Aucun recouvrement, aucune fuite.
Variante plus fine : A = "equipe X marque dans les deux mi-temps",
B = "X ne marque pas" (CLEAN_SHEET adverse) + total equipe Under 1.5.

## 2. Clean sheet x BTTS  (le plus liquide)
Books : CLEAN_SHEET betpawa 15, 1win 15, congobet 4.

"X n'encaisse pas de but" = l'adversaire ne marque pas = BTTS Non partiel.
Partition : A = CLEAN_SHEET domicile Oui, B = CLEAN_SHEET exterieur Oui,
C = BTTS Oui. Les trois issues sont exclusives et couvrent tout SAUF le 0-0,
qui appartient aux deux clean sheets — le solveur doit donc traiter le 0-0
comme intersection et non comme trou. Version propre a 2 jambes :
A = CLEAN_SHEET domicile Oui (book 1) / B = "l'exterieur marque" (book 2).

## 3. HTFT (mi-temps/fin de match) x Double chance
Books : congobet 15, betpawa 15, 1win 14 — le plus large des inexploites.

HTFT a 9 issues (1/1, 1/X, 1/2, X/1, ...). Trois d'entre elles forment
exactement "domicile gagne a la pause" : 1/1 + 1/X + 1/2. Donc :
A = HTFT {1/1, 1/X, 1/2} chez un book, B = Double chance X2 mi-temps 1
chez un autre. Partition fermee sur le resultat de la 1ere mi-temps.
Meme montage avec 2/x contre 1X mi-temps 1.

## 4. Ecart de victoire (WIN_MARGIN) x Handicap
Books : congobet 15, betpawa 14.

"Domicile gagne par 2 buts ou plus" = handicap -1.5 domicile. C'est la meme
issue sous deux libelles differents chez deux books, donc l'ecart de
calibration est direct : A = WIN_MARGIN domicile 2+ (book 1),
B = handicap +1.5 exterieur (book 2). Partition parfaite a 2 jambes.

## 5. Resultat + Total combine (RESULT_TOTAL) x 1X2
Books : congobet 15, betpawa 15.

RESULT_TOTAL = "domicile gagne ET plus de 2.5". Se decompose :
A = RESULT_TOTAL domicile+Over 2.5 (book 1),
B = RESULT_TOTAL domicile+Under 2.5 (book 1 ou 2),
C = Double chance X2 (book 3). Trois jambes, partition fermee sur 1X2 x total.
Le meme raisonnement s'applique a DC_TOTAL (congobet 15, betpawa 15).

## 6. Multigoals (intervalles) x Total
Books : betpawa 14, congobet 4, 1win 3.

Multigoals decoupe le total en tranches (0-1, 2-3, 4-6, 7+). Ces tranches
sont deja une partition fermee a elles seules : il suffit de prendre chaque
tranche chez le book qui la surcote. Marche le plus mecanique a integrer.

## 7. Score exact (CS) et score par mi-temps
Books : betpawa 15, congobet 4.

Le score exact est la partition la plus fine possible : 625 cases de la
grille, une par case. Toute famille ci-dessus peut donc etre bouchee par un
paquet de scores exacts pris chez un autre book. C'est le filet de secours
universel, mais il demande beaucoup de jambes — a garder pour les marges
elevees.

## 8. Statistiques joueurs (1xBet, 78 familles / 3 544 selections)
Chaque marche joueur est binaire (marque / ne marque pas, tire cadre / non).
1xBet est aujourd'hui le seul a les coter en volume : pas de partition
inter-books possible sans un second book sur le meme joueur. Piste reelle :
partition INTRA-1xBet entre "buteur X" et "score exact" / "total equipe",
ou attendre l'ouverture de ces marches chez betpawa (2/15 constate).

---

## Ordre d'attaque recommande
1. Multigoals (partition native, 3 books)
2. Ecart de victoire x Handicap (equivalence directe, 2 books x 15 matchs)
3. HTFT x Double chance mi-temps (le plus large, 3 books)
4. Clean sheet x BTTS (attention au 0-0)
5. Marque a chaque mi-temps x Total
6. RESULT_TOTAL / DC_TOTAL x 1X2
7. Score exact (filet de secours)
8. Joueurs 1xBet (bloque tant qu'un 2eme book ne les cote pas)

## Prealable technique commun
Le recensement montre 1xBet a 0 sur toutes ces familles : ses libelles
arrivent en numerique (xbet-G136, 976 occurrences). Rattacher ces
identifiants aux noms de familles ci-dessus est le pont a construire pour
que 1xBet participe aux combinaisons 1 a 7.
