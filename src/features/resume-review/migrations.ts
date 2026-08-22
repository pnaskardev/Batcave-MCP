import type { Migration } from "../../module";

export const migrations: readonly Migration[] = [
  {
    id: "0001-sessions-and-stages",
    sql: `create table if not exists resume_sessions (
            id text primary key,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            company text not null,
            role text not null,
            resume jsonb not null,
            job_description jsonb not null
          );
          create table if not exists resume_stages (
            session_id text not null references resume_sessions(id) on delete cascade,
            stage text not null,
            status text not null,
            issued_at timestamptz not null,
            completed_at timestamptz,
            result jsonb,
            primary key (session_id, stage)
          );
          create index if not exists resume_sessions_updated_at_idx
            on resume_sessions (updated_at desc);`,
  },
];
