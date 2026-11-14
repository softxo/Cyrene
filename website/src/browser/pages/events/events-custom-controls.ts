// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
(() => {
    function toLocalInputValue(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "";

        const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);

        return localDate.toISOString().slice(0, 16);
    }

    function fromLocalInputValue(value) {
        if (!value) return null;

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            throw new Error("Please enter a valid date and time.");
        }

        return date.toISOString();
    }

    function recurrenceLabel(recurrence) {
        if (!recurrence || recurrence.type === "none") {
            return "One-time";
        }

        const interval = Number(recurrence.interval || 1);
        const unit = {
            daily: "day",
            weekly: "week",
            monthly: "month",
        }[recurrence.type];

        if (!unit) return "One-time";

        let label = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;

        if (
            recurrence.type === "weekly" &&
            Array.isArray(recurrence.weekdays) &&
            recurrence.weekdays.length
        ) {
            const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            label +=
                " · " +
                recurrence.weekdays
                    .map((day) => names[day])
                    .filter(Boolean)
                    .join(", ");
        }

        return label;
    }

    function setButtonIcon(button, pathData) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.8");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
        button.replaceChildren(svg);
    }

    function makeElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (
            tag === "button" &&
            /events-custom-(?:progress|overview-objective)-button/.test(className || "") &&
            ["+", "-", "\u2212"].includes(text)
        ) {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "1.8");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("aria-hidden", "true");
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", text === "+" ? "M12 5v14M5 12h14" : "M5 12h14");
            svg.append(path);
            element.append(svg);
        } else if (text !== "") {
            element.textContent = text;
        }

        return element;
    }

    function makeButton(label, className, callback) {
        const button = makeElement(
            "button",
            `cyrene-button events-custom-action ${className || ""}`,
            label,
        );

        button.type = "button";
        button.addEventListener("click", callback);

        return button;
    }

    function enhanceNumberInput(input) {
        if (input.dataset.customSpinner === "true") {
            return;
        }

        input.dataset.customSpinner = "true";

        const wrapper = document.createElement("div");
        wrapper.className = "events-custom-number";
        wrapper.dataset.customSpinnerWrapper = "";

        input.parentNode.insertBefore(wrapper, input);
        wrapper.append(input);

        const spinner = document.createElement("div");
        spinner.className = "number-spinner";

        function changeValue(direction) {
            if (input.disabled || input.readOnly) {
                return;
            }

            const step = Number(input.step) || 1;
            const min = input.min === "" ? -Infinity : Number(input.min);
            const max = input.max === "" ? Infinity : Number(input.max);
            const current =
                input.value === "" ? (Number.isFinite(min) ? min : 0) : Number(input.value);
            const next =
                direction === "up" ? Math.min(current + step, max) : Math.max(current - step, min);

            if (next === current) {
                return;
            }

            input.value = String(next);

            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function createButton(direction, label) {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "number-spinner-button";
            button.dataset.direction = direction;
            button.setAttribute("aria-label", label);

            const arrow = document.createElement("span");
            arrow.className = "spinner-arrow";
            arrow.setAttribute("aria-hidden", "true");
            button.append(arrow);
            let holdTimeout = null;
            let holdInterval = null;
            function stopHolding() {
                clearTimeout(holdTimeout);
                clearInterval(holdInterval);
            }
            button.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                changeValue(direction);
                holdTimeout = setTimeout(() => {
                    holdInterval = setInterval(() => changeValue(direction), 80);
                }, 350);
            });
            ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
                button.addEventListener(type, stopHolding);
            });
            button.addEventListener("click", (event) => {
                event.preventDefault();
                if (event.detail === 0) changeValue(direction);
            });

            return button;
        }

        spinner.append(
            createButton("up", "Increase value"),
            createButton("down", "Decrease value"),
        );

        wrapper.append(spinner);
    }

    function initialiseAnimatedDetails(details, summary, content) {
        if (!details || !summary || !content || details.dataset.animated === "true") {
            return;
        }

        details.dataset.animated = "true";

        summary.addEventListener("click", async (clickEvent) => {
            clickEvent.preventDefault();

            if (details.dataset.animating === "true") {
                return;
            }

            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                details.open = !details.open;
                return;
            }

            details.dataset.animating = "true";

            const borderHeight =
                (Number.parseFloat(getComputedStyle(details).borderTopWidth) || 0) +
                (Number.parseFloat(getComputedStyle(details).borderBottomWidth) || 0);
            const collapsedHeight = summary.getBoundingClientRect().height + borderHeight;
            const startingHeight = details.getBoundingClientRect().height;
            const opening = !details.open;

            if (opening) {
                details.open = true;
            }

            const expandedHeight = details.getBoundingClientRect().height;
            const endingHeight = opening ? expandedHeight : collapsedHeight;
            const boxAnimation = details.animate(
                [{ height: `${startingHeight}px` }, { height: `${endingHeight}px` }],
                {
                    duration: opening ? 220 : 200,
                    easing: opening
                        ? "cubic-bezier(0.22, 1, 0.36, 1)"
                        : "cubic-bezier(0.4, 0, 0.2, 1)",
                    fill: "forwards",
                },
            );
            const contentAnimation = content.animate(
                opening
                    ? [
                          { opacity: 0, transform: "translateY(-4px)" },
                          { opacity: 1, transform: "translateY(0)" },
                      ]
                    : [
                          { opacity: 1, transform: "translateY(0)" },
                          { opacity: 0, transform: "translateY(-4px)" },
                      ],
                {
                    duration: opening ? 180 : 150,
                    easing: "ease-out",
                    fill: "forwards",
                },
            );

            try {
                await Promise.all([boxAnimation.finished, contentAnimation.finished]);
            } catch {}

            if (!opening) {
                details.open = false;
            }

            boxAnimation.cancel();
            contentAnimation.cancel();
            delete details.dataset.animating;
        });
    }

    function createDateTimePickers(form) {
        let activeDateTimePicker = null;

        function initialise() {
            form.querySelectorAll('input[type="datetime-local"]').forEach((input) => {
                if (input.dataset.customDateTimeInitialised === "true") return;
                input.dataset.customDateTimeInitialised = "true";
                const isRequired = input.required;
                input.required = false;

                const wrapper = document.createElement("div");
                wrapper.className = "events-custom-datetime";

                const trigger = document.createElement("button");
                trigger.type = "button";
                trigger.className = "cyrene-select-trigger events-custom-datetime-trigger";
                trigger.setAttribute("aria-haspopup", "dialog");
                trigger.setAttribute("aria-expanded", "false");
                trigger.setAttribute("aria-required", String(isRequired));

                const triggerValue = document.createElement("span");
                triggerValue.className = "events-custom-datetime-value";
                const triggerIcon = document.createElement("span");
                triggerIcon.className = "events-custom-datetime-icon";
                triggerIcon.setAttribute("aria-hidden", "true");
                trigger.append(triggerValue, triggerIcon);

                const popover = document.createElement("div");
                popover.className = "cyrene-popover events-custom-calendar";
                popover.setAttribute("role", "dialog");
                popover.setAttribute("data-modal-panel", "");
                popover.setAttribute("aria-label", "Choose date and time");
                popover.hidden = true;

                const header = document.createElement("div");
                header.className = "events-custom-calendar-header";
                const previous = document.createElement("button");
                previous.type = "button";
                previous.className = "cyrene-button events-custom-calendar-nav";
                setButtonIcon(previous, "M14 6l-6 6 6 6");
                previous.setAttribute("aria-label", "Previous month");
                const monthLabel = document.createElement("strong");
                monthLabel.className = "events-custom-calendar-month";
                const next = document.createElement("button");
                next.type = "button";
                next.className = "cyrene-button events-custom-calendar-nav";
                setButtonIcon(next, "M10 6l6 6-6 6");
                next.setAttribute("aria-label", "Next month");
                header.append(previous, monthLabel, next);

                const weekdays = document.createElement("div");
                weekdays.className = "events-custom-calendar-weekdays";
                ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day) => {
                    const label = document.createElement("span");
                    label.textContent = day;
                    weekdays.append(label);
                });

                const grid = document.createElement("div");
                grid.className = "events-custom-calendar-grid";
                grid.setAttribute("role", "grid");

                const timeRow = document.createElement("div");
                timeRow.className = "events-custom-calendar-time";
                const timeLabel = document.createElement("span");
                timeLabel.textContent = "Time";
                const hour = document.createElement("input");
                const minute = document.createElement("input");
                hour.type = minute.type = "text";
                hour.inputMode = minute.inputMode = "numeric";
                hour.maxLength = minute.maxLength = 2;
                hour.autocomplete = minute.autocomplete = "off";
                hour.setAttribute("aria-label", "Hour");
                minute.setAttribute("aria-label", "Minute");
                const separator = document.createElement("span");
                separator.textContent = ":";
                timeRow.append(timeLabel, hour, separator, minute);

                const footer = document.createElement("div");
                footer.className = "events-custom-calendar-footer";
                const today = document.createElement("button");
                today.type = "button";
                today.className = "cyrene-button events-custom-calendar-secondary";
                today.textContent = "Today";
                const footerEnd = document.createElement("div");
                footerEnd.className = "events-custom-calendar-footer-end";
                let clear = null;
                if (!isRequired) {
                    clear = document.createElement("button");
                    clear.type = "button";
                    clear.className = "cyrene-button events-custom-calendar-secondary";
                    clear.textContent = "Clear";
                    footerEnd.append(clear);
                }
                const cancel = document.createElement("button");
                cancel.type = "button";
                cancel.className = "cyrene-button events-custom-calendar-secondary";
                cancel.textContent = "Cancel";
                const apply = document.createElement("button");
                apply.type = "button";
                apply.className = "cyrene-button events-custom-calendar-apply";
                apply.textContent = "Apply";
                footerEnd.append(cancel, apply);
                footer.append(today, footerEnd);
                popover.append(header, weekdays, grid, timeRow, footer);

                input.after(wrapper);
                wrapper.append(trigger, popover);
                input.hidden = true;

                let selectedDate = new Date();
                let displayedMonth = new Date(
                    selectedDate.getFullYear(),
                    selectedDate.getMonth(),
                    1,
                );

                function valuesMatch(first, second) {
                    return (
                        first.getFullYear() === second.getFullYear() &&
                        first.getMonth() === second.getMonth() &&
                        first.getDate() === second.getDate()
                    );
                }

                function refreshTrigger() {
                    if (!input.value) {
                        triggerValue.textContent = isRequired
                            ? "Select date and time"
                            : "No end date";
                        trigger.classList.add("is-placeholder");
                        return;
                    }
                    const value = new Date(input.value);
                    triggerValue.textContent = new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                    }).format(value);
                    trigger.classList.remove("is-placeholder");
                }

                function renderCalendar() {
                    monthLabel.textContent = new Intl.DateTimeFormat(undefined, {
                        month: "long",
                        year: "numeric",
                    }).format(displayedMonth);
                    grid.replaceChildren();

                    const firstDay = new Date(
                        displayedMonth.getFullYear(),
                        displayedMonth.getMonth(),
                        1,
                    );
                    const mondayOffset = (firstDay.getDay() + 6) % 7;
                    const gridStart = new Date(firstDay);
                    gridStart.setDate(firstDay.getDate() - mondayOffset);
                    const currentDate = new Date();

                    for (let index = 0; index < 42; index += 1) {
                        const date = new Date(gridStart);
                        date.setDate(gridStart.getDate() + index);
                        const day = document.createElement("button");
                        day.type = "button";
                        day.className = "events-custom-calendar-day";
                        day.textContent = String(date.getDate());
                        day.setAttribute("role", "gridcell");
                        day.setAttribute(
                            "aria-label",
                            new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date),
                        );
                        day.classList.toggle(
                            "is-outside",
                            date.getMonth() !== displayedMonth.getMonth(),
                        );
                        day.classList.toggle("is-today", valuesMatch(date, currentDate));
                        day.classList.toggle("is-selected", valuesMatch(date, selectedDate));
                        day.addEventListener("click", () => {
                            selectedDate.setFullYear(
                                date.getFullYear(),
                                date.getMonth(),
                                date.getDate(),
                            );
                            displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                            renderCalendar();
                        });
                        grid.append(day);
                    }
                }

                function closePicker() {
                    popover.hidden = true;
                    trigger.setAttribute("aria-expanded", "false");
                    if (activeDateTimePicker === picker) {
                        activeDateTimePicker = null;
                    }
                }

                function openPicker() {
                    activeDateTimePicker?.close();
                    form.querySelectorAll(".custom-select.open").forEach((dropdown) => {
                        dropdown.classList.remove("open");
                        dropdown
                            .querySelector("[aria-expanded]")
                            ?.setAttribute("aria-expanded", "false");
                    });
                    const parsed = input.value ? new Date(input.value) : new Date();
                    selectedDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
                    displayedMonth = new Date(
                        selectedDate.getFullYear(),
                        selectedDate.getMonth(),
                        1,
                    );
                    hour.value = String(selectedDate.getHours()).padStart(2, "0");
                    minute.value = String(selectedDate.getMinutes()).padStart(2, "0");
                    renderCalendar();
                    popover.hidden = false;
                    trigger.setAttribute("aria-expanded", "true");
                    activeDateTimePicker = picker;
                }

                function commitValue() {
                    const hours = Math.max(0, Math.min(23, Number(hour.value) || 0));
                    const minutes = Math.max(0, Math.min(59, Number(minute.value) || 0));
                    selectedDate.setHours(hours, minutes, 0, 0);
                    const pad = (value) => String(value).padStart(2, "0");
                    input.value = `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}T${pad(selectedDate.getHours())}:${pad(selectedDate.getMinutes())}`;
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                    refreshTrigger();
                    closePicker();
                    trigger.focus();
                }

                const picker = { close: closePicker, refresh: refreshTrigger };
                input.customDateTimePicker = picker;

                trigger.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (popover.hidden) {
                        openPicker();
                    } else {
                        closePicker();
                    }
                });
                popover.addEventListener("click", (event) => {
                    event.stopPropagation();
                    if (!event.target.closest("input")) event.preventDefault();
                });
                wrapper.addEventListener("click", (event) => {
                    if (event.target === wrapper) event.preventDefault();
                });
                previous.addEventListener("click", () => {
                    displayedMonth.setMonth(displayedMonth.getMonth() - 1);
                    renderCalendar();
                });
                next.addEventListener("click", () => {
                    displayedMonth.setMonth(displayedMonth.getMonth() + 1);
                    renderCalendar();
                });
                today.addEventListener("click", () => {
                    selectedDate = new Date();
                    displayedMonth = new Date(
                        selectedDate.getFullYear(),
                        selectedDate.getMonth(),
                        1,
                    );
                    hour.value = String(selectedDate.getHours()).padStart(2, "0");
                    minute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5).padStart(
                        2,
                        "0",
                    );
                    renderCalendar();
                });

                [
                    [hour, 23],
                    [minute, 59],
                ].forEach(([field, maximum]) => {
                    field.addEventListener("input", () => {
                        field.value = field.value.replace(/\D/g, "").slice(0, 2);
                    });
                    field.addEventListener("blur", () => {
                        const value = Math.max(0, Math.min(maximum, Number(field.value) || 0));
                        field.value = String(value).padStart(2, "0");
                    });
                });
                clear?.addEventListener("click", () => {
                    input.value = "";
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                    refreshTrigger();
                    closePicker();
                    trigger.focus();
                });
                cancel.addEventListener("click", () => {
                    closePicker();
                    trigger.focus();
                });
                apply.addEventListener("click", commitValue);
                document.addEventListener("click", (event) => {
                    if (!wrapper.contains(event.target)) closePicker();
                });
                refreshTrigger();
            });
        }

        return {
            initialise,
            get active() {
                return activeDateTimePicker;
            },
        };
    }

    window.CyreneCustomEventControls = {
        toLocalInputValue,
        fromLocalInputValue,
        recurrenceLabel,
        makeElement,
        makeButton,
        enhanceNumberInput,
        initialiseAnimatedDetails,
        createDateTimePickers,
    };
})();
