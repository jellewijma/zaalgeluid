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
      <p className="privacy-updated">Bijgewerkt op 27 september 2026 · Beheerder: Jelle Wijma</p>

      <section aria-labelledby="privacy-account">
        <h2 id="privacy-account">Je account</h2>
        <p>Bij aanmelden met Google ontvangen en bewaren we je Google-accountnummer, naam, geverifieerde e-mailadres en, wanneer beschikbaar, de link naar je profielfoto. Daarmee herkennen we je account en koppelen we je eigen bibliotheek aan je aanmelding. Zaalgeluid ontvangt je Google-wachtwoord niet.</p>
        <p>Bij doorgaan als gast maken we een afzonderlijk gastaccount met een willekeurig nummer. Je hoeft geen naam, e-mailadres of wachtwoord op te geven. Ook een gast heeft een eigen bibliotheek en afspeler. De toegang wordt in deze browser bewaard zolang je aanmeldsessie geldig is. Na afmelden, het verlopen van de sessie of het wissen van browsergegevens kun je niet opnieuw bij hetzelfde gastaccount. Aanmelden met Google neemt gastbestanden niet automatisch over.</p>
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
        <p>Afmelden verwijdert je opgeslagen audio en app-account niet automatisch. Met Google of je bestaande wachtwoordaccount kun je later opnieuw bij je bestanden; voor een gastaccount is dat na afmelden niet mogelijk. Je kunt audio zelf uit je bibliotheek verwijderen; haal het bestand daarvoor eerst uit de speler en de afspeellijst. Verwijder als gast je bestanden voordat je afmeldt als je ze niet wilt bewaren. Google-toestemming intrekken verwijdert je opgeslagen audio en app-account ook niet automatisch.</p>
        <p>Voor vragen, inzage, correctie of een verzoek om je account en bijbehorende gegevens te verwijderen, mail je naar <a href="mailto:jelle.wijma@gmail.com">jelle.wijma@gmail.com</a>. Vermeld bij een Google-account je accountadres, of geef aan dat je de app als gast gebruikte. Deel geen wachtwoorden of koppelcodes.</p>
      </section>
    </main>
    <Footer cloud />
  </>;
}
