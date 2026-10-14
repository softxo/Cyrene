/* =========================================================
   CHARACTERS — ACCOUNT DROPDOWN
   ========================================================= */

function initCharacters() {
    const form = document.querySelector(
        "[data-characters-account-form]"
    );

    if (!form || form.dataset.initialised === "true") {
        return;
    }

    form.dataset.initialised = "true";

    const select = form.querySelector(
        ".characters-account-select"
    );

    const hiddenInput = select?.querySelector(
        'input[name="account_id"]'
    );

    const options = select?.querySelectorAll(
        ".custom-select-option"
    );

    if (!select || !hiddenInput || !options) {
        return;
    }

    options.forEach(option => {
        option.addEventListener("click", () => {
            const accountId = option.dataset.value;

            if (!accountId) {
                return;
            }

            hiddenInput.value = accountId;

            options.forEach(item => {
                const isSelected = item === option;

                item.classList.toggle(
                    "selected",
                    isSelected
                );

                item.setAttribute(
                    "aria-selected",
                    String(isSelected)
                );
            });

            form.requestSubmit();
        });
    });
}

/* Support initial page loads and client-side navigation. */
window.initCharacters = initCharacters;