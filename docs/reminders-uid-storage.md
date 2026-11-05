# Reminder UID persistence

A linked reminder has one canonical record per `(genshin_uid, reminder_type, reminder_mode)`. Any Discord user currently linked to that UID can see, enable, edit, or delete its settings. The original Discord ID is audit information; it does not own the reminder. Personal reminders without a UID keep their existing owner-only behaviour.

Notifications are sent to every distinct Discord account currently linked to the UID, as requested. Membership is resolved at send time. Unlinked users are excluded. A blocked DM does not prevent delivery to the other linked users, and attachments are created separately for each DM. Automatic trigger state is shared so separate Discord-created copies cannot repeatedly notify the same UID. When some DMs succeed and others are blocked, the episode is considered delivered to avoid repeating successful DMs.

The Resin scheduler tries the currently linked accounts' credentials, continuing after unavailable credentials or invalid HoYoLAB responses. Reminders are retained while no Discord users are linked and become eligible again after relinking. Resin thresholds, automatic trigger resets, and one-shot manual mode remain supported.

The original migration chose the most recently updated copy of each UID/type/mode as canonical and retained superseded IDs as aliases in `reminders`. These aliases and personal reminders remain active. The separate legacy archive and migration marker have now been backed up and retired; startup no longer recreates them. See [table retirement](uid-table-retirement.md).

Restart the updated backend and reminder scheduler to load the current code. Rollback-only PostgreSQL coverage: set `CYRENE_TEST_POSTGRES_URL` and run `tests/integration/test_reminders_uid.py`. Discord delivery tests use mock users and never send real messages.

Manual reminders have no fixed expiry. They remain active until their condition is met and notification delivery succeeds, then are disabled and removed from the active list. Their database record is retained; Delete removes a reminder explicitly. Automatic reminders remain active across cycles until deleted.
