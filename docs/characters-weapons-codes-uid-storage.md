# Characters, Weapons and Codes UID storage

Character Planner snapshots use `character_uid_snapshots`, keyed solely by Genshin UID. A currently linked account grants access; Discord user IDs and account row IDs are not storage identities. Legacy server snapshots have been backed up and retired. Startup creates only the current UID schema and never imports old snapshots.

Browser caches use `cyrene-character-plans-v3-${genshinUid}`. Pending edits from the current user's v2 cache migrate once, including deletions. Clean legacy caches never overwrite server plans. Failed saves remain pending and retry on reopening; newer pending UID edits take precedence over older v2 edits.

The plans API distinguishes a missing snapshot (`snapshot_exists: false`) from an intentional saved empty array. When no snapshot exists, clean browser-only UID or current-user v2 plans can be recovered too. Recovery inserts only if the UID is still missing, so a concurrent save or deletion wins. Unscoped legacy caches are never assigned to an arbitrary UID.

Weapons already use UID-owned storage: manual copies are scoped by `manual_weapons.genshin_uid`, and complete scanner imports use `weapon_account_scan_snapshots`. Their Discord creator fields are provenance only. Both paths require an account currently linked to the requesting user, share updates across links to that UID and survive unlinking. The legacy scanner snapshots have been retired after UID coverage checks and backup. Regression coverage includes another UID, another Discord user, unauthorised access, relinking, removal and an intentionally empty scan.

Automatic code redemption uses `gift_code_uid_settings`; redemption results use `gift_code_uid_redemptions`, keyed by UID and normalised code. Daily check-in uses `daily_checkin_uid_settings`, including the enabled flag and last successful claim date. These tables have no account-row foreign keys. Unlinking the final account pauses automation until credentials are linked again, without deleting settings or history. Any currently linked Discord user can change the shared settings.

Account-bound settings/history and their migration markers have been backed up and retired. Active settings and results remain in the UID tables. No startup code recreates the old tables. See [table retirement](uid-table-retirement.md).

Workers select one credential row per UID. Atomic database reservations protect each code and each daily claim against overlapping workers and manual redemption requests. Already submitted codes and terminal automatic failures are skipped. Cooldowns and abandoned processing reservations can retry later. Completion writes retain the UID captured before the request, so unlinking during a request cannot discard its result. Daily reservations expire after five minutes; code reservations after thirty minutes. An external submission followed by a process crash before its result is saved can still be retried after expiry; HoYoLAB offers no local transaction with the database.

The normal backend startup creates only the active schema through `initialise_database()`. Deploy the updated backend and frontend together and restart the backend. Typechecks and builds do not apply hosted migrations or prove live reward delivery.

Validation: `tests/integration/test_characters_automation_uid.py` uses temporary PostgreSQL tables and rolls back. Set `CYRENE_TEST_POSTGRES_URL` to run it. Worker tests mock HoYoLAB; browser tests exercise production Planner markup and the generated script with mocked API responses. No regression test redeems real codes or claims real rewards.
