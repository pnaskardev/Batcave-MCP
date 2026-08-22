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

## Supported versions

The project is pre-1.0 and only the `main` branch receives fixes.
