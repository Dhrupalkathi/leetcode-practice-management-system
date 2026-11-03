# Final Test Plan — LeetCode-Style Practice Management System

Team 24 · MC212 DBMS · DA-IICT

## Rule for this plan

This is the single test register for the finished website. For every test it records what to test, why it matters, how to perform it, and the expected result. Tests are deliberately scheduled for the final verification phase after all website functionality has been implemented. Do not interrupt feature development to execute this plan. Add cases whenever a new module is built.

A feature is not considered tested just because its page or API route exists. During final verification, exercise the browser workflow, the API behavior, and the resulting PostgreSQL records.

## Final execution sequence

1. Environment and database readiness.
2. Authentication, password handling, and sessions.
3. Problem management and problem discovery.
4. Submission, code execution, verdicts, and submission history.
5. Learner progress and analytics.
6. Contest creation, registration, participation, scoring, and ranking.
7. Company assessments, invitations, candidate workflow, and reports.
8. Reviewer, mentor, moderator, judge, support, and administrator workflows.
9. Role, ownership, privacy, and hidden-test authorization.
10. Input validation, injection, XSS, CSRF, session controls, rate limits, and error handling.
11. Performance, concurrency, availability, backup, and recovery.
12. Full end-to-end regression across representative accounts from all eight role categories.

Run these stages in order. Record test date, account and role, steps performed, actual result, expected result, pass/fail, and evidence for every test.

---

## A. Environment and database readiness

### A-01 — Application starts against the intended database
- **What:** Start the Node.js application using the existing leetcode PostgreSQL database.
- **Why:** Every workflow depends on the correct backend and database being available.
- **How:** Start the app using the documented npm command, inspect startup output, and open the local application URL.
- **Expected:** PostgreSQL connection succeeds and the frontend loads. No database password or session secret appears in logs.

### A-02 — Existing database records are preserved
- **What:** Compare existing users, 80 roles, problems, organizers, topics, test cases, languages, contests, assessments, verdicts, and submissions with the pre-development backup.
- **Why:** The application must extend the academic seed database without deleting existing records or relationships.
- **How:** Compare table counts and representative primary-key and foreign-key records before and after all migrations.
- **Expected:** Existing records remain intact; only documented additive or compatibility migrations change the schema.

## B. Authentication and session management

### B-01 — First login using a legacy seeded password
- **What:** Sign in with a seeded user whose stored password is still a legacy 64-character SHA-256 hash.
- **Why:** Existing seeded users must retain access while weak lab hashes are migrated.
- **How:** Submit the known demo email/password through the login form, then inspect only the stored hash prefix and length in PostgreSQL.
- **Expected:** Login succeeds, the stored hash changes to an Argon2id-encoded value, and no plaintext password is stored.

### B-02 — Incorrect password
- **What:** Attempt login using a valid email and an incorrect password.
- **Why:** Prevent unauthorized account access.
- **How:** Submit the incorrect credential through the normal login form.
- **Expected:** Login is rejected with a generic authentication message and no authenticated session.

### B-03 — Unknown and inactive accounts
- **What:** Attempt login using an unknown email and an inactive seeded account.
- **Why:** Inactive accounts must not authenticate, and the response should not disclose which email addresses exist.
- **How:** Attempt both logins using the same browser workflow.
- **Expected:** Both are rejected with the same generic authentication response.

### B-04 — Subsequent Argon2id login
- **What:** Sign in again after a legacy password has been upgraded.
- **Why:** Confirm that the migrated credential remains usable.
- **How:** Log out and sign in again with the same account and password.
- **Expected:** Login succeeds using the Argon2id hash; no legacy re-upgrade is needed.

### B-05 — Session persistence and logout
- **What:** Confirm a session survives a page reload and is invalidated by logout.
- **Why:** Users need a reliable login state, and logout must end access.
- **How:** Sign in, reload the page, verify the account indicator, log out, then request a protected endpoint.
- **Expected:** The session remains valid after reload and protected access is rejected after logout.

