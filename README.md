# LeetCode-Style Practice Management System

**Team 24 · MC212 Database Management Systems · DA-IICT**

This repository contains the implementation of our LeetCode-style practice management system. Development is being done in phases so each feature can be tested before the next one is added.

## Current phase: Phase 1 — PostgreSQL connectivity

The current starter uses:

- Node.js 20+
- Express.js
- PostgreSQL
- node-postgres (`pg`)
- Plain HTML, CSS and browser JavaScript

At this stage the application only verifies database connectivity. Problem CRUD, login, role checks, submissions and Judge0 code execution are **not implemented yet**.

## Local setup

1. Install Node.js 20 or newer and npm.
2. Make sure the existing PostgreSQL database named `leetcode` is running.
3. Clone this repository and enter its folder.
4. Copy the example environment file and edit it:

   ```bash
   cp .env.example .env
   nano .env
   ```

5. Enter your own PostgreSQL connection details in `.env`. Do not share your password.
6. Install dependencies and start the application:

   ```bash
   npm install
   npm run dev
   ```

7. Open `http://127.0.0.1:3000` and select **Test database connection**.

The backend also runs `SELECT version()` at startup. The browser communicates with Express; it never connects directly to PostgreSQL.

## Database safety

The existing project database has 19 relations and sample data. **Do not run the supplied `schema_with_data_fixed.sql` against the populated database as a setup step.** It begins by dropping tables with `CASCADE`. Future schema changes will be provided as small, reviewed migration scripts.

## Security approach

Security controls will be implemented in the actual frontend, backend, database access and code-execution integration, then tested. A control will only be described as implemented after its code and test evidence exist.

The `.env` file is excluded from Git. Never commit database credentials, Judge0 API tokens, or other secrets.

## Planned phases

1. PostgreSQL connectivity.
2. Safe `PROBLEM` CRUD for the Lab 11 demonstration.
3. Password hashing, login, and server-side role/ownership checks.
4. Problem and test-case management.
5. Judge0 integration with execution limits and a separate execution environment.
6. Submission history, verdicts, and basic progress.
7. Selected contest functionality.
8. Security tests and evidence report.

Features outside the agreed simplified SRS scope will not be added without a project decision.
