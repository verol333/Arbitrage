// ═══════════════════════════════════════════════════════════════════════════
// 1xBet — DICTIONNAIRE DES MARCHES (API mobile v3)
//
// Source : endpoint mobile officiel de l'app Android 1xBet, qui renvoie
// eventGroups (marches principaux) + subGamesForMainGame (sous-marches NOMMES :
// Corners, Cartons jaunes, 1ere mi-temps...). Les libelles de groupe et
// d'issue viennent du dictionnaire releve sur l'app, jamais devines.
// ═══════════════════════════════════════════════════════════════════════════

const MOBILE_HOST = 'https://c7121luoxkyiox.com';

const MOBILE_HEADERS = {
  Accept: 'application/vnd.xenvelop+json',
  'Content-Type': 'application/json; charset=utf-8',
  'User-Agent': 'org.xbet.client1-user-agent/1xbet-prod-v257.0.74',
  Version: '1xbet-prod-v257.0.74',
  'X-BundleId': 'org.xbet.client1',
  'X-DeviceManufacturer': 'samsung',
  'X-DeviceModel': 'SM-A326B',
  'X-FCountry': '93',
  'X-Group': '1357',
  'X-Language': 'fr_FR',
  'X-Referral': '1',
  'X-Whence': '22',
};

export const XBET_GROUP_NAMES = {
  1:'1X2',2:'Double Chance',3:'Handicap Europeen',4:'Total',5:'Total Equipe 1',6:'Total Equipe 2',7:'Mi-Temps / Match Final',
  11:'Score Exact (3 buts)',14:'Intervalle de Buts',19:'Pair/Impair Resultat',21:'BTTS (Over/Under)',22:'Pair/Impair Total',
  25:'Resultat 1ere MT',26:'Score Exact + Total',28:'Aucune Equipe Marque',29:'Score Exact + Resultat',31:'BTTS 2eme MT',
  32:'Total + Resultat par Equipe',33:'Score Exact Complet',39:'Handicap Score Exact',40:'Qui Gagne le Reste',41:'MT Plus de Buts',
  42:'Resultat sans Nul',44:'Minute 1er But',45:'Minute 1er But Intervalle',46:'Clean Sheet Eq.1',47:'Clean Sheet Eq.2',
  50:'Buts Exact Eq.1',51:'Buts Exact Eq.2',52:'Eq.1 Marque 2 MT',53:'Eq.2 Marque 2 MT',54:'But dans les 2 MT',
  56:'Eq.1 Gagne 2 MT',57:'Eq.2 Gagne 2 MT',58:'Eq.1 Gagne >=1 MT',59:'Eq.2 Gagne >=1 MT',60:'Eq.1 Marque 3+',61:'Eq.2 Marque 3+',
  62:'Victoire Eq.1 + BTTS',63:'Over 2.5 + BTTS',65:'Total + BTTS',66:'Victoire Eq.2 + BTTS',67:'Total Pair/Impair',
  70:'>=1 Clean Sheet',73:'Eq.1 Marque 2MT',74:'Eq.2 Marque 2MT',93:'Score Exact Regroupe',106:'Nombre de Buts',
  109:'Resultat Regroupe',114:'Nombre Exact Total',116:'Nombre Exact Eq.1',117:'Nombre Exact Eq.2',118:'Pair/Impair Eq.1',
  119:'Pair/Impair Eq.2',130:'BTTS (Oui/Non)',136:'Total Intervalle Eq.1',137:'Total Intervalle Eq.2',155:'Total Intervalle',
  215:'Difference de Score',216:'Total Passes',217:'Total Tirs',243:'But de la Tete',244:'But Hors Surface',245:'Resultat + Total',
  261:'Buts Eq.1 Regroupe',262:'Buts Eq.2 Regroupe',338:'Resultat Minute X',347:'BTTS + Total',349:'1X2 Minute X',350:'Total Minute X',
  351:'Total + Minute',419:'Total + BTTS Combine',431:'Intervalle 1er But',432:'Total par Intervalle Temps',433:'Total + Resultat',
  434:'Score Eq.1 par MT',435:'Score Eq.2 par MT',448:'Pair/Impair + Resultat',451:'BTTS par MT',452:'BTTS Toutes MT',
  454:'Buts par Intervalle',665:'Intervalle 1er But Eq.1',666:'Intervalle 1er But Eq.2',667:'BTTS 2eme MT',668:'Pair/Impair 2eme MT',
  741:'Resultat Minute Avance',742:'Total Minute Avance',746:'Resultat 2eme MT',747:'Double Chance 2eme MT',
  754:'Qui Marque Premier/Dernier',755:'Pair/Impair MT',770:'Clean Sheet par MT',914:'Total + BTTS Avance',
  1007:'Total Asiatique',1008:'Handicap Asiatique',1065:'Total Eq.1 + Resultat',1066:'Total Eq.2 + Resultat',
  1074:'Score Exact Intervalle',1075:'Resultat 1ere/2eme MT',1076:'BTTS + Resultat MT',1077:'Total Combine MT',
  1259:'But 10 Premieres Min',1265:'Eq.1 Marque 1ere MT',1266:'Eq.2 Marque 1ere MT',1269:'But 15 Premieres Min',
  1286:'Score Exact Intervalle Avance',1315:'Nombre Exact Eq.1',1316:'Nombre Exact Eq.2',1369:'Pair/Impair + Resultat',
  1424:'Total + Resultat Avance',1430:'Score Exact Rare',1523:'Qui Marque Dernier',2196:'Clean Sheet Combine',
  2197:'Marquer 2MT Combine',2198:'3+ Buts Combine',2199:'But 1ere+2eme MT Combine',2307:'Score Exact Combine Avance',
  2476:'Total Asiatique Eq.1',2477:'Total Asiatique Eq.2',2712:'Score Exact Detaille',2747:'Total Combine Avance',
  2891:'Score Exact par MT',2938:'Total Eq.1 Minute',2939:'Total Eq.2 Minute',3119:'Tir au But Eq.1',3120:'Tir Cadre Eq.1',
  3121:'Penalty Eq.1',3122:'Carton Rouge Eq.1',3123:'Corner Eq.1',3124:'But Eq.1 Oui/Non',3125:'Stats Combinees',
  3126:'Stats Avancees',3133:'Evenements Speciaux',3159:'Total Minute Detaille',3161:'Total Combine',
  3206:'Total Eq.1 Min Detaille',3207:'Total Eq.2 Min Detaille',3232:'Evenements 1ere MT',3233:'Pair/Impair 1ere MT',
  3234:'Nombre Buts 1ere MT',3235:'Score Exact 1ere MT',3237:'Score Exact 1ere MT Etendu',3248:'Eq.1 3+ Buts',
  3251:'Clean Sheet Eq.1 1ere MT',3252:'Eq.2 3+ Buts',3255:'Clean Sheet Eq.2 1ere MT',3263:'Eq.1 Marque 1ere MT',
  3264:'Eq.2 Marque 1ere MT',3268:'Difference Score Avancee',3269:'Difference Score Eq.2',3277:'Total Corners',
  3278:'Total Corners Detaille',3279:'Corners Eq.1',3280:'Corners Eq.2',3281:'Corners 3+',3282:'Corners Pair/Impair',
  3283:'Handicap Corners',3284:'1er Corner',3289:'Dernier Corner',3290:'Corner Pair/Impair Eq.1',3291:'Cartons Total',
  3292:'Cartons 3+',3293:'Cartons Pair/Impair',3294:'Cartons par Equipe',3805:'Pair/Impair Combine',
  3806:'Score Exact 1ere MT Combine',3843:'Pair/Impair Eq.1',3844:'Pair/Impair Eq.2',3851:'Total Fautes',
  3852:'Total Tirs Cadres',3863:'Combine Avance',3896:'But 1ere ou 2eme MT',3902:'Penalty Match',4115:'Total Statistiques',
  4178:'Resultat 3 Issues',4469:'Total + Resultat MT',4470:'Total MT Detaille',4471:'Score + Total MT',
  4472:'Clean Sheet MT Detaille',4473:'Statistiques MT',4474:'Evenements Rares MT',4475:'Evenements Combines',
  4489:'Comparaison Equipes',4490:'Comparaison Equipes Inverse',4491:'Evenement Rare Eq.1',4492:'Evenement Rare Eq.2',
  4514:'Pair/Impair Avance',5177:'1X2 1ere MT',5370:'Total Corners par MT',5371:'Total Cartons par MT',
  5386:'Double Chance 1ere MT',5465:'Total 1ere MT',5466:'Handicap 1ere MT',5487:'BTTS 1ere MT',5488:'Total Eq.1 1ere MT',
  5489:'Total Eq.2 1ere MT',5557:'1X2 2eme MT',5583:'Qui Marque 1er But',5584:'Qui Marque 2eme But',5595:'3+ Buts Match',
};

