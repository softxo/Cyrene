const profiles = new Map();
let refreshing = false;
function setText(element, value) {
    if (element.textContent !== value)
        element.textContent = value;
}
export function applyAccountProfiles() {
    // Remember the selected label before updating its option's name.
    document.querySelectorAll(".custom-select").forEach(select => {
        const option = select.querySelector('.custom-select-option:is(.selected, .active, [aria-selected="true"]) [data-account-profile-name]');
        const value = select.querySelector(".custom-select-button > span:first-child");
        if (!option || !value || value.querySelector("[data-account-profile-name]"))
            return;
        const uid = option.dataset.accountProfileName;
        const profile = profiles.get(uid);
        if (!profile)
            return;
        const name = option.dataset.accountProfileField === "display"
            ? profile.cyrene_nickname || profile.nickname || uid : profile.nickname || uid;
        const previous = option.textContent || "";
        if (previous && value.textContent?.includes(previous)) {
            setText(value, value.textContent.replace(previous, name));
        }
    });
    document.querySelectorAll("[data-account-profile-name]").forEach(element => {
        const profile = profiles.get(element.dataset.accountProfileName);
        if (!profile)
            return;
        const name = element.dataset.accountProfileField === "display"
            ? profile.cyrene_nickname || profile.nickname || profile.uid : profile.nickname || profile.uid;
        setText(element, name);
    });
    document.querySelectorAll("[data-account-profile-rank]").forEach(element => {
        const profile = profiles.get(element.dataset.accountProfileRank);
        if (profile) {
            setText(element, String(profile.level ?? "Unknown"));
            const rank = element.closest(".planner-account-rank");
            if (rank?.hasAttribute("aria-label"))
                rank.setAttribute("aria-label", `Adventure Rank ${profile.level ?? "Unknown"}`);
        }
    });
    document.querySelectorAll("[data-account-profile-meta]").forEach(element => {
        const profile = profiles.get(element.dataset.accountProfileMeta);
        if (profile)
            setText(element, `UID ${profile.uid} ? AR ${profile.level ?? "Unknown"}`);
    });
    document.querySelectorAll("[data-account-profile-option]").forEach(element => {
        const profile = profiles.get(element.dataset.accountProfileOption);
        if (!profile)
            return;
        const name = profile.cyrene_nickname || profile.nickname || profile.uid;
        setText(element, name === profile.uid ? profile.uid : `${name} (${profile.uid})`);
    });
    document.querySelectorAll("[data-account-profile-label], [data-account-profile-aria]").forEach(element => {
        const uid = element.dataset.accountProfileLabel || element.dataset.accountProfileAria;
        const profile = profiles.get(uid);
        const previous = element.dataset.accountProfileOldName;
        if (!profile || !previous)
            return;
        const name = profile.nickname || profile.uid;
        const attribute = element.dataset.accountProfileLabel ? "data-label" : "aria-label";
        const value = element.getAttribute(attribute);
        if (value?.includes(previous))
            element.setAttribute(attribute, value.replace(previous, name));
        element.dataset.accountProfileOldName = name;
    });
    document.querySelectorAll("[data-account-profile-weapon]").forEach(element => {
        const profile = profiles.get(element.dataset.accountProfileWeapon);
        if (profile)
            element.dataset.accountNickname = profile.nickname || "";
    });
    for (const profile of profiles.values()) {
        const accounts = window.plannerAccounts;
        accounts?.filter(account => account.genshin_uid === profile.uid).forEach(account => Object.assign(account, {
            nickname: profile.nickname, cyrene_nickname: profile.cyrene_nickname, level: profile.level,
        }));
    }
}
async function refreshProfiles() {
    if (refreshing || document.hidden)
        return;
    refreshing = true;
    try {
        const response = await fetch("/api/hoyolab/accounts", {
            credentials: "same-origin", headers: { "X-Cyrene-Background": "1" },
        });
        if (!response.ok)
            return;
        const data = await response.json();
        profiles.clear();
        for (const account of data.accounts || [])
            profiles.set(String(account.uid), account);
        applyAccountProfiles();
        document.getElementById("linked-account-list")?.dispatchEvent(new CustomEvent("cyrene:account-profiles", { detail: data.accounts || [] }));
    }
    catch {
        // Preserve the current labels when offline or when authentication expires.
    }
    finally {
        refreshing = false;
    }
}
export function initialiseAccountProfiles() {
    void refreshProfiles();
    window.setInterval(() => void refreshProfiles(), 60_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden)
        void refreshProfiles(); });
    let queued = false;
    new MutationObserver(() => {
        if (queued)
            return;
        queued = true;
        queueMicrotask(() => { queued = false; applyAccountProfiles(); });
    }).observe(document.body, { childList: true, subtree: true });
}
