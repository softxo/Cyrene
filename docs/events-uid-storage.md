# Events account persistence

Events state belongs to a Genshin UID, with server included for Custom Events. Discord identifies the signed-in viewer and verifies that they have linked the requested account; it is not the persistence key.

- `event_uid_checks` stores Daily, Trounce, Temper and Limited manual checks by UID, activity and reset period/event identity. Daily and weekly resets still apply.
- `custom_event_accounts` binds each event and its order to UID + server. An All accounts event targets the creator's currently linked UIDs; it is not public to unrelated accounts.
- Objective progress and occurrence completion use the existing UID + server records. Anyone linked to the same UID can read, edit, reorder and complete its events.
- Losing a Discord link or deleting an account connection leaves these identity records intact. The API projects account-specific events onto the viewer's current account ID.

`events_store.migrate` now creates only the active UID tables and index. Legacy checks, event order and migration markers have been retired after UID coverage checks and backup. Account linking attaches all-account events directly to `custom_event_accounts`, without the old account-order table. See [table retirement](uid-table-retirement.md).

Restart the backend to load the updated account-linking code. The integration test `tests/integration/test_events_uid.py` uses temporary PostgreSQL tables and always rolls back; opt in by setting `CYRENE_TEST_POSTGRES_URL`.
