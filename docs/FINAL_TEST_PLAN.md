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

### A-03 — Incremental migrations are applied in order

- **What:** Apply each project migration once, in numeric order, from 001 through 007.

- **Why:** New workflows depend on the schema added in each preceding migration.

- **How:** Take a backup, then apply `database/migrations/001_problem_crud.sql` through `007_governance_workflows.sql` in order using `psql -v ON_ERROR_STOP=1`; inspect migration output and schema changes.

- **Expected:** Each migration completes without dropping seeded records. Never re-run `schema_with_data_fixed.sql`, because it contains destructive DROP TABLE statements.

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

### B-07 — View and update personal profile
- **What:** Retrieve and update the signed-in user's own name and email address.
- **Why:** The SRS includes account/profile information and users should be able to maintain their own contact details.
- **How:** Open Profile, change the name and email, save, reload the page and retrieve `GET /api/profile`.
- **Expected:** Only the current user's record is updated; duplicate or malformed email addresses are rejected; role and account status are unchanged.

### B-08 — Learner preferred programming language
- **What:** Set or clear the preferred programming language on a Learner profile.
- **Why:** The existing LEARNER relation stores a preferred language for personalization.
- **How:** Sign in as Learner, select a language in Profile, save, and inspect the `learner.preferred_language_id` relationship.
- **Expected:** The selected language is persisted and shown on profile reload; non-Learner roles do not receive this setting and cannot change it through the API.

### B-09 — Change password and invalidate other sessions
- **What:** Change the account password using the current password.
- **Why:** Users need a secure way to rotate credentials; other signed-in sessions should not remain valid after a credential change.
- **How:** Enter the current password and a new password of at least 10 characters, confirm the new password, then sign in from a separate browser session before changing the password and try that old session afterwards.
- **Expected:** Incorrect current password and mismatched confirmation are rejected; successful change stores an Argon2id hash, keeps the current browser signed in with a regenerated session ID, and invalidates other stored sessions.

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

### C-10 — Assign topics while authoring
- **What:** Create or edit a problem with one or more topic associations.
- **Why:** Topic classification is required for discovery and topic-based learner analytics.
- **How:** In the Organizer editor, select multiple topics and save; compare the selected topic IDs with `problem_topic` rows.
- **Expected:** The selected topics are stored against the problem; missing, duplicate, or nonexistent topic IDs are rejected.

### C-11 — Create public sample and hidden test cases
- **What:** Add multiple test cases and mark each as sample or hidden.
- **Why:** Learners need public examples, while final judging needs confidential hidden cases.
- **How:** In the Organizer editor, add at least one test case, enter input and expected output, select the Hidden from learners option for some cases, and save.
- **Expected:** Each case is stored with an ordered test-case ID and its `is_hidden` flag; public problem details include only sample cases.

### C-12 — Preserve test data after submissions exist
- **What:** Attempt to modify test-case input, expected output, visibility, or count after a problem has submission history.
- **Why:** Changing test cases would make historical verdicts unreliable and undermine the auditability of prior attempts.
- **How:** Open the editor for a problem with existing submissions and inspect the lock notice; attempt to alter test data through a direct API request as well.
- **Expected:** The UI renders existing test cases read-only, and the API rejects changed test cases with a conflict response. Problem statement and topic changes can still be resubmitted for Reviewer approval.

### C-13 — Reviewer inspects sample and hidden tests
- **What:** Inspect all test cases and topic associations for a problem awaiting review.
- **Why:** Reviewer duties include checking problem statements and test cases before publication.
- **How:** Sign in as Reviewer, open the review queue, expand Inspect topics and all test cases, and review the case input/output and sample/hidden classification.
- **Expected:** Authorized Reviewer/Admin accounts can inspect all cases; ordinary Learner and Guest accounts cannot access the management endpoint or hidden data.

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

