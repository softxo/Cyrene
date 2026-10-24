from discord import app_commands


def create_artifact_autocomplete(artifacts):
    async def artifact_autocomplete(
        interaction,
        current: str
    ):
        artifacts_list = [
            artifact
            for artifact in artifacts.values()
            if artifact.get("type") == "artifact_set"
        ]

        matches = [
            artifact
            for artifact in artifacts_list
            if current.lower() in artifact["name"].lower()
        ]

        matches.sort(
            key=lambda artifact: artifact["name"].lower()
        )

        return [
            app_commands.Choice(
                name=artifact["name"],
                value=artifact["name"]
            )
            for artifact in matches[:25]
        ]

    return artifact_autocomplete