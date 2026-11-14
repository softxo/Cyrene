// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
window.initAchievements = function () {
    const page = document.querySelector(".achievements-page");
    const accountId = page?.dataset.achievementAccountId;

    function achievementApiUrl(path) {
        const separator = path.includes("?") ? "&" : "?";
        return `${path}${separator}account_id=${encodeURIComponent(accountId)}`;
    }

    const accountForm = document.querySelector(".achievements-account-form");
    const accountSelect = accountForm?.querySelector(".achievements-account-select");
    const accountButton = accountSelect?.querySelector(".custom-select-button");
    const accountInput = accountSelect?.querySelector('input[name="account_id"]');

    accountButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = !accountSelect.classList.contains("open");
        accountSelect.classList.toggle("open", open);
        accountButton.setAttribute("aria-expanded", String(open));
    });

    accountSelect?.querySelectorAll(".custom-select-option").forEach((option) => {
        option.addEventListener("click", () => {
            if (!option.dataset.value || !accountInput) {
                return;
            }
            accountInput.value = option.dataset.value;
            accountForm.requestSubmit();
        });
    });

    const categories = document.getElementById("achievement-categories");
    const categoryGrid = document.getElementById("achievement-category-grid");
    const browser = document.getElementById("achievement-browser");
    const backButton = document.getElementById("achievement-back");
    const sidebarList = document.getElementById("achievement-sidebar-list");
    const achievementList = document.getElementById("achievement-list");
    const categoryTitle = document.getElementById("achievement-category-title");
    const categoryPercent = document.getElementById("achievement-category-percent");
    const categoryProgressFill = document.getElementById("achievement-category-progress-fill");
    const achievementNotesModal = document.getElementById("achievement-notes-modal");
    const achievementNotesModalClose = document.getElementById("achievement-notes-modal-close");
    const achievementNotesModalCancel = document.getElementById("achievement-notes-cancel");
    const achievementNotesModalAdd = document.getElementById("achievement-notes-add");
    const achievementNotesModalBackdrop = document.getElementById(
        "achievement-notes-modal-backdrop",
    );
    const achievementNotesInput = document.getElementById("achievement-notes-input");

    function openAchievementNotesModal() {
        achievementNotesModal.hidden = false;

        achievementNotesInput.value = "";

        requestAnimationFrame(() => {
            achievementNotesInput.focus();
        });
    }

    function closeAchievementNotesModal() {
        achievementNotesModal.hidden = true;

        achievementNotesInput.value = "";
    }

    achievementNotesModalClose.addEventListener("click", closeAchievementNotesModal);

    achievementNotesModalCancel.addEventListener("click", closeAchievementNotesModal);

    achievementNotesModalBackdrop.addEventListener("click", closeAchievementNotesModal);

    achievementNotesModalAdd.addEventListener("click", async () => {
        const note = achievementNotesInput.value.trim();

        if (!note) {
            achievementNotesInput.focus();
            return;
        }

        if (!achievementNoteTarget) {
            return;
        }

        const { achievement, tier } = achievementNoteTarget;

        try {
            const response = await fetch(
                achievementApiUrl(
                    `/api/achievements/${encodeURIComponent(
                        tier.genshin_id,
                    )}/tiers/${tier.tier}/note`,
                ),
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type": "application/json",
                    },

                    body: JSON.stringify({
                        note: note,
                    }),
                },
            );

            if (!response.ok) {
                const result = await response.json();

                throw new Error(result.detail || "Failed to save note.");
            }

            tier.note = note;

            buildAchievements(achievement.category);

            closeAchievementNotesModal();

            achievementNoteTarget = null;
        } catch (error) {
            console.error("[Achievements] Failed to save note:", error);

            alert(error.message);
        }
    });

    let achievementData = null;
    let achievementsByCategory = new Map();
    let achievementListObserver = null;
    let searchRebuildTimer = null;
    let achievementSearchQuery = "";
    let hideCompletedAchievements = false;
    const achievementSelectedVersions = new Set();
    let achievementNoteTarget = null;
    let activeCategory = null;

    function getCategoryIcon(category) {
        const icon = achievementData.categories[category]?.icon_url;
        if (
            typeof icon === "string" &&
            /^https:\/\/static\.wikia\.nocookie\.net\/gensin-impact\/images\/[^?#]+\.png$/.test(
                icon,
            )
        ) {
            return escapeHTML(icon);
        }
        return "/static/images/ui/ui_icons/Achievements.png";
    }

    function filteredCategoryProgress(category) {
        const achievements = (achievementsByCategory.get(category) || []).filter((achievement) =>
            achievementMatchesFilters(achievement),
        );
        const tiers = achievements.flatMap((achievement) => achievement.tiers || []);
        return {
            total: tiers.length,
            completed: tiers.filter((tier) => tier.completed).length,
            matches: achievements.length,
        };
    }

    const CATEGORY_ORDER = [
        "Wonders of the World",
        "Memories of the Heart",
        "Mortal Travails: Series I",
        "Mortal Travails: Series II",
        "Mortal Travails: Series III",
        "Mortal Travails: Series IV",
        "Mortal Travails: Series V",
        "Mortal Travails: Series VI",
        "Mortal Travails: Series VII",
        "The Art of Adventure",
        "The Hero's Journey",
        "Mondstadt: The City of Wind and Song",
        "Liyue: The Harbor of Stone and Contracts",
        "Elemental Specialist: Series I",
        "Elemental Specialist: Series II",
        "Marksmanship",
        "Challenger: Series I",
        "Challenger: Series II",
        "Challenger: Series III",
        "Challenger: Series IV",
        "Challenger: Series V",
        "Challenger: Series VI",
        "Challenger: Series VII",
        "Challenger: Series VIII",
        "Challenger: Series IX",
        "Challenger: Series X",
        "Domains and Spiral Abyss: Series I",
        "Olah!: Series I",
        "Snezhnaya Does Not Believe in Tears: Series I",
        "Stone Harbor's Nostalgia: Series I",
        "Meetings in Outrealm: Series I",
        "Meetings in Outrealm: Series II",
        "Meetings in Outrealm: Series III",
        "Meetings in Outrealm: Series IV",
        "Meetings in Outrealm: Series V",
        "Meetings in Outrealm: Series VI",
        "Meetings in Outrealm: Series VII",
        "Visitors on the Icy Mountain",
        "A Realm Beyond: Series I",
        "A Realm Beyond: Series II",
        "A Realm Beyond: Series III",
        "Inazuma: The Islands of Thunder and Eternity - Series I",
        "Inazuma: The Islands of Thunder and Eternity - Series II",
        "Inazuma: The Islands of Thunder and Eternity - Series III",
        "The Chronicles of the Sea of Fog",
        "Teyvat Fishing Guide: Series I",
        "The Light of Day",
        "Chasmlighter",
        "Sumeru: The Rainforest of Lore",
        "Sumeru: The Gilded Desert - Series I",
        "Sumeru: The Gilded Desert - Series II",
        "Genius Invokation TCG",
        "Blessed Hamada",
        "Fontaine: Dance of the Dew-White Springs (I)",
        "Fontaine: Dance of the Dew-White Springs (II)",
        "Fontaine: Dance of the Dew-White Springs (III)",
        "Chenyu's Splendor",
        "Rhapsodia in the Ancient Sea",
        "Imaginarium Theater: The First Folio",
        "Imaginarium Theater: The Second Folio",
        "Natlan: The Land of Fire and Competition (I)",
        "Natlan: The Land of Fire and Competition (II)",
        "Duelist: Series I",
        "Duelist: Series II",
        "Duelist: Series III",
        "Repertoire of Myriad Melodies",
        "Sacred Mountain's Fading Glow",
        "A Summer of Ash and Prickly Pears",
        "Nod-Krai: An Elysium of Moonlight and Wanderings (I)",
        "Nod-Krai: An Elysium of Moonlight and Wanderings (II)",
        "Demon Mountain's Breath",
        "Unfettered Crescent",
        "Snezhnaya: Sacred city of ice and pale star (I)",
        "Land of Surging Shadows (I)",
    ];

    function orderedCategories() {
        const normalise = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const family = (name) =>
            normalise(name.replace(/(?:\s*-?\s*Series\s+[IVXLCDM]+|\s*\([IVXLCDM]+\))$/i, ""));
        const familyRanks = new Map();
        CATEGORY_ORDER.forEach((name, index) => {
            if (!familyRanks.has(family(name))) familyRanks.set(family(name), index);
        });
        const romanNumber = (name) => {
            const match = name.match(/(?:Series\s+|\()([IVXLCDM]+)\)?$/i);
            if (!match) return 0;
            const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
            const digits = [...match[1].toUpperCase()].map((digit) => values[digit]);
            return digits.reduce(
                (sum, value, index) => sum + (value < (digits[index + 1] || 0) ? -value : value),
                0,
            );
        };
        return Object.keys(achievementData.categories).sort((a, b) => {
            const rankA = familyRanks.get(family(a)) ?? Number.MAX_SAFE_INTEGER;
            const rankB = familyRanks.get(family(b)) ?? Number.MAX_SAFE_INTEGER;
            return (
                rankA - rankB ||
                family(a).localeCompare(family(b)) ||
                romanNumber(a) - romanNumber(b) ||
                a.localeCompare(b)
            );
        });
    }

    const achievementSearchInputs = document.querySelectorAll("[data-achievement-search]");
    const achievementHideCompletedInputs = document.querySelectorAll(
        "[data-achievement-hide-completed]",
    );
    const achievementImportButton = document.getElementById("achievement-import-button");
    const achievementImportInput = document.getElementById("achievement-import-input");
    const achievementImportSuccess = document.getElementById("achievement-import-success");
    const achievementImportSuccessMessage = document.getElementById(
        "achievement-import-success-message",
    );
    let achievementImportSuccessTimer = null;

    function showAchievementImportSuccess(result) {
        if (!achievementImportSuccess) {
            return;
        }

        if (achievementImportSuccessMessage) {
            const matched = Number(result?.matched) || 0;
            achievementImportSuccessMessage.textContent = `${matched} achievement${matched === 1 ? "" : "s"} imported successfully.`;
        }

        window.clearTimeout(achievementImportSuccessTimer);
        achievementImportSuccess.hidden = false;

        achievementImportSuccessTimer = window.setTimeout(() => {
            achievementImportSuccess.hidden = true;
        }, 2200);
    }

    if (achievementImportButton && achievementImportInput) {
        achievementImportButton.addEventListener("click", () => {
            achievementImportInput.click();
        });

        achievementImportInput.addEventListener("change", async () => {
            const file = achievementImportInput.files[0];

            if (!file) {
                return;
            }

            const formData = new FormData();

            formData.append("file", file);

            try {
                achievementImportButton.disabled = true;

                const response = await fetch(achievementApiUrl("/api/achievements/import"), {
                    method: "POST",
                    body: formData,
                });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.detail || "Failed to import achievements.");
                }

                achievementImportInput.value = "";

                if (await loadAchievements()) {
                    showAchievementImportSuccess(result);
                }
            } catch (error) {
                console.error("Achievement import failed:", error);

                achievementImportInput.value = "";

                alert(error.message);
            } finally {
                achievementImportButton.disabled = false;
            }
        });
    }

    function getAchievementVersions(achievement) {
        if (!achievement.version) {
            return [];
        }

        return [String(achievement.version)];
    }

    function buildVersionOptions() {
        const select = document.getElementById("achievement-version-select");

        if (!select || !achievementData) {
            return;
        }

        const menu = select.querySelector(".custom-select-menu");
        const value = select.querySelector(".custom-select-value");

        if (!menu || !value) {
            return;
        }

        menu.innerHTML = "";
        menu.setAttribute("role", "listbox");
        menu.setAttribute("aria-multiselectable", "true");

        const versions = new Set();

        achievementData.achievements.forEach((achievement) => {
            getAchievementVersions(achievement).forEach((version) => {
                versions.add(version);
            });
        });

        function getVersionPosition(version) {
            const value = String(version).trim();
            const normalMatch = value.match(/^(\d+)\.(\d+)$/);

            if (normalMatch) {
                return {
                    major: Number(normalMatch[1]),
                    minor: Number(normalMatch[2]),
                };
            }

            const lunaMatch = value.match(/\[(\d+)\.(\d+)\]/);

            if (lunaMatch) {
                return {
                    major: Number(lunaMatch[1]),
                    minor: Number(lunaMatch[2]),
                };
            }

            return {
                major: 999,
                minor: 999,
            };
        }

        function formatVersionLabel(version) {
            const value = String(version).trim();
            const lunaMatch = value.match(/^"?(Luna[^"]*)"?.*\[(\d+\.\d+)\]/i);

            if (lunaMatch) {
                return lunaMatch[1];
            }

            return value;
        }

        const sortedVersions = [...versions].sort((a, b) => {
            const aPosition = getVersionPosition(a);
            const bPosition = getVersionPosition(b);

            if (aPosition.major !== bPosition.major) {
                return aPosition.major - bPosition.major;
            }

            return aPosition.minor - bPosition.minor;
        });
        const allOption = document.createElement("button");

        allOption.type = "button";

        allOption.className = "custom-select-option";

        allOption.classList.add("version-all-option");

        allOption.style.gridColumn = "1 / -1";

        allOption.dataset.value = "all";

        const allVersionsSelected = achievementSelectedVersions.size === 0;

        allOption.classList.toggle("selected", allVersionsSelected);

        allOption.setAttribute("aria-selected", allVersionsSelected ? "true" : "false");

        allOption.textContent = "All Versions";

        allOption.setAttribute("role", "option");

        allOption.addEventListener("click", () => {
            achievementSelectedVersions.clear();
            syncVersionSelection();
            rebuildCategoryView();
        });

        menu.appendChild(allOption);

        const versionGroups = new Map();

        sortedVersions.forEach((version) => {
            const position = getVersionPosition(version);

            if (position.major === 999) {
                return;
            }

            if (!versionGroups.has(position.major)) {
                versionGroups.set(position.major, []);
            }

            versionGroups.get(position.major).push({
                version,
                minor: position.minor,
            });
        });

        const majorVersions = [...versionGroups.keys()].sort((a, b) => a - b);
        const maxMinor = Math.max(
            ...[...versionGroups.values()].flatMap((versions) =>
                versions.map((entry) => entry.minor),
            ),
            0,
        );

        for (let minor = 0; minor <= maxMinor; minor++) {
            majorVersions.forEach((major) => {
                const versionsForMajor = versionGroups.get(major);
                const versionEntry = versionsForMajor.find((entry) => entry.minor === minor);

                if (!versionEntry) {
                    const spacer = document.createElement("div");

                    spacer.className = "custom-select-option-spacer";

                    menu.appendChild(spacer);

                    return;
                }

                const version = versionEntry.version;
                const option = document.createElement("button");

                if (minor === 0) {
                    option.classList.add("achievement-version-first-row");
                }

                option.type = "button";

                option.className = "custom-select-option";

                option.setAttribute("role", "option");

                option.setAttribute("aria-selected", "false");

                option.dataset.value = version;

                option.textContent = formatVersionLabel(version);

                option.addEventListener("click", (event) => {
                    event.stopPropagation();
                    const selectedValue = option.dataset.value;
                    if (achievementSelectedVersions.has(selectedValue)) {
                        achievementSelectedVersions.delete(selectedValue);
                    } else {
                        achievementSelectedVersions.add(selectedValue);
                    }
                    syncVersionSelection();
                    rebuildCategoryView();
                });

                menu.appendChild(option);
            });
        }

        menu.querySelectorAll(".custom-select-option").forEach((option) => {
            const selected =
                option.dataset.value === "all"
                    ? achievementSelectedVersions.size === 0
                    : achievementSelectedVersions.has(option.dataset.value);

            option.classList.toggle("selected", selected);

            option.setAttribute("aria-selected", selected ? "true" : "false");
        });

        function focusSelectedVersionOption() {
            const selectedOption = menu.querySelector(".custom-select-option.selected");

            if (!selectedOption) {
                return;
            }

            selectedOption.setAttribute("tabindex", "0");

            selectedOption.focus({
                preventScroll: true,
            });
        }

        const button = select.querySelector(".custom-select-button");

        if (button) {
            button.onclick = function (event) {
                event.preventDefault();
                event.stopPropagation();

                const shouldOpen = !select.classList.contains("open");

                document.querySelectorAll(".custom-select.open").forEach((otherSelect) => {
                    if (otherSelect !== select) {
                        otherSelect.classList.remove("open");

                        const otherButton = otherSelect.querySelector(".custom-select-button");

                        if (otherButton) {
                            otherButton.setAttribute("aria-expanded", "false");
                        }
                    }
                });

                select.classList.toggle("open", shouldOpen);

                button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

                if (shouldOpen) {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            focusSelectedVersionOption();
                        });
                    });
                }
            };
        }
    }

    function syncVersionSelection() {
        const primary = document.getElementById("achievement-version-select");
        primary.querySelector(".custom-select-value").textContent = achievementSelectedVersions.size
            ? [...achievementSelectedVersions].join(", ")
            : "All Versions";
        primary.querySelectorAll(".custom-select-option").forEach((option) => {
            const selected =
                option.dataset.value === "all"
                    ? achievementSelectedVersions.size === 0
                    : achievementSelectedVersions.has(option.dataset.value);
            option.classList.toggle("selected", selected);
            option.setAttribute("aria-selected", String(selected));
        });
        syncSecondaryVersionSelect();
    }

    function syncVersionResetButtons() {
        document.querySelectorAll("[data-achievement-version-select]").forEach((select) => {
            let reset = select.querySelector(".achievement-version-reset");
            if (!reset) {
                reset = document.createElement("button");
                reset.type = "button";
                reset.className = "achievement-version-reset";
                reset.setAttribute("aria-label", "Reset to All Versions");
                const icon = document.createElement("span");
                icon.className = "cyrene-close";
                icon.setAttribute("aria-hidden", "true");
                reset.appendChild(icon);
                reset.onclick = (event) => {
                    event.stopPropagation();
                    achievementSelectedVersions.clear();
                    syncVersionSelection();
                    rebuildCategoryView();
                };
                select.appendChild(reset);
            }
            reset.hidden = achievementSelectedVersions.size === 0;
            const label = achievementSelectedVersions.size
                ? [...achievementSelectedVersions].join(", ")
                : "All Versions";
            select.style.setProperty(
                "--version-select-width",
                `${Math.min(420, Math.max(170, label.length * 8 + 100))}px`,
            );
        });
    }

    function syncSecondaryVersionSelect() {
        syncVersionResetButtons();
        const primary = document.getElementById("achievement-version-select");
        const secondary = [...document.querySelectorAll("[data-achievement-version-select]")].find(
            (select) => select !== primary,
        );

        if (!primary || !secondary) {
            return;
        }

        const primaryMenu = primary.querySelector(".custom-select-menu");
        const secondaryMenu = secondary.querySelector(".custom-select-menu");
        const secondaryValue = secondary.querySelector(".custom-select-value");
        const secondaryButton = secondary.querySelector(".custom-select-button");

        if (!primaryMenu || !secondaryMenu || !secondaryValue || !secondaryButton) {
            return;
        }

        secondaryValue.textContent = primary.querySelector(".custom-select-value").textContent;
        secondaryMenu.replaceChildren(
            ...[...primaryMenu.childNodes].map((node) => node.cloneNode(true)),
        );
        secondaryMenu.setAttribute("role", "listbox");
        secondaryMenu.setAttribute("aria-multiselectable", "true");

        secondaryMenu.querySelectorAll(".custom-select-option").forEach((option) => {
            option.addEventListener("click", (event) => {
                event.stopPropagation();
                const primaryOption = [
                    ...primaryMenu.querySelectorAll(".custom-select-option"),
                ].find((item) => item.dataset.value === option.dataset.value);

                primaryOption?.click();
            });
        });

        secondaryButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const open = !secondary.classList.contains("open");
            secondary.classList.toggle("open", open);
            secondaryButton.setAttribute("aria-expanded", String(open));
        };
    }

    function achievementIsCompleted(achievement) {
        if (!Array.isArray(achievement.tiers) || achievement.tiers.length === 0) {
            return false;
        }

        return achievement.tiers.every((tier) => tier.completed === true);
    }

    function achievementMatchesFilters(achievement, filterCompleted = true) {
        if (achievementSearchQuery) {
            const query = achievementSearchQuery.toLowerCase().trim();

            if (!achievement.searchText.includes(query)) return false;
        }

        if (
            achievementSelectedVersions.size &&
            !getAchievementVersions(achievement).some((version) =>
                achievementSelectedVersions.has(version),
            )
        ) {
            return false;
        }

        if (filterCompleted && hideCompletedAchievements && achievementIsCompleted(achievement)) {
            return false;
        }

        return true;
    }

    function rebuildCategoryView() {
        clearTimeout(searchRebuildTimer);
        if (activeCategory && !browser.hidden) {
            buildSidebar(activeCategory);
            buildAchievements(activeCategory);
            return;
        }

        buildCategories();
    }

    achievementSearchInputs.forEach((achievementSearch) => {
        achievementSearch.addEventListener("input", () => {
            achievementSearchQuery = achievementSearch.value;

            achievementSearchInputs.forEach((input) => {
                if (input !== achievementSearch) {
                    input.value = achievementSearch.value;
                }
            });

            clearTimeout(searchRebuildTimer);
            searchRebuildTimer = setTimeout(rebuildCategoryView, 120);
        });
    });

    achievementHideCompletedInputs.forEach((achievementHideCompleted) => {
        achievementHideCompleted.addEventListener("change", () => {
            hideCompletedAchievements = achievementHideCompleted.checked;

            achievementHideCompletedInputs.forEach((input) => {
                input.checked = achievementHideCompleted.checked;
            });

            rebuildCategoryView();
        });
    });

    async function loadAchievements() {
        if (accountId) void window.refreshImportDate?.("achievements", accountId);
        if (!accountId) {
            return;
        }

        try {
            const response = await fetch(achievementApiUrl("/api/achievements"), {
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error("Failed to load achievements.");
            }

            achievementData = await response.json();
            achievementsByCategory = new Map();
            achievementData.achievements.forEach((achievement) => {
                if (!achievementsByCategory.has(achievement.category))
                    achievementsByCategory.set(achievement.category, []);
                achievementsByCategory.get(achievement.category).push(achievement);
                achievement.searchText = [
                    achievement.name || "",
                    ...(achievement.tiers || []).map((tier) => tier.description || ""),
                ]
                    .join(" ")
                    .toLowerCase();
            });

            const loadError = document.getElementById("achievement-load-error");
            if (loadError) loadError.hidden = true;

            buildVersionOptions();
            syncSecondaryVersionSelect();

            buildCategories();

            updateOverallAchievementProgress();
            return true;
        } catch (error) {
            console.error("[Achievements] INITIALISATION ERROR:", error);
            const loadError = document.getElementById("achievement-load-error");
            const message = document.getElementById("achievement-load-error-message");
            if (message) {
                message.textContent =
                    "Cyrene could not read your saved achievement progress. Please retry.";
            }
            if (loadError) loadError.hidden = false;
            return false;
        }
    }

    function buildCategories() {
        if (!categoryGrid || !achievementData) {
            return;
        }

        categoryGrid.innerHTML = "";

        const categoryEntries = orderedCategories()
            .map((category) => {
                const data = achievementData.categories[category];

                if (
                    !data ||
                    (hideCompletedAchievements && data.total > 0 && data.completed === data.total)
                ) {
                    return null;
                }

                const categoryAchievements = achievementsByCategory.get(category) || [];
                const filteredAchievements = categoryAchievements.filter((achievement) =>
                    achievementMatchesFilters(achievement, false),
                );

                if (filteredAchievements.length === 0) {
                    return null;
                }

                let total = 0;
                let completed = 0;

                filteredAchievements.forEach((achievement) => {
                    if (!Array.isArray(achievement.tiers)) {
                        return;
                    }

                    achievement.tiers.forEach((tier) => {
                        total++;

                        if (tier.completed === true) {
                            completed++;
                        }
                    });
                });

                return {
                    category,
                    data,
                    total,
                    completed,
                };
            })
            .filter(Boolean);

        categoryEntries.forEach(({ category, total, completed }) => {
            const button = document.createElement("button");

            button.type = "button";

            button.className = "achievement-category";
            button.classList.toggle(
                "category-completed",
                achievementData.categories[category].total > 0 &&
                    achievementData.categories[category].completed ===
                        achievementData.categories[category].total,
            );

            const progress = total > 0 ? (completed / total) * 100 : 0;

            button.innerHTML = `

                    <div class="achievement-category-icon">
                
                        <img
                            src="${getCategoryIcon(category)}"
                            loading="lazy" decoding="async"
                            alt=""
                        >
                
                    </div>
                
                
                    <div class="achievement-category-content">
                
                        <h3 class="${category.length > 30 ? "long-category-name" : ""}">
                            ${escapeHTML(category)}
                        </h3>
                
                
                        <div class="achievement-category-stats">

                            <strong class="achievement-category-percent">
                                ${progress.toFixed(1)}%
                            </strong>
                        
                            <span class="achievement-category-count">
                                ${completed}/${total}
                            </span>
                        
                        </div>
                
                
                        <div
                            class="achievement-category-progress"
                        >
                
                            <div
                                class="achievement-sidebar-progress-fill"
                                style="width: ${progress}%"
                            ></div>
                
                        </div>
                
                    </div>
                
                `;

            button.addEventListener("click", () => {
                openCategory(category);
            });

            categoryGrid.appendChild(button);
        });
    }

    function buildSidebar(selectedCategory) {
        if (!sidebarList || !achievementData) {
            return;
        }

        sidebarList.innerHTML = "";

        orderedCategories().forEach((category) => {
            const data = achievementData.categories[category];

            if (!data) {
                return;
            }

            const button = document.createElement("button");

            button.type = "button";

            button.className = "achievement-sidebar-item";
            const completed = data.total > 0 && data.completed === data.total;
            if (hideCompletedAchievements && completed) return;
            button.classList.toggle("category-completed", completed);

            if (category === selectedCategory) {
                button.classList.add("active");
                button.setAttribute("aria-current", "page");
            }

            const filtered = filteredCategoryProgress(category);
            const progress = filtered.total > 0 ? (filtered.completed / filtered.total) * 100 : 0;
            const searchMatch = Boolean(achievementSearchQuery.trim()) && filtered.matches > 0;
            button.classList.toggle("search-match", searchMatch);
            if (searchMatch)
                button.setAttribute(
                    "aria-label",
                    `${category}: ${filtered.matches} search matches`,
                );

            button.innerHTML = `
                
                    <div class="achievement-sidebar-icon">
                
                        <img
                            src="${getCategoryIcon(category)}"
                            loading="lazy" decoding="async"
                            alt=""
                        >
                
                    </div>
                
                
                    <div class="achievement-sidebar-content">
                
                        <span class="achievement-sidebar-name">
                            ${escapeHTML(category)}
                            ${completed ? '<span class="cyrene-check achievement-category-complete-mark" role="img" aria-label="Completed"></span>' : ""}
                        </span>
                        ${searchMatch ? '<span class="achievement-search-match-label">Search match</span>' : ""}
                        <div class="achievement-sidebar-progress-row">
                
                            <div class="achievement-sidebar-progress">
                
                                <div
                                    class="achievement-sidebar-progress-fill"
                                    style="width: ${progress}%"
                                ></div>
                
                            </div>
                
                
                            <small>
                                ${filtered.completed}/${filtered.total}
                            </small>
                
                        </div>
                
                    </div>
                
                `;

            button.addEventListener("click", () => {
                openCategory(category);
            });

            sidebarList.appendChild(button);
        });
        const firstMatch = sidebarList.querySelector(".search-match");
        if (firstMatch) {
            const container = sidebarList.getBoundingClientRect();
            const match = firstMatch.getBoundingClientRect();
            sidebarList.scrollTop += match.top - container.top;
            sidebarList.scrollLeft += match.left - container.left;
        }
    }

    function openCategory(category) {
        if (!achievementData) {
            return;
        }

        activeCategory = category;
        syncSecondaryVersionSelect();

        const data = achievementData.categories[category];

        if (!data) {
            return;
        }

        categoryTitle.textContent = category;

        const percentage = data.total > 0 ? (data.completed / data.total) * 100 : 0;
        const roundedPercentage = Math.round(percentage * 10) / 10;

        categoryPercent.textContent = `${roundedPercentage}% (${data.completed}/${data.total})`;

        categoryProgressFill.style.width = `${percentage}%`;

        buildSidebar(category);

        buildAchievements(category);

        categories.hidden = true;

        browser.hidden = false;
    }

    function formatCompletedAt(timestamp) {
        if (timestamp === null || timestamp === undefined || timestamp === "") {
            return "";
        }

        let date;

        if (typeof timestamp === "number" || /^\d+$/.test(String(timestamp))) {
            const numericTimestamp = Number(timestamp);

            date = new Date(
                numericTimestamp < 100000000000 ? numericTimestamp * 1000 : numericTimestamp,
            );
        } else {
            date = new Date(timestamp);
        }

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");

        return `${day}-${month}-${year} ${hours}:${minutes}`;
    }

    function formatAchievementNote(note) {
        if (!note) {
            return "";
        }

        const lines = escapeHTML(note).split(/\r?\n/);
        let html = "";
        let inList = false;

        lines.forEach((line) => {
            const bulletMatch = line.match(/^\s*-\s+(.*)$/);

            if (bulletMatch) {
                if (!inList) {
                    html += "<ul>";
                    inList = true;
                }

                html += `
                    <li>${bulletMatch[1]}</li>
                `;

                return;
            }

            if (inList) {
                html += "</ul>";
                inList = false;
            }

            if (line.trim() === "") {
                html += "<br>";
            } else {
                html += `${line}<br>`;
            }
        });

        if (inList) {
            html += "</ul>";
        }

        return html;
    }

    function buildAchievements(category) {
        if (!achievementList || !achievementData) {
            return;
        }

        achievementListObserver?.disconnect();
        achievementList.innerHTML = "";
        achievementList.scrollTop = 0;

        const achievements = achievementData.achievements.filter(
            (achievement) =>
                (achievementSearchQuery.trim() || achievement.category === category) &&
                achievementMatchesFilters(achievement),
        );
        let renderedCount = 0;
        const sentinel = document.createElement("div");
        sentinel.className = "achievement-list-sentinel";
        sentinel.setAttribute("aria-hidden", "true");
        function renderNextBatch() {
            const fragment = document.createDocumentFragment();
            const batch = achievements.slice(renderedCount, renderedCount + 40);
            renderedCount += batch.length;
            batch.forEach((achievement) => {
                const item = document.createElement("div");

                item.className = "achievement-item";

                const totalTiers = achievement.tiers?.length || 1;

                item.innerHTML = `
    
                    <!-- Large achievement icon -->
    
                    <div class="achievement-item-icon">
    
                        <img
                            class="achievement-item-main-icon"
                            src="${getTierImage(0, totalTiers)}"
                            alt=""
                        >
    
                    </div>
    
    
                    <!-- Achievement content -->
    
                    <div class="achievement-item-content">
    
                        <div class="achievement-item-header">

                            <div class="achievement-title-row">

                                <h3>
                                    ${escapeHTML(achievement.name)}
                                </h3>
                            
                                ${
                                    achievement.version
                                        ? `
                                            <span class="achievement-version-badge">
                                                ${escapeHTML(achievement.version)}
                                            </span>
                                        `
                                        : ""
                                }
                            
                            </div>
                        
                        </div>
    
    
                        <div class="achievement-tier-list">
    
                            ${achievement.tiers
                                .map((tier) => {
                                    return `
    
                                        <div
                                            class="achievement-tier ${
                                                tier.completed ? "completed" : ""
                                            }"
                                            data-tier="${tier.tier}"
                                        >
    
                                            <!-- Small tier icon -->
    
                                            <div class="achievement-tier-icon">
    
                                                <img
                                                    src="${getTierImage(tier.tier, totalTiers)}"
                                                    alt="${tier.tier}/${totalTiers}"
                                                >
    
                                            </div>
    
    
                                            <div class="achievement-tier-content">

                                                <div class="achievement-tier-description">
                                                    <p>
                                                        ${escapeHTML(tier.description)}
                                                    </p>
                                                </div>
                                            
                                                ${
                                                    achievement.show_progress ||
                                                    tier.progress !== 1 ||
                                                    (tier.completed && tier.timestamp)
                                                        ? `
                                                            <div class="achievement-tier-progress-row">
                                                
                                                                ${
                                                                    achievement.show_progress ||
                                                                    tier.progress !== 1
                                                                        ? `
                                                                            <div class="achievement-tier-progress">
                                                
                                                                                <span class="achievement-tier-progress-current">
                                                                                    ${tier.current ?? 0}
                                                                                </span>
                                                
                                                                                <span class="achievement-tier-progress-separator">
                                                                                    /
                                                                                </span>
                                                
                                                                                <span class="achievement-tier-progress-total">
                                                                                    ${tier.progress ?? 0}
                                                                                </span>
                                                
                                                                            </div>
                                                                        `
                                                                        : ""
                                                                }
                                                
                                                                ${
                                                                    tier.completed && tier.timestamp
                                                                        ? `
                                                                            <span class="achievement-tier-completed-at">
                                                                                ${formatCompletedAt(
                                                                                    tier.timestamp,
                                                                                )}
                                                                            </span>
                                                                        `
                                                                        : ""
                                                                }
                                                
                                                            </div>
                                                        `
                                                        : ""
                                                }
                                            
                                                ${
                                                    tier.note
                                                        ? `
                                                            <div class="achievement-tier-note">
                                                                
                                                                <div class="achievement-tier-note-text">
                                                                    ${formatAchievementNote(tier.note)}
                                                                </div>
                                                
                                                                <button
                                                                    type="button"
                                                                    class="achievement-tier-note-remove"
                                                                    aria-label="Remove Note"
                                                                    title="Remove Note"
                                                                >
                                                                    <span class="cyrene-close" aria-hidden="true"></span>
                                                                </button>
                                                
                                                            </div>
                                                        `
                                                        : ""
                                                }
                                            
                                            </div>
                                            
                                            <div class="achievement-tier-reward">

                                                <span>
                                                    ${tier.primogems ?? 0}
                                                </span>
                                            
                                                <img
                                                    src="/static/images/misc/Primogem.webp"
                                                    alt="Primogems"
                                                >
                                            
                                            </div>
                                            
                                            
                                            <!-- Completion -->

                                            <button
                                                type="button"
                                                class="achievement-complete-button ${
                                                    tier.completed ? "completed" : ""
                                                }"
                                                aria-label="${
                                                    tier.completed
                                                        ? "Mark Incomplete"
                                                        : "Mark Completed"
                                                }"
                                                title="${
                                                    tier.completed
                                                        ? "Mark Incomplete"
                                                        : "Mark Completed"
                                                }"
                                            ></button>
                                            
                                            
                                            <!-- Notes -->
                                            
                                            <button
                                                type="button"
                                                class="achievement-notes-button"
                                                aria-label="Add Note"
                                                title="Add Note"
                                            >
                                                <svg
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    aria-hidden="true"
                                                    focusable="false"
                                                >
                                                    <path
                                                        d="M11 4H7.2C6.0799 4 5.51984 4 5.09202 4.21799C4.71569 4.40974 4.40974 4.7157 4.21799 5.09202C4 5.51985 4 6.0799 4 7.2V16.8C4 17.9201 4 18.4802 4.21799 18.908C4.40974 19.2843 4.71569 19.5903 5.09202 19.782C5.51984 20 6.0799 20 7.2 20H16.8C17.9201 20 18.4802 20 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.5903 19.2843 19.5903 19.5903 18.908 20 18.4802 20 17.9201 20 16.8V12.5"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    />
                                            
                                                    <path
                                                        d="M15.5 5.5L18.3284 8.32843M10.7627 10.2373L17.411 3.58902C18.192 2.80797 19.4584 2.80797 20.2394 3.58902C21.0205 4.37007 21.0205 5.6364 20.2394 6.41745L13.3774 13.2794C12.6158 14.0411 12.235 14.4219 11.8012 14.7247C11.4162 14.9936 11.0009 15.2162 10.564 15.3882C10.0717 15.582 9.54378 15.6885 8.48793 15.9016L8 16L8.04745 15.6678C8.21536 14.4925 8.29932 13.9048 8.49029 13.3561 9.17906 11.9786 9.50341 11.4966 9.92319 11.0768 10.7627 10.2373Z"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                        stroke-linecap="round"
                                                        stroke-linejoin="round"
                                                    />
                                                </svg>
                                            </button>
    
                                        </div>
    
                                    `;
                                })
                                .join("")}
    
                        </div>
    
                    </div>
    
                `;

                const tierButtons = item.querySelectorAll(".achievement-complete-button");
                const notesButtons = item.querySelectorAll(".achievement-notes-button");
                const noteRemoveButtons = item.querySelectorAll(".achievement-tier-note-remove");

                notesButtons.forEach((button) => {
                    button.addEventListener("click", (event) => {
                        event.stopPropagation();

                        achievementNoteTarget = {
                            achievement,
                            tier: achievement.tiers[Array.from(notesButtons).indexOf(button)],
                        };

                        const modal = document.getElementById("achievement-notes-modal");
                        const input = document.getElementById("achievement-notes-input");

                        if (!modal || !input) {
                            return;
                        }

                        input.value = "";

                        modal.hidden = false;

                        requestAnimationFrame(() => {
                            input.focus();
                        });
                    });
                });

                noteRemoveButtons.forEach((button) => {
                    button.addEventListener("click", async (event) => {
                        event.stopPropagation();

                        const tierElement = button.closest(".achievement-tier");

                        if (!tierElement) {
                            return;
                        }

                        const tierNumber = Number(tierElement.dataset.tier);
                        const tier = achievement.tiers.find(
                            (achievementTier) => achievementTier.tier === tierNumber,
                        );

                        if (!tier) {
                            return;
                        }

                        try {
                            const response = await fetch(
                                achievementApiUrl(
                                    `/api/achievements/${encodeURIComponent(
                                        tier.genshin_id,
                                    )}/tiers/${tier.tier}/note`,
                                ),
                                {
                                    method: "PATCH",

                                    headers: {
                                        "Content-Type": "application/json",
                                    },

                                    body: JSON.stringify({
                                        note: null,
                                    }),
                                },
                            );

                            if (!response.ok) {
                                const result = await response.json();

                                throw new Error(result.detail || "Failed to remove note.");
                            }

                            tier.note = null;

                            const noteElement = button.closest(".achievement-tier-note");

                            if (noteElement) {
                                noteElement.remove();
                            }
                        } catch (error) {
                            console.error("[Achievements] Failed to remove note:", error);

                            alert(error.message);
                        }
                    });
                });

                tierButtons.forEach((button, index) => {
                    const tier = achievement.tiers[index];

                    button.addEventListener("click", () => {
                        toggleTierCompleted(achievement, tier, item, button);
                    });
                });

                fragment.appendChild(item);

                updateLockedTiers(item);
                updateAchievementProgress(item);
            });

            achievementList.appendChild(fragment);
            if (renderedCount < achievements.length) achievementList.appendChild(sentinel);
            else {
                sentinel.remove();
                achievementListObserver?.disconnect();
            }
        }
        renderNextBatch();
        if (renderedCount < achievements.length) {
            achievementListObserver = new IntersectionObserver(
                (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) renderNextBatch();
                },
                { root: achievementList, rootMargin: "400px" },
            );
            achievementListObserver.observe(sentinel);
        }
    }

    function getTierImage(currentTier, totalTiers) {
        return `/static/images/achievements/tiers/Achievement_${currentTier}_${totalTiers}.png`;
    }

    function getAchievementDescription(achievement) {
        if (!achievement.tiers || achievement.tiers.length === 0) {
            return "";
        }

        const totalTiers = achievement.tiers.length;

        return achievement.tiers
            .map((tier) => {
                const tierNumber = tier.tier;

                return `
                    <div class="achievement-tier-row">
    
                        <img
                            src="${getTierImage(tierNumber, totalTiers)}"
                            alt="${tierNumber}/${totalTiers}"
                        >
    
                        <span>
                            ${escapeHTML(tier.description)}
                        </span>
    
                    </div>
                `;
            })
            .join("");
    }

    async function toggleTierCompleted(achievement, tier, item, button) {
        const totalTiers = achievement.tiers?.length || 1;
        const tierContainer = button.closest(".achievement-tier");

        if (tierContainer.classList.contains("locked")) {
            return;
        }

        const tierImage = tierContainer.querySelector(".achievement-tier-icon img");
        const isCompleted = tier.completed === true;

        if (isCompleted) {
            achievement.tiers.forEach((achievementTier) => {
                if (achievementTier.tier >= tier.tier) {
                    achievementTier.completed = false;
                    achievementTier.timestamp = null;
                }
            });
        } else {
            tier.completed = true;
        }

        try {
            const tiersToSave = isCompleted
                ? achievement.tiers.filter((achievementTier) => achievementTier.tier >= tier.tier)
                : [tier];

            for (const achievementTier of tiersToSave) {
                const response = await fetch(
                    achievementApiUrl(
                        `/api/achievements/${encodeURIComponent(
                            achievementTier.genshin_id,
                        )}/tiers/${achievementTier.tier}`,
                    ),
                    {
                        method: "PATCH",

                        headers: {
                            "Content-Type": "application/json",
                        },

                        body: JSON.stringify({
                            completed: achievementTier.completed,
                        }),
                    },
                );

                if (!response.ok) {
                    throw new Error(`Failed to save Tier ${achievementTier.tier}.`);
                }
            }
        } catch (error) {
            console.error("[Achievements] Failed to save completion:", error);

            await loadAchievements();

            return;
        }

        achievement.tiers.forEach((achievementTier) => {
            if (isCompleted && achievementTier.tier < tier.tier) {
                return;
            }

            const otherTier = item.querySelector(
                `.achievement-tier[data-tier="${achievementTier.tier}"]`,
            );

            if (!otherTier) {
                return;
            }

            const otherButton = otherTier.querySelector(".achievement-complete-button");
            const otherImage = otherTier.querySelector(".achievement-tier-icon img");
            const completed = achievementTier.completed === true;

            otherTier.classList.toggle("completed", completed);

            if (otherButton) {
                otherButton.classList.toggle("completed", completed);

                otherButton.title = completed ? "Mark Incomplete" : "Mark Completed";
            }

            if (otherImage) {
                otherImage.src = getTierImage(achievementTier.tier, totalTiers);

                otherImage.alt = `${achievementTier.tier}/${totalTiers}`;
            }
        });

        const updatedTier = tierContainer;
        const tierContent = updatedTier.querySelector(".achievement-tier-content");

        if (tierContent) {
            const descriptionContainer = tierContent.querySelector(".achievement-tier-description");
            let progressRow = tierContent.querySelector(".achievement-tier-progress-row");

            if (
                achievement.tiers.find((achievementTier) => achievementTier.tier === tier.tier)
                    ?.completed
            ) {
                const completedAt = new Date();
                const formattedCompletedAt = formatCompletedAt(completedAt.toISOString());

                if (!progressRow) {
                    progressRow = document.createElement("div");

                    progressRow.className = "achievement-tier-progress-row";

                    if (descriptionContainer) {
                        descriptionContainer.insertAdjacentElement("afterend", progressRow);
                    } else {
                        tierContent.prepend(progressRow);
                    }
                }

                const oldCompletedAt = progressRow.querySelector(".achievement-tier-completed-at");

                if (oldCompletedAt) {
                    oldCompletedAt.remove();
                }

                const completedAtElement = document.createElement("span");

                completedAtElement.className = "achievement-tier-completed-at";

                completedAtElement.textContent = formattedCompletedAt;

                progressRow.appendChild(completedAtElement);
            } else {
                if (progressRow) {
                    const completedAtElement = progressRow.querySelector(
                        ".achievement-tier-completed-at",
                    );

                    if (completedAtElement) {
                        completedAtElement.remove();
                    }

                    const hasProgress = progressRow.querySelector(".achievement-tier-progress");

                    if (!hasProgress) {
                        progressRow.remove();
                    }
                }
            }
        }

        updateLockedTiers(item);
        updateAchievementProgress(item);

        updateCategoryProgress();
        updateCategoryHeaderProgress();
        updateOverallAchievementProgress();
    }

    function updateAchievementProgress(item) {
        const tiers = item.querySelectorAll(".achievement-tier");
        const completedTiers = item.querySelectorAll(".achievement-tier.completed");
        const totalTiers = tiers.length;
        const completedCount = completedTiers.length;
        const achievementTierCount = item.querySelector(".achievement-tier-count");

        if (achievementTierCount) {
            achievementTierCount.textContent = `${completedCount}/${totalTiers}`;
        }

        item.classList.remove("progress-low", "progress-high");

        if (totalTiers === 0 || completedCount === totalTiers) {
            return;
        }

        const progress = completedCount / totalTiers;

        if (progress >= 1 / 3 && progress < 1 / 2) {
            item.classList.add("progress-low");
        } else if (progress >= 1 / 2) {
            item.classList.add("progress-high");
        }
    }

    function updateCategoryProgress() {
        if (!achievementData) {
            return;
        }

        Object.entries(achievementData.categories).forEach(([category, data]) => {
            let completed = 0;

            (achievementsByCategory.get(category) || []).forEach((achievement) => {
                if (!Array.isArray(achievement.tiers)) {
                    return;
                }

                achievement.tiers.forEach((tier) => {
                    if (tier.completed === true) {
                        completed++;
                    }
                });
            });

            data.completed = completed;
        });

        if (!categories.hidden) buildCategories();

        if (browser && !browser.hidden) {
            const scrollTop = sidebarList.scrollTop;
            buildSidebar(activeCategory);
            sidebarList.scrollTop = scrollTop;
        }
    }

    function updateLockedTiers(item) {
        const tiers = item.querySelectorAll(".achievement-tier");
        let previousCompleted = true;

        tiers.forEach((tier) => {
            const button = tier.querySelector(".achievement-complete-button");

            if (!button) {
                return;
            }

            const isCompleted = tier.classList.contains("completed");
            const locked = !previousCompleted;

            tier.classList.toggle("locked", locked);

            if (locked) {
                button.setAttribute("aria-disabled", "true");

                button.title = "Complete the previous tier first";
            } else {
                button.removeAttribute("aria-disabled");

                button.title = isCompleted ? "Mark Incomplete" : "Mark Completed";
            }

            previousCompleted = isCompleted;
        });

        const mainIcon = item.querySelector(".achievement-item-main-icon");

        if (mainIcon) {
            const totalTiers = tiers.length;
            let highestCompletedTier = 0;

            tiers.forEach((tier) => {
                if (tier.classList.contains("completed")) {
                    const tierNumber = Number(tier.dataset.tier);

                    if (tierNumber > highestCompletedTier) {
                        highestCompletedTier = tierNumber;
                    }
                }
            });

            mainIcon.src = getTierImage(highestCompletedTier, totalTiers);

            mainIcon.alt = `${highestCompletedTier}/${totalTiers}`;
        }

        const allTiersCompleted =
            tiers.length > 0 &&
            Array.from(tiers).every((tier) => tier.classList.contains("completed"));

        item.classList.toggle("completed", allTiersCompleted);
    }

    function updateOverallAchievementProgress() {
        if (!achievementData) {
            return;
        }

        const countElement = document.getElementById("achievement-overall-count");
        const percentElement = document.getElementById("achievement-overall-percent");
        const progressFill = document.getElementById("achievement-overall-progress-fill");

        if (!countElement || !percentElement || !progressFill) {
            return;
        }

        let totalAchievements = 0;
        let completedAchievements = 0;

        achievementData.achievements.forEach((achievement) => {
            if (!Array.isArray(achievement.tiers)) {
                return;
            }

            achievement.tiers.forEach((tier) => {
                totalAchievements++;

                if (tier.completed === true) {
                    completedAchievements++;
                }
            });
        });

        if (totalAchievements === 0) {
            countElement.textContent = "0 / 0";

            percentElement.textContent = "0%";

            progressFill.style.width = "0%";

            return;
        }

        const percentage = (completedAchievements / totalAchievements) * 100;

        countElement.textContent = `${completedAchievements} / ${totalAchievements}`;

        percentElement.textContent = `${percentage.toFixed(1)}%`;

        progressFill.style.width = `${percentage}%`;
    }

    function updateCategoryHeaderProgress() {
        if (!achievementData || !categoryTitle || !categoryPercent || !categoryProgressFill) {
            return;
        }

        const category = categoryTitle.textContent.trim();
        const achievements = achievementData.achievements.filter(
            (achievement) => achievement.category === category,
        );
        let total = 0;
        let completed = 0;

        achievements.forEach((achievement) => {
            if (!Array.isArray(achievement.tiers)) {
                return;
            }

            achievement.tiers.forEach((tier) => {
                total++;

                if (tier.completed === true) {
                    completed++;
                }
            });
        });

        const percentage = total > 0 ? (completed / total) * 100 : 0;
        const roundedPercentage = Math.round(percentage * 10) / 10;

        categoryPercent.textContent = `${roundedPercentage}% (${completed}/${total})`;

        categoryProgressFill.style.width = `${percentage}%`;
    }

    function closeBrowser() {
        achievementListObserver?.disconnect();
        browser.hidden = true;
        buildCategories();
        categories.hidden = false;
    }

    if (backButton) {
        backButton.addEventListener("click", closeBrowser);
    }

    function escapeHTML(value) {
        const div = document.createElement("div");

        div.textContent = value ?? "";

        return div.innerHTML;
    }

    loadAchievements();
};

document.addEventListener("click", (event) => {
    document.querySelectorAll(".custom-select.open").forEach((select) => {
        if (!select.contains(event.target)) {
            select.classList.remove("open");

            const button = select.querySelector(".custom-select-button");

            if (button) {
                button.setAttribute("aria-expanded", "false");
            }
        }
    });
});

function tryInitAchievements() {
    if (document.getElementById("achievement-categories")) {
        window.initAchievements();
    }
}

document.addEventListener("DOMContentLoaded", tryInitAchievements);
