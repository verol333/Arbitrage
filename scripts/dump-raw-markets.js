#!/usr/bin/env node
// Ce point d'entree est conserve pour le workflow "Dump Raw Markets" deja
// existant : il lance desormais le recensement football (scripts/foot-market-census.js),
// qui remplace l'ancien dump manuel multi-sports.
import './foot-market-census.js';
