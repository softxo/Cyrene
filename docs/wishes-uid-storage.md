# Wishes UID persistence

`wish_uid_history` is keyed by `(genshin_uid, wish_id)`. Linked account IDs remain the API selector, and ownership is checked before reads and both regular and streaming imports. Storage resolves the selected account to its actual UID; different Discord logins linked to that UID see the same history.

The legacy `wish_history` table has been retired after checking UID coverage and taking a backup. Startup creates only `wish_uid_history` and its index. The active history has no foreign key to a removable Discord/account connection; see [table retirement](uid-table-retirement.md).

Imports validate the entire batch UID before writing. They report only newly inserted pulls, deduplicate across Discord logins, retain icons if a later import omits them, and do not erase historical pulls absent from the upstream response. Existing URL validation and selected-UID checks remain in place; authentication URLs and auth keys are not stored.

Restart the updated backend to use the current schema bootstrap. Rollback-only PostgreSQL coverage: set `CYRENE_TEST_POSTGRES_URL` and run `tests/integration/test_wishes_uid.py`.
