"""Hands support activity from the website to the bot, and wakes pages waiting on a ticket."""

import asyncio
import logging

logger = logging.getLogger(__name__)
_relay = None
_locks: dict[int, asyncio.Lock] = {}
_tasks: set[asyncio.Task] = set()
_versions: dict[int, int] = {}
_waiters: dict[int, set[asyncio.Future]] = {}


def register(relay):
    global _relay
    _relay = relay


def unregister(relay):
    global _relay
    if _relay is relay:
        _relay = None


def send(event, ticket, message=None):
    task = asyncio.get_running_loop().create_task(_deliver(event, ticket, message))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _deliver(event, ticket, message):
    async with _locks.setdefault(ticket["id"], asyncio.Lock()):
        if _relay is None:
            return
        try:
            await _relay(event, ticket, message)
        except Exception:
            logger.exception(
                "Couldn't relay support %s for ticket %s to Discord.", event, ticket["id"]
            )


def version(ticket_id):
    return _versions.get(ticket_id, 0)


ANY_TICKET = 0


def touch(ticket_id):
    for key in {ticket_id, ANY_TICKET}:
        _versions[key] = version(key) + 1
        for waiter in _waiters.pop(key, ()):
            if not waiter.done():
                waiter.set_result(None)


async def wait(ticket_id, known, timeout):
    if version(ticket_id) != known:
        return version(ticket_id)
    waiter = asyncio.get_running_loop().create_future()
    _waiters.setdefault(ticket_id, set()).add(waiter)
    try:
        await asyncio.wait_for(waiter, timeout)
    except TimeoutError:
        pass
    finally:
        _waiters.get(ticket_id, set()).discard(waiter)
    return version(ticket_id)
