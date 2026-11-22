USER_TABLES = (
    ("custom_events", "discord_user_id"),
    ("custom_event_completions", "discord_user_id"),
    ("custom_event_progress", "discord_user_id"),
    ("reminders", "discord_user_id"),
    ("manual_weapons", "discord_user_id"),
    ("support_tickets", "discord_user_id"),
    ("web_sessions", "discord_user_id"),
    ("web_discord_oauth", "discord_user_id"),
    ("web_discord_profiles", "discord_user_id"),
)

UID_TABLES = (
    "achievement_uid_progress",
    "character_uid_snapshots",
    "daily_checkin_uid_settings",
    "event_uid_checks",
    "gift_code_uid_redemptions",
    "gift_code_uid_settings",
    "uid_import_dates",
    "weapon_account_scan_snapshots",
    "weapon_uid_plans",
    "wish_uid_history",
)


async def erase_user(pool, discord_user_id):
    async with pool.connection() as connection:
        async with connection.transaction():
            for table, column in USER_TABLES:
                await connection.execute(
                    f"DELETE FROM {table} WHERE {column} = %s", (discord_user_id,)
                )

            result = await connection.execute(
                "DELETE FROM shared_uploads WHERE uploader_id = %s RETURNING id",
                (discord_user_id,),
            )
            upload_ids = [row["id"] for row in await result.fetchall()]

            result = await connection.execute(
                "DELETE FROM accounts WHERE discord_user_id = %s RETURNING genshin_uid",
                (discord_user_id,),
            )
            uids = {row["genshin_uid"] for row in await result.fetchall()}

            for uid in sorted(uids):
                result = await connection.execute(
                    "SELECT 1 FROM accounts WHERE genshin_uid = %s LIMIT 1", (uid,)
                )

                if await result.fetchone() is not None:
                    continue

                for table in UID_TABLES:
                    await connection.execute(f"DELETE FROM {table} WHERE genshin_uid = %s", (uid,))

            result = await connection.execute("SELECT to_regclass('errors') AS name")
            errors_table = await result.fetchone()

            if errors_table["name"] is not None:
                await connection.execute(
                    "UPDATE errors SET user_id = NULL WHERE user_id = %s", (discord_user_id,)
                )

    return upload_ids
