# Zaalgeluid

Een audioafspeler voor een pc aan een PA-systeem, met bediening vanaf een tablet. De pc speelt muziek en geluidseffecten af; de tablet stuurt de pc aan en toont de afspeelstatus.

Er zijn twee uitvoeringen: online via Vercel en Convex, en lokaal via de meegeleverde Node-server. De lokale bibliotheek en de online bibliotheek staan los van elkaar. Het kiezen van een andere uitvoering verplaatst of overschrijft geen bestanden.

## Online gebruiken

1. Open op de pc [jellewijma.com/play-audio/player](https://jellewijma.com/play-audio/player) en kies **Doorgaan met Google**. Gebruik een Google-account met een geverifieerd e-mailadres. De knop verschijnt zodra Google-aanmelding voor die omgeving is ingericht. Voor het bestaande account blijft aanmelden met gebruikersnaam **jelle** en je eigen wachtwoord beschikbaar; nieuwe wachtwoordaccounts registreren is niet mogelijk.
2. Kies de juiste Windows-audio-uitgang, controleer het PA-volume en klik op **Audio activeren**. Dit is na openen, verversen of overnemen opnieuw nodig.
3. Voeg je liedjes en geluidseffecten toe. Bestanden worden in de online bibliotheek opgeslagen en blijven beschikbaar na afsluiten of opnieuw aanmelden.
4. Scan op de tablet de persoonlijke QR-code van de pc, of open de daar getoonde koppellink. Die link bevat `?room=...` en kiest de juiste speler. Vul vervolgens de zescijferige code van de pc in. Op de tablet is geen Google-account of beheerderswachtwoord nodig. De oude algemene `/control`-link werkt alleen voor de bestaande bibliotheek van het wachtwoordaccount **jelle**.

Ieder Google-account heeft een eigen bibliotheek, afspeellijst en speler. Een andere gebruiker kan jouw bestanden en speler niet benaderen met alleen zijn eigen aanmelding. De bestaande bibliotheek van **jelle** blijft bij het wachtwoordaccount: een Google-aanmelding koppelt of verplaatst deze gegevens niet automatisch, ook niet bij een overeenkomend e-mailadres. Gebruik voor de bestaande bestanden het bestaande wachtwoordaccount, of upload de gewenste bestanden in je afzonderlijke Google-bibliotheek.

Beide apparaten hebben internet nodig; ze hoeven niet op hetzelfde netwerk te zitten. De koppelcode is tien minuten geldig. Vernieuw de code op de pc als die is verlopen. Een gekoppelde tablet kan maximaal twaalf uur bedienen; bij het sluiten van zijn browsersessie kan opnieuw koppelen nodig zijn. Je kunt alle tabletverbindingen op de pc verbreken. Na acht mislukte koppelpogingen geldt een wachttijd van vijf minuten.

Er kan per account één pc tegelijk afspelen. Gebruik **Overnemen** als een andere pc of een ander tabblad van hetzelfde account nog als speler actief is. De vorige speler stopt zodra de overname is ontvangen. Bij een lange verbindingsuitval stopt de speler uiterlijk rond het verlopen van zijn verbinding van 45 seconden; daarna moet je de audio opnieuw activeren. Een korte uitval van de tablet onderbreekt de muziek op de pc niet. Bedieningsopdrachten zijn maximaal vijf seconden geldig en worden daarna niet alsnog uitgevoerd.

De online afspeellijst, selectie en volumes worden bewaard. Hervatten of overnemen start geen geluid vanzelf. Een actief geluidseffect wordt niet automatisch hervat. Houd het afspelertabblad open en voorkom dat de pc in slaapstand gaat.

Via de accountbediening op de pc kun je het wachtwoord van het bestaande wachtwoordaccount wijzigen. Je huidige wachtwoord is daarvoor nodig. Na een wijziging meld je je opnieuw aan met het nieuwe wachtwoord; andere sessies van dat account worden eveneens ingetrokken. Voor Google-accounts beheer je het wachtwoord bij Google; de app bewaart geen Google-wachtwoord.

## Lokaal beginnen op de pc

1. Installeer [Node.js](https://nodejs.org/) versie **22.12 of nieuwer** als die nog niet op de pc staat. Node.js 24 LTS is geschikt.
2. Dubbelklik op **Start-Zaalgeluid.cmd**. Bij de eerste start installeert het script de benodigde pakketten. Het bouwt bij iedere start de app, zodat wijzigingen worden meegenomen, en start daarna de server.
3. Houd het opdrachtvenster open. Zodra de server is gestart, open je [http://localhost:3000/player](http://localhost:3000/player) in de browser van de pc.
4. Kies in Windows de audio-uitgang die met het PA-systeem is verbonden. Controleer ook het Windows-volume en het niveau op de mengtafel.
5. Klik op **Audio activeren**. Dit is na het openen of verversen van de pagina opnieuw nodig: browsers vereisen een klik voordat een pagina geluid mag starten.
6. Voeg de gewenste audiofragmenten toe. De bestanden worden lokaal op de pc opgeslagen.

De installatie heeft internet nodig. Na de installatie werkt de app zonder internet; de pc en tablet moeten elkaar wel via het lokale netwerk kunnen bereiken.

## Lokaal verbinden met de tablet

1. Verbind de tablet met hetzelfde lokale netwerk als de pc. De pc mag ook via een netwerkkabel aangesloten zijn.
2. Scan met de tablet de QR-code op het afspelerscherm, of open het daar getoonde adres. Het adres heeft de vorm `http://192.168.1.100:3000/control`; gebruik het daadwerkelijke adres van jouw pc.
3. Vul de zescijferige koppelcode in die op de pc staat.
4. Kies een fragment en druk op **Afspelen**. Het geluid komt uit de pc.

Gebruik op de pc `localhost` voor het afspelerscherm. Het ophalen van de koppelgegevens is alleen op de server-pc toegestaan. `localhost` op een tablet verwijst naar de tablet zelf en werkt dus niet als adres van de pc.

De koppeling van de tablet is maximaal 12 uur geldig. Na het opnieuw starten van de server moet je de tablet opnieuw koppelen met de code op de pc.

De tabletbediening past in één scherm, in liggende en staande tabletstand. De grote knoppen, tijdlijn en volumeregelaar blijven in beeld. Bij veel fragmenten blader je met **Vorige fragmenten** en **Volgende fragmenten** door de bibliotheek; je hoeft daarvoor niet te scrollen. Bladeren verandert het klaargezette fragment niet.

## Bediening

| Actie | Gedrag |
| --- | --- |
| Fragment kiezen | Zet het fragment klaar; start het nog niet. |
| Afspelen | Start het gekozen fragment of speelt verder na een pauze. |
| Pauzeren | Onderbreekt het geluid en bewaart de positie. |
| Stoppen | Stopt zowel de muziek als een actief geluidseffect en zet de muziek terug naar het begin. |
| Opnieuw | Speelt het fragment direct vanaf het begin af. |
| Vorig / volgend liedje | Gaat naar het vorige of volgende liedje in de afspeellijst. Als muziek speelt, speelt het nieuwe liedje direct; anders blijft het klaarstaan. |
| Geluidseffect | Speelt het effect direct over de muziek heen. Er speelt één effect tegelijk; opnieuw kiezen start het effect weer vanaf het begin. |
| Effect stoppen | Stopt alleen het geluidseffect; de muziek gaat door. |
| Muziekvolume / effectvolume | Regelt muziek en geluidseffecten afzonderlijk. Het Windows- en PA-volume blijven daarnaast van invloed. |
| Tijdlijn | Verplaatst de afspeelpositie binnen het fragment. |

Er kan lokaal één afspeler, of online één afspeler per account, tegelijk actief zijn. Laat het afspelertabblad open en voorkom dat de pc in slaapstand gaat. Houd bij lokaal gebruik ook het servervenster open. De tablet heeft geen audiorechten nodig: alleen de afspeler op de pc maakt geluid.

Voeg op de pc muziek en geluidseffecten toe aan hun eigen bibliotheek met **Liedjes toevoegen** en **Effecten toevoegen**. Je kunt meerdere bestanden tegelijk kiezen. Gebruik de **+** naast een liedje om het aan de afspeellijst toe te voegen; nogmaals klikken haalt het uit de lijst. De volgorde van toevoegen is de afspeelvolgorde. Het eerste toegevoegde liedje wordt klaargezet als er nog niets is geselecteerd. Open **Afspeellijst**, kies het gewenste startliedje en druk op **Afspelen**. Na afloop gaat de afspeler automatisch verder met het volgende liedje in die lijst. Aan het einde stopt de muziek: de lijst wordt niet herhaald. Geluidseffecten staan apart en kun je tijdens de muziek direct starten vanaf de pc of tablet.

De afspeellijst bevat maximaal 200 liedjes. Online wordt de lijst bewaard. Bij lokaal gebruik geldt de lijst voor de huidige afspelersessie en wordt die gewist bij verversen of sluiten van het afspelertabblad; de bestanden blijven in beide uitvoeringen bewaard. **Lijst leegmaken** wist alleen de lijst. Het huidige liedje blijft spelen als je het uit de lijst haalt, maar gaat daarna niet automatisch door naar een ander liedje.

Als de tablet de verbinding verliest, blijft het huidige fragment op de pc doorspelen. Bij opnieuw verbinden ontvangt de tablet de actuele status. Lokaal stopt de afspeler als zijn serververbinding wegvalt. Online kan de muziek tijdens een korte onderbreking blijven spelen zolang de verbinding van de speler nog geldig is, maximaal 45 seconden na de laatste bevestiging. Na het stoppen door verbindingsverlies moet de audio opnieuw worden geactiveerd. Oude bedieningsacties worden niet later alsnog afgespeeld.

## Bestanden en opslag

- Ondersteunde bestandstypen zijn MP3, WAV, OGG, M4A en FLAC, tot maximaal 500 MB per bestand. De gebruikte browser moet de codec in het bestand kunnen afspelen; de bestandsextensie alleen garandeert dit niet.
- Bij lokaal gebruik staan uploads in `data/audio/`, de bibliotheek in `data/library.json` en de koppelcode in `data/settings.json`.
- Online staan bestanden in Convex File Storage en de bibliotheek, afspeellijst en afspeelstatus in Convex. Elke accountbibliotheek bevat maximaal 1000 bestanden. Uploads gaan rechtstreeks naar Convex en hoeven niet door een Vercel Function.
- Beide bibliotheken blijven bestaan wanneer je de app afsluit of de pc opnieuw opstart. Ze worden niet automatisch onderling gesynchroniseerd. Wil je lokale bestanden online gebruiken, upload dan de gewenste bestanden via de online afspeler.
- Bestaande fragmenten zonder categorie blijven bewaard en worden als muziek weergegeven.
- Maak voor een lokale reservekopie een kopie van de map `data/` terwijl de app is afgesloten. Een lokale reservekopie bevat geen online gegevens; maak daarvoor een export van de juiste Convex-deployment inclusief bestandsopslag.
- Alleen de lokale uitvoering houdt audio, instellingen en opdrachten volledig binnen je pc en lokale netwerk. Online gebruikt de app Vercel voor de interface en Convex voor aanmelden, opslag en communicatie.

Online kan iedere aangemelde gebruiker alleen zijn eigen bestanden uploaden, verwijderen en media-URL's ophalen. Gekoppelde tablets ontvangen de bestandsnamen en status van hun gekoppelde speler, geen media-URL's. Een gekopieerde directe Convex-media-URL blijft wel bruikbaar zonder opnieuw aanmelden totdat het bestand wordt verwijderd; deel die URL's dus alleen wanneer je ook het bestand wilt delen. Zie [Convex: bestanden aanbieden](https://docs.convex.dev/file-storage/serve-files).

Om een liedje te verwijderen, haal je het eerst uit de afspeellijst. Is het ook geselecteerd, stop dan het afspelen en klik op de pc op **Selectie wissen**. Stop een geselecteerd geluidseffect met **Effect stoppen**. Daarna kun je het bestand uit de bibliotheek verwijderen; je bevestigt de verwijdering voordat het bestand wordt gewist. **Selectie wissen** is beschikbaar wanneer het liedje niet wordt afgespeeld en niet wordt geladen, en verwijdert op zichzelf geen bestand.

## Als de tablet lokaal niet kan verbinden

- Controleer of het servervenster op de pc nog open is en of het afspelerscherm via `localhost` werkt.
- Gebruik het netwerkadres dat op het afspelerscherm wordt getoond. Dat adres kan veranderen als de pc een ander IP-adres krijgt.
- Sta Node.js toe op **privénetwerken** als Windows Firewall daarom vraagt. Het startscript past je firewall niet aan.
- Een gastnetwerk of wifi met apparaat-/clientisolatie kan verkeer tussen de tablet en pc blokkeren. Gebruik een netwerk waarop apparaten elkaar mogen bereiken.
- Schakel bij twijfel tijdelijk een VPN op de betrokken apparaten uit of controleer de lokale netwerkroutes.
- Verschijnt de melding dat er al een afspeler actief is, sluit dan de andere afspeler voordat je deze activeert.
- Is er verbinding maar geen geluid, controleer dan de activatieknop, het volume van de app, de Windows-uitgang, een eventueel gedempt browsertabblad en de aansluiting op het PA-systeem.

De lokale server is bedoeld voor een vertrouwd lokaal netwerk. De koppelcode voorkomt onbedoelde bediening door andere lokale bezoekers; die verbinding gebruikt HTTP en is niet versleuteld. Publiceer deze server niet rechtstreeks op internet en stel geen portforwarding in. Gebruik voor internettoegang de online uitvoering met HTTPS, aanmelding en Convex.

## Lokaal starten vanuit een terminal

Open een terminal in deze map:

```powershell
npm.cmd install
$env:VITE_APP_MODE = "local"
npm.cmd run build
npm.cmd start
```

Voor ontwikkeling, met automatisch vernieuwen van de interface:

```powershell
npm.cmd run dev
```

De server luistert standaard op poort 3000 en is bereikbaar via alle netwerkinterfaces. Je kunt een andere poort kiezen:

```powershell
$env:PORT = "3100"
npm.cmd start
```

Open dan `http://localhost:3100/player` op de pc. Stop de server met `Ctrl+C` in het servervenster.

## Het URL-pad instellen

De app ondersteunt een instelbaar URL-pad. Test het beoogde pad eerst lokaal door bij zowel bouwen als starten dezelfde waarde te gebruiken:

```powershell
$env:APP_BASE_PATH = "/play-audio"
npm.cmd run build
npm.cmd start
```

De afspeler staat dan op `http://localhost:3000/play-audio/player` en de bediening op `http://localhost:3000/play-audio/control`. De QR-code, API, audiobestanden, WebSocket en interfacebestanden gebruiken hetzelfde voorvoegsel. Dit werkt ook met `npm.cmd run dev`. Zonder `APP_BASE_PATH` blijven de bestaande adressen `/player` en `/control` werken. Verwijder de variabele en bouw opnieuw om terug te gaan naar de standaard:

```powershell
Remove-Item Env:APP_BASE_PATH -ErrorAction SilentlyContinue
npm.cmd run build
```

Online wordt hetzelfde pad gebruikt voor de interface en navigatie. De online uitvoering gebruikt geen lokale `/api`- of `/ws`-routes: de browser communiceert rechtstreeks met Convex. Vercel levert uitsluitend de gebouwde interface uit `dist/`.

## Online ontwikkelen en publiceren

Gebruik afzonderlijke Convex-deployments voor ontwikkeling en productie. Accounts, wachtwoorden, sleutels, bestanden en status zijn per deployment gescheiden. Een code-deploy kopieert geen lokale bibliotheek en geen ontwikkeldata naar productie.

### Omgevingsvariabelen

| Waar | Variabele | Waarde of doel |
| --- | --- | --- |
| Vite/Vercel build | `VITE_APP_MODE` | `cloud` voor online; anders wordt de lokale interface gebruikt. |
| Vite/Vercel build | `VITE_CONVEX_URL` | De HTTPS `.convex.cloud`-URL van de bijbehorende deployment. Dit is een openbaar adres, geen geheim. |
| Vite/Vercel build | `APP_BASE_PATH` | `/play-audio`. |
| Lokale Convex CLI | `CONVEX_DEPLOYMENT` | De geselecteerde ontwikkeldeployment; de CLI beheert dit doorgaans in `.env.local`. |
| Convex | `OWNER_LOGIN` | `jelle`; gebruikersnaam van het bestaande, gesloten wachtwoordaccount. Google-gebruikers hebben afzonderlijke accounts. |
| Convex | `SITE_URL` | Publiek app-adres, voor productie `https://jellewijma.com/play-audio`. |
| Convex | `AUTH_GOOGLE_ID` | Google OAuth-client-ID voor de betreffende omgeving. Alleen serverconfiguratie. |
| Convex | `AUTH_GOOGLE_SECRET` | Bijbehorend geheim van de Google OAuth-client. Nooit een `VITE_`-variabele. |
| Convex | `JWT_PRIVATE_KEY` | Geheime aanmeldsleutel, afzonderlijk genereren voor dev en productie. |
| Convex | `JWKS` | De publieke verificatiesleutels die bij `JWT_PRIVATE_KEY` horen. |
| Convex, automatisch | `CONVEX_SITE_URL` | Het `.convex.site`-adres; gebruikt door `convex/auth.config.ts`. |
| Alleen een eventuele CI-deploy | `CONVEX_DEPLOY_KEY` | Geheime deploymentsleutel, nooit een `VITE_`-variabele of onderdeel van de browserbuild. |

Bewaar secrets buiten Git. `.env*`, `.checks/` en `.vercel/` worden genegeerd. Publiceer de privésleutel, het wachtwoord, Google-clientgeheim en deploymenttokens niet in documentatie of buildlogs. Google-aanmelding is alleen geregistreerd wanneer zowel `AUTH_GOOGLE_ID` als `AUTH_GOOGLE_SECRET` in Convex zijn ingesteld. De openbare query `account:authMethods` geeft alleen aan welke aanmeldmethodes zijn geconfigureerd, zonder waarden prijs te geven.

### Ontwikkeling

Selecteer de juiste Convex-projectomgeving en push de functies:

```powershell
npm.cmd ci
npx.cmd convex dev --once
npx.cmd convex env set OWNER_LOGIN jelle
npx.cmd convex env set SITE_URL http://localhost:3000/play-audio
```

Richt bij een **nieuwe** deployment Convex Auth in, inclusief de twee sleutels. De bestaande bestanden `convex/auth.ts`, `convex/auth.config.ts` en `convex/http.ts` bevatten al de vereiste koppeling en de gesloten wachtwoordregistratie. De Auth-installatiehulp kan de deploymentsleutels instellen:

```powershell
npx.cmd @convex-dev/auth --web-server-url http://localhost:3000/play-audio
```

Genereer bij een reeds ingerichte deployment niet onbedoeld nieuwe sleutels: daarmee worden bestaande aanmeldingen ongeldig. Voor handmatige inrichting zijn de namen `JWT_PRIVATE_KEY` en `JWKS` nodig. Gebruik de interactieve invoer van `npx.cmd convex env set JWT_PRIVATE_KEY`, of `--from-file` met een privébestand, zodat de PEM-regels intact blijven. Zie [Convex Auth: handmatige inrichting](https://labs.convex.dev/auth/setup/manual).

Start daarna de interface tegen de ontwikkeldeployment, met de juiste URL uit Convex:

```powershell
$env:VITE_APP_MODE = "cloud"
$env:VITE_CONVEX_URL = "https://<ontwikkeldeployment>.convex.cloud"
$env:APP_BASE_PATH = "/play-audio"
npm.cmd run dev
```

Open `http://localhost:3000/play-audio/player`. Laat voor verdere backendwijzigingen `npx.cmd convex dev` in een tweede terminal draaien. De Node-server dient hier als ontwikkelserver voor de interface; de online gegevens blijven in de geselecteerde Convex-deployment.

### Productie op Vercel

1. Stel `OWNER_LOGIN`, `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`, `AUTH_GOOGLE_ID` en `AUTH_GOOGLE_SECRET` ook op de **productiedeployment** in. Gebruik bij Convex-omgevingscommando's `--prod`, bijvoorbeeld `npx.cmd convex env set OWNER_LOGIN jelle --prod` en `npx.cmd convex env set SITE_URL https://jellewijma.com/play-audio --prod`. Gebruik de productieclient van Google, met de productiecallback uit de Google-instructies hieronder. De Auth-installatiehulp ondersteunt eveneens `--prod`; ontwikkelsleutels worden niet automatisch overgenomen.
2. Voer de controles hieronder uit en publiceer de backend met `npx.cmd convex deploy`. De CLI toont de deployment waarop de wijziging wordt toegepast.
3. Configureer in het audio-project op Vercel de drie buildvariabelen: `VITE_APP_MODE=cloud`, `VITE_CONVEX_URL` met de productie-URL en `APP_BASE_PATH=/play-audio`. `vercel.json` gebruikt Vite, `npm run build` en uitvoermap `dist`. Werk bij een andere Convex-deployment ook de toegestane HTTPS/WSS-adressen in de Content Security Policy van `vercel.json` bij.
4. Bouw/publiceer het audio-project en controleer eerst zijn eigen Vercel-adres: aanmelden, meerdere uploads, muziek, effecten, tabletbediening en herladen met behoud van de afspeellijst. Productie en previews moeten bewust aan de juiste Convex-deployment gekoppeld zijn.
5. De bestaande portfolio op `jellewijma.com` routeert uitsluitend `/play-audio` en `/play-audio/:path*` door naar het audio-project, met behoud van het voorvoegsel. DNS kan geen afzonderlijk URL-pad toewijzen. Laat de audio-app zijn eigen beveiligingsheaders leveren en controleer dat de portfolio-overige routes blijven werken. Zie [Vercel rewrites](https://vercel.com/docs/routing/rewrites).
6. Controleer het hele gebruikspad opnieuw via `https://jellewijma.com/play-audio`, inclusief de directe `/player`- en `/control`-links, assets, aanmelding, upload en afspelen.

### Google-aanmelding inrichten

Gebruik een afzonderlijk Google Cloud-project met een OAuth-client van type **Web application** voor ontwikkeling en voor productie. De productieclient bevat alleen productieadressen. Stel de Google Auth Platform-audience in op **External** wanneer mensen met hun eigen Google-account moeten kunnen aanmelden. Voeg tijdens ontwikkeling testgebruikers toe; publiceer de productie-app voor het externe publiek wanneer de inrichting gereed is. Controleer de appnaam, contactgegevens en vereiste openbare app- en privacypagina's in Google Auth Platform. Zie [Google: OAuth voorbereiden voor productie](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

De openbare homepage is `https://jellewijma.com/play-audio`; de privacy-URL voor Google Branding is `https://jellewijma.com/play-audio/privacy`. De privacypagina werkt zonder aanmelding en zonder Convex-verbinding, en is vanaf de homepage en het aanmeldscherm bereikbaar. Ze beschrijft de opgeslagen profiel- en audiogegevens, browseropslag, betrokken diensten en het contactadres voor verwijderingsverzoeken.

De callback loopt rechtstreeks via Convex HTTP Actions. Vul bij **Authorized redirect URIs** exact het adres van de bijbehorende omgeving in:

| Omgeving | Authorized redirect URI |
| --- | --- |
| Ontwikkeling | `https://fortunate-bass-968.eu-west-1.convex.site/api/auth/callback/google` |
| Productie | `https://dependable-lynx-178.eu-west-1.convex.site/api/auth/callback/google` |

Gebruik bij **Authorized JavaScript origins** de frontend-origin zonder pad: `https://jellewijma.com` voor productie en de gebruikte lokale origin voor ontwikkeling, bijvoorbeeld `http://localhost:3000` of `http://localhost:4173`. De `/play-audio`-prefix hoort niet in de Google-callback of JavaScript-origin. Zie [Convex Auth: Google configureren](https://labs.convex.dev/auth/config/oauth/google).

Stel de client-ID in als `AUTH_GOOGLE_ID` en het clientgeheim als `AUTH_GOOGLE_SECRET` op de bijbehorende **Convex**-deployment in, via het dashboard of `convex env set --from-file` met een privébestand. Gebruik `--prod` voor de productieomgeving. Zet deze waarden niet in Vercel-buildvariabelen of frontendcode. De app vraagt uitsluitend `openid profile email` aan en toont de Google-accountkeuze. Alleen een geverifieerd e-mailadres wordt geaccepteerd; het onveranderlijke Google-accountnummer bepaalt bij volgende aanmeldingen welk app-account wordt gebruikt.

Stel `SITE_URL` op het volledige frontend-adres inclusief het app-pad in: productie `https://jellewijma.com/play-audio`, ontwikkeling bijvoorbeeld `http://localhost:4173/play-audio`. De frontend geeft een **absolute** terugkeer-URL door, bijvoorbeeld `https://jellewijma.com/play-audio/player`. `convex/auth_policy.ts` staat uitsluitend de `/player`-pagina onder de geconfigureerde origin en het app-pad toe. Daardoor verdubbelt `/play-audio` niet en kan de aanmelding niet naar een andere website worden doorgestuurd. Test Google-aanmelding op dezelfde origin als `SITE_URL`; de hoofdsite en een losse Vercel-preview zijn verschillende origins.

### Beheerdersaccount aanmaken of herstellen

Openbare wachtwoordregistratie en openbare wachtwoordreset zijn uitgeschakeld; Google-gebruikers krijgen bij hun eerste geslaagde aanmelding wel een eigen account. Op een nieuwe deployment maakt een Convex-beheerder het bestaande type wachtwoordaccount één keer aan via de **interne** action `account:bootstrapOwner`, met argument `{ "password": "<nieuw wachtwoord>" }`. De gebruikersnaam komt uit `OWNER_LOGIN`. De action weigert een bestaand account te overschrijven.

Voor herstel voert een Convex-beheerder de interne action `account:resetOwner` uit met hetzelfde argumentschema. Dat wijzigt het wachtwoord en trekt alle bestaande beheerderssessies in; bestanden en afspeellijst blijven behouden. Gebruik een uniek wachtwoord van 12 tot 200 tekens en voer het via een privé-invoermethode of de bevoegde Convex-dashboardinterface in. Zet het echte wachtwoord niet in een vast CLI-commando, shellgeschiedenis of Git-bestand. Controleer vóór uitvoering expliciet of dev of productie is geselecteerd. Voor een gewone wijziging gebruikt de eigenaar de wachtwoordfunctie in de app.

## Opbouw voor ontwikkelaars

Lokaal levert de Node-server de interface en audiobestanden vanaf hetzelfde adres. De tablet stuurt opdrachten via een WebSocket naar de actieve afspeler. Online levert Vercel de interface en verwerkt Convex de opslag, aanmelding, status en opdrachten. In beide uitvoeringen rapporteert de pc de werkelijke afspeelstatus; de pc blijft het apparaat dat audio produceert.

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| `server/app.ts` | Lokale opslag, koppeling, uploads en communicatie tussen afspeler en bediening. |
| `shared/protocol.ts` | Gedeelde berichten, opdrachten en statusdefinities. |
| `shared/paths.ts` / `src/lib/paths.ts` | Gedeeld URL-voorvoegsel voor server, interface, API en WebSocket. |
| `src/lib/audio-engine.ts` | Audio-activering, afspelen en volumeregeling in de browser van de pc. |
| `src/hooks/use-room.ts` | WebSocket-verbinding, status en opnieuw verbinden. |
| `src/App.tsx` | De startpagina, afspeler en tabletbediening. |
| `src/CloudApp.tsx` | Online aanmelden, tablet koppelen, uploads en accountbediening. |
| `src/hooks/use-cloud-room.ts` | Online afspeelstatus, spelerverbinding, overnemen en verlopen opdrachten. |
| `shared/cloud-protocol.ts` | Online statusvelden en geldigheidsduren. |
| `convex/rooms.ts` | Afspelerregistratie, koppelcodes, tabletmachtigingen en opdrachten. |
| `convex/files.ts` | Bibliotheek, directe uploads, media-URL's en veilig verwijderen. |
| `convex/auth.ts` / `convex/auth_policy.ts` / `convex/account.ts` | Google-aanmelding, geverifieerde profielen, veilige terugkeer-URL, bestaand wachtwoordaccount en accountinformatie. |
| `convex/cleanup.ts` / `convex/crons.ts` | Opruimen van verlopen opdrachten, koppelingen en onafgemaakte uploads. |
| `vercel.json` | Statische online hosting, routes en beveiligingsheaders. |

## Controles voor ontwikkelaars

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:cloud
npm.cmd run test:browser
```

De browsercontroles gebruiken via Playwright de geïnstalleerde Google Chrome als die op `C:/Program Files/Google/Chrome/Application/chrome.exe` staat. Anders gebruiken ze Playwright Chromium; installeer die zo nodig met `npx.cmd playwright install chromium`.

De lokale browsercontroles starten zelf testservers op poort 3107 of een vrije lokale poort en gebruiken aparte tijdelijke datamappen van het besturingssysteem. Ze wijzigen de normale bibliotheek onder `data/` niet. Bouw daarvoor eerst de lokale uitvoering met `VITE_APP_MODE=local` en `npm.cmd run build`; voor testen tegen de ontwikkelserver kun je `$env:E2E_DEV = "1"` instellen. De controle voor `/play-audio` gebruikt altijd een ontwikkelserver met dat voorvoegsel.

`test:cloud` controleert de Convex-functies in een geïsoleerde testomgeving, inclusief Google-profielen, veilige OAuth-terugkeer, gescheiden bibliotheken/spelers, behoud van het wachtwoordaccount, gesloten wachtwoordregistratie, verlopen koppelingen/opdrachten, overnemen en bestandsbescherming. Deze tests wijzigen geen ontwikkel- of productiegegevens. Controleer online daarnaast met twee echte browsersessies de route van Google-aanmelden en uploaden tot afspelen en tabletbediening; uitsluitend een geslaagde build bewijst die verbinding niet.

Gebruik voor een repetitie ook de daadwerkelijke pc, tablet en PA-aansluiting om netwerkbereik en geluidsniveau te controleren.
