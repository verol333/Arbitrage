# Relais Bet9ja — mise à jour de l'espace Hugging Face

Le relais `verol333-alve-relay.hf.space` sert de sortie réseau pour les fonctions
de l'application (dont la sortie Cloudflare est refusée par Akamai). Il ne
connaissait pas Bet9ja : il répondait « domaine refuse ».

## Ce qu'il faut faire (une fois)

1. Ouvrir https://huggingface.co/spaces/verol333/alve-relay/tree/main
2. Cliquer sur le fichier **app.py**, puis **Edit**.
3. Remplacer tout le contenu par le fichier `relay/app.py` de ce dépôt.
4. **Commit changes to main**.
5. Attendre ~30 s que l'espace redémarre (onglet **App** : il repasse en Running).

Les deux seules lignes qui changent par rapport à l'ancien fichier :

- le motif de domaines autorisés reçoit `bet9ja` :
  `...|lnbpari|lnb|bet9ja)\.[a-z.]+$`
- l'en-tête Bet9ja (`origin: https://sports.bet9ja.com`, `referer:`) est ajouté
  automatiquement aux appels `bet9ja.com`, sinon Akamai renvoie 403.

## Contrôle après mise à jour

```
curl -s -X POST https://verol333-alve-relay.hf.space/gradio_api/call/relay \
  -H 'content-type: application/json' \
  --data '{"data":["{\"url\":\"https://sports.bet9ja.com/desktop/feapi/PalimpsestAjax/GetSports?DISP=0&v_cache_version=1.331.0.251\",\"method\":\"GET\"}"]}'
```

Réponse attendue : un `event_id`. On lit ensuite le flux
`/gradio_api/call/relay/<event_id>` (en-tête `accept: text/event-stream`) : le
corps doit contenir `\"status\": 200` et `\"body\": \"{\\\"R\\\":\\\"OK\\\"...``.

## À savoir

Le service d'arbitrage de ce dépôt (GitHub Actions / Render) n'a PAS besoin du
relais : ses runners atteignent Bet9ja en direct (vérifié le 2026-11-13). Le
relais ne concerne que l'application Base44, dont la sortie Cloudflare est
bloquée par Akamai.
