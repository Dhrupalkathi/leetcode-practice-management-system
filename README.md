# LeetCode-Style Practice Management System

**Team 24 · MC212 Database Management Systems · DA-IICT**

A LeetCode-style programming practice and technical-assessment platform backed by PostgreSQL.

## Implemented modules

- **Accounts and roles:** seeded-user login, automatic legacy SHA-256-to-Argon2id migration, self-service Learner L1 registration, PostgreSQL-backed sessions, and Admin account/role controls.
- **Problem library:** title search, difficulty/topic filtering, problem detail pages, public sample cases, and hidden-test confidentiality.
- **Problem lifecycle:** Organizer create/edit/retire with topic tagging, public sample and hidden test-case authoring, immutable test data after submissions exist, Reviewer inspection/approval, changes-requested and rejection decisions, publication status and review history.
- **Code editor and judge:** supported-language selector, Run samples, Submit solution, asynchronous Judge0 execution, verdicts, per-test outcomes, runtime/memory metrics and personal submission history.
- **Learner progress:** solved/attempted counts, acceptance rate, streak, daily activity, topic performance, language usage and recent practice.
- **Contests:** schedule, Organizer/Admin setup, Moderator problem-set management, Learner registration, contest-linked submissions, configurable score/penalty and leaderboard, plus Judge result reviews.
- **Company assessments:** organization-scoped setup, invitations, time window and personal timer, candidate-only workspace/history, aggregate post-assessment reports and human-review activity indicators.
- **Role services:** Mentor feedback, Support tickets and queue, Admin user/role management, aggregate platform/assessment reporting, audit history, and suspicious-activity review.
- Parameterized SQL, server-side validation and authorization, rate limits, Helmet, secure session-cookie settings and generic API errors.

## Existing role structure

The database's 80 role records are retained: Learner L1–L10, Organizer L1–L10, Moderator L1–L10, Reviewer L1–L10, Mentor L1–L10, Judge L1–L10, Admin L1–L10 and Support L1–L10. Public registration can create only Learner L1; elevated roles are assigned by an Admin.

Authorization is enforced by role category and ownership where implemented. The supplied SRS access matrix is category-level; distinct permissions between L1–L10 have not been defined as separate business rules in the current SRS, so the application does not invent level-specific privilege differences.

## Local setup

1. Use the existing PostgreSQL database named `leetcode`.
2. Copy `.env.example` to `.env` and enter the local database password.
3. Generate a session secret with `openssl rand -hex 32` and set `SESSION_SECRET` in `.env`.
4. Take a backup, then apply the migrations once and in order (see below).
5. Install and run:

   ```bash
   npm install
   npm run dev
   ```

6. Open http://127.0.0.1:3000.

## Database migrations

