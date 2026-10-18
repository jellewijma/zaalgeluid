# Appa beheren

Deze bestanden zijn kopieën van de geïnstalleerde configuratie voor Zaalgeluid op Appa. Ze bevatten geen beheersleutel, instance secret, aanmeldsleutel of Google-clientgeheim. De paden in de services zijn voor gebruiker `jelle`.

## Installatie en versies

| Onderdeel | Geïnstalleerd pad |
| --- | --- |
| Backend en SQLite-database | `/home/jelle/.local/share/play-audio-convex/` |
| Native backend | `bin/convex-local-backend` onder die map |
| Gateway | `gateway.mjs` onder die map |
| Back-upscript | `bin/backup.py` onder die map |
| Apart CLI-project voor back-ups | `backup-client/package.json` onder die map |
| Dagelijkse snapshots | `backups/` onder die map |
| Private backendconfiguratie | `/home/jelle/.config/play-audio-convex/backend.env` |
| Private beheersleutel | `/home/jelle/.config/play-audio-convex/admin-key` |
| Gebruikersservices en timer | `/home/jelle/.config/systemd/user/play-audio-convex*` |
| Convex CLI | `/home/jelle/.local/bin/convex`, versie `1.45.0` |
| Node.js | `/home/jelle/.local/bin/node`, versie `24.15.0` |

De native backend is vastgezet op release [`precompiled-2026-10-10-72ce13c`](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-10-10-72ce13c), asset `convex-local-backend-x86_64-unknown-linux-gnu.zip`. [backend-version.txt](backend-version.txt) bevat ook de SHA-256 van het geïnstalleerde programma. De backend gebruikt SQLite en lokale bestandsopslag. Docker is niet nodig.

De backend luistert uitsluitend op `127.0.0.1:3210`, HTTP Actions op `127.0.0.1:3211`. De gateway op `127.0.0.1:3212` stuurt `/http/...` zonder het `/http`-voorvoegsel door naar HTTP Actions en overig verkeer, inclusief WebSockets, naar de backend.

De publieke backend is ingesteld op `https://appa.tailf12edd.ts.net:10000`. Het publieke adres voor HTTP Actions en de JWT-uitgever is `https://appa.tailf12edd.ts.net:10000/http`. De bestaande Funnel-route op poort 443 en de tailnetroute op 8443 blijven afzonderlijk bestaan.

## Services controleren en herstarten

Voer dit uit als `jelle` op Appa. De geselecteerde statusvelden tonen geen uitgewerkte startopdracht met het instance secret.

```bash
systemctl --user show play-audio-convex.service play-audio-convex-gateway.service \
  -p Id -p ActiveState -p SubState -p Result -p ExecMainStatus
systemctl --user show play-audio-convex-backup.service \
  -p Id -p Result -p ExecMainStatus
systemctl --user list-timers play-audio-convex-backup.timer --no-pager
curl --fail --silent http://127.0.0.1:3212/version
```

Bij een geplande herstart stopt de online verbinding kort. Bestanden en accounts blijven op schijf staan.

```bash
systemctl --user restart play-audio-convex.service
systemctl --user restart play-audio-convex-gateway.service
```

Gebruik voor een handmatige back-up:

```bash
systemctl --user start play-audio-convex-backup.service
journalctl --user -u play-audio-convex-backup.service -n 8 --no-pager
```

De timer draait dagelijks om 04:15 in `Europe/Amsterdam`, met maximaal vijftien minuten spreiding. Een gemiste beurt wordt na het starten van de timer alsnog uitgevoerd. Het script exporteert rechtstreeks vanaf de loopback-backend, inclusief bestandsopslag, en controleert de volledige ZIP-integriteit voordat het de dagkopie vervangt. Er blijven zeven dagkopieën bewaard. De map heeft modus `700`, snapshots `600`; de beheersleutel gaat alleen via de procesomgeving naar de CLI. De CLI schrijft geen foutdetails met credentials naar het journal.

De snapshots staan op dezelfde Appa-schijf als de database. Ze helpen bij herstel van gegevens, maar overleven geen defect of verlies van die schijf. De snapshot bevat geen backendprogramma, functiecode, deployment-omgevingsvariabelen of instance secret. Bewaar de private configuratie en een kopie van snapshots ook op een afzonderlijke, beveiligde locatie voor herstel na schijfverlies.

## Opnieuw installeren en een snapshot herstellen

Gebruik deze stappen voor een herstelde of nieuwe Appa-installatie met dezelfde gebruiker en paden. Een snapshotimport vervangt de gegevens in de geïmporteerde tabellen. Maak bij herstel op een bestaande installatie eerst een actuele snapshot en onderbreek het gebruik van de app.

