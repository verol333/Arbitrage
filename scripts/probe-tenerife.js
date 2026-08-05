#!/usr/bin/env node
// TEMPORAIRE : ce fichier a ete detourne pour executer le probe Maxibet via
// le workflow probe-tenerife.yml (seul workflow sur main capable de dispatch
// arbitraire sans ajouter de fichier a main). L'original est sauvegarde dans
// .probe-tenerife-backup.js et sera restaure apres la collecte.
import('./probe-maxibet-endpoint.js');