### D-15 — PostgreSQL queue persistence and restart recovery
- **What:** Verify that a queued ordinary submission survives an application restart and resumes without duplicate per-test records.
- **Why:** The SRS requires reliable submission history and service continuity; an in-memory callback alone cannot recover pending jobs.
- **How:** Queue multiple harmless learner/contest submissions, restart the application while one is pending or running, then inspect the saved submission and test-result rows.
- **Expected:** Jobs whose worker lease expires return to PENDING, partial test-result rows from the interrupted run are cleared, workers claim jobs from PostgreSQL, and the final record reaches COMPLETED or FAILED without duplicate-key errors. A live worker renews its lease before each bounded Judge0 test execution. Candidate assessment completion remains blocked while any candidate submission is PENDING or RUNNING.

### D-17 — Missing test cases at worker execution time
- **What:** Remove or disassociate the test cases after a valid submission is queued but before a worker begins execution, using an isolated test database.
- **Why:** A race or administrative change must never cause an empty test set to be recorded as an Accepted solution.
- **How:** Queue a harmless submission, remove its test cases before the worker claims it, and inspect the final submission state and test-result rows.
- **Expected:** The submission is marked FAILED with a safe explanatory message; it is never marked Accepted and no fabricated successful test result is inserted.

### D-16 — Concurrent worker claiming
- **What:** Verify that multiple configured workers do not claim the same pending submission.
- **Why:** Concurrent processing should improve throughput without duplicate execution or conflicting database writes.
- **How:** Configure two or more workers, queue several submissions, and compare submission IDs, per-test rows and worker logs.
- **Expected:** Each queued submission is claimed once by one worker using row-level locking with `SKIP LOCKED`; every job reaches one terminal state.


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
- **Expected:** Each accepted problem adds the configured points-per-problem value (default 100). Each wrong full submission before first acceptance adds the configured penalty in minutes (default 5). If elapsed-time penalty is enabled, whole minutes from contest start to first acceptance are also added per solved problem. Sample-only runs do not affect score.

### F-08 — Leaderboard ordering
- **What:** Compare ranks for participants with different scores and penalties.
- **Why:** Contest participants need transparent ranking.
- **How:** Create ties and different penalties, then inspect leaderboard results and SQL ordering.
- **Expected:** Higher score ranks first; for equal scores, lower penalty ranks first; registration time and learner ID provide deterministic ordering where scores and penalties match.

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



### H-01 — Preserve all 80 role records

- **What:** Confirm all 80 existing role rows remain present with their original IDs, names and descriptions.

- **Why:** The project model includes eight categories with ten levels each; implementation must not collapse or delete these records.

- **How:** Compare the ROLE table before and after all migrations and Admin operations; inspect IDs 1–80.

- **Expected:** Learner, Organizer, Moderator, Reviewer, Mentor, Judge, Admin and Support each retain L1–L10 and their original role_id values.



### H-02 — Reviewer queue is restricted

- **What:** Open the problem review queue as Reviewer, Admin, Organizer and Learner.

- **Why:** Only authorized review roles should make publication decisions.

- **How:** Call `GET /api/problems/review-queue` from each account and inspect the Workspace interface.

- **Expected:** Reviewer and Admin can view pending review work; other categories receive a forbidden response and no review queue is displayed.



### H-03 — New problem enters pending review

- **What:** Create a new problem as an Organizer.

- **Why:** Content should follow the SRS lifecycle rather than becoming public before review.

- **How:** Submit a problem through the Organizer form and inspect its `review_status` and `is_active` fields.

- **Expected:** The new problem is stored with `PENDING_REVIEW` and `is_active = FALSE`; it does not appear in public problem discovery.



### H-04 — Reviewer approval publishes a problem

- **What:** Approve a pending problem.

- **Why:** Publication must be a deliberate, recorded review action.

- **How:** Sign in as Reviewer, add review comments, choose APPROVED, then inspect the problem and problem_review records.

- **Expected:** The problem becomes `PUBLISHED` and active; reviewer identity, decision, comments and timestamp are retained.



### H-05 — Changes requested and resubmission

- **What:** Request changes on a pending problem, then have the Organizer edit and resubmit it.

- **Why:** The lifecycle must support iterative review without deleting earlier decisions.

- **How:** Choose CHANGES_REQUESTED with comments, edit the problem as its Organizer, then inspect the new review queue entry.

