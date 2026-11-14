type ExplorationArea = {
    name?: string;
    exploration_percentage?: number;
    area_exploration_list?: ExplorationArea[];
    type?: string;
    level?: number;
    offerings?: { name?: string; level?: number }[];
    natan_reputation?: { tribal_list?: { name?: string; level?: number }[] };
};
type ExplorationPayload = {
    regions?: ExplorationArea[];
    stats?: Record<string, number>;
    error?: string;
};
type RegionArtwork = {
    name: string;
    icon: string;
    background: string;
    aliases?: string[];
    branches?: RegionArtwork[];
};

const explorationRegions: RegionArtwork[] = [
    { name: "Snezhnaya", icon: "Snezhnaya", background: "Snezhnaya" },
    { name: "Temple of Space", icon: "Temple_of_Space", background: "Temple_of_Space" },
    {
        name: "Nod-Krai",
        icon: "Nod-Krai",
        background: "Nod-Krai",
        branches: [{ name: "Frost Moon", icon: "Frost_Moon", background: "Frost_Moon" }],
    },
    {
        name: "Natlan",
        icon: "Natlan",
        background: "Natlan",
        branches: [
            {
                name: "Ancient Sacred Mountain",
                icon: "Ancient_Sacred_Mountain",
                background: "Ancient_Sacred_Mountain",
            },
        ],
    },
    {
        name: "Fontaine",
        icon: "Fontaine",
        background: "Fontaine",
        branches: [
            {
                name: "Sea of Bygone Eras",
                icon: "Sea_of_Bygone_Eras",
                background: "Sea_of_Bygone_Eras",
            },
        ],
    },
    { name: "Sumeru", icon: "Sumeru", background: "Sumeru" },
    {
        name: "Inazuma",
        icon: "Inazuma",
        background: "Inazuma",
        branches: [{ name: "Enkanomiya", icon: "Enkanomiya", background: "Enkanomiya" }],
    },
    {
        name: "Liyue",
        icon: "Liyue",
        background: "Liyue",
        branches: [
            {
                name: "The Chasm: Underground Mines",
                icon: "The_Chasm",
                background: "The_Chasm_Underground_Mines",
                aliases: [
                    "The Chasm: Underground",
                    "The Chasm Underground Mines",
                    "The Chasm: Underground Mine",
                ],
            },
        ],
    },
    {
        name: "Mondstadt",
        icon: "Mondstadt",
        background: "Mondstadt",
    },
];

const namedAreas: Record<string, string[]> = {
    Snezhnaya: [
        "Everfrozen Earth",
        "Fellfrost Peak",
        "Flamefeather Valley",
        "Volkodlak Tundra",
        "White Birch Snowgrave",
        "Novokitezhgrad",
        "Wingspan Peak",
    ],
    "Frost Moon": ["Dark Side of the Moon", "Lunar Highlands", "Moontide Sea"],
    "Nod-Krai": [
        "Hiisi Island",
        "Lempo Isle",
        "Paha Isle",
        "Ashveil Peak",
        "Voidsea Outlook",
        "Wavechaser Plain",
        "Dunanna Pit",
    ],
    Natlan: [
        "Basin of Unnumbered Flames",
        "Coatepec Mountain",
        "Tequemecan Valley",
        "Toyac Springs",
        "Ochkanatlan",
        "Quahuacan Cliff",
        "Tezcatepetonco Range",
        "Atocpan",
        "Easybreeze Holiday Resort",
    ],
    Fontaine: [
        "Belleau Region",
        "Beryl Region",
        "Court of Fontaine Region",
        "Fontaine Research Institute of Kinetic Energy Engineering Region",
        "Liffey Region",
        "Erinnyes Forest",
        "Morte Region",
        "Nostoi Region",
    ],
    Sumeru: [
        "Ardravi Island",
        "Ashavan Realm",
        "Avidya Forest",
        "Lokapala Jungle",
        "Lost Nursery",
        "Vanarana",
        "Vissudha Field",
        "Hypostyle Desert",
        "Land of Lower Setekh",
        "Land of Upper Setekh",
        "Desert of Hadramaveth",
        "Gavireh Lajavard",
        "Realm of Farakhkert",
    ],
    Inazuma: [
        "Narukami Island",
        "Kannazuka",
        "Yashiori Island",
        "Seirai Island",
        "Watatsumi Island",
        "Tsurumi Island",
    ],
    Liyue: [
        "Bishui Plain",
        "Lisha",
        "Minlin",
        "Qiongji Estuary",
        "Sea of Clouds",
        "Chenyu Vale: Southern Mountain",
        "Chenyu Vale: Upper Vale",
        "Mt. Laixin",
        "The Chasm",
    ],
    Mondstadt: [
        "Brightcrown Mountains",
        "Galesong Hill",
        "Starfell Valley",
        "Windwail Highland",
        "Windrest Peak",
        "Dragonspine",
    ],
};

