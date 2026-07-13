/** Maps internal/technical errors to client-friendly Lithuanian messages. */
export function formatUserError(message: string): string {
  const m = message.toLowerCase()

  if (message.includes('atšaukt')) return message
  if (message.includes('užtruko')) return message
  if (message.includes('tą patį vaizdą') || m.includes('google')) {
    return 'Nepavyko pakeisti fasado. Naudokite aiškią pastato nuotrauką (ne ekrano nuotrauką iš žemėlapio).'
  }
  if (m.includes('413') || m.includes('per didel') || m.includes('payload')) {
    return 'Nuotrauka per didelė. Bandykite mažesnę nuotrauką arba generuokite dar kartą.'
  }
  if (m.includes('gemini') || m.includes('api raktas') || m.includes('.env')) {
    return 'Paslauga laikinai nepasiekiama. Bandykite vėliau.'
  }
  if (m.includes('saugumo filtras') || m.includes('safety') || m.includes('blocklist')) {
    return 'Nepavyko sugeneruoti šiai nuotraukai. Bandykite kitą nuotrauką.'
  }
  if (m.includes('webgl') || m.includes('canvas')) {
    return 'Jūsų naršyklė nepalaiko šios funkcijos. Bandykite naujesnę naršyklę.'
  }
  if (m.includes('429') || m.includes('quota') || m.includes('rate limit')) {
    return 'Per daug užklausų. Palaukite minutę ir bandykite dar kartą.'
  }
  if (m.includes('timeout') || m.includes('network') || m.includes('failed to fetch')) {
    return 'Nepavyko prisijungti. Patikrinkite interneto ryšį ir bandykite dar kartą.'
  }
  if (m.includes('generavimas nepavyko') || m.includes('di grąžino')) {
    return 'Nepavyko sugeneruoti vizualizacijos. Bandykite dar kartą arba pasirinkite kitą nuotrauką.'
  }

  return 'Įvyko klaida. Bandykite dar kartą.'
}