- **Expected:** The problem remains inactive with `CHANGES_REQUESTED`; the Organizer's update returns it to `PENDING_REVIEW`; previous review history remains stored.



### H-06 — Reject a problem

- **What:** Reject a problem submitted for review.

- **Why:** Invalid or unsuitable content must not be published.

- **How:** Choose REJECTED with a reviewer comment and inspect public listing and review history.

- **Expected:** The problem stays inactive with `REJECTED` status; public guests cannot retrieve its content; the decision is retained.



### H-07 — Organizer can read reviewer feedback

- **What:** Open a problem with review decisions as its owning Organizer, as a different Organizer, as Reviewer, and as Learner.
- **Why:** Organizers need actionable feedback to correct and resubmit content, while review history must remain scoped to authorized users.
- **How:** As the owning Organizer, open the problem details and inspect the Review feedback section. Confirm reviewer name, decision, timestamp, and comments appear in newest-first order. Repeat with a different Organizer and a Learner account.
- **Expected:** The owning Organizer and Admin can read the complete review history. A different Organizer cannot retrieve it; Learners do not see the review-history section. Empty history displays a clear empty state, and comments render as text rather than executable markup.

### H-08 — Retired and unpublished problem visibility is restricted

- **What:** Attempt to list and open RETIRED, PENDING_REVIEW, CHANGES_REQUESTED, and REJECTED problems as an owning Organizer, another Organizer, Reviewer, Admin, Learner, and Guest.
- **Why:** Draft, rejected, and retired content must not leak through list or detail endpoints.
- **How:** Exercise GET /api/problems?includeInactive=true and GET /api/problems/:id for each account; compare API responses with the problem list and details UI.
- **Expected:** Reviewer/Admin can inspect these states; only the owning Organizer can inspect their own non-public content; other Organizers, Learners, and Guests cannot retrieve it. Existing public active problems remain discoverable.

### H-09 — Organizer retires a published problem

- **What:** Retire a previously published problem.

- **Why:** The SRS requires retirement without destroying historical records.

- **How:** Retire it from the Organizer interface and inspect `is_active`, `review_status`, submissions and test cases.

- **Expected:** The problem becomes inactive and `RETIRED`; submission/test-case history is preserved.



### H-08 — Mentor feedback is scoped to a learner

- **What:** Create and retrieve feedback for a learner, optionally linked to a problem or submission.

- **Why:** Mentors should be able to guide learners without exposing unrelated learners' records.

- **How:** Use a Mentor account to post feedback to a valid Learner ID and optionally a submission belonging to that learner; then view the learner's feedback.

- **Expected:** Feedback is stored with mentor, learner, optional problem/submission and timestamp; a submission owned by a different learner is rejected; each learner sees only their own received feedback.



### H-09 — Learner support ticket lifecycle

- **What:** Create a support ticket and view its status.

- **Why:** Users need a recorded way to request platform assistance.

- **How:** Create a LOW/MEDIUM/HIGH/URGENT ticket, open My tickets, and inspect the support_ticket row.

- **Expected:** The ticket is associated with its requester and starts OPEN; unrelated learners cannot read it through the personal ticket endpoint.



### H-10 — Support queue and assignment

- **What:** Update support tickets as Support and Admin.

- **Why:** Support staff must process tickets without giving ordinary users queue-wide access.

- **How:** Sign in as Support, load the queue, change status/priority and assign to an active Support account; attempt the same as Learner.

- **Expected:** Support/Admin can view and update the queue; non-support users cannot; assignment accepts only active Support-role accounts; changes are timestamped and audited.



### H-11 — Judge validates ended contest results

- **What:** Approve or flag contest results.

- **Why:** The SRS includes Judge responsibilities for validating contest results.

- **How:** After a contest ends, open its leaderboard in the Judge workspace and save APPROVED or FLAGGED with review notes.

- **Expected:** A Judge/Admin decision is stored with contest, reviewer and timestamp; a contest that has not ended cannot be reviewed; prior reviews remain visible.



### H-12 — Moderator manages contest problem sets

- **What:** Add/remove problems from an upcoming contest as Moderator.

- **Why:** Contest moderation requires controlled problem-set management.

