import genshin
import genshin.models.genshin.constants as constants

print("genshin version:", genshin.__version__ if hasattr(genshin, "__version__") else "unknown")

print("Available constants:")
print([name for name in dir(constants) if "CHARACTER" in name.upper() or "DBCHAR" in name.upper()])

print("Character name data:")
print(getattr(constants, "CHARACTER_NAMES", "Not available"))
