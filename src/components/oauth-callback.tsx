import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import { appPath, appRoute } from '../lib/paths'

/** Handle the one-time callback explicitly so a failed exchange never leaves a blank/loading page. */
export function OAuthCallback({ children }: { children: ReactNode }) {
  const { signIn } = useAuthActions()
  const [code] = useState(() => appRoute() === '/player' ? new URLSearchParams(location.search).get('code') : null)
  const [status, setStatus] = useState<'pending' | 'done' | 'failed'>(code ? 'pending' : 'done')
  const started = useRef(false)
  useEffect(() => {
    if (!code || started.current) return
    started.current = true
    // Keep the short-lived code out of URLs and subsequent navigation/referrers.
    history.replaceState(null, '', appPath('/player'))
    // The SDK's OAuth code branch redeems this code with its stored verifier;
    // naming the provider keeps the public API typed without bypassing PKCE.
    void signIn('google', { code }).then(result => {
      setStatus(result.signingIn ? 'done' : 'failed')
    }).catch(() => setStatus('failed'))
  }, [code, signIn])

  if (status === 'done') return children
  return <main className="setup-loading" aria-live="polite">
    {status === 'pending' ? <>
      <LoaderCircle className="spin" />
      <h1>Je aanmelding wordt afgerond…</h1>
    </> : <>
      <h1>Aanmelden is niet gelukt.</h1>
      <p>De aanmeldlink is verlopen of al gebruikt. Probeer opnieuw met je Google-account.</p>
      <Button onClick={() => location.assign(appPath('/player'))}>Opnieuw aanmelden</Button>
    </>}
  </main>
}
