import { ArrowLeft } from "lucide-react";
import { Header, Footer } from "../App";
import { appPath } from "../lib/paths";

export function PrivacyPage() {
  return <>
    <Header cloud />
    <main className="privacy-page">
      <a className="back-link" href={appPath("/")}><ArrowLeft size={16} /> Naar Zaalgeluid</a>
      <div className="eyebrow">ZAALGELUID ONLINE</div>
      <h1>Privacy</h1>
      <p className="privacy-intro">Zaalgeluid laat je audio afspelen op een pc en bedienen vanaf een tablet. Hier lees je welke gegevens de online app daarvoor gebruikt.</p>
      <p className="privacy-updated">Bijgewerkt op 13 september 2026 · Beheerder: Jelle Wijma</p>

      <section aria-labelledby="privacy-account">
        <h2 id="privacy-account">Je account</h2>
        <p>Bij aanmelden met Google ontvangen en bewaren we je Google-accountnummer, naam, geverifieerde e-mailadres en, wanneer beschikbaar, de link naar je profielfoto. Daarmee herkennen we je account en koppelen we je eigen bibliotheek aan je aanmelding. Zaalgeluid ontvangt je Google-wachtwoord niet.</p>
        <p>Het bestaande wachtwoordaccount blijft afzonderlijk beschikbaar. Google-aanmelding neemt de bestanden van dat account niet automatisch over.</p>
      </section>

      <section aria-labelledby="privacy-audio">
        <h2 id="privacy-audio">Audio en tabletbediening</h2>
        <p>We bewaren je uploads, bestandsnamen, bestandsgrootte en categorie, samen met je afspeellijst, selectie, volumes en afspeelstatus. Iedere gebruiker heeft een eigen bibliotheek en speler.</p>
        <p>Een tablet die je met je persoonlijke link en code koppelt, krijgt toegang tot de bestandsnamen, afspeelstatus en bediening van jouw speler. De tablet ontvangt geen downloadlinks naar je audio. Een directe audiolink die je zelf deelt, kan wel toegang geven tot dat bestand.</p>
      </section>

      <section aria-labelledby="privacy-browser">
        <h2 id="privacy-browser">Opslag in je browser</h2>
        <p>De browser bewaart aanmeldgegevens in lokale opslag zodat je aangemeld kunt blijven. De tablet bewaart zijn tijdelijke koppeling in de browsersessie. Tijdens Google-aanmelding worden ook functionele cookies en tijdelijke gegevens gebruikt om de aanmelding af te ronden. Je kunt uitloggen en tabletverbindingen verbreken vanuit de speler.</p>
      </section>

      <section aria-labelledby="privacy-services">
        <h2 id="privacy-services">Diensten die de app gebruikt</h2>
        <p>Vercel levert de website. Convex verwerkt accounts, aanmeldsessies, audio-opslag en de verbinding tussen pc en tablet. Google verzorgt de Google-aanmelding. Deze diensten ontvangen daarbij ook technische verbindingsgegevens, zoals je IP-adres. De app gebruikt je Google-profiel voor aanmelden en accountbeheer.</p>
        <p>Deze pagina gaat over de online app. De afzonderlijke lokale uitvoering slaat audio en instellingen op de pc op.</p>
      </section>

      <section aria-labelledby="privacy-delete">
        <h2 id="privacy-delete">Gegevens verwijderen en contact</h2>
        <p>Je bestanden blijven beschikbaar na uitloggen. Je kunt audio zelf uit je bibliotheek verwijderen; haal het bestand daarvoor eerst uit de speler en de afspeellijst. Google-toestemming intrekken verwijdert je opgeslagen audio en app-account niet automatisch.</p>
        <p>Voor vragen, inzage, correctie of een verzoek om je account en bijbehorende gegevens te verwijderen, mail je naar <a href="mailto:jelle.wijma@gmail.com">jelle.wijma@gmail.com</a>. Vermeld je accountadres en deel geen wachtwoorden of koppelcodes.</p>
      </section>
    </main>
    <Footer cloud />
  </>;
}
