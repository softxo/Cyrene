"""Back up and retire migrated account-bound tables; run with --apply to commit."""

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg import sql
from psycopg.rows import dict_row

RETIRED = (
    "achievement_progress",
    "wish_history",
    "game_data_accounts",
    "character_plans",
    "character_plan_snapshots",
    "weapon_scan_snapshots",
    "event_activity_checks",
    "custom_event_account_order",
    "gift_code_settings",
    "gift_code_redemptions",
    "daily_checkin_settings",
    "reminder_uid_legacy_archive",
    "event_uid_migrations",
    "reminder_uid_migrations",
    "automation_uid_migrations",
)

# Verify identity coverage, rather than equal row counts: old Discord copies merge.
# Current values win; an intentional empty snapshot is still a migrated snapshot.
COVERAGE = {
    "achievement_progress": """SELECT count(*) AS missing FROM achievement_progress p
        JOIN game_data_accounts a ON a.id=p.account_id WHERE NOT EXISTS (
        SELECT 1 FROM achievement_uid_progress u WHERE u.genshin_uid=a.genshin_uid
        AND u.achievement_id=p.achievement_id AND u.tier=p.tier)""",
    "wish_history": """SELECT count(*) AS missing FROM wish_history l WHERE NOT EXISTS (
        SELECT 1 FROM wish_uid_history u WHERE u.genshin_uid=l.genshin_uid AND u.wish_id=l.wish_id)""",
    "character_plan_snapshots": """SELECT count(*) AS missing FROM character_plan_snapshots l WHERE NOT EXISTS (
        SELECT 1 FROM character_uid_snapshots u WHERE u.genshin_uid=l.genshin_uid)""",
    "character_plans": """SELECT count(*) AS missing FROM character_plans l JOIN accounts a ON a.id=l.account_id
        WHERE NOT EXISTS(SELECT 1 FROM character_uid_snapshots u WHERE u.genshin_uid=a.genshin_uid)""",
    "weapon_scan_snapshots": """SELECT count(*) AS missing FROM weapon_scan_snapshots l WHERE NOT EXISTS (
        SELECT 1 FROM weapon_account_scan_snapshots u WHERE u.genshin_uid=l.genshin_uid)""",
    "event_activity_checks": """SELECT count(*) AS missing FROM event_activity_checks l WHERE NOT EXISTS (
        SELECT 1 FROM event_uid_checks u WHERE u.genshin_uid=l.genshin_uid
        AND u.activity_type=l.activity_type AND u.period_key=l.period_key)""",
    "gift_code_settings": """SELECT count(*) AS missing FROM gift_code_settings l JOIN accounts a ON a.id=l.account_id
        WHERE NOT EXISTS(SELECT 1 FROM gift_code_uid_settings u WHERE u.genshin_uid=a.genshin_uid)""",
    "gift_code_redemptions": """SELECT count(*) AS missing FROM gift_code_redemptions l JOIN accounts a ON a.id=l.account_id
        WHERE NOT EXISTS(SELECT 1 FROM gift_code_uid_redemptions u
        WHERE u.genshin_uid=a.genshin_uid AND u.code=UPPER(TRIM(l.code)))""",
    "daily_checkin_settings": """SELECT count(*) AS missing FROM daily_checkin_settings l JOIN accounts a ON a.id=l.account_id
        WHERE NOT EXISTS(SELECT 1 FROM daily_checkin_uid_settings u WHERE u.genshin_uid=a.genshin_uid
        AND (l.last_claimed_date IS NULL OR u.last_claimed_date>=l.last_claimed_date))""",
    "custom_event_account_order": """SELECT count(*) AS missing FROM custom_event_account_order l
        JOIN accounts a ON a.id=l.account_id WHERE NOT EXISTS(SELECT 1 FROM custom_event_accounts u
        WHERE u.event_id=l.event_id AND u.genshin_uid=a.genshin_uid AND u.genshin_server=a.genshin_server)""",
}


def fingerprint(connection, schema, table):
    rows = connection.execute(
        sql.SQL("SELECT to_jsonb(t)::text AS value FROM {} t ORDER BY to_jsonb(t)::text").format(
            sql.Identifier(schema, table)
        )
    )
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        digest.update(row["value"].encode())
        digest.update(b"\n")
        count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


def retire(connection, backup_dir, *, apply=False):
    connection.execute("SET LOCAL lock_timeout='5s'")
    connection.execute("SET LOCAL statement_timeout='30s'")
    schema = connection.execute("SELECT current_schema() AS name").fetchone()["name"]
    tables = {
        r["tablename"]
        for r in connection.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname=%s", (schema,)
        )
    }
    obsolete = sorted(tables.intersection(RETIRED))
    if not obsolete:
        return {"dropped": [], "message": "No retired tables remain."}
    active = sorted(tables.difference(RETIRED))
    if apply:
        # Freeze the source and retained data for verification within one transaction.
        for names, mode in ((obsolete, "ACCESS EXCLUSIVE"), (active, "SHARE")):
            connection.execute(
                sql.SQL("LOCK TABLE {} IN " + mode + " MODE").format(
                    sql.SQL(",").join(sql.Identifier(schema, name) for name in names)
                )
            )
    for name, query in COVERAGE.items():
        if name in obsolete:
            missing = connection.execute(query).fetchone()["missing"]
            if missing:
                raise RuntimeError(
                    f"Cannot retire {name}: {missing} records have no UID destination."
                )
    before = {name: fingerprint(connection, schema, name) for name in active}
    if not apply:
        return {
            "ready_to_drop": obsolete,
            "retained": {name: value["rows"] for name, value in before.items()},
        }
    backup = {"schema": schema, "created_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    for name in obsolete:
        columns = connection.execute(
            """SELECT column_name,data_type,udt_name,column_default,is_nullable,
            is_identity,identity_generation FROM information_schema.columns
            WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position""",
            (schema, name),
        ).fetchall()
        constraints = connection.execute(
            """SELECT conname,pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conrelid=%s::regclass""",
            (f'"{schema}"."{name}"',),
        ).fetchall()
        indexes = connection.execute(
            "SELECT indexdef FROM pg_indexes WHERE schemaname=%s AND tablename=%s", (schema, name)
        ).fetchall()
        rows = connection.execute(
            sql.SQL("SELECT to_jsonb(t) AS value FROM {} t").format(sql.Identifier(schema, name))
        ).fetchall()
        backup["tables"][name] = {
            "columns": columns,
            "constraints": constraints,
            "indexes": indexes,
            "rows": [r["value"] for r in rows],
        }
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-legacy-uid-tables.json"
    )
    with backup_path.open("x", encoding="utf-8") as handle:
        json.dump(backup, handle, indent=2, ensure_ascii=False)
    # RESTRICT refuses to remove any unanticipated dependent object.
    connection.execute(
        sql.SQL("DROP TABLE {} RESTRICT").format(
            sql.SQL(",").join(sql.Identifier(schema, name) for name in obsolete)
        )
    )
    after = {name: fingerprint(connection, schema, name) for name in active}
    if before != after:
        raise RuntimeError("Retained data changed during retirement; rolling back.")
    return {
        "dropped": obsolete,
        "backup": str(backup_path),
        "retained_tables_verified": len(active),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Back up and commit the table retirement"
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env")
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
        result = retire(connection, root / "tools" / "uid-retirement-backups", apply=args.apply)
        if not args.apply:
            connection.rollback()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
