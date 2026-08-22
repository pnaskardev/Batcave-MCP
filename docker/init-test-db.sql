-- Runs once, the first time the Postgres volume is created.
-- Tests get their own database: the end-to-end suite drops its tables on teardown, which would
-- otherwise wipe the schema out from under a dev server that is already running.
CREATE DATABASE batcave_test;
