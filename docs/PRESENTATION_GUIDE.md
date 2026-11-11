# Team 24 — Platform presentation guide

**Course:** MC212 Database Management Systems  
**Project:** LeetCode-Style Practice Management System  
**Stack:** Node.js, Express, PostgreSQL (Neon in production), Judge0 execution provider, HTML/CSS/JavaScript frontend.

## 1. Project overview

A role-aware programming practice and technical-assessment platform. It combines a problem library, code editor and judging workflow, learner progress tracking, contests, company assessments, and operational workflows for content review, mentoring, support and administration.

## 2. User roles and access model

The database retains 80 role records: Learner L1–L10, Organizer L1–L10, Moderator L1–L10, Reviewer L1–L10, Mentor L1–L10, Judge L1–L10, Admin L1–L10 and Support L1–L10. The application authorizes by role category. Public registration can create Learner L1 only; elevated roles are assigned by an administrator. The supplied access matrix does not define separate permissions for each L1–L10 level, so do not claim level-specific differences.

| Role category | Main responsibility |
|---|---|
| Learner | Practice problems, run/submit code, see own history and progress, register for contests, use support |
| Organizer | Create/manage problems, submit content for review, create contests and organization assessments |
| Reviewer | Inspect problem content and test cases; approve, request changes or reject |
| Moderator | Manage contest problem sets before contest start |
| Mentor | Provide feedback to learners |
| Judge | Review contest results and flag issues |
| Support | Handle and update support tickets |
| Admin | Manage users/roles and platform-wide governance, reports and oversight |

## 3. Website sections and what they do

### Public / account
- **Problem library:** browse active problems, search titles, filter by difficulty/topic, open statements and public sample tests.
- **Registration and login:** public self-registration creates a Learner L1 account; existing seeded accounts can sign in.
- **Profile:** update name/email and preferred programming language; change password.
- **Notifications / inbox:** view in-app workflow notifications and mark one or all as read.
- **Database Explorer:** presentation-focused SQL examples, entity inventory and relationship map.

### Learner workspace
- **Dashboard / progress:** solved and attempted problems, acceptance rate, streak, daily activity, topic performance, language usage and recent practice.
- **Problem detail / editor:** choose a supported language, run public samples or submit against the full test suite.
- **Submission history:** see personal attempts, execution state, verdict, per-test outcomes and runtime/memory measurements.
- **Contests:** register before start, view contest problems and leaderboard.
- **Support:** create tickets and review own ticket history.

### Organizer workspace
- **Problem management:** create/edit/retire problem content, assign topics, author public and hidden test cases, and send content into review.
- **Contest setup:** create and edit upcoming contests, choose problem sets, configure points and wrong-attempt penalties.
- **Company assessments:** create organization-scoped assessments, set schedule/time limits, select problems and issue candidate invitations.
- **Candidate reports:** review aggregate assessment participation and human-review activity indicators.

### Reviewer / Moderator / Judge / Mentor / Support / Admin workspaces
- **Review queue:** inspect submitted problems and record approve / changes requested / reject decisions; review history is retained.
- **Contest moderation:** manage contest problem selection before the contest begins.
- **Contest judging:** review contest results and record approved/flagged decisions.
- **Mentor feedback:** write feedback linked to a learner and optionally to a problem/submission.
- **Support queue:** assign tickets and update status/priority.
- **Admin overview and users:** inspect aggregate usage, manage active state and role assignments, view audit events, reports and governance queues.

### Candidate assessment experience
- Candidates access an assessment through an invitation token rather than a normal platform account.
- The invitation is scoped to a candidate and assessment, has an expiry, and is verified before the candidate starts.
- Candidate workspace exposes assigned problems, public sample cases and candidate-scoped submission history.
- Tab-hidden, window-blur, copy and paste attempts can be logged as review indicators. They are not automatically treated as proof of cheating; an authorized person reviews or dismisses them.
- The app creates a one-time invitation URL for the organizer to share manually; automatic email delivery is not configured.

## 4. Database design explanation

### Main entity groups
- **Identity:** role, users, learner, organizer, organization, user_sessions.
- **Problem catalogue:** problem, topic, problem_topic, test_case, problem_review.
- **Execution:** language, verdict, submission, submission_test_result.
- **Contests:** contest, contest_registration, includes, contest_result_review.
- **Assessments:** assessment, assessment_problem, candidate, invites, suspicious_activity.
- **Operations:** mentor_feedback, support_ticket, audit_log, notification.

Junction tables implement many-to-many relationships: problem_topic connects problems and topics; includes connects contests and problems; contest_registration connects learners and contests; assessment_problem connects assessments and problems; invites connects candidates and assessments.

The submission model supports platform users and external candidates. A submission has exactly one actor (user or candidate) and is associated with at most one contest/assessment context. The migrations add checks and indexes to support these invariants.

**Important ERD caveat:** the repository contains incremental migrations but not the original base-schema DDL. The Database Explorer therefore shows a logical model assembled from SQL references and migration definitions. Before calling every base-table column or relationship a verified physical FK, compare the diagram with the live PostgreSQL catalog (for example, information_schema and pg_constraint). Do not invent missing constraints.

## 5. SQL Playground explanation

