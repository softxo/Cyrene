// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Account and option dropdowns in the custom event form.
window.CyreneCustomEventDropdowns = (ctx) => {
    const { page, modal, form, $, $$, dateTimePickers } = ctx;

    function updateAccountDropdown(selectedId) {
        const dropdown = $("[data-custom-account-select]", form);
        if (!dropdown) return;

        const hiddenInput = dropdown.querySelector('input[name="account_id"]');
        const valueElement = dropdown.querySelector(".custom-select-value");
        const options = Array.from(dropdown.querySelectorAll("[data-account-id]"));
        const preferred = options.find(
            (option) => option.dataset.accountId === String(page.dataset.accountId),
        );
        if (preferred) preferred.parentElement.prepend(preferred);

        const selectedOption = options.find(
            (option) => option.dataset.accountId === String(selectedId),
        );

        if (hiddenInput) {
            hiddenInput.value = selectedOption ? selectedOption.dataset.accountId : "";
        }

        if (valueElement) {
            valueElement.textContent = selectedOption
                ? selectedOption.textContent.trim()
                : "Select an account";
        }

        options.forEach((option) => {
            const isSelected = option === selectedOption;

            option.classList.toggle("active", isSelected);
            option.setAttribute("aria-selected", String(isSelected));
        });
    }

    function initialiseAccountDropdown() {
        const dropdown = $("[data-custom-account-select]", form);
        if (!dropdown) return;

        const button = dropdown.querySelector(".custom-select-button");
        const menu = dropdown.querySelector(".custom-select-menu");

        if (!button || !menu) return;

        button.addEventListener("click", (event) => {
            event.preventDefault();
            dateTimePickers.active?.close();
            const isOpen = dropdown.classList.toggle("open");
            if (isOpen) revealDropdown(dropdown);
            button.setAttribute("aria-expanded", String(isOpen));
        });

        dropdown.querySelectorAll("[data-account-id]").forEach((option) => {
            option.addEventListener("click", (event) => {
                event.preventDefault();
                updateAccountDropdown(option.dataset.accountId);

                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            });
        });

        document.addEventListener("click", (event) => {
            if (!dropdown.contains(event.target)) {
                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            }
        });

        updateAccountDropdown(
            page.dataset.accountId ||
                dropdown.querySelector("[data-account-id]")?.dataset.accountId,
        );
    }

    function updateFormDropdown(name, selectedValue) {
        const dropdown = $(`[data-custom-dropdown="${name}"]`, form);

        if (!dropdown) return;

        const hiddenInput = dropdown.querySelector(`input[name="${name}"]`);
        const valueElement = dropdown.querySelector(".custom-select-value");
        const options = Array.from(dropdown.querySelectorAll("[data-value]"));
        const selectedOption = options.find(
            (option) => option.dataset.value === String(selectedValue),
        );

        if (hiddenInput) {
            hiddenInput.value = selectedOption ? selectedOption.dataset.value : "";
        }

        if (valueElement) {
            valueElement.textContent = selectedOption
                ? selectedOption.textContent.trim()
                : "Select an option";
        }

        options.forEach((option) => {
            const selected = option === selectedOption;

            option.classList.toggle("active", selected);
            option.setAttribute("aria-selected", String(selected));
        });
    }

    function revealDropdown(dropdown) {
        const menu = dropdown.querySelector('[role="listbox"]');
        const trigger = dropdown.querySelector(".custom-select-button");
        const panel = modal.querySelector(".events-custom-dialog");
        if (!menu || !trigger || !panel || !dropdown.classList.contains("open")) return;
        if (!menu.matches(":popover-open")) menu.showPopover();
        const box = trigger.getBoundingClientRect();
        const frame = panel.getBoundingClientRect();
        const upper = Math.max(12, frame.top + 12);
        const lower = Math.min(window.innerHeight - 12, frame.bottom - 12);
        const below = Math.max(0, lower - box.bottom - 6);
        const above = Math.max(0, box.top - upper - 6);
        const upwards = below < Math.min(menu.scrollHeight, 300) && above > below;
        menu.style.width = `${box.width}px`;
        menu.style.maxHeight = `${Math.min(300, upwards ? above : below)}px`;
        menu.style.left = `${box.left}px`;
        menu.style.top = `${upwards ? box.top - 6 - menu.offsetHeight : box.bottom + 6}px`;
    }

    $$(".custom-select", form).forEach((dropdown) => {
        const menu = dropdown.querySelector('[role="listbox"]');
        if (!menu) return;
        menu.setAttribute("popover", "manual");
        new MutationObserver(() => {
            if (dropdown.classList.contains("open")) revealDropdown(dropdown);
            else if (menu.matches(":popover-open")) menu.hidePopover();
        }).observe(dropdown, { attributes: true, attributeFilter: ["class"] });
    });

    modal.querySelector(".events-custom-dialog")?.addEventListener("scroll", (event) => {
        if (event.target !== event.currentTarget) return;
        $$(".custom-select.open", form).forEach(revealDropdown);
    });

    window.addEventListener("resize", () =>
        $$(".custom-select.open", form).forEach(revealDropdown),
    );

    function initialiseFormDropdowns() {
        $$("[data-custom-dropdown]", form).forEach((dropdown) => {
            const button = dropdown.querySelector(".custom-select-button");

            if (!button) return;

            const name = dropdown.dataset.customDropdown;

            button.addEventListener("click", (event) => {
                event.preventDefault();
                dateTimePickers.active?.close();
                const isOpen = dropdown.classList.toggle("open");
                if (isOpen) revealDropdown(dropdown);

                button.setAttribute("aria-expanded", String(isOpen));
            });

            dropdown.querySelectorAll("[data-value]").forEach((option) => {
                option.addEventListener("click", (event) => {
                    event.preventDefault();
                    updateFormDropdown(name, option.dataset.value);

                    dropdown.classList.remove("open");
                    button.setAttribute("aria-expanded", "false");

                    const hiddenInput = dropdown.querySelector(`input[name="${name}"]`);

                    if (hiddenInput) {
                        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                });
            });
        });

        document.addEventListener("click", (event) => {
            $$("[data-custom-dropdown]", form).forEach((dropdown) => {
                if (dropdown.contains(event.target)) return;

                dropdown.classList.remove("open");

                dropdown
                    .querySelector(".custom-select-button")
                    ?.setAttribute("aria-expanded", "false");
            });
        });
    }

    return {
        initialiseAccountDropdown,
        initialiseFormDropdowns,
        updateAccountDropdown,
        updateFormDropdown,
    };
};
