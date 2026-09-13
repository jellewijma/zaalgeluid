# Zaalgeluid

Een lokale audioafspeler voor een pc aan een PA-systeem, met bediening vanaf een tablet. De pc speelt het geluid af. De tablet stuurt de pc aan en toont de afspeelstatus.

## Beginnen op de pc

1. Installeer [Node.js](https://nodejs.org/) versie **22.12 of nieuwer** als die nog niet op de pc staat. Node.js 24 LTS is geschikt.
2. Dubbelklik op **Start-Zaalgeluid.cmd**. Bij de eerste start installeert het script de benodigde pakketten. Het bouwt bij iedere start de app, zodat wijzigingen worden meegenomen, en start daarna de server.
3. Houd het opdrachtvenster open. Zodra de server is gestart, open je [http://localhost:3000/player](http://localhost:3000/player) in de browser van de pc.
4. Kies in Windows de audio-uitgang die met het PA-systeem is verbonden. Controleer ook het Windows-volume en het niveau op de mengtafel.
5. Klik op **Audio activeren**. Dit is na het openen of verversen van de pagina opnieuw nodig: browsers vereisen een klik voordat een pagina geluid mag starten.
6. Voeg de gewenste audiofragmenten toe. De bestanden worden lokaal op de pc opgeslagen.

De installatie heeft internet nodig. Na de installatie werkt de app zonder internet; de pc en tablet moeten elkaar wel via het lokale netwerk kunnen bereiken.

## Verbinden met de tablet

1. Verbind de tablet met hetzelfde lokale netwerk als de pc. De pc mag ook via een netwerkkabel aangesloten zijn.
2. Scan met de tablet de QR-code op het afspelerscherm, of open het daar getoonde adres. Het adres heeft de vorm `http://192.168.1.100:3000/control`; gebruik het daadwerkelijke adres van jouw pc.
3. Vul de zescijferige koppelcode in die op de pc staat.
4. Kies een fragment en druk op **Afspelen**. Het geluid komt uit de pc.

Gebruik op de pc `localhost` voor het afspelerscherm. Het ophalen van de koppelgegevens is alleen op de server-pc toegestaan. `localhost` op een tablet verwijst naar de tablet zelf en werkt dus niet als adres van de pc.

De koppeling van de tablet is maximaal 12 uur geldig. Na het opnieuw starten van de server moet je de tablet opnieuw koppelen met de code op de pc.

## Bediening

| Actie | Gedrag |
| --- | --- |
| Fragment kiezen | Zet het fragment klaar; start het nog niet. |
| Afspelen | Start het gekozen fragment of speelt verder na een pauze. |
| Pauzeren | Onderbreekt het geluid en bewaart de positie. |
| Stoppen | Stopt het geluid en zet de positie terug naar het begin. |
| Opnieuw | Speelt het fragment direct vanaf het begin af. |
| Volume | Verandert het afspeelvolume op de pc. Het Windows- en PA-volume blijven daarnaast van invloed. |
| Tijdlijn | Verplaatst de afspeelpositie binnen het fragment. |

Er kan één afspeler tegelijk actief zijn. Laat het afspelertabblad en het servervenster op de pc open en voorkom dat de pc in slaapstand gaat. De tablet heeft geen audiorechten nodig: alleen de afspeler op de pc maakt geluid.

Als de tablet de verbinding verliest, blijft het huidige fragment op de pc doorspelen. Bij opnieuw verbinden ontvangt de tablet de actuele status. Als de afspeler zelf de verbinding met de server verliest, stopt het geluid en moet de afspeler opnieuw worden geactiveerd. Eerdere bedieningsacties worden niet in een wachtrij bewaard of later alsnog afgespeeld.

## Bestanden en opslag

- Ondersteunde bestandstypen zijn MP3, WAV, OGG, M4A en FLAC, tot maximaal 500 MB per bestand. De gebruikte browser moet de codec in het bestand kunnen afspelen; de bestandsextensie alleen garandeert dit niet.
- Uploads staan in `data/audio/`, de bibliotheek in `data/library.json` en de koppelcode in `data/settings.json`.
- De bibliotheek blijft bestaan wanneer je de app afsluit of de pc opnieuw opstart.
- Maak voor een reservekopie een kopie van de map `data/` terwijl de app is afgesloten.
- Audio, instellingen en opdrachten blijven binnen je eigen pc en lokale netwerk. Er worden geen gehoste diensten gebruikt.

Om het geselecteerde fragment te verwijderen, stop je eerst het afspelen en klik je op de pc op **Selectie wissen**. Daarna kun je het fragment uit de bibliotheek verwijderen; je bevestigt de verwijdering voordat het bestand wordt gewist. **Selectie wissen** is beschikbaar wanneer het fragment niet wordt afgespeeld en niet wordt geladen, en verwijdert op zichzelf geen bestand.

## Als de tablet niet kan verbinden

- Controleer of het servervenster op de pc nog open is en of het afspelerscherm via `localhost` werkt.
- Gebruik het netwerkadres dat op het afspelerscherm wordt getoond. Dat adres kan veranderen als de pc een ander IP-adres krijgt.
- Sta Node.js toe op **privénetwerken** als Windows Firewall daarom vraagt. Het startscript past je firewall niet aan.
- Een gastnetwerk of wifi met apparaat-/clientisolatie kan verkeer tussen de tablet en pc blokkeren. Gebruik een netwerk waarop apparaten elkaar mogen bereiken.
- Schakel bij twijfel tijdelijk een VPN op de betrokken apparaten uit of controleer de lokale netwerkroutes.
- Verschijnt de melding dat er al een afspeler actief is, sluit dan de andere afspeler voordat je deze activeert.
- Is er verbinding maar geen geluid, controleer dan de activatieknop, het volume van de app, de Windows-uitgang, een eventueel gedempt browsertabblad en de aansluiting op het PA-systeem.

De app is bedoeld voor een vertrouwd lokaal netwerk. De koppelcode voorkomt onbedoelde bediening door andere lokale bezoekers; de verbinding gebruikt HTTP en is niet versleuteld. Publiceer deze server niet rechtstreeks op internet en stel geen portforwarding in.

## Starten vanuit een terminal

Open een terminal in deze map:

```powershell
npm.cmd install
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

## Opbouw voor ontwikkelaars

De Node-server levert de interface en audiobestanden vanaf hetzelfde adres. De tablet stuurt opdrachten via een WebSocket naar de server, die ze doorgeeft aan de actieve afspeler. De afspeler rapporteert de werkelijke afspeelstatus terug, zodat de tablet de status van de pc toont.

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| `server/app.ts` | Lokale opslag, koppeling, uploads en communicatie tussen afspeler en bediening. |
| `shared/protocol.ts` | Gedeelde berichten, opdrachten en statusdefinities. |
| `src/lib/audio-engine.ts` | Audio-activering, afspelen en volumeregeling in de browser van de pc. |
| `src/hooks/use-room.ts` | WebSocket-verbinding, status en opnieuw verbinden. |
| `src/App.tsx` | De startpagina, afspeler en tabletbediening. |

## Controles voor ontwikkelaars

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:browser
```

De browsercontroles gebruiken via Playwright de geïnstalleerde Google Chrome als die op `C:/Program Files/Google/Chrome/Application/chrome.exe` staat. Anders gebruiken ze Playwright Chromium; installeer die zo nodig met `npx.cmd playwright install chromium`.

De browsercontroles starten zelf een testserver op poort 3107 en gebruiken een aparte tijdelijke datamap van het besturingssysteem. Ze wijzigen de normale bibliotheek onder `data/` niet. Bouw de app eerst met `npm.cmd run build`; voor testen tegen de ontwikkelserver kun je `$env:E2E_DEV = "1"` instellen.

Gebruik voor een repetitie ook de daadwerkelijke pc, tablet en PA-aansluiting om netwerkbereik en geluidsniveau te controleren.
