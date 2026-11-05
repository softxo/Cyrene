import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from cogs.misc.fun.alice.commands import Love


class LoveCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_allowed_users_receive_exact_messages_in_both_commands(self):
        cog = Love(None)
        for user_id, message in (
            (1554226490462183505, "I love you, Everly (Shiori loves you too! Very very much)."),
            (1557792995179495497, "I love you, Shiori (Everly loves you too! Very very much)."),
        ):
            interaction = SimpleNamespace(
                user=SimpleNamespace(id=user_id), response=SimpleNamespace(send_message=AsyncMock())
            )
            await Love.love_slash.callback(cog, interaction)
            interaction.response.send_message.assert_awaited_once_with(message)
            ctx = SimpleNamespace(author=SimpleNamespace(id=user_id), send=AsyncMock())
            await Love.love_prefix.callback(cog, ctx)
            ctx.send.assert_awaited_once_with(message)

    async def test_other_users_cannot_receive_a_love_message(self):
        cog = Love(None)
        interaction = SimpleNamespace(
            user=SimpleNamespace(id=123), response=SimpleNamespace(send_message=AsyncMock())
        )
        await Love.love_slash.callback(cog, interaction)
        interaction.response.send_message.assert_awaited_once_with(
            "This command is not available to you.", ephemeral=True
        )
        ctx = SimpleNamespace(author=SimpleNamespace(id=123), send=AsyncMock())
        await Love.love_prefix.callback(cog, ctx)
        ctx.send.assert_not_awaited()