### B-06 — Login rate limiting
- **What:** Exceed the configured failed-login attempt limit within its time window.
- **Why:** Reduce automated password-guessing attempts.
- **How:** Submit repeated incorrect passwords until the configured limit is exceeded.
- **Expected:** Further attempts are rate-limited and account existence is not disclosed.

### B-07 — Self-service Learner registration
- **What:** Create a new platform account through the public registration form.
- **Why:** The SRS requires account registration; Guests should be able to become registered Learners.
- **How:** Submit a new name, unique email, and password meeting the minimum length from the home page.
- **Expected:** A users row is created with the existing Learner L1 role, a learner subtype row is created, the password is stored as Argon2id, and the browser receives a signed-in session.

### B-08 — Duplicate and invalid registration
- **What:** Attempt registration with an already-used email, malformed email, missing name, and short password.
- **Why:** Protect unique account identity and keep invalid or weak credentials out of the database.
- **How:** Submit the invalid combinations through the registration form and direct API requests.
- **Expected:** Invalid data receives a clear client error; duplicate email receives a conflict response; no duplicate or partial user/learner records are written.

### B-09 — Public registration cannot escalate privileges
- **What:** Attempt to submit a different role_id or role_name during public account creation.
- **Why:** Public users must not be able to create Organizer, Reviewer, Admin, or other privileged accounts.
- **How:** Send role fields in a direct registration API request and inspect the created user's role.
- **Expected:** The API ignores/rejects caller-supplied role fields and assigns Learner L1 only.

## C. Problem management and discovery

### C-01 — Public problem listing
- **What:** Browse the library while logged out.
- **Why:** Guests must be able to discover public problems.
- **How:** Open the home page in a logged-out browser session.
- **Expected:** Active problems are visible; retired problems are excluded.

### C-02 — Title search and difficulty filter
- **What:** Search by partial problem title and filter by Easy, Medium, or Hard.
- **Why:** The SRS requires problem discovery using searchable metadata and difficulty.
- **How:** Combine a title search with each difficulty selection and compare the result list.
- **Expected:** Only problems matching all selected filters are shown.

### C-03 — Topic-based discovery
- **What:** Filter the problem library by a topic.
- **Why:** The SRS requires topic-oriented discovery and the database models a many-to-many Problem–Topic relationship.
- **How:** Select a topic and compare visible problems against their ProblemTopic associations in PostgreSQL.
- **Expected:** Every displayed problem is associated with the chosen topic; clearing the filter restores all otherwise matching problems.

### C-04 — Full problem detail view
- **What:** Open a problem and view its statement, input/output format, constraints, difficulty, and topics.
- **Why:** A learner needs the complete problem specification before coding.
- **How:** Select View problem on a library row.
- **Expected:** The displayed fields belong to the selected problem and user-controlled text is displayed as text rather than interpreted as HTML.

### C-05 — Public sample cases
- **What:** View sample test input and expected output.
- **Why:** Learners need examples to understand required input/output behavior.
- **How:** Open a problem containing public test cases.
- **Expected:** Only test cases marked is_hidden = FALSE are rendered and returned to ordinary users.

### C-06 — Hidden test confidentiality
- **What:** Attempt to retrieve hidden test inputs and expected outputs.
- **Why:** Hidden tests are confidential judging material.
- **How:** Inspect problem-detail API responses and attempt direct browser requests using developer tools.
- **Expected:** Hidden inputs and expected outputs are never returned to guests or ordinary learners.

### C-07 — Create, update, and retire a problem
- **What:** Perform the Organizer problem lifecycle.
- **Why:** Problem lifecycle management is a required product function.
- **How:** Sign in as an authorized Organizer and create a problem, edit it, and retire it through the UI.
- **Expected:** Changes persist; retirement hides the problem from public discovery without deleting related history.

