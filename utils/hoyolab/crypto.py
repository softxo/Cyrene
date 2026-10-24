import os
from cryptography.fernet import Fernet


class HoYoLABCrypto:
    def __init__(self):
        key = os.getenv("HOYOLAB_ENCRYPTION_KEY")

        if not key:
            raise RuntimeError(
                "HOYOLAB_ENCRYPTION_KEY is not configured."
            )

        try:
            self.fernet = Fernet(key.encode())
        except Exception as exc:
            raise RuntimeError(
                "HOYOLAB_ENCRYPTION_KEY is invalid."
            ) from exc

    def encrypt(self, value: str) -> str:
        return self.fernet.encrypt(
            value.encode("utf-8")
        ).decode("utf-8")

    def decrypt(self, value: str) -> str:
        return self.fernet.decrypt(
            value.encode("utf-8")
        ).decode("utf-8")