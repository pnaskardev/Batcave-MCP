# Security

## Reporting a vulnerability

Report privately through GitHub's [security advisories][advisories] rather than opening a public
issue. Include what you did, what happened, and what you expected.

[advisories]: https://github.com/pnaskardev/Batcave-MCP/security/advisories/new

## What this server handles

Sessions hold **complete resumes** — names, phone numbers, email addresses, employment history —
stored as `jsonb` in Postgres. Treat the database as containing personal data, and treat a
connection string to it as a credential.

## Known limitations

These are properties of the current design, not bugs. Know them before you deploy it.

- **One shared bearer token.** `MCP_AUTH_TOKEN` authenticates the request but identifies nobody.
  Everyone holding it sees and can delete everyone's sessions through `list_sessions` and
  `delete_session`. There is no per-user isolation and no owner column on `resume_sessions`.
  Multi-tenant use needs both before anyone else's resume goes in.
- **The HTTP endpoint speaks plaintext.** It must run behind something that terminates TLS. The
  compose file publishes to `127.0.0.1` to make that hard to get wrong; exposing port 3000
  directly puts the token on the wire in clear text.
- **Nothing expires.** Sessions persist until `delete_session` removes them. There is no
  retention policy and no automatic purge.
- **`resume_path` reads the server's filesystem.** In a container that is the container's
  filesystem, which is why remote callers should pass text instead. Do not expose the HTTP
  endpoint to callers you would not grant read access to that path.

## Before you expose it

1. **Generate the token properly** — `openssl rand -hex 32`. The server refuses to start on
   anything under 32 characters, but a long guessable string still passes that check.
2. **Terminate TLS in front of it** and keep the app on `127.0.0.1:3000`. Confirm from off the
   box that port 3000 does not answer.
3. **Restrict the security group** to the clients you expect. For claude.ai that is
   `160.79.104.0/21`; port 3000 open to `0.0.0.0/0` is the same as publishing your sessions.
4. **Run `bun run preflight` on the box.** It boots the real entrypoint and checks that an
   anonymous request and a wrong token are both rejected before it reports ready.
5. **Keep the token out of URLs, shells, and chat.** It belongs in an instance secret or the
   shell profile. `/mcp?token=…` is rejected precisely so it never reaches a proxy log.
6. **Rotate with `export MCP_AUTH_TOKEN=… && docker compose up -d`.** That restarts the
   container; there is no revocation list and no overlap window where both tokens work.

`tests/http-auth.test.ts` is the executable version of the first point and runs in CI. Everything
else on this list is outside the repo and nothing here can verify it for you.

## Supported versions

The project is pre-1.0 and only the `main` branch receives fixes.