### C-08 — Retired problem visibility
- **What:** Request retired problems with and without an authenticated session.
- **Why:** Retired records should not be publicly discoverable, but authenticated users may need historical access according to policy.
- **How:** Toggle Show retired and request a retired detail endpoint after logging in and after logging out.
- **Expected:** Logged-out requests do not reveal retired content; authenticated access follows the approved policy.

### C-09 — Problem input validation
- **What:** Submit missing fields, invalid difficulty, excessive values, and malformed payloads.
- **Why:** Keep records consistent and reject invalid data.
- **How:** Use both the problem form and direct API requests with invalid payloads.
- **Expected:** Invalid requests return validation errors and do not write invalid rows.

## D. Submission and code execution

### D-01 — Available programming languages
- **What:** Retrieve the language choices available to the application.
- **Why:** Users must not select seeded language versions that the configured execution provider cannot run.
- **How:** Open a problem detail view, inspect the language selector, and compare it with `GET /api/languages` and the provider's language catalogue.
- **Expected:** Only seeded versions that exactly match the configured Judge0 language names are selectable.

### D-02 — Run public samples only
- **What:** Execute code using Run samples.
- **Why:** Learners need feedback on public examples without exposing hidden judging data.
- **How:** Open a problem with sample cases, enter code, select a language, and click Run samples. Inspect the saved run record and per-test results.
- **Expected:** Only rows with `is_hidden = FALSE` are run. The record is marked run-only and the interface labels it as a sample run.

### D-03 — Submit against all configured test cases
- **What:** Submit code for full judging.
- **Why:** The final verdict must account for public and hidden tests.
- **How:** Enter code and click Submit solution; compare the number and outcomes of saved test-result rows with the problem's configured cases.
- **Expected:** All configured test cases are evaluated in order until the first non-accepted result; the response never contains hidden inputs or expected outputs.

### D-04 — Accepted solution
- **What:** Execute a known-correct solution for a problem whose data matches that solution.
- **Why:** Verify the successful judging path and accepted verdict persistence.
- **How:** Submit the correct implementation and wait for execution to finish.
- **Expected:** The record reaches COMPLETED with Accepted verdict and all evaluated test results are ACCEPTED.

### D-05 — Wrong answer
- **What:** Submit code that runs but produces incorrect output.
- **Why:** Distinguish incorrect logic from compilation and runtime failure.
- **How:** Use a controlled wrong-answer implementation and submit it.
- **Expected:** A Wrong Answer verdict is stored for the first failing test; subsequent test cases are not executed.

### D-06 — Compilation error
- **What:** Submit syntactically invalid code in a compiled language.
- **Why:** Compilation errors need a distinct verdict and useful diagnostic feedback.
- **How:** Select a compiled language, introduce a compilation error, and submit.
- **Expected:** Compilation Error is stored, with compiler diagnostics safely bounded in length.

### D-07 — Runtime error
- **What:** Submit code that starts but crashes during execution.
- **Why:** A runtime failure must not be presented as a wrong answer.
- **How:** Use a controlled runtime-error example in an available language.
- **Expected:** Runtime Error is stored for the failing test and later tests are not executed.

### D-08 — CPU time, wall time, and memory limits
- **What:** Verify that resource-heavy code is terminated by the isolated judge.
- **Why:** User code must not consume uncontrolled shared resources or affect the web/database process.
- **How:** Use controlled infinite-loop and memory-allocation examples only against the isolated Judge0 service; never execute these examples directly on the app host.
- **Expected:** The judge enforces configured CPU, wall-time, and memory limits. Where the provider reports memory termination as a generic runtime error, the app must not invent a separate memory-limit verdict.

### D-09 — Unsupported language
- **What:** Attempt a submission using a language ID that is not in the available-language response.
- **Why:** Prevent manipulated IDs or unsupported runtimes from reaching the judge.
- **How:** Send a direct API request with an unmapped seeded language ID.
- **Expected:** The API returns a client error and does not create a submission record.

