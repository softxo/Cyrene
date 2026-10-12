// =========================================================
// EVENTS — FEATURED EVENT CARDS
// =========================================================

window.initialiseEventFeatureToggles = function initialiseEventFeatureToggles() {

    document.querySelectorAll(".event-featured-toggle")
        .forEach(toggle => {

            if (toggle.dataset.initialised === "true") {
                return;
            }

            toggle.dataset.initialised = "true";

            toggle.addEventListener("click", event => {

                event.preventDefault();
                event.stopPropagation();

                const card =
                    toggle.closest(".event-featured-card");

                if (!card) {
                    return;
                }

                const collapsed =
                    card.classList.toggle("collapsed");

                toggle.setAttribute(
                    "aria-expanded",
                    collapsed ? "false" : "true"
                );

            });

        });

};