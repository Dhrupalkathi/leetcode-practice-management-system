# LeetCode-Style Practice Management System

**Team 24 · MC212 Database Management Systems · DA-IICT**

A LeetCode-style programming practice platform backed by PostgreSQL.

## Implemented

- PostgreSQL connectivity through Express.
- Problem listing, title search, difficulty and topic filtering, full problem details, topic labels and public sample-test display.
- Problem create, update and safe retirement.
- Code editor with Run samples and Submit solution using asynchronous Judge0 execution.
- Per-user submission history, test-result summaries, verdict, execution time and peak memory.
- Learner dashboard with solved/attempted counts, acceptance rate, practice streak, 30-day activity, topic performance, language usage and recent practice history.
- Contest schedule, Organizer/Admin contest setup, Learner registration, live contest problem access, contest-linked submissions, automatic scoring and leaderboard.
- Contest schedule, Organizer/Admin contest setup, Learner registration, live contest problem access, contest-linked submissions, automatic scoring and leaderboard.
- Parameterized SQL queries and server-side input validation.
- Login/logout using the existing USERS and ROLE tables.
- PostgreSQL-backed sessions with HttpOnly, SameSite cookies.
- Legacy unsalted SHA-256 lab-hash verification and upgrade to Argon2id after successful login.
- Role-category authorization based on the existing role names (e.g. Organizer L1 ... Organizer L10). Existing role records are retained.

## Local setup

1. Use the existing PostgreSQL database named `leetcode`.
2. Copy `.env.example` to `.env` and enter your local database password.
3. Generate a session secret with `openssl rand -hex 32` and set `SESSION_SECRET` in `.env`.
4. Apply the database migrations in order (see below).
5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

6. Open http://127.0.0.1:3000.

## Database migrations

Take a backup before applying migrations. Run each migration once:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/001_problem_crud.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/002_auth_sessions.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/003_submissions_judge0.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/004_contest_submissions.sql
```

Migration 001 adds `problem_statement` and identity generation for `problem_id` beginning at 81. Migration 002 widens `users.password_hash` from CHAR(64) to VARCHAR(255) without changing existing hash values, and creates the PostgreSQL session table. Migration 003 adds asynchronous execution state, Judge0 language mappings, submission identity generation, and per-test outcome storage without deleting historical submissions. Migration 004 adds optional contest linkage for new submissions, contest identity generation, creator attribution, and allows Admin-created contests without an Organizer subtype record. Previous submissions remain ordinary practice records.

## Demo login

The original lab seed generator used the password `pw` followed by the user ID, then stored an unsalted SHA-256 digest. For example, the demo password pattern for user ID 82 is `pw82`. Use the email belonging to that seeded user.

On a successful legacy login, the server verifies SHA-256 and immediately replaces that user's stored hash with an Argon2id hash. New/changed passwords must use Argon2id. These predictable credentials are strictly for the local academic demo and must never be used in a deployed service.

## API

- `GET /api/topics` — list available problem topics.
- `GET /api/problems` — list active problems with assigned topic metadata.
- `GET /api/problems/:id` — full problem details, topics and public sample tests (hidden test cases are excluded).
- `GET /api/problems?includeInactive=true` — include retired problems for signed-in users.
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `POST /api/problems`, `PUT /api/problems/:id`, `PATCH /api/problems/:id/retire` — Organizer role category only.
- `GET /api/languages` — seeded language versions available on the configured Judge0 provider.
- `POST /api/submissions` — asynchronous sample run (`action: run`) or full hidden-test submission (`action: submit`).
- `GET /api/submissions` and `GET /api/submissions/:id` — signed-in user's own submission history and result details.
- `GET /api/progress/me` — signed-in Learner's aggregate practice dashboard, activity, topic and language metrics.
- `GET /api/contests`, `GET /api/contests/:id` — public contest schedule and details (upcoming problem lists are protected).
- `POST /api/contests`, `PUT /api/contests/:id` — Organizer/Admin contest setup and upcoming-contest editing.
- `POST /api/contests/:id/register` — Learner registration before contest start.
- `GET /api/contests/:id/leaderboard` — public standings.

Contest scoring is explicit: 100 points per problem with an accepted full submission, plus 5 penalty points per wrong full submission before the first accepted solution. Score ranks descending, then penalty ascending.
- `GET /api/contests`, `GET /api/contests/:id` — public contest schedule and details.
- `POST /api/contests`, `PUT /api/contests/:id` — Organizer/Admin contest setup and upcoming-contest editing.
- `POST /api/contests/:id/register` — Learner registration before contest start.
- `GET /api/contests/:id/leaderboard` — public standings.

Contest scoring is explicit: 100 points per problem with an accepted full submission, plus 5 penalty points per wrong full submission before the first accepted solution. Score ranks descending, then penalty ascending.

## Code execution provider

The default development configuration uses the hosted Judge0 CE endpoint at `https://ce.judge0.com`. Set `JUDGE0_BASE_URL` to a self-hosted Judge0 endpoint for a private environment; set `JUDGE0_AUTH_TOKEN` only when the configured deployment requires it. The language selector is limited to seeded database versions that exactly match language names exposed by the current Judge0 instance. Other seeded versions are not offered for execution until an exact provider mapping is configured.

**Privacy:** When using hosted Judge0, submitted source code and relevant test-case input/expected output are sent to that external execution service. Use a self-hosted Judge0 deployment before processing company-confidential assessments, private problems, or sensitive candidate data. Keep the Judge0 endpoint and any authentication token private. CPU, wall-time, and memory limits are configurable through the `JUDGE0_*` environment variables.

## Security scope and limitations

This is a localhost-only academic development build. The app uses parameterized SQL, server-side role checks, rate-limited login, Argon2id for upgraded credentials, PostgreSQL-backed sessions, HttpOnly/SameSite cookies, Origin checks on browser state-changing requests, Helmet and generic API errors.

The legacy SHA-256 hashes are unsalted and intentionally supported only to migrate the seeded lab accounts. They are not acceptable for new password storage. The predictable `pw + user_id` demo passwords are not production credentials.

The current authorization implementation uses the eight existing role categories by their role-name prefix; problem management is restricted to Organizer. Detailed per-level permission differences, full Admin/Moderator/Reviewer/Mentor/Judge/Support workflows, account registration and password reset still need implementation against the final SRS access matrix. Do not describe these unimplemented workflows as complete.

Do not deploy this application or expose it to a network until remaining SRS permissions, account recovery, HTTPS deployment settings, restricted database credentials and full security testing are completed. Never commit `.env`, database dumps, actual passwords or API tokens.

Never run the old `schema_with_data_fixed.sql` against the populated database; it contains destructive DROP ... CASCADE statements.
