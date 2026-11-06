import type { PriceList } from '../lib/quote';

/**
 * Uvaag Elektros prisliste, hentet fra «Tilbudsberegning – mal.xlsx» (6. nov. 2026).
 * Priser eks. mva, ferdig montert (materiell og arbeid). Poster med 0 kr krever eierens vurdering.
 * Kan endres under Innstillinger → Prisliste, eller ved å laste opp Excel-arket på nytt.
 */
export const PRICE_LIST_UVAAG: PriceList = {
  markup: 1.0,
  warranty: 1.05,
  vatRate: 0.25,
  source: 'Tilbudsberegning – mal.xlsx',
  items: [
    { id: "stikkontakt-2-uttak", group: "Generell installasjon", name: "Stikkontakt - 2 uttak", unitPrice: 800, unit: "stk" },
    { id: "stikkontakt-6-uttak", group: "Generell installasjon", name: "Stikkontakt - 6 uttak", unitPrice: 1800, unit: "stk" },
    { id: "lyspunkt-tak-vegg", group: "Generell installasjon", name: "Lyspunkt - Tak/vegg", unitPrice: 950, unit: "stk" },
    { id: "lyspunkt-downlights", group: "Generell installasjon", name: "Lyspunkt - Downlights", unitPrice: 1100, unit: "stk" },
    { id: "lyspunkt-utvendig", group: "Generell installasjon", name: "Lyspunkt - Utvendig", unitPrice: 950, unit: "stk" },
    { id: "fotocelle-astrour", group: "Generell installasjon", name: "Fotocelle/astrour", unitPrice: 2500, unit: "stk" },
    { id: "data-tv-2-uttak", group: "Generell installasjon", name: "Data/TV - 2 uttak", unitPrice: 2000, unit: "stk" },
    { id: "bryter", group: "Generell installasjon", name: "Bryter", unitPrice: 750, unit: "stk" },
    { id: "dimmer", group: "Generell installasjon", name: "Dimmer", unitPrice: 1000, unit: "stk" },
    { id: "thermostat-m-gulvfoler", group: "Generell installasjon", name: "Thermostat m/gulvføler", unitPrice: 1000, unit: "stk" },
    { id: "varmekabel-m2", group: "Generell installasjon", name: "Varmekabel - m2", unitPrice: 1000, unit: "m²" },
    { id: "varmefolie-m2", group: "Generell installasjon", name: "Varmefolie - m2", unitPrice: 750, unit: "m²" },
    { id: "baderomsvifte-m-fukt-og-bryter", group: "Generell installasjon", name: "Baderomsvifte m/fukt og bryter", unitPrice: 3600, unit: "stk" },
    { id: "komfyrvakt", group: "Generell installasjon", name: "Komfyrvakt", unitPrice: 3200, unit: "stk" },
    { id: "demontering-av-eksisterende", group: "Generell installasjon", name: "Demontering av eksisterende", unitPrice: 0, unit: "stk" },
    { id: "tilpassing-av-eksisterende", group: "Generell installasjon", name: "Tilpassing av eksisterende", unitPrice: 0, unit: "stk" },
    { id: "uforutsett", group: "Generell installasjon", name: "Uforutsett", unitPrice: 0, unit: "stk" },
    { id: "disc-290", group: "Belysning (ferdig montert)", name: "Disc 290", unitPrice: 2000, unit: "stk" },
    { id: "led-stripe-1000-per-meter", group: "Belysning (ferdig montert)", name: "LED-Stripe (1000,- per meter)", unitPrice: 3000, unit: "stk" },
    { id: "utelys-echo-nedlys", group: "Belysning (ferdig montert)", name: "Utelys Echo nedlys", unitPrice: 1250, unit: "stk" },
    { id: "utelys-echo-opp-nedlys", group: "Belysning (ferdig montert)", name: "Utelys Echo opp/nedlys", unitPrice: 1950, unit: "stk" },
    { id: "garasjelys-wave-120cm", group: "Belysning (ferdig montert)", name: "Garasjelys - Wave 120cm", unitPrice: 2050, unit: "stk" },
    { id: "sikringsskap-innvendig", group: "Teknisk", name: "Sikringsskap innvendig", unitPrice: 13000, unit: "stk" },
    { id: "kurser-15a-1-fas-ink-sikring", group: "Teknisk", name: "Kurser 15A 1- fas ink sikring", unitPrice: 2000, unit: "stk" },
    { id: "kurser-25a-1-fas-ink-sikring", group: "Teknisk", name: "Kurser 25A 1- fas ink sikring", unitPrice: 2500, unit: "stk" },
    { id: "tks-ink-16mm2-kabel-20m", group: "Teknisk", name: "TKS ink 16mm2 kabel 20m", unitPrice: 18000, unit: "stk" },
    { id: "ventilasjonsanlegg", group: "Teknisk", name: "Ventilasjonsanlegg", unitPrice: 8000, unit: "stk" },
    { id: "varmepumpe-luft-vann", group: "Teknisk", name: "Varmepumpe luft/vann", unitPrice: 40000, unit: "stk" },
    { id: "overspenningsvern-u-signalkont", group: "Teknisk", name: "Overspenningsvern u/signalkont.", unitPrice: 2000, unit: "stk" },
    { id: "signal-overspenningsvern", group: "Teknisk", name: "Signal overspenningsvern", unitPrice: 3000, unit: "stk" },
    { id: "ny-kursfortegnelse", group: "Teknisk", name: "Ny kursfortegnelse", unitPrice: 1500, unit: "stk" },
    { id: "hovedsikring", group: "Teknisk", name: "Hovedsikring", unitPrice: 2000, unit: "stk" },
    { id: "sikringsskap-hybel-lite-7-kurser", group: "Teknisk", name: "Sikringsskap Hybel lite - 7 kurser", unitPrice: 7000, unit: "stk" },
    { id: "tilf-sikringsskap-hybel-3g10-15m", group: "Teknisk", name: "Tilf. sikringsskap hybel - 3G10 - 15m", unitPrice: 4000, unit: "stk" },
    { id: "sikringsskap-ny-innmat-antall-kurser", group: "Teknisk", name: "Sikringsskap ny innmat - antall kurser", unitPrice: 1100, unit: "kurs" },
    { id: "soknad-elvia", group: "Administrasjon", name: "Søknad Elvia", unitPrice: 3000, unit: "stk" },
    { id: "prosjektering", group: "Administrasjon", name: "Prosjektering", unitPrice: 10000, unit: "stk" },
    { id: "dokumentasjon", group: "Administrasjon", name: "Dokumentasjon", unitPrice: 3000, unit: "stk" },
    { id: "annet", group: "Administrasjon", name: "Annet", unitPrice: 1000, unit: "stk" },
  ],
};
