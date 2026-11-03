# Legacy UID table retirement

The obsolete tables were backed up and dropped from the configured database on 2 November 2026 after the user confirmed the UID storage was working. All 20 retained tables were compared before and after deletion using row counts and SHA-256 fingerprints; their data was unchanged.

Retired tables: `achievement_progress`, `wish_history`, `game_data_accounts`, `character_plans`, `character_plan_snapshots`, `weapon_scan_snapshots`, `event_activity_checks`, `custom_event_account_order`, `gift_code_settings`, `gift_code_redemptions`, `daily_checkin_settings`, `reminder_uid_legacy_archive`, `event_uid_migrations`, `reminder_uid_migrations` and `automation_uid_migrations`.

The local backup is `tools/uid-retirement-backups/20261102T232954211176Z-legacy-uid-tables.json`. It contains the old rows, column descriptions, constraints and indexes. This directory is ignored by Git. Backup data is not loaded during startup.

`scripts/retire_legacy_uid_tables.py` performs a dry-run by default. With `--apply`, it checks that legacy records with resolvable UIDs have UID destinations, locks the affected tables, writes the backup and drops only the explicit obsolete list using `RESTRICT`. It verifies that retained data is unchanged before committing. It never uses `CASCADE`. Current UID values take precedence over old values; intentional empty snapshots remain authoritative. Unresolvable legacy rows are preserved in the backup rather than assigned to an arbitrary account.

Backend startup no longer creates or reads the retired tables. Account linking writes UID event associations directly. Active `accounts`, `reminders`, Custom Events tables, shared UID tables, manual weapons, Discord sessions and credentials remain required. A table containing a Discord user or an account selector is not automatically obsolete.

Deploy/restart the updated backend before further account linking. An older running process still contains the old account-linking implementation, and an older deployed checkout can recreate retired tables on startup. Fresh-schema and repeated-startup regression coverage lives in `tests/integration/test_uid_schema_without_legacy.py` and uses rollback-only temporary tables. Historical migrations live only in test fixtures, outside runtime code.