export const XBET_TYPE_NAMES = {
  1:'Victoire Domicile (W1)',2:'Match Nul (X)',3:'Victoire Exterieur (W2)',4:'1X (Dom ou Nul)',5:'12 (Dom ou Ext)',6:'X2 (Nul ou Ext)',
  7:'Handicap W1',8:'Handicap W2',9:'Over',10:'Under',11:'Over Eq.1',12:'Under Eq.1',13:'Over Eq.2',14:'Under Eq.2',
  15:'W1/W1',16:'W1/X',17:'W1/W2',18:'X/W1',19:'X/X',20:'X/W2',21:'W2/W1',22:'W2/X',23:'W2/W2',
  180:'BTTS Oui',181:'BTTS Non',182:'Pair',183:'Impair',794:'Oui',795:'Non',
  388:'Score Exact Over',389:'Score Exact Eq.1',390:'Score Exact Under',188:'W1 1ere MT',189:'X 1ere MT',190:'W2 1ere MT',
  196:'W1 + Score',197:'X + Score',198:'W2 + Score',199:'Total + Score',206:'W1 + Score Under',207:'X + Score Under',
  208:'W2 + Score Under',209:'Total + Score Under',191:'W1 + Total',192:'X + Total',193:'W2 + Total',194:'Total + Total',
  211:'W1 + Total Under',212:'X + Total Under',213:'W2 + Total Under',214:'Total + Total Under',
  200:'BTTS 2eme MT Oui',205:'BTTS 2eme MT Non',195:'Aucune Marque',210:'Au Moins 1 Marque',
  201:'Over Eq.1 Intervalle',202:'Under Eq.1 Intervalle',203:'Over Eq.2 Intervalle',204:'Under Eq.2 Intervalle',
  478:'W1 (sans nul)',479:'W2 (sans nul)',504:'Eq.1 Clean Sheet Oui',505:'Eq.1 Clean Sheet Non',506:'Eq.2 Clean Sheet Oui',
  507:'Eq.2 Clean Sheet Non',731:'Score Exact',8617:'Score Exact Detaille',8618:'Autre Score',
  1781:'But Intervalle',1720:'But Apres Min',2948:'Pas de But',2949:'But Oui Intervalle',2950:'But Non Intervalle',
  424:'Handicap W1 Score',425:'Handicap X Score',426:'Handicap W2 Score',475:'W1 Reste',476:'X Reste',477:'W2 Reste',
  480:'Avant Min',481:'Apres Min',482:'Pas de But',483:'Avant Min Intervalle',484:'Apres Min Intervalle',485:'Pas de But Minute',
  1143:'BTTS Oui + Over',1144:'BTTS Oui + Under',1145:'BTTS Non + Over',1146:'BTTS Non + Under',
  1189:'W1 Minute',1190:'X Minute',1191:'W2 Minute',1192:'Over Minute',1193:'Under Minute',1194:'X Minute (avance)',
  1197:'Over Combine Minute',1198:'Under Combine Minute',1503:'But Oui Minute',1504:'But Non Minute',
  1652:'BTTS 1ere MT Over',1653:'BTTS 1ere MT Under',1668:'BTTS 2eme MT Over',1669:'BTTS 2eme MT Under',
  1808:'Pair Total',1809:'Impair Total',1824:'BTTS Toutes Oui',1825:'BTTS Toutes Non',
  16684:'W1 2eme MT',16685:'X 2eme MT',16686:'W2 2eme MT',
  15770:'W1 1ere MT',15771:'W2 1ere MT',15772:'X 1ere MT',15773:'W1 1ere MT (2)',15774:'W2 1ere MT (2)',15775:'X 1ere MT (2)',
  16258:'X2 1ere MT',16259:'1X 1ere MT',16260:'12 1ere MT',16261:'1X 1ere MT (2)',16263:'12 1ere MT (2)',
  16264:'X2 1ere MT + Over',16265:'1X 1ere MT + Over',16266:'12 1ere MT + Over',16269:'12 1ere MT + Under',
  16453:'Over 1ere MT',16454:'Under 1ere MT',16455:'Handicap W1 1ere MT',16456:'Handicap W2 1ere MT',
  16503:'BTTS 1ere MT Oui',16504:'BTTS 1ere MT Non',16505:'Over Eq.1 1ere MT',16507:'Over Eq.2 1ere MT',
  3827:'Over Asiatique',3828:'Under Asiatique',3829:'Handicap W1 Asiatique',3830:'Handicap W2 Asiatique',
  7778:'Over Asiatique Eq.1',7779:'Under Asiatique Eq.1',7780:'Over Asiatique Eq.2',7781:'Under Asiatique Eq.2',
  512:'Over Corners + BTTS',513:'Under Corners + BTTS',514:'Over Corners Non BTTS',515:'Under Corners Non BTTS',
  9250:'Score MT1',9251:'Score MT1 Under',
  9918:'Over Stat',9919:'Under Stat',9920:'Over Stat 2',9921:'Under Stat 2',9922:'Over Stat 3',9923:'Under Stat 3',
  9924:'Over Stat 4',9925:'Under Stat 4',9926:'Over Stat 5',9927:'Under Stat 5',9928:'Over Stat 6',9929:'Under Stat 6',
  963:'Clean Sheet >=1 Oui',964:'Clean Sheet >=1 Non',4460:'But 10min Oui',4461:'But 10min Non',4466:'But 15min Oui',
  4467:'But 15min Non',4880:'Score Rare',5194:'Dernier But W1',5195:'Dernier But W2',
  578:'Eq.1 Exact Over',579:'Eq.2 Exact Over',580:'Total Exact Under',
  651:'1-0, 2-0, 2-1',652:'0-0, 1-1, 2-2',653:'0-1, 0-2, 1-2',665:'W1 Score Regroupe',666:'X Score Regroupe',
  667:'W1 Score Exact Regroupe',668:'X Score Exact Regroupe',669:'W2 Score Exact Regroupe',670:'W2 Exact 1',671:'W2 Exact 2',
  672:'W2 Exact 3',673:'X Exact 2',739:'Total Exact W1',741:'Total Exact X',743:'Total Exact W2',749:'Eq.1 Exact',
  751:'X Exact Eq',753:'Eq.2 Exact',755:'Pair Eq.1',757:'Impair Eq.1',763:'Eq.1 Exact Avance',764:'X Exact Avance',
  765:'Eq.2 Exact Avance',766:'Pair Eq.2',767:'Impair Eq.2',
  496:'Eq.1 Marque 2MT Oui',497:'Eq.1 Marque 2MT Non',498:'Eq.2 Marque 2MT Oui',499:'Eq.2 Marque 2MT Non',
  500:'Eq.1 Gagne >=1MT Oui',501:'Eq.1 Gagne >=1MT Non',502:'Eq.2 Gagne >=1MT Oui',503:'Eq.2 Gagne >=1MT Non',
  508:'Eq.1 3+ Oui',509:'Eq.1 3+ Non',510:'Eq.2 3+ Oui',511:'Eq.2 3+ Non',516:'W1 + BTTS Oui',517:'W1 + BTTS Non',
  518:'W2 + BTTS Oui',519:'W2 + BTTS Non',520:'Over 2.5 + BTTS Oui',521:'Over 2.5 + BTTS Non',
  1082:'Eq.1 Marque 2MT Oui',1083:'Eq.1 Marque 2MT Non',1084:'Eq.2 Marque 2MT Oui',1085:'Eq.2 Marque 2MT Non',
  1092:'But Hors Surface Oui',1093:'But Hors Surface Non',1094:'But Tete Oui',1095:'But Tete Non',
  1096:'But Hors Surface Eq Oui',1097:'But Hors Surface Eq Non',1125:'Eq.1 Buts Regroupe Over',1126:'Eq.1 Buts Regroupe Under',
  1127:'Eq.2 Buts Regroupe Over',1128:'Eq.2 Buts Regroupe Under',1029:'Difference Score Over',1030:'Difference Score Under',
  1031:'Total Passes Over',1032:'Total Passes Under',1033:'Total Tirs Over',1034:'Total Tirs Under',
  1147:'Total Corners Eq.1 Over',1148:'Total Corners Eq.1 Under',1149:'Total Cartons Eq.1 Over',1150:'Total Cartons Eq.1 Under',
  1810:'But 2MT Oui',1811:'But 2MT Non',2353:'Over 2.5 + BTTS Avance Oui',2354:'Over 2.5 + BTTS Avance Non',
  2450:'BTTS Toutes + Score',2533:'Total Intervalle Over',2534:'Total Intervalle Under',2535:'Total Intervalle Eq Over',
  2536:'Total Intervalle Eq Under',2557:'Eq.1 But Intervalle Oui',2558:'Eq.1 But Intervalle Non',2559:'Eq.2 But Intervalle Oui',
  2560:'Eq.2 But Intervalle Non',2561:'BTTS 2MT Oui',2562:'BTTS 2MT Non',2563:'Pair 2MT',2564:'Impair 2MT',
  2577:'W1 + Over',2578:'W1 + Under',2579:'X + Over',2580:'X + Under',2583:'W2 + Over',2584:'W2 + Under',
  2791:'W1 Minute Oui',2792:'W1 Minute Non',2793:'Over Minute Oui',2794:'Over Minute Non',
  2808:'Resultat 2MT W1',2809:'Resultat 2MT X',2810:'Resultat 2MT W2',2811:'DC 2MT 1X',2812:'DC 2MT 12',2813:'DC 2MT X2',
  2828:'1er But W1',2829:'1er But W2',2831:'Dernier But Nul',2837:'Over + BTTS',2838:'Over + Non BTTS',2839:'Under + BTTS',
  2840:'Under + Non BTTS',3523:'Over + W1',3524:'Under + W1',3525:'Over + W2',3526:'Under + W2',
  3527:'MT/Match W1 Autre',3528:'MT/Match X Autre',3529:'MT/Match W2 Autre',3786:'Autre Score Exact',
  3984:'Score Intervalle Over',3988:'Score Intervalle Under',3990:'W1 1ere MT Resultat',3991:'W1 1ere MT Under',
  3992:'X 1ere MT Resultat',3993:'X 1ere MT Pair',3994:'W2 1ere MT Resultat',3995:'W2 1ere MT Pair',
  3996:'BTTS 1MT + Over',3997:'BTTS 1MT + Under',4000:'Non BTTS 1MT + Over',4001:'Non BTTS 1MT + Under',
  4002:'Total Combine MT Over',4003:'Total Combine MT Under',3973:'Over Eq.1 + Resultat',3974:'Under Eq.1 + Resultat',
  3975:'Over Eq.2 + Resultat',3976:'Under Eq.2 + Resultat',4406:'Score Exact Eq.1 MT',4407:'Score Exact Eq.2 MT',
  4408:'Eq.1 Total Exact',4409:'Eq.2 Total Exact',4546:'Over Combine',4547:'Under Combine',4548:'Exact Combine',
  4549:'Under Exact Combine',4550:'Intervalle Combine Over',4551:'Intervalle Combine Under',4552:'Exact Combine Avance',
  4553:'Under Exact Combine Avance',4555:'Nombre Exact Eq.1',4556:'Nombre Exact Eq.1 Under',4563:'Nombre Exact Eq.2',
  4564:'Nombre Exact Eq.2 Under',4722:'Pair + Resultat Oui',4723:'Pair + Resultat Non',4850:'Total + Resultat Over',
  4851:'Total + Resultat Under',4852:'Total Avance Over',4853:'Total Avance Under',4854:'Eq.1 Marque 1MT Oui',
  4855:'Eq.1 Marque 1MT Non',4856:'Eq.2 Marque 1MT Oui',4857:'Eq.2 Marque 1MT Non',4918:'Total + Resultat >=3',
  4919:'Total + Resultat <3',5209:'Clean Sheet Eq.1 MT1 Oui',5210:'Clean Sheet Eq.1 MT1 Non',5211:'Clean Sheet Eq.2 MT1 Oui',
  5212:'Clean Sheet Eq.2 MT1 Non',7171:'Score Exact Combine Avance',7197:'Score Exact Intervalle Avance',
  8788:'Total Combine Avance Over',8789:'Total Combine Avance Under',9436:'Total Eq.1 Minute Over',9437:'Total Eq.1 Minute Under',
  9438:'Total Eq.2 Minute Over',9439:'Total Eq.2 Minute Under',9954:'Evenement Special 1 Oui',9955:'Evenement Special 1 Non',
  9956:'Evenement Special 2 Oui',9957:'Evenement Special 2 Non',10010:'Total Combine Over',10011:'Total Combine Under',
  10209:'1MT Evenement 1',10210:'1MT Evenement 2',10211:'1MT Evenement 3',10212:'1MT Evenement 4',10213:'1MT Evenement 5',
  10214:'1MT Evenement 6',10215:'Pair 1ere MT',10216:'Impair 1ere MT',10217:'Buts 1MT 0',10218:'Buts 1MT 1',10219:'Buts 1MT 2',
  10220:'Buts 1MT 3+',10221:'Score 1MT 0-0',10222:'Score 1MT 1-0',10223:'Score 1MT 0-1',10224:'Score 1MT 1-1',
  10225:'Score 1MT Autre',10226:'Score 1MT 2-0',10227:'Score 1MT 0-2',10228:'Score 1MT 2-1',10229:'Score 1MT 1-2',
  10230:'Score 1MT 2-2',10231:'Score 1MT Autre Etendu',10268:'Eq.1 3+ Oui',10269:'Eq.1 3+ Non',
  10274:'Clean Sheet Eq.1 1MT Oui',10275:'Clean Sheet Eq.1 1MT Non',10276:'Eq.2 3+ Oui',10277:'Eq.2 3+ Non',
  10282:'Clean Sheet Eq.2 1MT Oui',10283:'Clean Sheet Eq.2 1MT Non',10314:'Eq.1 Marque 1MT Oui',10315:'Eq.1 Marque 1MT Non',
  10316:'Eq.2 Marque 1MT Oui',10317:'Eq.2 Marque 1MT Non',10324:'Difference Score Over',10325:'Difference Score Under',
  10326:'Difference Score Eq.2 Over',10327:'Difference Score Eq.2 Under',10334:'Over Eq.1 + Non BTTS',10335:'Under Eq.1 + Non BTTS',
  10336:'Over Eq.2 + Non BTTS',10337:'Under Eq.2 + Non BTTS',10338:'Total Corners Over',10339:'Total Corners Under',
  10340:'Total Corners Eq.1 Over',10341:'Total Corners Eq.1 Under',10342:'Total Corners Detaille Over',
  10343:'Total Corners Detaille Under',10344:'Total Corners Eq.2 Over',10345:'Total Corners Eq.2 Under',
  10346:'Corners Eq.1 Over',10347:'Corners Eq.1 Under',10350:'Corners Eq.2 Over',10351:'Corners Eq.2 Under',
  10358:'Corners 3+ Oui',10359:'Corners 3+ Non',10362:'Corners Pair',10363:'Corners Impair',10366:'Handicap Corners W1',
  10367:'Handicap Corners W2',10370:'1er Corner W1',10371:'1er Corner W2',10382:'Dernier Corner W1',10383:'Dernier Corner W2',
  10386:'Corner Pair Eq.1',10387:'Corner Impair Eq.1',10390:'Cartons Total Over',10391:'Cartons Total Under',
  10392:'Cartons 3+ Oui',10393:'Cartons 3+ Non',10394:'Cartons Pair',10395:'Cartons Impair',10396:'Cartons Eq.1 Plus',
  10397:'Cartons Eq.2 Plus',12031:'Pair Combine Oui',12032:'Pair Combine Non',12033:'Score 1MT Combine W1',
  12035:'Score 1MT Combine X',12037:'Score 1MT Combine W2',12039:'Score 1MT Combine Autre',12143:'Pair Eq.1',12144:'Impair Eq.1',
  12145:'Pair Eq.2',12146:'Impair Eq.2',12158:'Total Fautes Over',12159:'Total Fautes Under',12160:'Total Tirs Cadres Over',
  12161:'Total Tirs Cadres Under',12580:'But 1ere ou 2eme Oui',12581:'But 1ere ou 2eme Non',12586:'Penalty Oui',12587:'Penalty Non',
  13109:'Total Stats Over 1',13110:'Total Stats Under 1',13113:'Total Stats Over 2',13114:'Total Stats Under 2',
  13250:'Resultat 3 Issues W1',13251:'Resultat 3 Issues X',13252:'Resultat 3 Issues W2',13538:'Total Eq.1 Min Over',
  13539:'Total Eq.1 Min Under',13542:'Total Eq.2 Min Over',13543:'Total Eq.2 Min Under',13546:'Total Min Detaille Over',
  13547:'Total Min Detaille Under',14027:'MT1 W1+Over',14028:'MT1 W1+Under',14029:'MT1 X+Over',14030:'MT1 X+Under',
  14031:'MT1 W2+Over',14032:'MT1 W2+Under',14033:'MT1 Total+Over',14034:'MT1 Total+Under',14035:'MT1 Total Eq.1 Over',
  14036:'MT1 Total Eq.1 Under',14037:'MT1 Total Eq.2 Over',14038:'MT1 Total Eq.2 Under',14039:'MT2 W1+Over',14040:'MT2 W1+Under',
  14041:'MT2 X+Over',14042:'MT2 X+Under',14043:'MT2 W2+Over',14044:'MT2 W2+Under',14045:'MT2 Total+Over',14046:'MT2 Total+Under',
  14047:'Clean Sheet MT1 Eq.1 Oui',14048:'Clean Sheet MT1 Eq.1 Non',14049:'Clean Sheet MT1 Eq.2 Oui',14050:'Clean Sheet MT1 Eq.2 Non',
  14051:'Stats MT1 Over 1',14052:'Stats MT1 Under 1',14053:'Stats MT1 Over 2',14054:'Stats MT1 Under 2',14055:'Stats MT1 Over 3',
  14056:'Stats MT1 Under 3',14057:'Stats MT1 Over 4',14058:'Stats MT1 Under 4',14059:'Evenement Rare MT1 Eq.1 Oui',
  14060:'Evenement Rare MT1 Eq.1 Non',14061:'Evenement Rare MT1 Eq.2 Oui',14062:'Evenement Rare MT1 Eq.2 Non',
  14063:'Evenement Combine 1 Oui',14064:'Evenement Combine 1 Non',14065:'Evenement Combine 2 Oui',14066:'Evenement Combine 2 Non',
  14067:'Evenement Combine 3 Oui',14068:'Evenement Combine 3 Non',14069:'Evenement Combine 4 Oui',14070:'Evenement Combine 4 Non',
  14113:'Comparaison Eq.1 Over',14114:'Comparaison Eq.1 Under',14115:'Comparaison Eq.2 Over',14116:'Comparaison Eq.2 Under',
  14117:'Comparaison Inv Eq.1 Over',14118:'Comparaison Inv Eq.1 Under',14119:'Comparaison Inv Eq.2 Over',
  14120:'Comparaison Inv Eq.2 Under',14121:'Rare Eq.1 Oui',14122:'Rare Eq.1 Non',14123:'Rare Eq.2 Oui',14124:'Rare Eq.2 Non',
  14125:'Rare Eq.1 Inv Oui',14126:'Rare Eq.1 Inv Non',14127:'Rare Eq.2 Inv Oui',14128:'Rare Eq.2 Inv Non',
  14173:'Pair Avance Oui',14174:'Pair Avance Non',16772:'1er But W1',16773:'1er But W2',16774:'2eme But W1',16775:'2eme But W2',
  16797:'3+ Buts Oui',16798:'3+ Buts Non',1802:'Total Intervalle Bas',1803:'Total Intervalle Haut',827:'Total Intervalle Milieu',
  837:'MT Plus Buts',962:'MT Egal Buts',1820:'BTTS MT1 + Over',1821:'BTTS MT1 + Under',1822:'Non BTTS MT1 + Over',
  1823:'Non BTTS MT1 + Under',1828:'But Intervalle Eq.1 Over',1829:'But Intervalle Eq.1 Under',1830:'But Intervalle Combine Over',
  1831:'But Intervalle Combine Under',1834:'But Intervalle Eq.2 Over',1835:'But Intervalle Eq.2 Under',
  1836:'But Intervalle Combine Eq Over',1837:'But Intervalle Combine Eq Under',1747:'Score Eq.1 MT1/MT2 Over',
  1748:'Score Eq.1 MT1/MT2 Under',1749:'Score Eq.2 MT1/MT2 Over',1750:'Score Eq.2 MT1/MT2 Under',2094:'But Tete Eq Oui',
  2095:'But Tete Eq Non',2096:'But Hors Surface Avance Oui',2097:'But Hors Surface Avance Non',6844:'CS Combine 1 Oui',
  6845:'CS Combine 1 Non',6846:'CS Combine 2 Oui',6847:'CS Combine 2 Non',6848:'Marquer 2MT 1 Oui',6849:'Marquer 2MT 1 Non',
  6850:'Marquer 2MT 2 Oui',6851:'Marquer 2MT 2 Non',6852:'3+ Combine 1 Oui',6853:'3+ Combine 1 Non',6854:'3+ Combine 2 Oui',
  6855:'3+ Combine 2 Non',6856:'But 1+2MT 1 Oui',6857:'But 1+2MT 1 Non',6858:'But 1+2MT 2 Oui',
  9930:'Stats Combinees 1 Over',9931:'Stats Combinees 1 Under',9932:'Stats Combinees 2 Over',9933:'Stats Combinees 2 Under',
  9934:'Stats Combinees 3 Over',9935:'Stats Combinees 3 Under',9936:'Stats Avancees 1 Over',9937:'Stats Avancees 1 Non',
  9938:'Stats Avancees 2 Oui',9939:'Stats Avancees 2 Non',9940:'Stats Avancees 3 Oui',9941:'Stats Avancees 3 Non',
};