Apply each incremental migration once, in numeric order. These extend the populated database without re-seeding it:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/001_problem_crud.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/002_auth_sessions.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/003_submissions_judge0.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/004_contest_submissions.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/005_company_assessments.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/006_user_registration.sql
psql -h 127.0.0.1 -p 5432 -U postgres -d leetcode -W -v ON_ERROR_STOP=1 -f database/migrations/007_governance_workflows.sql
```

- Migration 001 adds `problem_statement` and identity generation for new problem IDs beginning at 81.
- Migration 002 widens the password hash field and creates the PostgreSQL session table.
- Migration 003 adds asynchronous execution state, exact Judge0 language mappings, submission ID generation and per-test outcomes.
- Migration 004 links future submissions to contests, adds contest creator attribution and configurable scoring fields.
- Migration 005 adds organization ownership for assessments, invitation token hashes/expiry and candidate-linked submissions.
- Migration 006 adds identity generation for future user IDs without changing seeded users.
- Migration 007 adds problem review status/history, Mentor feedback, Support tickets, Judge reviews, suspicious-activity indicators and audit history.

**Never run `schema_with_data_fixed.sql` against the populated database.** It contains destructive `DROP TABLE ... CASCADE` statements.

## Demo accounts

The original lab seed generator used the password `pw` followed by the user ID and stored an unsalted SHA-256 digest. For example, the local demo pattern for user ID 82 is `pw82`. These predictable credentials are for the academic seed only and must never be used in a deployed service.

On the first successful legacy login, the application verifies SHA-256 and upgrades that account to Argon2id. New public registrations use Argon2id immediately. Never commit `.env`, actual passwords, hashes, database dumps or API tokens.

## API overview

**Accounts and problems**
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `GET /api/topics`, `GET /api/problems`, `GET /api/problems/:id`.
- `POST /api/problems`, `PUT /api/problems/:id`, `PATCH /api/problems/:id/retire` — Organizer content lifecycle.
- `GET /api/problems/review-queue`, `GET /api/problems/:id/reviews`, `POST /api/problems/:id/reviews` — Reviewer/Admin governance.

**Submissions and learner progress**
- `GET /api/languages` — exact language versions available on the configured Judge0 provider.
- `POST /api/submissions` — asynchronous public-sample run or full submission (including hidden tests).
- `GET /api/submissions`, `GET /api/submissions/:id` — the signed-in user's own history and results.
- `GET /api/progress/me` — Learner practice statistics and activity.

**Contests**
- `GET /api/contests`, `GET /api/contests/:id`, `GET /api/contests/:id/leaderboard`.
- `POST /api/contests`, `PUT /api/contests/:id` — Organizer/Admin setup and upcoming-contest editing.
- `POST /api/contests/:id/register` — Learner registration before contest start.
- `POST /api/contests/:id/problems`, `DELETE /api/contests/:id/problems/:problemId` — Organizer/Admin/Moderator problem-set changes before contest start.
- `GET /api/judge/contests/:id/reviews`, `POST /api/judge/contests/:id/reviews` — Judge/Admin result validation after a contest ends.

Contest score defaults to 100 points per solved problem. Each wrong full submission before first acceptance adds 5 penalty minutes. Organizer/Admin can configure both values and optionally include elapsed minutes from contest start to first acceptance. The leaderboard ranks by score descending, then penalty ascending.

**Company assessments and role services**
- `GET /api/organizations`, `GET /api/assessments`, `POST /api/assessments`, `PUT /api/assessments/:id`.
- `POST /api/assessments/:id/invitations`, `GET /api/assessments/:id/report`.
- Candidate token routes under `/api/candidate-assessment` support invitation verification, start, assigned problems, candidate submissions/history, activity indicators and finish.
- `POST /api/mentor/feedback`, `GET /api/mentor/feedback` — Mentor feedback and Learner feedback history.
- `/api/support/tickets` — ticket creation, own-ticket history and Support/Admin queue updates.
- `/api/admin/users`, `/api/admin/audit`, `/api/admin/reports` — Admin account/role management, audit history, aggregate usage metrics, popular/low-success practice problems, daily practice activity, and assessment participation summaries.
- `/api/assessments/:id/suspicious-activity` — organization-scoped human review of candidate activity signals.

## Company assessments

Organizer accounts manage assessments for the organization attached to their Organizer profile. Admin accounts can choose an organization. Each assessment has a time window, a personal time limit and an ordered set of active problems.

An invitation creates or reuses a Candidate record and stores only a SHA-256 hash of a random invitation token. The raw token is returned once to the Organizer. Candidates open `/assessment.html#token=...`; the frontend sends the token in an Authorization header. The token expires three days after the assessment end time. A candidate can start only during the assessment window, and the effective deadline is the earlier of the assessment end time or personal time limit.

Candidate submissions are stored against `candidate_id` and `assessment_id`, not a platform user account. Candidate-facing APIs return public sample cases only and scope history to the invitation. Organizer/Admin reports are aggregate-only and do not return source code.

Candidate browser events such as tab-hidden, window-blur, copy and paste may be recorded as review indicators. They are not automatically classified as cheating; an authorized Organizer/Admin must review or dismiss them. Clipboard contents are not stored.

**Invitation delivery:** This build generates a one-time invitation URL for an Organizer to copy and share manually; automatic email delivery is not configured. Set `APP_BASE_URL` to a candidate-reachable URL when using another device. HTTPS and deployment networking must be configured separately.

**Legacy assessment ownership:** Existing assessment rows were not assigned an organization by inference. They remain Admin-visible until a valid organization is assigned.

## Code execution provider

The default development configuration uses hosted Judge0 CE at `https://ce.judge0.com`. Set `JUDGE0_BASE_URL` to a self-hosted Judge0 endpoint for a private environment; set `JUDGE0_AUTH_TOKEN` only when that deployment requires it. The language selector offers only seeded versions that exactly match names exposed by the configured provider.

**Privacy:** Hosted Judge0 receives submitted source code and relevant test-case input/expected output. Use a self-hosted Judge0 deployment before processing company-confidential assessments, private problems or sensitive candidate data. CPU, wall-time and memory limits are configurable through `JUDGE0_*` environment variables.

## Security scope and limitations

This is a local academic development build. It includes parameterized SQL, server-side validation and role-category checks, ownership checks for organization-scoped assessment and contest operations, password hashing, PostgreSQL sessions, rate limiting, Helmet and Origin checks on browser state-changing requests.

Role-category routes are implemented for the main Learner, Organizer, Moderator, Reviewer, Mentor, Judge, Admin and Support workflows. The exact fine-grained differences between L1–L10 are not defined in the supplied SRS access matrix; do not claim distinct level-based privileges beyond the category rules that are implemented.

Do not deploy or expose this application until the final test plan is executed, production HTTPS and database credentials are configured, the code-execution worker is isolated and privately hosted where required, and any remaining deployment controls are completed.

## Final verification

`docs/FINAL_TEST_PLAN.md` is the authoritative test register. It documents what to test, why, how, expected results and the ordered final execution sequence. Per the project workflow, execute the full test plan after functionality development is complete; do not treat code presence or syntax review as functional verification.

