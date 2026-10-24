function initSettings() {

    // =========================================
    // THEME
    // =========================================

    updateThemeSelection(
        document.documentElement.dataset.theme
    );


    // =========================================
    // HOVER EFFECTS
    // =========================================

    const toggle =
        document.getElementById("hover-effects-toggle");

    if (!toggle) {
        return;
    }

    const savedHoverEffects =
        localStorage.getItem("hoverEffects");

    // Hover effects are enabled by default.
    const hoverEffectsEnabled =
        savedHoverEffects !== "false";

    applyHoverEffectsSetting(hoverEffectsEnabled);


    toggle.addEventListener("click", () => {

        const currentlyEnabled =
            document.documentElement.dataset.hoverEffects !== "off";

        applyHoverEffectsSetting(!currentlyEnabled);

    });
}


/* =========================================================
   HOVER EFFECTS SETTING
   ========================================================= */

function applyHoverEffectsSetting(enabled) {

    const toggle =
        document.getElementById("hover-effects-toggle");

    if (enabled) {

        document.documentElement.dataset.hoverEffects = "on";

        localStorage.setItem(
            "hoverEffects",
            "true"
        );

        if (toggle) {
            toggle.classList.add("active");

            toggle.setAttribute(
                "aria-pressed",
                "true"
            );
        }

    } else {

        document.documentElement.dataset.hoverEffects = "off";

        localStorage.setItem(
            "hoverEffects",
            "false"
        );

        if (toggle) {
            toggle.classList.remove("active");

            toggle.setAttribute(
                "aria-pressed",
                "false"
            );
        }
    }
}