const areaAliases: Record<string, string[]> = {
    "Court of Fontaine Region": ["Court of Fontaine"],
    "Ardravi Island": ["Ardravi Valley"],
};
const specialAreaIcons: Record<string, string> = {
    Dragonspine: "Dragonspine",
    "Chenyu Vale: Upper Vale": "Chenyu_Vale",
    "Chenyu Vale: Southern Mountain": "Chenyu_Vale",
    "Mt. Laixin": "Chenyu_Vale",
    "The Chasm": "The_Chasm",
    "Hypostyle Desert": "Great_Red_Sand",
    "Land of Lower Setekh": "Great_Red_Sand",
    "Land of Upper Setekh": "Great_Red_Sand",
    "Desert of Hadramaveth": "Great_Red_Sand",
    "Gavireh Lajavard": "Girdle_of_the_Sands",
    "Realm of Farakhkert": "Girdle_of_the_Sands",
    "Easybreeze Holiday Resort": "Easybreeze_Holiday_Resort",
};

type LevelSpec = {
    name: string;
    max: number;
    icon?: string;
    section?: "meeting";
    owner?: string;
    aliases?: string[];
    small?: boolean;
};
const levelSpecs: LevelSpec[] = [
    {
        name: "Shadow Realm Analyzer",
        max: 9,
        icon: "meeting_points/Shadow_Realm_Analyzer.webp",
        small: true,
    },
    ...[
        "Tidesong Cavern",
        "Huntsman's Cabin",
        "The Korolevskiy Theater",
        "Teplo Oasis",
        "Royal Railway Transport Bureau",
        "Final Night Cemetery",
        "Clink-Clank Krumkake Craftshop",
        "Frostmoon Enclave",
        "The Witch's Garden",
        "Favonius Keep",
        "Cliffwatch Camp",
    ].map((name) => ({
        name,
        max: 5,
        section: "meeting" as const,
        icon: `meeting_points/${name.replaceAll(" ", "_").replaceAll("'", "%27")}_Meeting_Point_Level_Emblem.webp`,
    })),
    {
        name: "Nuur Stone Circle",
        max: 5,
        section: "meeting",
        owner: "Frost Moon",
        icon: "meeting_points/Nuur_Stone_Circle.png",
    },
    {
        name: "Curtain Form Blackbody Containment Lab",
        max: 5,
        section: "meeting",
        owner: "Frost Moon",
        icon: "meeting_points/Curtain_Form_Blackbody_Containment_Lab.png",
    },
    { name: "Memory Core", max: 10, icon: "icons/UI_Memory_Core.webp" },
    { name: "Tona's Flame", max: 50, icon: "icons/Tablet_of_Tona.webp", aliases: ["Tona?s Flame"] },
    ...[
        "People of the Springs",
        "Scions of the Canopy",
        "Children of Echoes",
        "Flower-Feather Clan",
        "Masters of the Night-Wind",
        "Collective of Plenty",
    ].map((name) => ({
        name,
        max: 4,
        section: "meeting" as const,
        icon: `meeting_points/${name.replaceAll(" ", "_")}_Icon.webp`,
    })),
    { name: "Fountain of Lucine", max: 50, icon: "icons/Fountain_of_Lucine.webp" },
    { name: "Tree of Dreams", max: 50, icon: "icons/Tree_of_Dreams.webp" },
    { name: "Amrita Pool", max: 6, icon: "icons/Amrita_Pool.webp" },
    {
        name: "Sacred Sakura's Favor",
        max: 50,
        icon: "icons/Sacred_Sakura.webp",
        aliases: ["Sacred Sakura's Favour", "Sacred Sakura", "Sacred Sakura?s Favor"],
    },
    {
        name: "Rainjade Oblation",
        max: 10,
        icon: "icons/Rainjade_Oblation.png",
        owner: "Liyue",
        small: true,
    },
    {
        name: "Lumenstone Adjuvant",
        max: 10,
        icon: "icons/Lumenstone_Adjuvant.png",
        owner: "The Chasm: Underground Mines",
        small: true,
    },
    {
        name: "Frostbearing Tree",
        max: 12,
        icon: "icons/Frostbearing_Tree.webp",
        owner: "Mondstadt",
    },
];
const reputationMax: Record<string, number> = {
    Fontaine: 10,
    Sumeru: 10,
    Inazuma: 10,
    Liyue: 8,
    Mondstadt: 8,
};

