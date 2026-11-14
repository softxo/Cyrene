import discord

from bot.utils.errors.error_handler import send_not_your_command


class OwnedView(discord.ui.View):
    """A view that only the user who opened it may use."""

    def __init__(self, owner_id: int, *, timeout: float | None = 300):
        super().__init__(timeout=timeout)

        self.owner_id = owner_id

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.owner_id:
            await send_not_your_command(interaction)
            return False

        return True