### D-10 — Asynchronous execution and polling
- **What:** Verify asynchronous submission creation and status retrieval.
- **Why:** The browser should not hold one HTTP request open for compilation and execution.
- **How:** Submit code, capture the returned submission ID, and request its detail endpoint until a terminal status is reached.
- **Expected:** Creation returns HTTP 202 with PENDING; the stored state progresses to RUNNING and then COMPLETED or FAILED.

### D-11 — Provider unavailable or polling timeout
- **What:** Verify behavior when Judge0 cannot be reached or does not return a terminal result in time.
- **Why:** Provider failure must not lose the submission or expose sensitive internal information.
- **How:** Use a controlled invalid development endpoint, submit harmless code, and then restore the configured provider.
- **Expected:** The submission remains in PostgreSQL and is marked FAILED with a generic message; logs do not print source code or hidden test data.

### D-12 — Repeated runs and submissions
- **What:** Create multiple sample runs and full submissions for the same user/problem.
- **Why:** Every execution record must remain distinguishable and satisfy the database uniqueness constraint.
- **How:** Perform several Run samples and Submit solution actions, then compare attempt numbers, `is_run_only`, and saved rows.
- **Expected:** Each action is retained, run-only records are visibly distinguished, and the unique user/problem/attempt constraint is never violated. Confirm how run-only records affect visible attempt numbering.

### D-13 — Own submission history and privacy
- **What:** Request submission history and details as the submitting user and as a different user.
- **Why:** Source code and personal submission history must not be exposed to other learners.
- **How:** Use two separate accounts and request `GET /api/submissions` and `GET /api/submissions/:id` for records owned by each account.
- **Expected:** Each account can see only its own submissions; another user's record returns not found.

### D-14 — Execution metrics and per-test outcomes
- **What:** Verify time, memory, per-test result, and final verdict persistence.
- **Why:** The SRS requires submission metadata and execution metrics for feedback and analysis.
- **How:** Compare API details with `submission` and `submission_test_result` rows in PostgreSQL.
- **Expected:** Stored metrics correspond to the judge's returned values; hidden inputs and expected outputs are never returned by the submission-detail API.

---
## E. Submission history and progress analytics

### E-01 — Learner-only dashboard access
- **What:** Open the progress dashboard as a Learner and as a non-Learner role.
- **Why:** Progress analytics are learner-specific and must follow the role policy.
- **How:** Sign in with a Learner account and open My progress; repeat with Organizer, Reviewer, and Guest accounts.
- **Expected:** Learners can open their dashboard; roles not authorized by the current policy do not receive the dashboard endpoint or button.

### E-02 — Solved and attempted problem counts
- **What:** Verify the dashboard's solved and attempted problem totals.
- **Why:** Learners need accurate progress counts, not raw submission totals.
- **How:** Compare dashboard values with distinct problem IDs in completed, non-run-only submissions; a problem counts as solved if at least one attempt has a PASSED verdict.
- **Expected:** Counts match the database calculation; sample runs and pending/failed infrastructure jobs do not inflate solved counts.

### E-03 — Submission success rate
- **What:** Verify the displayed success rate.
- **Why:** A success rate helps learners understand their accuracy across evaluated attempts.
- **How:** Count accepted completed full submissions and divide by all completed full submissions; compare with the dashboard value.
- **Expected:** The displayed percentage matches the evaluated submission calculation and is zero when no full submissions have completed.

### E-04 — Topic performance
- **What:** Review solved/attempted counts and solve rate for topics.
- **Why:** The SRS requires topic strengths and weaknesses.
- **How:** Compare the dashboard topic rows with the user's completed submissions joined through ProblemTopic and Topic.
- **Expected:** Each topic count reflects distinct problems; multi-topic problems are included in every associated topic and are not double-counted within a topic.