export function xbetGroupName(groupId) {
  return XBET_GROUP_NAMES[groupId] || `Groupe inconnu #${groupId}`;
}
export function xbetTypeName(typeId) {
  return XBET_TYPE_NAMES[typeId] || `#${typeId}`;
}

// Appel de l'API mobile v3 (3 tentatives). Renvoie data ou null.
export async function fetchXbetMobileGame(gameId, { timeoutMs = 20000 } = {}) {
  const qs = new URLSearchParams({
    cfView: '3', fcountry: '93', gameId: String(gameId), gr: '1357',
    lng: 'fr_FR', ref: '1', supportedSpecialType: '1', whence: '22',
  });
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(`${MOBILE_HOST}/MainFeedLine/mobile/v3/game?${qs}`, { headers: MOBILE_HEADERS, signal: ctrl.signal });
      clearTimeout(to);
      if (r.ok) {
        const j = await r.json();
        if (j?.data) return j.data;
      }
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800));
  }
  return null;
}

// Met un groupe a plat : { market, groupId, subGame, selections[{typeId,name,line,params,odds}] }
function flattenGroup(group, subGame) {
  const selections = [];
  for (const row of group.events || []) {
    for (const ev of (Array.isArray(row) ? row : [row])) {
      const odds = Number(ev.cf);
      if (!odds || odds <= 1) continue;
      selections.push({
        typeId: ev.type,
        name: xbetTypeName(ev.type),
        line: ev.parameter ?? null,
        params: ev.eventParams?.params || null,
        odds,
      });
    }
  }
  const gname = xbetGroupName(group.groupId);
  return {
    market: subGame ? `${subGame} • ${gname}` : gname,
    groupId: group.groupId,
    subGame: subGame || null,
    selections,
  };
}

