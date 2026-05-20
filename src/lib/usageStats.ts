const STORAGE_KEY = 'klinker-usage-v1'

/** Vienkartinė pradinė reikšmė — jau sugeneruotos šiandien prieš skaitiklį. */
const INITIAL_TODAY_COUNT = 6

/** Apytikslė kaina už vieną sėkmingą generavimą (USD). */
export const ESTIMATED_USD_PER_GENERATION = 0.04

export interface UsageStats {
  date: string
  todayCount: number
  estimatedUsdToday: number
}

function todayDateKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toStats(count: number, date: string): UsageStats {
  return {
    date,
    todayCount: count,
    estimatedUsdToday: Math.round(count * ESTIMATED_USD_PER_GENERATION * 100) / 100,
  }
}

function readStored(): { date: string; count: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { date?: string; count?: number }
    if (
      typeof parsed.date === 'string' &&
      typeof parsed.count === 'number' &&
      parsed.count >= 0
    ) {
      return { date: parsed.date, count: parsed.count }
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeStored(date: string, count: number): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date, count }))
}

/** Nuskaito šiandienos statistiką (be +1). */
export function getUsageStats(): UsageStats {
  const today = todayDateKey()
  const stored = readStored()

  if (stored?.date === today) {
    return toStats(stored.count, today)
  }

  if (!stored) {
    writeStored(today, INITIAL_TODAY_COUNT)
    return toStats(INITIAL_TODAY_COUNT, today)
  }

  writeStored(today, 0)
  return toStats(0, today)
}

/** Po sėkmingo generavimo — +1 šiandienai. */
export function formatPhotoCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} nuotrauka`
  if (mod10 >= 2 && mod10 <= 9 && (mod100 < 10 || mod100 >= 20)) {
    return `${n} nuotraukos`
  }
  return `${n} nuotraukų`
}

/** Po sėkmingo generavimo — +1 šiandienai. */
export function recordGeneration(): UsageStats {
  const today = todayDateKey()
  const stored = readStored()
  let count: number

  if (stored?.date === today) {
    count = stored.count + 1
  } else if (!stored) {
    count = INITIAL_TODAY_COUNT + 1
  } else {
    count = 1
  }

  writeStored(today, count)
  return toStats(count, today)
}