### E-05 — Current practice streak
- **What:** Verify the consecutive-day practice streak.
- **Why:** The SRS identifies practice streak as a learner progress statistic.
- **How:** Compare full-submission dates with the displayed streak, checking activity on today, yesterday, consecutive days, and gaps.
- **Expected:** The streak counts consecutive calendar dates up to today, or up to yesterday when no submission has yet been made today; sample runs are excluded.

### E-06 — Last-30-days activity
- **What:** Inspect daily submission activity for the past 30 days.
- **Why:** Learners need to see consistency and recent practice trends.
- **How:** Compare each activity cell with the number of full submissions on that date.
- **Expected:** The activity grid contains 30 days in date order; zero-submission days remain empty.

### E-07 — Recent submissions list
- **What:** Review the recent submission list in the dashboard.
- **Why:** Learners need a quick route back to recent work and results.
- **How:** Compare the listed items with the most recent full submissions owned by that learner.
- **Expected:** The list contains only the learner's own full submissions, ordered newest first, and excludes sample runs.

### E-08 — Dashboard refresh after new submission
- **What:** Verify dashboard values refresh after a new full submission.
- **Why:** Progress should reflect saved activity rather than stale browser state.
- **How:** Record current totals, submit a solution, reopen My progress, and compare the updated values.
- **Expected:** Counts and activity refresh from PostgreSQL; a failed or pending execution does not count as a solved problem.

## F. Contests

### F-01 — Public contest schedule
- **What:** Browse the contest schedule while logged out and signed in.
- **Why:** Learners need to discover upcoming, live, and ended contests.
- **How:** Open the Contests section and compare status, timing, problem count, and participant count with database rows.
- **Expected:** Public contests are listed with accurate UPCOMING, LIVE, or ENDED status and counts.

### F-02 — Organizer/Admin contest creation
- **What:** Create a contest with a name, start/end time, rules, and selected active problems.
- **Why:** The SRS requires organizers and administrators to configure contests and their problem sets.
- **How:** Use an Organizer account and an Admin account to create a future contest; inspect contest, includes, and creator/organizer records.
- **Expected:** Contest and problem associations persist atomically. Invalid names, time ranges, or inactive problem IDs are rejected.

### F-03 — Contest ownership and editing
- **What:** Edit a contest before it starts and attempt editing a contest owned by another Organizer or one that has started.
- **Why:** Contest management must respect ownership and schedule state.
- **How:** Use two Organizer accounts, then an Admin account, to update the same contest.
- **Expected:** An Organizer edits only their own upcoming contests; Admin can manage all upcoming contests; started contests cannot be edited.

### F-04 — Learner registration
- **What:** Register a Learner for an upcoming contest and try duplicate and late registrations.
- **Why:** The platform must retain participation records and enforce eligibility timing.
- **How:** Register once, try again, and repeat after contest start.
- **Expected:** First registration succeeds; duplicate and late registration are rejected; Guests and non-Learners cannot register.

### F-05 — Contest problem access
- **What:** Access contest problem details as an unregistered Learner, registered Learner, and Organizer.
- **Why:** Contest participation and access must follow contest state.
- **How:** Compare the UI and problem detail workflow before, during, and after the contest.
- **Expected:** Upcoming problem details are not exposed to ordinary participants before start; registered Learners can open them during the live window; historical problem sets remain accessible after the contest.

### F-06 — Contest-bound submission
- **What:** Submit a solution to a contest problem with a contest_id.
- **Why:** Contest submissions must be distinguishable from ordinary practice submissions.
- **How:** Register, wait until the contest live window, and submit to a problem linked through INCLUDES; also attempt unregistered, out-of-window, and non-included problem submissions.
- **Expected:** Only registered Learners can submit to included problems while the contest is live. The submission row stores contest_id and cannot also reference an assessment.

### F-07 — Automatic score and penalty calculation
- **What:** Verify contest score and penalty after accepted and incorrect submissions.
- **Why:** Contest outcomes must be calculated consistently.
- **How:** Submit wrong code and then an accepted solution for a problem; inspect contest_registration.
- **Expected:** Each accepted problem adds 100 points. Each wrong full submission before the first accepted solution adds 5 penalty points. Sample-only runs do not affect score.

