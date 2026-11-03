# LeetCode-Style Practice Management System

**Team 24 · MC212 Database Management Systems · DA-IICT**

A LeetCode-style programming practice platform backed by PostgreSQL.

## Current implementation

- **Phase 1 complete:** browser → Express → PostgreSQL connectivity verified with `SELECT version()`.
- **Phase 2 in progress:** problem listing, search/filter, create, edit and safe retirement.
- Stack: Node.js 20+, Express, PostgreSQL (`pg`), HTML/CSS and browser JavaScript.

## Local setup

1. Use the existing PostgreSQL database named `leetcode`.
2. Copy `.env.example` to `.env` and set your local database password.
3. Set `DEV_ORGANIZER_ID` to an existing organizer ID. This is a temporary local development identity until login and server-side authorization are implemented.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open http://127.0.0.1:3000.

## Apply the database migration

Take a database backup first. Then run the migration once:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/001_problem_crud.sql
```

The migration adds `problem_statement` and identity generation for `problem_id` starting at 81. It does not delete or recreate existing rows or foreign-key relationships. Review the SQL before running it.

## Problem API

- `GET /api/problems` — list active problems.
- `GET /api/problems?includeInactive=true` — include retired problems (local development UI).
- `GET /api/problems/:id` — get one problem.
- `POST /api/problems` — create a problem.
- `PUT /api/problems/:id` — update a problem.
- `PATCH /api/problems/:id/retire` — retire a problem without deleting related history.

Database access uses parameterized queries. The database unique constraint remains authoritative for duplicate titles.

## Important security limitation

This is a localhost-only development build. The temporary `DEV_ORGANIZER_ID` setting is **not authentication or authorization**. Do not deploy this application or expose it to a network as a multi-user service until login, server-side role/ownership checks and a restricted database account are implemented. Do not commit `.env`, passwords or API tokens.

The migration is incremental. Never run the old `schema_with_data_fixed.sql` against the populated database; it contains destructive DROP ... CASCADE statements.
