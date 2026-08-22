## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem. Link an issue if there is one. -->

## What breaks if this is wrong

<!-- More useful to a reviewer than a description of the happy path. -->

## Checks

- [ ] `bun run check` and `bun run typecheck` pass
- [ ] `bun test` passes with `TEST_DB_URL` set
- [ ] New behaviour has a test; a bug fix has a test that fails without the fix
- [ ] Schema changes are a **new** migration, not an edit to one that already shipped
