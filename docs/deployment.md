# Secure deployment and operator setup

The authorized hosted project is Vercel `rivox-control` and Supabase `dsfnqlwhexcjqanwnklz`. All 17 application migrations and their history are applied. Production reached `READY` at `https://rivox-control.vercel.app`: login HTTP 200, anonymous APIs HTTP 401, cross-origin mutation HTTP 403 and invalid-account login HTTP 401. CSP, HSTS, `DENY` frame protection and `nosniff` were confirmed. This is an HTTPS/access-control smoke check, not a successful commercial-write test. Local development is optional and is not required for employees.

## Supabase

1. Use the private project `dsfnqlwhexcjqanwnklz` or a dedicated staging project first.
2. The current hosted project already has all migrations through `202611130019_production_verification.sql`, recorded in `supabase_migrations.schema_migrations`. Do not rerun the guarded first-install bundle against its occupied schema. Future changes must be forward migrations. There is no generic SQL endpoint in the app.
3. Disable public sign-ups. Only invitations issued by the Owner should create membership. Set a strong password policy, email verification, appropriate Supabase Auth rate limits, session lifetime, and TOTP MFA enrollment/verification. Owner/Admin access is denied until the JWT has `aal2`.
4. Site URL and exact redirects are configured for `https://rivox-control.vercel.app`. The default Supabase email provider restricts recipients to project-team addresses. General SMTP delivery requires an operator-configured provider; Owner-issued private employee links do not depend on SMTP.
5. The default provider's ordinary email link is supported: it opens the Owner setup page, clears the session fragment and asks for explicit acceptance before setting HTTP-only cookies. The original private setup tab then verifies the matching email before choosing a password. No email template customization is needed. With a custom SMTP provider, the following optional staff template also works:

   ```html
   <a
     href="{{ .SiteURL }}/account/setup#token_hash={{ .TokenHash }}&type=invite"
     >Accept your RIVOX invitation</a
   >
   ```

   Set `.SiteURL` to the exact HTTPS deployment origin. The local Mailpit flow also supports Supabase's standard session fragment after explicit user acceptance; it is converted to verified HTTP-only cookies. The legacy token-hash confirmation route remains compatible.

6. The intended Owner opens the operator's private, expiring setup handoff. The hosted mode requires `RIVOX_HOSTED_OWNER_SETUP=true`, `RIVOX_BOOTSTRAP_ENABLED=true`, an exact HTTPS origin, a strong private capability and an expiry of at most one hour. The user verifies their own email, chooses their own password/name and completes MFA. A verified session alone cannot claim ownership. `bootstrap_owner` remains server-only and single-Owner; no default identity is guessed.
7. Sign in to RIVOX. The Owner is sent to MFA setup, then back to the workspace after verification. Test with a second account before inviting the wider team.
8. Invite a trusted Admin reviewer. Access changes need a different authorized, MFA-verified reviewer; no requester or target may approve their own change. The sole Owner cannot bypass this control. Changes to that Admin require a different eligible reviewer.

## Environment bindings

Configure in the hosting provider's secure environment settings, never in tracked files:

| Binding                                | Usage                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://dsfnqlwhexcjqanwnklz.supabase.co`                                                              |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public browser-safe Supabase project key, not the service-role key                                      |
| `SUPABASE_SERVICE_ROLE_KEY`            | Restricted server operations: invitation, transactional sync, sanitized integration error recording     |
| `APP_ORIGIN`                           | Exact origin used for CSRF validation; no trailing path                                                 |
| `ELDORADO_CLIENT_ID`                   | Fresh seller API client ID                                                                              |
| `ELDORADO_CLIENT_SECRET`               | Optional environment alternative to the Owner connection form                                           |
| `INVENTORY_ENCRYPTION_KEY`             | Persistent raw 32-byte key encoded as 64 hex characters; required for inventory and saved integrations  |
| `CRON_SECRET`                          | App-generated private worker key, encrypted in Vercel and Supabase Vault; operator helper configures it |
| `RIVOX_DEV_MOCKS`                      | Defaults to false; true only for synthetic local development, always rejected in production             |

Proxy-backed bindings are valid only at their configured destinations; they are not raw values that can be copied to another host. The project's Supabase keys were configured in Vercel through its authorized Management API. Its inventory key was generated once and stored encrypted; preserve it across deployments. The Owner can now configure Eldorado directly in Settings after MFA, without modifying proxy bindings. The existing client ID is fixed by server configuration. An official order read must succeed before saving; failed checks preserve the prior connection. Browser roles have no table/RPC access to stored credentials. AES-256-GCM uses a purpose-derived key and binds the envelope to that client ID. Only the server can decrypt it. Never copy a proxy placeholder into a hosting variable or add duplicate secret bindings.