- **How:** Open an upcoming contest as Moderator and add an active problem or remove one without submissions; attempt the same after start and after a problem has contest submissions.

- **Expected:** Moderator can change the problem set before start; cannot edit general contest ownership/scoring fields; the problem set locks at start and a problem with submissions cannot be removed.



### H-13 — Admin user and role management

- **What:** Search users, change a role using one of the existing role IDs, and activate/deactivate an account.

- **Why:** The SRS requires administration of users, roles and account activity.

- **How:** Use Admin account management to assign a role, deactivate/reactivate a user, and assign an organization when creating an Organizer profile.

- **Expected:** Changes persist; only role IDs 1–80 are selectable; Organizer conversion requires a valid organization; all 80 ROLE rows remain intact; changes are audited.



### H-14 — Last active Admin protection

- **What:** Attempt to demote or deactivate the last active Admin account.

- **Why:** Prevent accidental removal of all platform administration capability.

- **How:** Use an Admin account when only one active Admin remains and attempt to change its role or deactivate it.

- **Expected:** The API rejects the change and leaves the account active with an Admin role.



### H-15 — Admin audit history

- **What:** View audit events for account changes, problem review, feedback, support tickets, judging and suspicious-activity decisions.

- **Why:** Sensitive operational actions need accountability.

- **How:** Use Admin workspace to load audit history and compare entries to their associated records.

- **Expected:** Admin can read recent audit events; non-Admin accounts cannot; event details contain no passwords, session secrets, candidate invitation tokens or source-code payloads.



### H-19 — Admin creates a problem with an Organizer owner
- **What:** Create a problem while signed in as Admin and assign an active Organizer profile as its content owner.
- **Why:** The SRS access matrix permits Admin problem creation, while the supplied relational schema stores `problem.created_by` as a foreign key to `organizer.organizer_id`.
- **How:** Open the Admin problem editor, select an active Organizer and required topic/test cases, then submit for Reviewer approval. Inspect the created problem and audit event.
- **Expected:** The problem is created as `PENDING_REVIEW` and inactive, `created_by` references the selected Organizer, and the audit actor is the Admin. Missing, inactive or invalid Organizer owners are rejected.

### H-16 — Admin platform overview reporting
- **What:** View the aggregate platform overview as an Admin.
- **Why:** The SRS requires administrative reporting for platform usage, content governance, contests, assessments and submissions.
- **How:** Open Platform overview in the Admin workspace and compare total users, active accounts, active submitters, published problems, pending reviews, submissions, contests and assessments with read-only aggregate SQL counts.
- **Expected:** The dashboard displays consistent aggregate values and the rolling 30-day submitter count; it exposes no raw passwords, invitation tokens or source code.

### H-17 — Popular and low-success problem reports
- **What:** Compare the most attempted and lowest-acceptance practice problems.
- **Why:** Admins need to identify popular problems and problems that may have unclear statements, difficult tests or low success rates.
- **How:** Compare both report lists with completed non-run-only practice submissions in PostgreSQL; confirm the low-success report's minimum of five completed attempts.
- **Expected:** Popular problems are ordered by completed attempt count; low-success problems are ordered by acceptance rate and exclude problems with fewer than five completed attempts. Contest and company-assessment submissions are not mixed into practice problem metrics.

### H-18 — Company assessment activity reporting
- **What:** View aggregate invited, started and completed candidate counts and average completed score for recent assessments.
- **Why:** The SRS requires administrative reporting on assessment activity while protecting candidate information.
- **How:** Compare the assessment report rows with assessment and invite aggregates in PostgreSQL.
- **Expected:** Candidate counts and averages match stored records; the summary does not expose candidate names, email addresses, invitation tokens or source code.

## I. Security and non-functional verification



### I-01 — Server-side authorization for every protected API

- **What:** Attempt protected operations without a session and with the wrong role category.

- **Why:** Frontend button hiding is not a security boundary.

- **How:** Call each protected route directly with curl/browser developer tools using Guest, Learner, Organizer, Reviewer, Mentor, Moderator, Judge, Support and Admin accounts.