### F-08 — Leaderboard ordering
- **What:** Compare ranks for participants with different scores and penalties.
- **Why:** Contest participants need transparent ranking.
- **How:** Create ties and different penalties, then inspect leaderboard results and SQL ordering.
- **Expected:** Higher score ranks first; for equal scores, lower penalty ranks first; remaining ties use registration order and learner ID for stable display.

### F-09 — Contest and practice separation
- **What:** Verify contest submissions do not count toward ordinary practice progress metrics.
- **Why:** Practice and contest contexts must remain distinguishable.
- **How:** Compare learner dashboard counts before and after a contest submission.
- **Expected:** Contest-linked submissions are excluded from practice progress, while remaining visible in contest standings and submission history.

---
## G. Company assessments

### G-01 — Organization-scoped assessment listing
- **What:** View the assessment list as an Organizer and as an Admin.
- **Why:** Company assessment details must be isolated by organization; Admin has platform-wide access.
- **How:** Sign in with Organizer accounts belonging to different organizations and with an Admin account. Compare returned assessment and organization IDs.
- **Expected:** Each Organizer sees only assessments belonging to their organization; Admin sees all assessments, including legacy rows without an assigned organization.

### G-02 — Assessment creation and problem assignment
- **What:** Create an assessment with title, description, start/end time, time limit, and ordered active problems.
- **Why:** The SRS requires private assessments with configurable timing and selected questions.
- **How:** Use Organizer and Admin accounts to create assessments; inspect assessment and assessment_problem rows.
- **Expected:** The assessment is attached to the correct organization and creator; problem assignments and order persist in one transaction; invalid/inactive problem IDs and invalid time limits are rejected.

### G-03 — Assessment ownership and editing
- **What:** Edit an upcoming assessment and attempt to edit another organization's assessment or an assessment that has started.
- **Why:** Assessment setup must enforce organization ownership and schedule rules.
- **How:** Use two different Organizer accounts and an Admin account to edit the same assessment before and after start.
- **Expected:** Organizer can edit only their own upcoming assessments; Admin can edit any upcoming assessment; started assessments are immutable through this route.

### G-04 — Candidate invitation creation
- **What:** Invite a candidate by name and email.
- **Why:** The system must maintain candidate identity and invitation status.
- **How:** Create an invitation through the assessment detail view; inspect candidate and invites rows.
- **Expected:** Candidate is created or reused by unique email; invite status is Invited; invitation time and expiry are recorded; a repeated email reuses the candidate for that assessment.

### G-05 — Invitation token confidentiality
- **What:** Verify how the one-time candidate token is generated, stored, and used.
- **Why:** A guessed or database-read invitation token must not expose an assessment.
- **How:** Capture the invitation URL once, inspect the database token field, then try a random token and an expired token.
- **Expected:** Only a SHA-256 token hash is stored; plaintext token is returned once; invalid or expired links receive an authorization/expiry error; the candidate token is sent in an Authorization header, not a query parameter.

### G-06 — Candidate start window
- **What:** Attempt to start before, during, and after the configured assessment window.
- **Why:** Candidates must start only when eligible.
- **How:** Use invitations with scheduled times in the future, currently open, and already ended.
- **Expected:** A candidate can start only when start_time <= current time < end_time; status changes from Invited to Started and attempted_at is recorded once.

### G-07 — Individual time limit and completion
- **What:** Verify the candidate timer and assessment deadline.
- **Why:** Every candidate has a configured time limit, bounded by the assessment end time.
- **How:** Start an assessment with a short time limit; wait for expiry and also test the scheduled end boundary.
- **Expected:** Candidate cannot submit after the earlier of personal time-limit expiry or assessment end; invitation changes to Completed and score is recorded.

