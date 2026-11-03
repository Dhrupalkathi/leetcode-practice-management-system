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

Detailed cases will be added with the learner dashboard. Verify own-history access, denial of another user's raw code, solved count, success rate, streak, topic performance, and consistency between displayed metrics and persisted submission records.

## F. Contests

Detailed cases will be added with contest functionality. Verify contest creation and organizer ownership, start/end boundaries, registration eligibility, participation, contest-only submissions, scoring, penalties, solve times, ranking ties, and post-contest statistics.

## G. Company assessments

Detailed cases will be added with assessment functionality. Verify company ownership, assessment setup, invitations, candidate eligibility, start/end boundaries, live-code confidentiality, completed reports, and isolation between organizations.

## H. Role-specific workflows and governance

Detailed cases will be added as the remaining roles are implemented. Preserve all 80 existing role records across Learner, Organizer, Moderator, Reviewer, Mentor, Judge, Admin, and Support. Verify allowed and denied actions against the approved access matrix; do not assume every level in a category has identical permissions unless the approved policy says so.

## I. Security and non-functional verification

Detailed cases will be added as the full architecture is completed. Include direct API authorization, ownership and IDOR checks, SQL injection, XSS-safe rendering, CSRF/origin behavior, session fixation, rate limits, generic error handling, audit records, execution isolation, resource limits, concurrency, and backup/recovery.

## Test result log

| Test ID | Date | Account / role | Actual result | Pass/Fail | Issue / evidence |
|---|---|---|---|---|---|
| — | — | — | To be completed in final verification phase | — | — |