function initExploration(): void {
    const form = document.querySelector<HTMLFormElement>("[data-exploration-account-form]");
    if (form && !form.dataset.initialised) {
        form.dataset.initialised = "true";
        form.querySelectorAll<HTMLButtonElement>(".custom-select-option").forEach((option) => {
            option.addEventListener("click", () => {
                const input = form.querySelector<HTMLInputElement>('input[name="account_id"]');
                if (!input || !option.dataset.value) return;
                if (input.value === option.dataset.value) {
                    const select = option.closest(".custom-select");
                    select?.classList.remove("open");
                    select
                        ?.querySelector(".custom-select-button")
                        ?.setAttribute("aria-expanded", "false");
                    return;
                }
                input.value = option.dataset.value;
                form.requestSubmit();
            });
        });
    }
    const root = document.querySelector<HTMLElement>("[data-exploration-root]");
    if (!root || root.dataset.loading === "true") return;
    root.dataset.loading = "true";
    const node = (tag: string, className: string, value?: string): HTMLElement => {
        const element = document.createElement(tag);
        element.className = className;
        if (value !== undefined) element.textContent = value;
        return element;
    };
    const normalise = (value: string): string =>
        value.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "");
    const matches = (area: ExplorationArea, artwork: RegionArtwork): boolean =>
        [artwork.name, ...(artwork.aliases || [])].some(
            (name) => normalise(name) === normalise(area.name || ""),
        );
    const progress = (container: HTMLElement, value: unknown): void => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            container.append(node("span", "exploration-unavailable", "Unavailable"));
            return;
        }
        const amount = Math.max(0, Math.min(100, value / 10));
        const complete = amount >= 100;
        const label = node(
            "strong",
            `exploration-percentage${complete ? " is-complete" : ""}`,
            `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(amount)}%`,
        );
        const bar = node("div", `exploration-progress${complete ? " is-complete" : ""}`);
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", "Exploration progress");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(amount));
        const fill = node("span", "");
        fill.style.width = `${amount}%`;
        bar.append(fill);
        container.append(label, bar);
    };
    const expandAll = document.querySelector<HTMLButtonElement>("[data-exploration-toggle-all]");
    const updateAllButton = (): void => {
        if (!expandAll) return;
        const toggles = Array.from(
            root.querySelectorAll<HTMLButtonElement>(".exploration-card-toggle"),
        );
        const allExpanded =
            toggles.length > 0 &&
            toggles.every((toggle) => toggle.getAttribute("aria-expanded") === "true");
        const label = allExpanded ? "Shrink all" : "Expand all";
        expandAll.setAttribute("aria-label", label);
        expandAll.title = label;
        expandAll.classList.toggle("is-expanded", allExpanded);
        expandAll.disabled = toggles.length === 0;
    };
    expandAll?.addEventListener("click", () => {
        const expand = !expandAll.classList.contains("is-expanded");
        root.querySelectorAll<HTMLButtonElement>(".exploration-card-toggle").forEach((toggle) => {
            toggle.setAttribute("aria-expanded", String(expand));
            const name =
                toggle.closest(".exploration-card")?.querySelector("h2")?.textContent || "region";
            toggle.setAttribute("aria-label", `${expand ? "Shrink" : "Expand"} ${name}`);
            toggle.closest(".exploration-card")?.classList.toggle("is-expanded", expand);
        });
        updateAllButton();
    });
    const viewButtons = document.querySelectorAll<HTMLButtonElement>("[data-exploration-view]");
    let currentView = "list";
    try {
        if (sessionStorage.getItem("cyrene-exploration-view") === "grid") currentView = "grid";
    } catch {}
    const setView = (view: string): void => {
        currentView = view === "grid" ? "grid" : "list";
        root.querySelector<HTMLElement>(".exploration-regions")?.toggleAttribute(
            "hidden",
            currentView === "grid",
        );
        root.querySelector<HTMLElement>(".exploration-overview")?.toggleAttribute(
            "hidden",
            currentView !== "grid",
        );
        if (expandAll) expandAll.hidden = currentView === "grid";
        viewButtons.forEach((button) =>
            button.setAttribute(
                "aria-pressed",
                String(button.dataset.explorationView === currentView),
            ),
        );
        try {
            sessionStorage.setItem("cyrene-exploration-view", currentView);
        } catch {}
    };
    viewButtons.forEach((button) =>
        button.addEventListener("click", () => setView(button.dataset.explorationView || "list")),
    );
    const createCard = (
        artwork: RegionArtwork,
        region: ExplorationArea | undefined,
        branch: boolean,
        records: ExplorationArea[],
    ): HTMLElement => {
        const card = node("article", `exploration-card${branch ? " exploration-branch" : ""}`);
        const overlay =
            artwork.name === "The Chasm: Underground Mines"
                ? "linear-gradient(90deg, rgba(12, 17, 30, .88), rgba(12, 17, 30, .68) 58%, rgba(12, 17, 30, .45))"
                : "linear-gradient(90deg, rgba(12, 17, 30, .96), rgba(12, 17, 30, .82) 58%, rgba(12, 17, 30, .6))";
        card.style.backgroundImage = `${overlay}, url("/static/images/exploration/background/${artwork.background}.webp")`;
        const head = node("div", "exploration-card-head");
        const icon = document.createElement("img");
        icon.className = "exploration-icon";
        icon.src = `/static/images/exploration/${artwork.icon}.webp`;
        icon.alt = "";
        const title = node("div", "exploration-title");
        title.append(
            node("span", "exploration-eyebrow", branch ? "Related area" : "Region"),
            node("h2", "", artwork.name),
        );
        head.append(icon, title);
        const configured = namedAreas[artwork.name];
        const upstreamAreas = (region?.area_exploration_list || []).filter(
            (area) =>
                !explorationRegions.some(
                    (parent) =>
                        matches(area, parent) ||
                        parent.branches?.some((item) => matches(area, item)),
                ),
        );
        const matchesName = (area: ExplorationArea, name: string): boolean =>
            [name, ...(areaAliases[name] || [])].some(
                (candidate) => normalise(candidate) === normalise(area.name || ""),
            );
        const isConfigured = (area: ExplorationArea): boolean =>
            (configured || []).some((name) => matchesName(area, name));
        const areas: ExplorationArea[] = configured
            ? [
                  ...configured.map((name) => {
                      const local = upstreamAreas.find((area) => matchesName(area, name));
                      const candidates = records.filter((area) => matchesName(area, name));
                      const found = local || (candidates.length === 1 ? candidates[0] : undefined);
                      return { name, exploration_percentage: found?.exploration_percentage };
                  }),
                  ...upstreamAreas.filter(
                      (area) => !isConfigured(area) && normalise(area.name || "") !== "chenyuvale",
                  ),
              ]
            : upstreamAreas;
        const status = node("div", "exploration-status");
        const frostValues =
            artwork.name === "Frost Moon"
                ? areas.slice(0, 3).map((area) => area.exploration_percentage)
                : [];
        const frostProgress =
            frostValues.length === 3 &&
            frostValues.every((value) => typeof value === "number" && Number.isFinite(value))
                ? frostValues.reduce<number>(
                      (sum, value) => sum + Math.max(0, Math.min(1000, value as number)),
                      0,
                  ) / 3
                : undefined;
        progress(
            status,
            artwork.name === "Frost Moon" ? frostProgress : region?.exploration_percentage,
        );
        head.append(status);
        card.append(head);
        const levels: { name: string; level: number; spec?: LevelSpec }[] = [];
        const findSpec = (name: string): LevelSpec | undefined =>
            levelSpecs.find(
                (spec) =>
                    [spec.name, ...(spec.aliases || [])].some(
                        (alias) => normalise(alias) === normalise(name),
                    ) ||
                    (spec.name === "Collective of Plenty" &&
                        normalise(name).includes(normalise(spec.name))) ||
                    (spec.name === "Memory Core" && normalise(name).includes(normalise(spec.name))),
            );
        const addLevel = (name: unknown, level: unknown, fromOther = false): void => {
            if (
                typeof name !== "string" ||
                !name.trim() ||
                typeof level !== "number" ||
                !Number.isFinite(level) ||
                level < 0
            )
                return;
            if (
                ["Snezhnaya", "Nod-Krai", "Natlan"].includes(artwork.name) &&
                ["reputation", "reputationlevel"].includes(normalise(name))
            )
                return;
            const spec = findSpec(name);
            if (fromOther && spec?.owner !== artwork.name) return;
            if (spec?.owner && spec.owner !== artwork.name) return;
            const display = spec?.name || name.trim();
            if (!levels.some((item) => normalise(item.name) === normalise(display)))
                levels.push({ name: display, level, spec });
        };
        if (region?.type?.toLowerCase() === "reputation") addLevel("Reputation", region.level);
        for (const offering of region?.offerings || []) addLevel(offering.name, offering.level);
        for (const tribe of region?.natan_reputation?.tribal_list || [])
            addLevel(tribe.name, tribe.level);
        for (const source of records) {
            if (source === region) continue;
            if (source.name && source.type?.toLowerCase() !== "reputation")
                addLevel(source.name, source.level, true);
            for (const offering of source.offerings || [])
                addLevel(offering.name, offering.level, true);
            for (const tribe of source.natan_reputation?.tribal_list || [])
                addLevel(tribe.name, tribe.level, true);
        }
        const renderLevels = (items: typeof levels, heading: string, target: HTMLElement): void => {
            if (!items.length) return;
            const section = node("section", "exploration-levels");
            section.append(node("h3", "exploration-levels-title", heading));
            const levelList = node("div", "exploration-levels-list");
            for (const item of items) {
                const level = node("div", "exploration-level");
                const iconPath =
                    item.name === "Reputation" ? "icons/Reputation.png" : item.spec?.icon;
                if (iconPath) {
                    const image = document.createElement("img");
                    image.className = `exploration-level-icon${item.spec?.small ? " is-small" : ""}`;
                    image.alt = "";
                    image.src = `/static/images/exploration/${iconPath.split("/").map(encodeURIComponent).join("/")}`;
                    level.append(image);
                }
                const content = node("div", "exploration-level-content");
                const max =
                    item.name === "Reputation" ? reputationMax[artwork.name] : item.spec?.max;
                content.append(
                    node("span", "exploration-level-name", item.name),
                    node(
                        "strong",
                        `exploration-level-value${max !== undefined && item.level >= max ? " is-complete" : ""}`,
                        `Lv. ${item.level}`,
                    ),
                );
                level.append(content);
                levelList.append(level);
            }
            section.append(levelList);
            target.append(section);
        };
        renderLevels(
            levels.filter((item) => item.spec?.section !== "meeting"),
            "Regional progress",
            card,
        );
        const details = node("div", "exploration-card-details");
        const detailsContent = node("div", "exploration-card-details-content");
        details.append(detailsContent);
        renderLevels(
            levels.filter((item) => item.spec?.section === "meeting"),
            "Meeting points",
            detailsContent,
        );
        if (areas.length) {
            const list = node("div", "exploration-areas");
            for (const area of areas) {
                const row = node("div", "exploration-area");
                const areaIcon = document.createElement("img");
                areaIcon.className = "exploration-area-icon";
                areaIcon.alt = "";
                areaIcon.src = `/static/images/exploration/${specialAreaIcons[area.name || ""] || artwork.icon}.webp`;
                row.append(
                    areaIcon,
                    node("span", "exploration-area-name", area.name || "Unnamed area"),
                );
                const detail = node("div", "exploration-area-status");
                progress(detail, area.exploration_percentage);
                row.append(detail);
                list.append(row);
            }
            detailsContent.append(list);
        }
        if (!detailsContent.childElementCount) return card;
        card.classList.add("has-details");
        card.append(details);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "exploration-card-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", `Expand ${artwork.name}`);
        toggle.append(node("span", "exploration-toggle-arrow"));
        toggle.addEventListener("click", () => {
            const expanded = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Shrink" : "Expand"} ${artwork.name}`);
            card.classList.toggle("is-expanded", expanded);
            updateAllButton();
        });
        card.append(toggle);
        return card;
    };
    const explorationWindow = window as Window & {
        explorationPrefetch?: { accountId: string; ok: boolean; payload: unknown };
        beginExplorationLoading?: () => () => void;
    };
    const prefetch =
        explorationWindow.explorationPrefetch?.accountId === root.dataset.accountId
            ? explorationWindow.explorationPrefetch
            : undefined;
    explorationWindow.explorationPrefetch = undefined;
    const finishLoading = prefetch ? undefined : explorationWindow.beginExplorationLoading?.();
    void (async () => {
        try {
            const response = prefetch
                ? undefined
                : await fetch(
                      `/api/exploration?account_id=${encodeURIComponent(root.dataset.accountId || "")}`,
                  );
            const data = (
                prefetch ? prefetch.payload : await response!.json()
            ) as ExplorationPayload;
            if (!(prefetch ? prefetch.ok : response!.ok))
                throw new Error(data.error || "Couldn't retrieve exploration progress.");
            const regions = Array.isArray(data.regions) ? data.regions : [];
            root.replaceChildren();
            if (!regions.length) {
                root.append(
                    node(
                        "div",
                        "exploration-message",
                        "HoYoLAB did not return any exploration progress for this account.",
                    ),
                );
                return;
            }
            const records = regions.flatMap((area) => [
                area,
                ...(area.area_exploration_list || []),
            ]);
            const list = node("div", "exploration-regions");
            const overview = node("div", "exploration-overview");
            const addOverviewCard = (card: HTMLElement): void => {
                const head = card.querySelector<HTMLElement>(".exploration-card-head");
                if (!head) return;
                const tile = document.createElement("button");
                tile.type = "button";
                tile.className = "exploration-overview-card";
                tile.style.backgroundImage = card.style.backgroundImage;
                tile.append(head.cloneNode(true));
                tile.setAttribute(
                    "aria-label",
                    `Show ${card.querySelector("h2")?.textContent || "region"} details`,
                );
                tile.addEventListener("click", () => {
                    setView("list");
                    card.scrollIntoView({ block: "center", behavior: "smooth" });
                    card.querySelector<HTMLButtonElement>(".exploration-card-toggle")?.focus({
                        preventScroll: true,
                    });
                });
                overview.append(tile);
            };
            for (const artwork of explorationRegions) {
                const parent =
                    regions.find((area) => matches(area, artwork)) ||
                    regions
                        .flatMap((area) => area.area_exploration_list || [])
                        .find((area) => matches(area, artwork));
                const group = node("section", "exploration-region-group");
                const mainCard = createCard(artwork, parent, false, records);
                group.append(mainCard);
                for (const child of artwork.branches || []) {
                    const region =
                        regions.find((area) => matches(area, child)) ||
                        parent?.area_exploration_list?.find((area) => matches(area, child));
                    const branch = node("div", "exploration-branch-link");
                    const branchCard = createCard(child, region, true, records);
                    const eyebrow = branchCard.querySelector(".exploration-eyebrow");
                    if (eyebrow) eyebrow.textContent = `${artwork.name} / Related area`;
                    addOverviewCard(branchCard);
                    branch.append(branchCard);
                    group.append(branch);
                }
                addOverviewCard(mainCard);
                list.append(group);
            }
            root.append(list, overview);
            setView(currentView);
            updateAllButton();
        } catch (error) {
            const message = node("div", "exploration-message");
            message.append(
                node("h2", "", "Unable to load exploration"),
                node("p", "", error instanceof Error ? error.message : "Please try again."),
            );
            root.replaceChildren(message);
        } finally {
            root.closest<HTMLElement>(".exploration-page")?.removeAttribute("hidden");
            finishLoading?.();
        }
    })();
}
window.initExploration = initExploration;