1. Installeer de hierboven genoemde Node- en CLI-versies. Download de vastgezette backendasset, pak `convex-local-backend` uit naar `~/.local/share/play-audio-convex/bin/` en controleer de SHA-256 tegen `backend-version.txt`.
2. Herstel de private bestanden `backend.env` en `admin-key` uit de beveiligde configuratiekopie. `backend.env` bevat `INSTANCE_SECRET`; gebruik dezelfde waarde als bij die beheersleutel. De configuratiemap krijgt modus `700`, beide bestanden `600`. Kopieer deze bestanden nooit naar deze repository.
3. Kopieer `gateway.mjs` naar de datamap, `backup.py` naar `bin/`, `backup-client/package.json` naar de gelijknamige submap en de vier service-/timerbestanden naar `~/.config/systemd/user/`. Maak de datamap, `bin/`, `backup-client/` en `backups/` aan met modus `700`. `backup.py` krijgt modus `700`.
4. Herstel de gewenste volledige ZIP-snapshot in `backups/` met modus `600`. Maak daarnaast `~/.config/play-audio-convex/app.env` met de bewaarde deployment-omgevingsvariabelen, met modus `600`. Dit is een privébestand; het is geen onderdeel van de automatische databaseback-up.
5. Start de native backend en gateway.

```bash
systemctl --user daemon-reload
systemctl --user enable --now play-audio-convex.service play-audio-convex-gateway.service
```

Voer onderstaande code uit vanuit de root van deze repository, nadat `npm ci` is uitgevoerd. Pas uitsluitend de snapshotdatum aan. De code selecteert de native backend expliciet, leest de beheersleutel uit het privébestand en importeert de volledige snapshot, inclusief `users`, `auth*` en opslagbestanden. Daardoor blijven alle oorspronkelijke ID's behouden. De geselecteerde omgevingsvariabelen worden eerst hersteld en daarna wordt de functiecode gepubliceerd.

```bash
python3 - <<'PY'
from pathlib import Path
import os
import subprocess

repo = Path.cwd()
if not (repo / "convex/schema.ts").is_file():
    raise SystemExit("Start dit commando vanuit de root van de Zaalgeluid-repository.")
config = Path("/home/jelle/.config/play-audio-convex")
snapshot = Path("/home/jelle/.local/share/play-audio-convex/backups/snapshot-2026-10-18.zip")
if not snapshot.is_file() or not (config / "app.env").is_file():
    raise SystemExit("Herstel eerst de snapshot en het private app.env-bestand.")
environment = {
    name: value for name, value in os.environ.items()
    if name in {"HOME", "LANG", "LC_ALL", "TZ"}
}
environment.update({
    "PATH": "/home/jelle/.local/bin:/usr/local/bin:/usr/bin:/bin",
    "CI": "1",
    "CONVEX_PROVISION_HOST": "http://127.0.0.1:3210",
    "CONVEX_SELF_HOSTED_URL": "http://127.0.0.1:3210",
    "CONVEX_SELF_HOSTED_ADMIN_KEY": (config / "admin-key").read_text().strip(),
})
commands = [
    ["env", "set", "--from-file", str(config / "app.env")],
    ["deploy", "--yes"],
    ["import", "--replace", "--yes", str(snapshot)],
]
for arguments in commands:
    result = subprocess.run(
        ["/home/jelle/.local/bin/convex", *arguments],
        cwd=repo, env=environment, capture_output=True, text=True,
    )
    if result.returncode:
        raise SystemExit(f"Herstelstap {arguments[0]} mislukt, status {result.returncode}.")
    print(f"Herstelstap {arguments[0]} geslaagd.")
PY
```

Behoud in de private appconfiguratie `OWNER_LOGIN`, `JWT_PRIVATE_KEY`, `JWKS`, `AUTH_GOOGLE_ID` en `AUTH_GOOGLE_SECRET`. `SITE_URL` blijft `https://jellewijma.com/play-audio`. `CUSTOM_AUTH_SITE_URL` blijft `https://dependable-lynx-178.eu-west-1.convex.site` zolang de Google-doorstuurroute wordt gebruikt. `AUTH_PROXY_URL` hoort uitsluitend op de oude Cloud-deployment, met waarde `https://appa.tailf12edd.ts.net:10000/http`; zet deze variabele niet op Appa. `CONVEX_SITE_URL` en `CONVEX_CLOUD_URL` komen uit de native backendconfiguratie en horen niet in `app.env`.

Activeer na herstel de timer en controleer de app met een speler en gekoppelde tablet.

```bash
systemctl --user enable --now play-audio-convex-backup.timer
systemctl --user start play-audio-convex-backup.service
```

## Publieke Funnel-route

De native backend en gateway zijn lokaal ingericht. De nieuwe publieke TLS-route op poort 10000 wacht nog op activering. Het benodigde commando op Appa is:

```bash
tailscale funnel --bg --https=10000 http://127.0.0.1:3212
```

Dit voegt een afzonderlijke poort toe. Controleer daarna `tailscale funnel status` en `https://appa.tailf12edd.ts.net:10000/version`, en test de volledige browserroute. De bestaande routes op 443 en 8443 hoeven niet te worden gewijzigd.