The Database Explorer provides curated, read-only examples of representative backend SQL for problem search/creation, review decisions, submission queueing, test results, learner progress, contest registration, assessment invitations, support tickets and audit events.

It deliberately does not execute arbitrary SQL. A public query endpoint attached to production would create an avoidable SQL injection, data disclosure and destructive-query risk. The page displays parameter placeholders ($1, $2, …) and explains their meaning. It contains no credentials or real personal data.

## 6. Security improvements implemented

| Control | What it does | Why it matters |
|---|---|---|
| Parameterized SQL | Uses PostgreSQL placeholders for user-supplied values | Prevents values from being interpreted as SQL syntax in those queries |
| Server-side validation | Validates names, email, password length, IDs, status values and request shape | Browser-side validation alone can be bypassed |
| Role-category authorization | Checks role category on protected routes | Prevents a normal learner from invoking privileged workflows merely by changing the UI |
| Ownership / scope checks | Scopes learner submissions, candidate invitations, organization assessments and tickets to their owner/context | Reduces insecure direct object reference (IDOR) risk |
| Argon2id password hashing | New passwords use Argon2id; legacy SHA-256 hashes are upgraded after successful login | Stronger password storage than plain text or fast unsalted hashes |
| Session security | PostgreSQL-backed sessions; HttpOnly, Secure in production, SameSite=Strict cookie; password change invalidates other sessions | Reduces session theft and persistence risks |
| Login / API / registration rate limits | Limits repeated requests and login attempts | Raises the cost of brute-force and automated abuse |
| Helmet | Applies standard HTTP security headers | Adds browser-side defense-in-depth |
| Origin checks | Blocks cross-origin state-changing requests when an Origin is supplied and mismatched | Helps mitigate cross-site request forgery in combination with SameSite cookies |
| Hidden test confidentiality | Public problem and candidate routes return sample cases only; hidden cases are used by judging | Protects assessment/judging integrity |
| Invitation token hashing | Stores token hash and expiry, not the raw invitation token | Limits damage if invitation records are exposed |
| Asynchronous execution | Queues submissions; worker claims jobs with row locking and leases | Avoids holding a web request open and supports recovery from abandoned jobs |
| Audit / review history | Stores administrative actions and governance decisions | Improves accountability and incident investigation |
| Data integrity constraints | CHECK, UNIQUE, PK/FK constraints and indexes in migrations | Enforces valid states and prevents duplicate/invalid relationships |

### Security limitations to be honest about
- This is an academic project, not a formally audited production security product.
- Role levels L1–L10 are not implemented as distinct permission tiers; authorization is category-based.
- Hosted Judge0 receives submitted source code and relevant test-case data. For confidential company assessments, a self-hosted execution provider is preferable.
- Candidate activity indicators are signals for human review, not reliable proof of cheating.
- The invitation URL is manually shared; automatic email delivery is not configured.
- Do not claim that SQL injection, XSS, CSRF, IDOR or all vulnerabilities are impossible. Describe the controls above and state that security testing is still required.
- Publicly displaying a schema diagram is a deliberate presentation choice and reveals structural metadata. Keep credentials, hashes, tokens, raw audit details and personal records private.

## 7. Suggested live demonstration (6–8 minutes)

1. Show the public problem library and explain search/filtering.
2. Sign in as a Learner; open a problem, run a sample, submit, then show verdict and per-test results.
3. Show the learner dashboard and explain how aggregates are derived from submissions.
4. Show the role workspaces briefly: Organizer problem creation/review lifecycle, Reviewer decision, contest registration/leaderboard, assessment invitation/candidate flow.
5. Open Database Explorer. Select “Queue a code submission” and explain how a browser action becomes a parameterized INSERT and then an asynchronous worker job.
6. Open the ER diagram and explain the junction tables and submission actor/context design.
7. Finish with security controls and honest limitations.

## 8. Short project pitch

“We built a role-aware LeetCode-style practice and technical-assessment platform using Node.js, Express and PostgreSQL. Beyond problem solving, it supports content governance, asynchronous code judging, learner analytics, contests, organization-scoped assessments, candidate activity review, mentoring, support and administrative audit workflows. Our DBMS design uses relational entities and junction tables, constraints, indexes and parameterized queries. Security is enforced server-side through role and ownership checks, modern password hashing, protected sessions, rate limits, origin validation and hidden-test confidentiality.”

## 9. Likely viva questions

- **Why use junction tables?** To represent many-to-many relationships without repeating multi-valued attributes in a single row.
- **Why parameterized queries?** SQL structure is separated from data values, reducing SQL injection risk.
- **Why asynchronous submissions?** Code execution can take time; queuing lets the API respond quickly and workers process jobs independently.
- **Why store per-test results separately?** One submission can have many test outcomes; the composite key identifies each test result within a submission.
- **Why store invitation token hashes?** The application can verify a presented token without storing the bearer secret itself.
- **Why are hidden test cases not returned?** To prevent learners/candidates from reverse-engineering the judging dataset.
- **Why use audit logs?** To retain an attributable history of sensitive administrative changes.
- **What is the limitation of the role model?** L1–L10 are separate role records, but implemented authorization groups them by role category.
