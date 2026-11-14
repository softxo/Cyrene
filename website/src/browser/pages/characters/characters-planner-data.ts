// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
(() => {
    function safeCharacterIcon(value) {
        if (typeof value !== "string") return "";
        if (
            /^\/static\/images\/[a-zA-Z0-9_./-]+\.(?:png|webp)$/.test(value) &&
            !value.includes("..")
        )
            return value;
        try {
            const url = new URL(value);
            const trusted = [
                "enka.network",
                "mihoyo.com",
                "hoyoverse.com",
                "hoyolab.com",
                "gachabase.net",
            ];
            if (
                url.protocol === "https:" &&
                !url.username &&
                !url.password &&
                !url.port &&
                trusted.some(
                    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
                )
            )
                return url.href;
        } catch {}
        return "";
    }

    const elementIcons = {
        Anemo: "/static/images/characters/Element_Anemo.webp",
        Geo: "/static/images/characters/Element_Geo.webp",
        Electro: "/static/images/characters/Element_Electro.webp",
        Dendro: "/static/images/characters/Element_Dendro.webp",
        Hydro: "/static/images/characters/Element_Hydro.webp",
        Pyro: "/static/images/characters/Element_Pyro.webp",
        Cryo: "/static/images/characters/Element_Cryo.webp",
    };

    function getTalentBonuses(character, talents) {
        const normaliseText = (value) =>
            String(value || "")
                .replace(/<[^>]*>/g, " ")
                .toLocaleLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
        const activeEffects = (character?.constellations || [])
            .filter((item) => item?.activated && [3, 5].includes(Number(item.pos)))
            .map((item) => normaliseText(item.effect));

        return talents.map((talent, index) => {
            const name = normaliseText(talent?.name);
            const matched = name && activeEffects.some((effect) => effect.includes(name));

            return matched || (Number(talent?.level) > 10 && index > 0) ? 3 : 0;
        });
    }

    function withoutTalentBonuses(levels, bonuses) {
        return levels.map((level, index) =>
            Math.max(1, Number(level) - Number(bonuses?.[index] || 0)),
        );
    }

    function combinePlanCosts(costs, includeWeapon) {
        const groups = ["level", "talents", ...(includeWeapon ? ["weapon"] : [])];
        if (
            groups.some(
                (group) =>
                    !costs?.[group] || ["unavailable", "invalid"].includes(costs[group].status),
            )
        ) {
            return {
                status: "unavailable",
                items: [],
                message: "Some material costs couldn't be loaded. Please try again.",
            };
        }
        const items = new Map();

        ["level", "talents", "weapon"].forEach((group) => {
            (costs?.[group]?.items || []).forEach((item) => {
                const id = String(item.id);
                const existing = items.get(id);

                if (existing) {
                    existing.amount += Number(item.amount) || 0;
                } else {
                    items.set(id, {
                        ...item,
                        amount: Number(item.amount) || 0,
                    });
                }
            });
        });

        return {
            status: items.size > 0 ? "required" : "complete",
            items: Array.from(items.values()),
            preview: ["level", "talents", "weapon"].some((group) => costs?.[group]?.preview),
            message:
                items.size > 0
                    ? "Combined character, talent, and weapon costs."
                    : "All saved goals are already reached.",
        };
    }

    function unownedCharacter(plan) {
        const weapon = plan.plannedWeapon;
        return {
            name: plan.name,
            element: plan.element,
            level: 1,
            ascension: 0,
            constellation: 0,
            constellations: [],
            skills: [1, 2, 3].map((id) => ({ id, skill_type: 1, level: 1 })),
            weapon: weapon ? { ...weapon, level: 1, ascension: 0 } : null,
        };
    }

    window.CyrenePlannerData = {
        safeCharacterIcon,
        elementIcons,
        getTalentBonuses,
        withoutTalentBonuses,
        combinePlanCosts,
        unownedCharacter,
    };
})();
