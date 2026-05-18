export class FetchTimeoutError extends Error {
  constructor(seconds: number) {
    super(`Užklausa užtruko (>${seconds} s). Bandykite dar kartą po kelių sekundžių.`)
    this.name = 'FetchTimeoutError'
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 60_000, signal: outerSignal, ...rest } = init ?? {}
  const controller = new AbortController()

  const onOuterAbort = () => controller.abort()
  outerSignal?.addEventListener('abort', onOuterAbort)

  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (outerSignal?.aborted) {
        throw new Error('Generavimas atšauktas.')
      }
      throw new FetchTimeoutError(Math.round(timeoutMs / 1000))
    }
    throw e
  } finally {
    window.clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
  }
}
