"""Historical migration fixtures for regression tests; never imported by the application."""


async def migrate_events(connection):
    await connection.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-events-uid-v1'))")
    await connection.execute("""CREATE TABLE IF NOT EXISTS event_uid_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    applied = await connection.execute("SELECT 1 FROM event_uid_migrations WHERE name='uid-v1'")
    if await applied.fetchone():
        return
    # Additive migration: legacy tables remain intact for recovery.
    await connection.execute("""CREATE TABLE IF NOT EXISTS event_uid_checks (
        genshin_uid TEXT NOT NULL, activity_type TEXT NOT NULL, period_key TEXT NOT NULL,
        checked BOOLEAN NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (genshin_uid, activity_type, period_key))""")
    await connection.execute("""INSERT INTO event_uid_checks
        SELECT DISTINCT ON (genshin_uid, activity_type, period_key)
            genshin_uid, activity_type, period_key, checked, updated_at
        FROM event_activity_checks
        ORDER BY genshin_uid, activity_type, period_key, updated_at DESC, id DESC
        ON CONFLICT DO NOTHING""")
    await connection.execute("""CREATE TABLE IF NOT EXISTS custom_event_accounts (
        event_id BIGINT NOT NULL REFERENCES custom_events(id) ON DELETE CASCADE,
        genshin_uid TEXT NOT NULL, genshin_server TEXT NOT NULL,
        sort_order BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (event_id, genshin_uid, genshin_server))""")
    await connection.execute("""INSERT INTO custom_event_accounts
            (event_id, genshin_uid, genshin_server, sort_order)
        SELECT DISTINCT ON (e.id, a.genshin_uid, a.genshin_server)
            e.id, a.genshin_uid, a.genshin_server, COALESCE(o.sort_order, e.sort_order)
        FROM custom_events e
        JOIN accounts a ON (e.account_scope = 'all' AND a.discord_user_id = e.discord_user_id)
          OR (e.account_scope = 'account' AND a.genshin_uid = e.genshin_uid
              AND a.genshin_server = e.genshin_server)
        LEFT JOIN custom_event_account_order o ON o.event_id=e.id AND o.account_id=a.id
        ORDER BY e.id, a.genshin_uid, a.genshin_server, a.id DESC
        ON CONFLICT DO NOTHING""")
    await connection.execute("""CREATE INDEX IF NOT EXISTS idx_custom_event_accounts_uid
        ON custom_event_accounts (genshin_uid, genshin_server, sort_order)""")
    # Preserve account-specific events even if their owner has already unlinked.
    await connection.execute("""INSERT INTO custom_event_accounts
            (event_id, genshin_uid, genshin_server, sort_order)
        SELECT id, genshin_uid, genshin_server, sort_order FROM custom_events
        WHERE account_scope='account' AND genshin_uid IS NOT NULL AND genshin_server IS NOT NULL
        ON CONFLICT DO NOTHING""")
    # Recover associations for all-account events from saved identity-based state.
    await connection.execute("""INSERT INTO custom_event_accounts
            (event_id, genshin_uid, genshin_server, sort_order)
        SELECT e.id, s.genshin_uid, s.genshin_server, e.sort_order
        FROM custom_events e JOIN (
            SELECT event_id, genshin_uid, genshin_server FROM custom_event_progress
            UNION SELECT event_id, genshin_uid, genshin_server FROM custom_event_completions
        ) s ON s.event_id=e.id
        WHERE s.genshin_uid IS NOT NULL AND s.genshin_server IS NOT NULL
        ON CONFLICT DO NOTHING""")
    # Legacy UID completions may still reference a Discord-local account row.
    # Detach them so unlinking cannot cascade-delete durable completion history.
    await connection.execute("""UPDATE custom_event_completions SET account_id=NULL
        WHERE account_id IS NOT NULL AND genshin_uid IS NOT NULL AND genshin_server IS NOT NULL""")
    # Seed old Overview-level completion onto each associated UID. Explicit
    # per-account entries, including intentional false values, always win.
    await connection.execute("""INSERT INTO custom_event_completions
        (event_id, discord_user_id, account_id, genshin_uid, genshin_server,
         occurrence_start, completed, completed_at)
        SELECT c.event_id, c.discord_user_id, NULL, a.genshin_uid, a.genshin_server,
               c.occurrence_start, c.completed, c.completed_at
        FROM custom_event_completions c JOIN custom_event_accounts a ON a.event_id=c.event_id
        WHERE c.genshin_uid IS NULL AND c.genshin_server IS NULL AND c.account_id IS NULL
        ON CONFLICT DO NOTHING""")

    await connection.execute("INSERT INTO event_uid_migrations (name) VALUES ('uid-v1')")


async def migrate_achievement(connection):
    await connection.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-achievements-uid-v1'))")
    await connection.execute("""CREATE TABLE IF NOT EXISTS achievement_uid_progress (
        genshin_uid TEXT NOT NULL, achievement_id TEXT NOT NULL, tier INTEGER NOT NULL,
        completed BOOLEAN NOT NULL DEFAULT FALSE, current INTEGER NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ, note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (genshin_uid, achievement_id, tier))""")
    # Insert only missing identities, so later restarts cannot undo edits or clears.
    # Keep the legacy table intact, including records without a resolvable UID.
    await connection.execute("""INSERT INTO achievement_uid_progress
        (genshin_uid,achievement_id,tier,completed,current,completed_at,note,created_at,updated_at)
        SELECT DISTINCT ON (a.genshin_uid,p.achievement_id,p.tier)
            a.genshin_uid,p.achievement_id,p.tier,p.completed,p.current,p.completed_at,p.note,p.created_at,p.updated_at
        FROM achievement_progress p JOIN game_data_accounts a ON a.id=p.account_id
        ORDER BY a.genshin_uid,p.achievement_id,p.tier,p.updated_at DESC,p.id DESC
        ON CONFLICT DO NOTHING""")


async def migrate_wish(connection):
    await connection.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-wishes-uid-v1'))")
    await connection.execute("""CREATE TABLE IF NOT EXISTS wish_uid_history (
        genshin_uid TEXT NOT NULL, wish_id TEXT NOT NULL, gacha_type TEXT NOT NULL,
        item_name TEXT NOT NULL, item_type TEXT NOT NULL, rank_type INTEGER NOT NULL,
        icon_url TEXT, pulled_at TIMESTAMP NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (genshin_uid,wish_id))""")
    await connection.execute("""CREATE INDEX IF NOT EXISTS idx_wish_uid_history_time
        ON wish_uid_history(genshin_uid,pulled_at DESC,wish_id DESC)""")
    # The saved pull contains its actual UID; never infer ownership from Discord.
    # Retain legacy rows and all older history. Only fill missing icons on repeats.
    await connection.execute("""INSERT INTO wish_uid_history
        (genshin_uid,wish_id,gacha_type,item_name,item_type,rank_type,icon_url,pulled_at,created_at)
        SELECT DISTINCT ON (genshin_uid,wish_id)
            genshin_uid,wish_id,gacha_type,item_name,item_type,rank_type,icon_url,pulled_at,created_at
        FROM wish_history
        ORDER BY genshin_uid,wish_id,(icon_url IS NOT NULL) DESC,created_at DESC,account_id DESC
        ON CONFLICT (genshin_uid,wish_id) DO UPDATE SET
            icon_url=COALESCE(wish_uid_history.icon_url,EXCLUDED.icon_url)""")


async def migrate_reminder(c):
    await c.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-reminders-uid-v1'))")
    await c.execute("""CREATE TABLE IF NOT EXISTS reminder_uid_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    result = await c.execute("SELECT 1 FROM reminder_uid_migrations WHERE name='uid-v1'")
    if await result.fetchone():
        return
    # Preserve the original configuration of every reminder before merging conflicts.
    await c.execute(
        "CREATE TABLE IF NOT EXISTS reminder_uid_legacy_archive AS TABLE reminders WITH NO DATA"
    )
    await c.execute("INSERT INTO reminder_uid_legacy_archive SELECT * FROM reminders")
    await c.execute("""ALTER TABLE reminders ADD COLUMN IF NOT EXISTS superseded_by BIGINT
        REFERENCES reminders(id) ON DELETE CASCADE""")
    await c.execute("""WITH ranked AS (
        SELECT id,FIRST_VALUE(id) OVER(PARTITION BY genshin_uid,reminder_type,reminder_mode
            ORDER BY updated_at DESC,id DESC) AS canonical_id
        FROM reminders WHERE genshin_uid IS NOT NULL)
        UPDATE reminders r SET superseded_by=ranked.canonical_id,enabled=FALSE,next_trigger_at=NULL
        FROM ranked WHERE r.id=ranked.id AND ranked.id<>ranked.canonical_id""")
    await c.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_uid_type_mode
        ON reminders(genshin_uid,reminder_type,reminder_mode)
        WHERE genshin_uid IS NOT NULL AND superseded_by IS NULL""")
    await c.execute("INSERT INTO reminder_uid_migrations(name) VALUES('uid-v1')")


async def migrate_character(c):
    await c.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-character-planner-uid-v1'))")
    await c.execute("""CREATE TABLE IF NOT EXISTS character_uid_snapshots (
        genshin_uid TEXT PRIMARY KEY, plans JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    # Complete snapshots are authoritative: merging would resurrect deleted plans.
    # Retain the legacy snapshots, including those whose accounts were unlinked.
    await c.execute("""INSERT INTO character_uid_snapshots(genshin_uid,plans,updated_at)
        SELECT DISTINCT ON (genshin_uid) genshin_uid,plans,updated_at
        FROM character_plan_snapshots
        ORDER BY genshin_uid,updated_at DESC,discord_user_id DESC
        ON CONFLICT (genshin_uid) DO NOTHING""")


async def migrate_automation(c):
    await c.execute("SELECT pg_advisory_xact_lock(hashtext('cyrene-automation-uid-v1'))")
    await c.execute("""CREATE TABLE IF NOT EXISTS automation_uid_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    result = await c.execute("SELECT 1 FROM automation_uid_migrations WHERE name='uid-v1'")
    if await result.fetchone():
        return
    await c.execute("""CREATE TABLE IF NOT EXISTS gift_code_uid_settings (
        genshin_uid TEXT PRIMARY KEY, auto_claim_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await c.execute("""CREATE TABLE IF NOT EXISTS gift_code_uid_redemptions (
        genshin_uid TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL,
        message TEXT, attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(genshin_uid,code))""")
    await c.execute("""CREATE TABLE IF NOT EXISTS daily_checkin_uid_settings (
        genshin_uid TEXT PRIMARY KEY, auto_checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        last_claimed_date DATE, last_status TEXT, last_message TEXT,
        processing_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    # The latest explicit setting wins, including disabling automation.
    await c.execute("""INSERT INTO gift_code_uid_settings(genshin_uid,auto_claim_enabled,updated_at)
        SELECT DISTINCT ON (a.genshin_uid) a.genshin_uid,s.auto_claim_enabled,s.updated_at
        FROM gift_code_settings s JOIN accounts a ON a.id=s.account_id
        ORDER BY a.genshin_uid,s.updated_at DESC,a.id DESC
        ON CONFLICT DO NOTHING""")
    # A successful submission must win over later transient errors from another link.
    # All failed codes were already terminal for automatic attempts in the old worker.
    await c.execute("""INSERT INTO gift_code_uid_redemptions
        (genshin_uid,code,status,message,attempted_at)
        SELECT DISTINCT ON (a.genshin_uid,UPPER(TRIM(r.code)))
            a.genshin_uid,UPPER(TRIM(r.code)),r.status,r.message,r.attempted_at
        FROM gift_code_redemptions r JOIN accounts a ON a.id=r.account_id
        ORDER BY a.genshin_uid,UPPER(TRIM(r.code)),
            CASE r.status WHEN 'submitted' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
            r.attempted_at DESC,r.id DESC
        ON CONFLICT DO NOTHING""")
    await c.execute("""INSERT INTO daily_checkin_uid_settings
        (genshin_uid,auto_checkin_enabled,last_claimed_date,last_status,last_message,updated_at)
        SELECT DISTINCT ON (a.genshin_uid) a.genshin_uid,s.auto_checkin_enabled,
            MAX(s.last_claimed_date) OVER (PARTITION BY a.genshin_uid),
            s.last_status,s.last_message,s.updated_at
        FROM daily_checkin_settings s JOIN accounts a ON a.id=s.account_id
        ORDER BY a.genshin_uid,s.updated_at DESC,a.id DESC
        ON CONFLICT DO NOTHING""")
    await c.execute("INSERT INTO automation_uid_migrations(name) VALUES('uid-v1')")


async def migrate_weapon_scans(connection):
    """Share scans by UID, retaining legacy snapshots for recovery.

    Only seed missing UIDs: restarting must never undo shared edits or empty scans.
    The latest complete snapshot wins; combining snapshots would duplicate weapons.
    """
    await connection.execute(
        """CREATE TABLE IF NOT EXISTS weapon_account_scan_snapshots (
            genshin_uid TEXT PRIMARY KEY,
            scan_id TEXT NOT NULL,
            weapons JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"""
    )
    await connection.execute(
        """INSERT INTO weapon_account_scan_snapshots (genshin_uid, scan_id, weapons, updated_at)
        SELECT genshin_uid, scan_id, weapons, updated_at FROM (
            SELECT genshin_uid, scan_id, weapons, updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY genshin_uid ORDER BY updated_at DESC, discord_user_id DESC
                ) AS position
            FROM weapon_scan_snapshots
        ) legacy WHERE position = 1
        ON CONFLICT (genshin_uid) DO NOTHING"""
    )
