# Secure deployment and operator setup

This is a release checklist, not a claim that deployment has occurred. No Vercel deployment or hosted database migration has been performed.

## Supabase

1. Use the private project `dsfnqlwhexcjqanwnklz` or a dedicated staging project first.
2. Apply all SQL files in `supabase/migrations` in filename order using Supabase CLI migrations or the project's SQL Editor. Do not expose a generic SQL endpoint in the app. Local migration tests do not prove hosted application.
3. Disable public sign-ups. Only invitations issued by the Owner should create membership. Set a strong password policy, email verification, appropriate Supabase Auth rate limits, session lifetime, and TOTP MFA enrollment/verification. Owner/Admin access is denied until the JWT has `aal2`.
4. Configure production SMTP and allowed redirect URLs for the exact application origin. No email provider credentials are needed by the app; Supabase handles delivery.
5. Set the invitation email template link to the supported token-hash confirmation flow:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite"
     >Accept your RIVOX invitation</a
   >
   ```

   Set `.SiteURL` to the exact HTTPS deployment origin. Do not use an implicit access-token-in-URL flow with this server-cookie implementation.

6. Create and verify the initial Owner Auth user in the Supabase dashboard. Then, in the SQL Editor, call `public.bootstrap_owner` with that user's UUID, email, and display name. This function is executable only by `service_role`/database administrators, succeeds only once, and creates an audit entry. Do not grant it to `authenticated` or `anon`.
7. Sign in to RIVOX. The Owner is sent to MFA setup, then back to the workspace after verification. Test with a second account before inviting the wider team.
8. Invite a trusted Admin reviewer. Access changes need a different authorized, MFA-verified reviewer; no requester or target may approve their own change. The sole Owner cannot bypass this control. Changes to that Admin require a different eligible reviewer.

## Environment bindings

Configure in the hosting provider's secure environment settings, never in tracked files:

| Binding                                | Usage                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://dsfnqlwhexcjqanwnklz.supabase.co`                                                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public browser-safe Supabase project key, not the service-role key                                                |
| `SUPABASE_SERVICE_ROLE_KEY`            | Restricted server operations: invitation, transactional sync, sanitized integration error recording               |
| `APP_ORIGIN`                           | Exact origin used for CSRF validation; no trailing path                                                           |
| `ELDORADO_CLIENT_ID`                   | Fresh seller API client ID                                                                                        |
| `ELDORADO_CLIENT_SECRET`               | Fresh seller API client secret                                                                                    |
| `ELDORADO_CURSOR_PARAMETER`            | Optional verified official cursor request parameter; absent disables subsequent upstream pages                    |
| `INVENTORY_ENCRYPTION_KEY`             | Optional raw 32-byte key encoded as 64 hex characters; requires secure runtime injection, not a proxy placeholder |
| `RIVOX_DEV_MOCKS`                      | Defaults to false; true only for synthetic local development, always rejected in production                       |

The cloud draft declares the Supabase service credential only for the supplied project's HTTPS hostname. An injected proxy binding is appropriate for HTTPS authentication. It is not suitable for a raw PostgreSQL connection password or a local encryption key. Do not infer missing credentials solely from CLI login status.

Rebuild after public binding changes and restart after server binding changes. The app deliberately has no form that displays integration secret values.

## Vercel

- Import the private GitHub repository with the Next.js framework preset. Use `npm ci`, `npm run build`, and the standard `.next` output.
- Set production and preview bindings separately. A preview must not silently inherit production seller credentials.
- Use HTTPS. Set `APP_ORIGIN` and the Supabase Site URL/redirect allowlist to the exact deployment origin.
- Configure durable monitoring and alerts for integration failures and missing audit records. Current logs are intentionally limited to event/error types; do not add request-body, token, or upstream-response logging.
- Apply migrations before promoting the application. Verify RLS and staff accounts against the real Supabase gateway.
- Ensure the static build was made with the intended public Supabase bindings. The setup-only workspace is intentionally visible without credentials and contains no live data.

## Acceptance before commercial use

Verify actual sign-in, TOTP, invitation delivery, expired/revoked/disabled accounts, cross-user RLS, overrides, approval separation, SMTP failure reconciliation, atomic reservations, and backup/restore on a staging project. Configure scheduled database backups and document inventory-key rotation before storing delivery credentials.

Start Eldorado integration with an authorized read. Verify current order response/request contracts and pagination. Verify token refresh under the actual proxy. No delivery, cancellation, listing update, deletion, or bulk mutation should be used as a setup test.

The app must not be called production-ready until the pending contracts, real integration tests, external operation execution/recovery, messaging authorization, and operational controls listed in the status document are resolved.

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