- **Expected:** Unauthenticated calls return 401; authenticated but unauthorized calls return 403 or a non-disclosing 404 as specified; no protected mutation occurs.



### I-02 — Ownership and IDOR checks

- **What:** Change IDs in problem, submission, contest, assessment, support-ticket and suspicious-activity requests.

- **Why:** Predictable IDs must not grant access to another user's or organization's records.

- **How:** Use two accounts from different users/organizations and request each other's record IDs directly.

- **Expected:** Users see only their own submissions/tickets/feedback; Organizers see only their organization's assessments and activity indicators; contest owners and moderators follow their separate permissions.



### I-03 — Hidden test-case confidentiality

- **What:** Try to obtain hidden test input and expected output through problem, submission, contest and candidate APIs.

- **Why:** Hidden judging data must remain confidential.

- **How:** Inspect all JSON responses and network requests for a problem containing both public and hidden test cases.

- **Expected:** Only public samples are returned; hidden test contents never appear in browser HTML or JSON. Judge workers receive them server-side only.



### I-04 — Assessment invitation token confidentiality

- **What:** Inspect invitation creation, persistence and use.

- **Why:** A leaked database token or guessed invitation should not grant candidate access.

- **How:** Capture an invitation link, inspect the stored hash, then try invalid and expired links.

- **Expected:** Only a SHA-256 token hash is stored; raw token is returned once and sent in an Authorization header; invalid/expired links are rejected.



### I-05 — SQL injection

- **What:** Supply SQL-looking values in search, form fields, IDs and filter parameters.

- **Why:** User input must not alter database query structure.

- **How:** Use harmless injection strings through forms and direct API requests; inspect results and database records.

- **Expected:** Parameterized queries treat values as data; no unintended query or mutation occurs.



### I-06 — XSS and unsafe text rendering

- **What:** Enter HTML/script-like strings into problem text, feedback, contest rules, support descriptions and review comments.

- **Why:** Stored content must not execute in other users' browsers.

- **How:** Save representative payload strings and view them from a different authorized account.

- **Expected:** Text is rendered as text; no script/event handler executes; DOM insertion does not interpret untrusted strings as HTML.



### I-07 — CSRF and cross-origin state changes

- **What:** Attempt cross-origin POST/PUT/PATCH/DELETE requests while signed in.

- **Why:** A browser session should not be usable by an unrelated site to mutate records.

- **How:** Issue cross-origin requests with and without Origin headers using a controlled test page.

- **Expected:** Cross-origin requests are rejected according to the origin/SameSite policy; legitimate same-origin actions continue to work.



### I-08 — Session fixation, expiry and logout

- **What:** Confirm login rotates session ID, cookies are HttpOnly/SameSite and logout invalidates the session.

- **Why:** Prevent stolen/pre-authentication session reuse.

- **How:** Compare session IDs before/after login, inspect cookie attributes, wait for expiry where practical, and retry after logout.

- **Expected:** Session ID is regenerated at login; cookie is HttpOnly and SameSite Strict; old/expired/destroyed session cannot authorize protected actions.



### I-09 — Rate limiting and request-size limits

- **What:** Exceed login, registration and general API rate limits and send oversized JSON/code.

- **Why:** Reduce brute-force and resource-exhaustion risks.

- **How:** Use controlled repeated requests and payloads above configured limits.

- **Expected:** Requests are rate-limited or rejected with bounded responses; server remains responsive.



### I-10 — Candidate activity indicators are not automatic findings

- **What:** Generate tab-hidden, window-blur, copy and paste events during a candidate assessment.

- **Why:** Suspicious behavior should support human review without automatically declaring a candidate guilty.

- **How:** Trigger each signal and inspect the activity record and Organizer/Admin review screen.

- **Expected:** Event type and minimal metadata are stored; clipboard contents and raw copied text are not stored; the interface labels indicators as non-conclusive; a human can mark REVIEWED or DISMISSED.



### I-11 — Audit coverage and secret minimization

- **What:** Inspect audit records for sensitive operations and verify secret fields are excluded.

- **Why:** Accountability must not create a second repository of secrets.

