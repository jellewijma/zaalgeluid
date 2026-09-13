import { test, expect } from '@playwright/test'

test('login exposes only configured methods and keeps the password fallback keyboard accessible', async ({ page }, info) => {
  await page.goto('player')
  await expect(page.getByRole('heading', { name: 'Meld je aan op de pc.' })).toBeVisible()
  await expect(page.getByText('Aanmeldopties laden…', { exact: true })).toHaveCount(0)
  const google = page.getByRole('button', { name: 'Doorgaan met Google', exact: true })
  if (await google.isVisible()) {
    await expect(google).toBeEnabled()
    await expect.poll(() => google.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.getByLabel('Gebruikersnaam', { exact: true })).toBeHidden()
    await page.getByRole('link', { name: 'Terug', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(google).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.password-login summary')).toBeFocused()
    await page.keyboard.press('Enter')
  } else {
    await expect(page.getByText('Google-aanmelding wordt nog ingesteld.', { exact: true })).toBeVisible()
  }
  await expect(page.getByLabel('Gebruikersnaam', { exact: true })).toBeVisible()
  await page.getByLabel('Wachtwoord', { exact: true }).fill('incorrect-test-password')
  await page.getByRole('button', { name: 'Aanmelden', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Controleer je gebruikersnaam en wachtwoord')
  await expect(page.getByRole('button', { name: 'Aanmelden', exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('google-login-mobile.png'), fullPage: true })
})

test('cancelled Google sign-in shows a safe message and can be retried', async ({ page }) => {
  await page.goto('player?error=access_denied&error_description=%3Cscript%3Euntrusted-provider-message%3C%2Fscript%3E')
  await expect(page.getByRole('alert')).toHaveText('De Google-aanmelding is geannuleerd. Je kunt het opnieuw proberen.')
  await expect(page.getByText('untrusted-provider-message', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Aanmeldopties laden…', { exact: true })).toHaveCount(0)
  const google = page.getByRole('button', { name: 'Doorgaan met Google', exact: true })
  test.skip(!await google.isVisible(), 'Google OAuth is not configured on this backend yet.')
  // Observe the real redirect chain. Intercepting a later hop in an HTTP redirect
  // chain does not reliably replace Google's document in browser routing.
  const bridgeRequest = page.waitForRequest(request => {
    const url = new URL(request.url())
    return request.isNavigationRequest() && url.hostname.endsWith('.convex.site') && url.pathname === '/api/auth/signin/google'
  })
  const googleRequest = page.waitForRequest(request => {
    const url = new URL(request.url())
    return request.isNavigationRequest() && url.hostname === 'accounts.google.com' && url.searchParams.has('redirect_uri') && url.searchParams.has('client_id')
  })
  await google.focus()
  await page.keyboard.press('Enter')
  const [bridge, authorization] = await Promise.all([bridgeRequest, googleRequest])
  const bridgeURL = new URL(bridge.url())
  const parameters = new URL(authorization.url()).searchParams
  expect(bridgeURL.protocol).toBe('https:')
  expect(parameters.get('redirect_uri')).toBe(new URL('/api/auth/callback/google', bridgeURL.origin).href)
  expect(parameters.get('response_type')).toBe('code')
  expect(parameters.get('scope')?.split(/\s+/).sort()).toEqual(['email', 'openid', 'profile'])
  expect(parameters.get('prompt')).toBe('select_account')
  expect(parameters.get('code_challenge_method')).toBe('S256')
  // Only assert lengths so failed tests never print state, nonce or PKCE values.
  expect(parameters.get('code_challenge')?.length ?? 0).toBeGreaterThanOrEqual(43)
  expect(parameters.get('state')?.length ?? 0).toBeGreaterThan(0)
  expect(parameters.get('nonce')?.length ?? 0).toBeGreaterThan(0)
  expect(parameters.has('code_verifier')).toBe(false)
  await expect(page).toHaveURL(url => url.hostname === 'accounts.google.com')
})

test('a new room pairing link does not reuse another room or legacy controller token', async ({ page }) => {
  await page.goto('control?room=room-new')
  const storagePrefix = await page.evaluate(() => location.pathname.replace(/\/control$/, '/zaalgeluid-cloud-controller'))
  await page.evaluate(prefix => {
    sessionStorage.setItem(prefix, 'legacy-controller-session')
    sessionStorage.setItem(`${prefix}:room-other`, 'other-controller-session')
  }, storagePrefix)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Neem de bediening over.' })).toBeVisible()
  await expect(page.getByLabel('Koppelcode', { exact: true })).toBeFocused()
  expect(await page.evaluate(prefix => ({
    legacy: sessionStorage.getItem(prefix),
    other: sessionStorage.getItem(`${prefix}:room-other`),
    current: sessionStorage.getItem(`${prefix}:room-new`),
  }), storagePrefix)).toEqual({ legacy: 'legacy-controller-session', other: 'other-controller-session', current: null })
})

test('an invalid OAuth callback code shows recovery instead of hanging on authentication', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('player?code=invalid-oauth-test-code')
  await expect(page.getByRole('heading', { name: 'Aanmelden is niet gelukt.', exact: true })).toBeVisible()
  await expect(page).toHaveURL(url => !url.searchParams.has('code'))
  await expect(page.getByText('De aanmeldlink is verlopen of al gebruikt. Probeer opnieuw met je Google-account.')).toBeVisible()
  await page.getByRole('button', { name: 'Opnieuw aanmelden', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Meld je aan op de pc.', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
