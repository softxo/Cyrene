import inspect
from genshin.models.genshin.chronicle import characters as models

for name in ("Character", "GenshinDetailCharacters"):
    model = getattr(models, name, None)

    print(f"\n--- {name} ---")

    if model is None:
        print("Class not found")
        continue

    print("Annotations:", getattr(model, "__annotations__", {}))

    fields = getattr(model, "model_fields", None)
    if fields:
        print("Model fields:", list(fields.keys()))

    attrs = getattr(model, "__attrs_attrs__", None)
    if attrs:
        print("Attrs fields:", [attr.name for attr in attrs])