- **How:** Perform representative admin, review, support, mentor, judge and suspicious-activity actions; inspect audit_log details and server logs.

- **Expected:** Actor/action/entity/time are retained; password hashes, plaintext credentials, session cookies, invitation tokens and source code are not copied into audit details or ordinary logs.



### I-12 — Code execution isolation and resource controls

- **What:** Verify submitted code runs only through the configured isolated Judge0 execution service.

- **Why:** Untrusted code must not execute inside the Express process or access the application database host.

- **How:** Inspect deployment configuration and send controlled CPU/time/memory-limit examples only to the isolated judge.

- **Expected:** Source code and test inputs are sent to the configured judge; CPU, wall-time and memory limits are enforced; the app process and database are not exposed to the submitted program.



### I-13 — Provider outage and interrupted worker recovery

- **What:** Simulate an unavailable Judge0 endpoint and restart the application while a submission is pending.

- **Why:** Submission history must remain consistent across execution failures and restarts.

- **How:** Use a controlled development endpoint, submit harmless code, and restart the server while a job is pending.

- **Expected:** The submission record remains; failed/interrupted work reaches FAILED with a generic retry message; no dangling PENDING/RUNNING job remains indefinitely.



### I-14 — Concurrency and database integrity

- **What:** Submit multiple requests concurrently and register several learners for a contest.

- **Why:** Simultaneous use must not create duplicate attempt numbers, duplicate registrations or inconsistent scores.

- **How:** Use a small controlled parallel request batch and inspect unique constraints/relationships.

- **Expected:** Every accepted action has a unique persisted record; transaction/unique constraints prevent duplicate attempts and registrations; contest score totals remain consistent.



### I-15 — Backup and recovery

- **What:** Restore the database from the project backup into a separate test database.

- **Why:** The platform must be recoverable without damaging the live project database.

- **How:** Restore only into a disposable database and compare key counts/foreign keys with the backup source.

- **Expected:** Users, roles, problems, submissions, contests, assessments and review/audit history restore with consistent relationships.



### I-16 — Performance and availability under representative load

- **What:** Review problem browsing, contest listing, history and dashboard response under representative concurrent requests.

- **Why:** The platform should remain responsive for practice and scheduled assessment/contest activity.

- **How:** Generate a controlled load against a staging/local test instance and monitor latency, errors, database connections and resource use.

- **Expected:** The application stays responsive within agreed project demonstration limits and does not lose or corrupt records.

### H-09 — Admin assigns an Organizer with an organization selector

- **What:** Assign an existing account to an Organizer role and associate it with a real organization.
- **Why:** Organizer permissions and assessment ownership depend on a valid organization relationship; administrators should not have to guess numeric organization IDs.
- **How:** Sign in as Admin, open User and role management, change a non-Organizer account to an Organizer role, select an organization from the organization-name dropdown, and save. Reload the account list and inspect the Organizer profile relationship.
- **Expected:** The organization dropdown appears only when a new Organizer profile is required; saving without a selection is blocked; a valid selection creates the Organizer profile with the chosen organization; existing Organizer organization assignments remain unchanged unless separately supported.

## Test result log

| Test ID | Date | Account / role | Actual result | Pass/Fail | Issue / evidence |
|---|---|---|---|---|---|
| — | — | — | To be completed in final verification phase | — | — |


### I-17 — Role-based workspace navigation and isolation

- **What:** Verify that each authenticated role receives only its own workspace navigation and corresponding sections.
- **Why:** Role-specific operations must be clearly separated; unrelated role workspaces should not be exposed through the normal interface.
- **How:** Sign in separately as Learner, Organizer, Reviewer, Mentor, Support, Judge, Moderator and Admin. Inspect navigation labels, switch between every available section, and verify that sections for other roles remain hidden. Also verify guest problem browsing and that profile, notifications and logout remain available for authenticated users.
- **Expected:** Each role sees only its configured navigation destinations and matching sections; Admin has the platform administration entry; Learner does not see Organizer, Reviewer or Admin workspaces; switching sections does not clear or mutate records; existing dialogs and workflows continue to function. This is a UI separation check, not a substitute for server-side authorization tests.
