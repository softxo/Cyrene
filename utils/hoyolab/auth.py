from dataclasses import dataclass


@dataclass
class HoYoLABCredentials:
    ltuid: str | None = None
    ltoken: str | None = None

    ltuid_v2: str | None = None
    ltoken_v2: str | None = None
    ltmid_v2: str | None = None

    cookie_token: str | None = None
    account_id: str | None = None

    cookie_token_v2: str | None = None
    account_mid_v2: str | None = None
    account_id_v2: str | None = None

    def as_cookies(self) -> dict[str, str]:
        cookies = {}

        for name in (
            "ltuid",
            "ltoken",
            "ltuid_v2",
            "ltoken_v2",
            "ltmid_v2",
            "cookie_token",
            "account_id",
            "cookie_token_v2",
            "account_mid_v2",
            "account_id_v2",
        ):
            value = getattr(self, name)

            if value:
                cookies[name] = value

        return cookies


def credentials_from_web_login(result) -> HoYoLABCredentials:
    return HoYoLABCredentials(
        ltuid_v2=result.ltuid_v2,
        ltoken_v2=result.ltoken_v2,
        ltmid_v2=result.ltmid_v2,
        cookie_token_v2=result.cookie_token_v2,
        account_mid_v2=result.account_mid_v2,
        account_id_v2=result.account_id_v2,
    )