### G-08 — Assessment problem confidentiality
- **What:** Request assigned problems before starting, after starting, and using a different invitation token.
- **Why:** Private assessment questions must not be exposed to unauthorized candidates.
- **How:** Open problem endpoints with an Invited token, Started token, and token for another assessment.
- **Expected:** Invited candidates cannot retrieve problem details before start; Started candidates can access only assigned problems; other assessment problems are not returned.

### G-09 — Public sample and hidden test confidentiality
- **What:** Run samples and submit code during an assessment.
- **Why:** Candidates may need sample feedback, but hidden judging inputs/outputs must remain confidential.
- **How:** Inspect candidate problem details and candidate submission result responses for both Run public samples and Submit solution.
- **Expected:** Public sample inputs/expected outputs are available; hidden test inputs/expected outputs never appear in candidate-facing JSON or HTML.

### G-10 — Candidate submission persistence and isolation
- **What:** Submit code as a candidate and attempt to retrieve another candidate's submission.
- **Why:** External candidates must have private histories without requiring platform user accounts.
- **How:** Create two candidate invitations, submit under both, and request the other candidate's submission ID using each token.
- **Expected:** Rows use candidate_id with user_id NULL and correct assessment_id; a candidate can retrieve only their own code and results; another candidate's ID returns not found.

### G-11 — Assessment score and report
- **What:** Finish an assessment and compare its score and report.
- **Why:** Recruiters need an authorized post-assessment summary.
- **How:** Complete an assessment with known accepted and unaccepted problems, then request its report after end_time.
- **Expected:** Score is the rounded percentage of assigned problems accepted at least once; report includes rank, score, status, attempts, accepted submissions, solved problems, execution time, and languages.

### G-12 — Live source-code privacy
- **What:** Attempt to obtain candidate code from Organizer/Admin endpoints while the assessment is live and after it closes.
- **Why:** The SRS says candidate live code is hidden during assessments unless a specifically approved policy changes.
- **How:** Inspect assessment detail, invitation list, and report endpoints before and after assessment end.
- **Expected:** These management/report endpoints never return candidate source code. Candidate code remains available only through that candidate's token-scoped history.

### G-13 — Cross-organization isolation
- **What:** Request another organization's assessment, invitations, and report.
- **Why:** Company assessment content and candidate data are confidential across organizations.
- **How:** Use an Organizer from Organization A and request assessment IDs belonging to Organization B.
- **Expected:** Cross-organization records return not found; Admin retains platform-wide access.

### G-14 — Invitation revocation and expiry
- **What:** Verify behavior after token expiry and after re-inviting a candidate.
- **Why:** A stale or superseded link must not continue granting access.
- **How:** Use an expired link, re-invite the same candidate, then attempt the old and new links.
- **Expected:** Expired token is rejected; re-invitation replaces the token hash; only the new link works.

### G-15 — Invitation delivery limitation
- **What:** Verify generated links can be shared manually and are not automatically emailed.
- **Why:** The current deployment has no configured email provider.
- **How:** Create an invitation, copy the returned link, and open it in a separate browser session/device reachable at APP_BASE_URL.
- **Expected:** A one-time URL is generated and can be shared manually; no automatic email is sent or reported as sent.

---
## H. Role-specific workflows and governance

Detailed cases will be added as the remaining roles are implemented. Preserve all 80 existing role records across Learner, Organizer, Moderator, Reviewer, Mentor, Judge, Admin, and Support. Verify allowed and denied actions against the approved access matrix; do not assume every level in a category has identical permissions unless the approved policy says so.

## I. Security and non-functional verification

Detailed cases will be added as the full architecture is completed. Include direct API authorization, ownership and IDOR checks, SQL injection, XSS-safe rendering, CSRF/origin behavior, session fixation, rate limits, generic error handling, audit records, execution isolation, resource limits, concurrency, and backup/recovery.

## Test result log

| Test ID | Date | Account / role | Actual result | Pass/Fail | Issue / evidence |
|---|---|---|---|---|---|
| — | — | — | To be completed in final verification phase | — | — |