The Owner connection form clears the secret immediately after submission and retains no secret in React state, query/mutation caches or browser storage. Stored credentials take precedence over environment credentials. Other serverless instances may keep an already-issued token for up to its 15-minute lifetime; the client ID cannot be switched through this form. Retain and back up the encryption key securely. Changing or losing it makes previously encrypted inventory and integration data unreadable.

Rebuild after public binding changes and restart after server binding changes. The app deliberately has no form that displays integration secret values.

## Vercel

- Import the private GitHub repository with the Next.js framework preset. Use `npm ci`, `npm run build`, and the standard `.next` output.
- Set production and preview bindings separately. A preview must not silently inherit production seller credentials.
- Use HTTPS. Set `APP_ORIGIN` and the Supabase Site URL/redirect allowlist to the exact deployment origin.
- Configure durable monitoring and alerts for integration failures and missing audit records. Current logs are intentionally limited to event/error types; do not add request-body, token, or upstream-response logging.
- Apply migrations before promoting the application. Verify RLS and staff accounts against the real Supabase gateway.
- Ensure the static build was made with the intended public Supabase bindings. Production workspace pages require authentication even when configuration is missing; only the development setup preview is available without credentials.
- Configure the hosted scheduler using `scripts/configure-hosted-automation.py` after migrations and before deploying. It configures the encrypted worker key and the database dispatcher without enabling traffic. After deployment, use `--check-production` to verify the worker diagnostic from both the operator and database HTTP transport. See [hosted operations](hosted-operations.md).

For an operator to automate hosting and hosted migrations, configure `VERCEL_TOKEN` for `api.vercel.com` and `SUPABASE_ACCESS_TOKEN` for `api.supabase.com` in the environment's secure settings. These are provider administration credentials, separate from the Eldorado seller credentials and Supabase application API key. Never commit them or paste them into chat. Declaring these requirements does not create a deployment or grant access.

## Temporary HTTPS access

The first-Owner form also supports an explicitly enabled temporary HTTPS session backed by the isolated local Auth service. It requires `RIVOX_TEMPORARY_HTTPS_SETUP=true`, the exact canonical HTTPS `APP_ORIGIN`, a strong private bootstrap token, and an expiry of at most one hour. Hosted Supabase bootstrap remains disabled in this mode. The actual request Host and Origin must both match; forwarded-host headers cannot authorize setup.

A private `#setup=…` capability is removed from browser history immediately and held only in component memory. It is submitted in the same-origin JSON body, never in a request URL or browser storage. The operator still chooses their own account/password and completes MFA. This mechanism does not provide a tunnel, hosting, durable storage, public SMTP, or availability after the environment stops. Use a production build with secure cookies for any externally accessible instance.

The earlier isolated tunnel test was blocked before an address was issued. Hosted delivery uses the separately authorized Vercel project; no tunnel is required.

## Acceptance before commercial use

Verify actual sign-in, TOTP, invitation delivery, expired/revoked/disabled accounts, cross-user RLS, overrides, approval separation, SMTP failure reconciliation, atomic reservations, and backup/restore on a staging project. Configure scheduled database backups and document inventory-key rotation before storing delivery credentials.

Start Eldorado integration with an authorized read. Verify current order response/request contracts and pagination. Verify token refresh under the actual proxy. No delivery, cancellation, listing update, deletion, or bulk mutation should be used as a setup test.

This release is ready for controlled operator testing of the documented actions. No real commercial mutation was used as a setup probe. The intended Owner still needs verified-email activation/MFA and the secure Eldorado connection. It is a private single-seller workspace, not a multi-tenant subscription service; unsupported API families, sensitive gift-card imports and messaging remain outside the enabled scope. Review the implementation evidence before broader commercial use.

## Saved keys versus active runtime bindings

A credential stored in environment settings must also be saved and bound to the expected application variable name. A suggested configuration value is not proof that it has reached the running instance.

Check the names and presence only; never dump the process environment or copy credential values into logs/chat. This read-only diagnostic prints booleans:

```sh
node --input-type=module - <<'JS'
for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_ORIGIN']) {
  console.log(name + ': ' + Boolean(process.env[name]));
}
JS
```

If bindings are absent, verify the saved variable/secret names and complete saving the environment configuration before rebuilding or testing authentication. Do not rotate or duplicate keys solely because they have not appeared in the instance. A successful unauthenticated request returning HTTP 401 proves network reachability, not successful key authentication or database readiness.

## Hosted service restoration

On 2026-11-13, the existing Supabase project was INACTIVE. The authorized Management API restore returned 200 and the project reached ACTIVE_HEALTHY; schema and migration history were preserved. Free projects may pause after inactivity. A Vercel deployment cannot make an inactive database available; check project health before diagnosing login errors. No paid plan was enabled.