// Inventaire COMPLET d'un match : marches principaux + tous les sous-marches
// nommes (Corners, Cartons jaunes, 1ere/2eme mi-temps, duels de joueurs...).
// skipSubGames : regex des sous-marches a ignorer (par defaut les duels joueurs).
export async function dumpXbetMarkets(gameId, {
  includeSubGames = true,
  skipSubGames = /duel de joueurs|joueur/i,
  concurrency = 4,
} = {}) {
  const game = await fetchXbetMobileGame(gameId);
  if (!game) return { ok: false, markets: [], reason: 'fetch_failed' };

  const markets = (game.eventGroups || []).map((g) => flattenGroup(g, null)).filter((m) => m.selections.length);

  if (includeSubGames) {
    const subs = (game.subGamesForMainGame || [])
      .filter((s) => s.id && s.id !== gameId && s.subGameName && !skipSubGames.test(s.subGameName));
    for (let i = 0; i < subs.length; i += concurrency) {
      const slice = subs.slice(i, i + concurrency);
      const datas = await Promise.all(slice.map((s) => fetchXbetMobileGame(s.id).then((d) => ({ s, d })).catch(() => ({ s, d: null }))));
      for (const { s, d } of datas) {
        if (!d) continue;
        for (const g of d.eventGroups || []) {
          const m = flattenGroup(g, s.subGameName);
          if (m.selections.length) { m.subGameId = s.id; markets.push(m); }
        }
      }
    }
  }

  return {
    ok: true,
    team1: game.opponent1?.fullName,
    team2: game.opponent2?.fullName,
    league: (game.liga?.name || '').trim(),
    markets,
  };
}
