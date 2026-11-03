# Achievement UID persistence

Achievement progress, completion dates and notes use `achievement_uid_progress`, keyed by `(genshin_uid, achievement_id, tier)`. Discord is used only to verify ownership of the selected linked account. Different Discord logins linked to the same UID see and update the same data. Unlinking or relinking does not delete this progress.

The former account-bound tables have been retired after UID coverage checks and backup. Startup creates only the current UID schema. Historical migration selection remains covered by test-only fixtures; see [table retirement](uid-table-retirement.md).

Manual updates atomically change only supplied fields. Imports update progress and completion dates without overwriting notes. The existing account authorisation checks and API shapes are retained. Restart the updated backend so it uses the current schema bootstrap.

Rollback-only PostgreSQL regression: set `CYRENE_TEST_POSTGRES_URL` and run `tests/integration/test_achievements_uid.py`. It exercises migration conflicts, shared access, unauthorised accounts, imports, partial edits, timestamp preservation, unlink/relink, and repeated migrations.
