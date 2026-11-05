# Discord authorisation setup

In the Discord Developer Portal, open Cyrene's application and add this OAuth2 redirect:

`https://cyrene-teyvat.xyz/auth/discord/callback`

Set these server environment variables:

- `DISCORD_CLIENT_ID`: Cyrene's application ID.
- `DISCORD_CLIENT_SECRET`: the OAuth2 client secret (not the bot token).
- `DISCORD_REDIRECT_URI`: the exact registered redirect URL above.

The existing `HOYOLAB_ENCRYPTION_KEY` encrypts stored access and refresh tokens and protects the short-lived authorisation cookie. Keep it stable across deployments and workers. Restart Cyrene to create `web_discord_oauth` through the normal database initialiser.

The verification box always shows **Authorise with Discord**. All three OAuth2 variables must be configured for authorisation to work; until then, clicking the button displays an availability message and leaves code verification usable. The button requests only `identify`, which permits reading the account's ID, username, display name and avatar. It does not request email, guild membership or messages.

Successful authorisation uses the same Discord user ID and session mechanism as `/verify`, so existing Genshin accounts and Reminders data remain associated with that identity. Authorising another Discord account switches the web session only after success; it does not transfer data between accounts.

Opening Connect Discord refreshes the authorised profile and rotates expired access tokens on the server. If Discord is unavailable or consent was revoked, the last saved profile remains visible. Authorise again to renew revoked access. Disconnecting signs out the current browser session; Discord authorisation can separately be revoked under Discord's Authorized Apps settings.

Use HTTPS for testing: the authorisation and session cookies are Secure. Test a successful grant, cancellation, profile changes, expired-token refresh, and switching between two accounts against the configured application before deploying.
