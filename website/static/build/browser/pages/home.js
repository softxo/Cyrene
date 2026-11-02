(() => {
    window.initHome = () => {
        const root = document.querySelector("[data-changelog]");
        if (!root || root.dataset.initialised)
            return;
        window.disposeHome?.();
        root.dataset.initialised = "true";
        const lifecycle = new AbortController();
        const { signal } = lifecycle;
        const status = root.querySelector("[data-changelog-status]");
        const list = root.querySelector("[data-changelog-entries]");
        const add = root.querySelector("[data-changelog-add]");
        const dialog = root.querySelector("dialog");
        let modalMotion = null;
        let closingModal = null;
        function animateEditorIn() {
            modalMotion?.cancel();
            dialog.inert = false;
            dialog.classList.remove("is-closing");
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
                return;
            dialog.classList.add("is-opening");
            const motion = dialog.animate([
                { opacity: 0, transform: "translateY(14px) scale(.97)" },
                { opacity: 1, transform: "translateY(0) scale(1)" },
            ], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" });
            modalMotion = motion;
            void motion.finished
                .then(() => {
                if (modalMotion !== motion)
                    return;
                motion.cancel();
                modalMotion = null;
                dialog.classList.remove("is-opening");
            })
                .catch(() => {
                /* Closing can replace an unfinished entrance. */
            });
        }
        function closeEditor() {
            if (closingModal)
                return closingModal;
            if (!dialog.open)
                return Promise.resolve();
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                modalMotion?.cancel();
                modalMotion = null;
                dialog.close();
                return Promise.resolve();
            }
            const style = getComputedStyle(dialog);
            const opacity = style.opacity;
            const transform = style.transform;
            modalMotion?.cancel();
            dialog.inert = true;
            dialog.classList.remove("is-opening");
            dialog.classList.add("is-closing");
            const motion = dialog.animate([
                { opacity, transform },
                { opacity: 0, transform: "translateY(10px) scale(.98)" },
            ], { duration: 180, easing: "cubic-bezier(.4,0,1,1)", fill: "both" });
            modalMotion = motion;
            closingModal = motion.finished
                .catch(() => { })
                .then(() => {
                if (modalMotion === motion) {
                    dialog.close();
                    motion.cancel();
                    modalMotion = null;
                    dialog.classList.remove("is-closing");
                    dialog.inert = false;
                }
                closingModal = null;
            });
            return closingModal;
        }
        const form = root.querySelector("form");
        const deleteDialog = root.querySelector(".changelog-delete-dialog");
        deleteDialog
            .querySelector("[data-delete-cancel]")
            .addEventListener("click", () => deleteDialog.close(), { signal });
        deleteDialog.querySelector("[data-delete-confirm]").addEventListener("click", () => {
            deleteDialog.close();
            void save(true);
        }, { signal });
        let deletePressedOutside = false;
        function outsideDelete(event) {
            const bounds = deleteDialog.getBoundingClientRect();
            return (event.target === deleteDialog &&
                (event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom));
        }
        deleteDialog.addEventListener("pointerdown", (event) => {
            deletePressedOutside = outsideDelete(event);
        }, { signal });
        deleteDialog.addEventListener("click", (event) => {
            if (deletePressedOutside && outsideDelete(event))
                deleteDialog.close();
            deletePressedOutside = false;
        }, { signal });
        const date = form.querySelector("[name=date]");
        const timeInput = form.querySelector("[name=time]");
        const hour = form.querySelector("[data-time-hour]");
        const minute = form.querySelector("[data-time-minute]");
        const content = form.querySelector("#changelog-content");
        const colour = form.querySelector("[name=pill_colour]");
        const pillPreview = form.querySelector("[data-pill-preview]");
        const gradient = form.querySelector("[data-pill-gradient]");
        const colourEnd = form.querySelector("[data-pill-colour-end]");
        function stylePill(pill, start, end) {
            pill.style.setProperty("--pill-colour", start);
            const hasGradient = !!end && /^#[a-f0-9]{6}$/i.test(end);
            pill.classList.toggle("is-gradient", hasGradient);
            if (hasGradient)
                pill.style.setProperty("--pill-colour-end", end);
            else
                pill.style.removeProperty("--pill-colour-end");
        }
        gradient.addEventListener("change", updateDate, { signal });
        colourEnd.addEventListener("input", updateDate, { signal });
        const dateTrigger = form.querySelector("[data-date-trigger]");
        const calendar = form.querySelector("[data-date-calendar]");
        const calendarGrid = calendar.querySelector("[role=grid]");
        let selectedDate = new Date();
        let month = new Date();
        const isoDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
        function updateDate() {
            const label = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${date.value}T12:00:00`));
            const dateLabel = document.createElement("span");
            dateLabel.textContent = label;
            const timeLabel = document.createElement("span");
            timeLabel.className = "changelog-date-time";
            timeLabel.textContent = timeInput.value;
            dateTrigger.replaceChildren(dateLabel, document.createTextNode(" "), timeLabel);
            pillPreview.textContent = `${label}, ${timeInput.value}`;
            colourEnd.hidden = !gradient.checked;
            stylePill(pillPreview, colour.value, gradient.checked ? colourEnd.value : null);
        }
        function closeCalendar() {
            calendar.hidden = true;
            dateTrigger.setAttribute("aria-expanded", "false");
        }
        function renderCalendar() {
            calendar.querySelector("[data-date-month]").textContent =
                new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month);
            calendarGrid.replaceChildren();
            const start = new Date(month.getFullYear(), month.getMonth(), 1);
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
            for (let i = 0; i < 42; i++) {
                const value = new Date(start);
                value.setDate(start.getDate() + i);
                const day = document.createElement("button");
                day.type = "button";
                day.textContent = String(value.getDate());
                day.setAttribute("role", "gridcell");
                day.setAttribute("aria-label", new Intl.DateTimeFormat("en-GB", { dateStyle: "full" }).format(value));
                day.setAttribute("aria-selected", String(isoDate(value) === isoDate(selectedDate)));
                day.classList.toggle("is-outside", value.getMonth() !== month.getMonth());
                day.classList.toggle("is-today", isoDate(value) === isoDate(new Date()));
                day.addEventListener("click", () => {
                    selectedDate = value;
                    renderCalendar();
                });
                calendarGrid.append(day);
            }
        }
        dateTrigger.addEventListener("click", () => {
            if (!calendar.hidden) {
                closeCalendar();
                return;
            }
            [hour.value, minute.value] = timeInput.value.split(":");
            selectedDate = new Date(`${date.value}T12:00:00`);
            month = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            renderCalendar();
            calendar.hidden = false;
            dateTrigger.setAttribute("aria-expanded", "true");
        }, { signal });
        for (const [selector, offset] of [
            ["[data-date-prev]", -1],
            ["[data-date-next]", 1],
        ]) {
            calendar.querySelector(selector).addEventListener("click", () => {
                month.setMonth(month.getMonth() + offset);
                renderCalendar();
            }, { signal });
        }
        calendar.querySelector("[data-date-today]").addEventListener("click", () => {
            selectedDate = new Date();
            month = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            renderCalendar();
        }, { signal });
        calendar
            .querySelector("[data-date-cancel]")
            .addEventListener("click", closeCalendar, { signal });
        calendar.querySelector("[data-date-apply]").addEventListener("click", () => {
            date.value = isoDate(selectedDate);
            const clampTime = (value, max) => String(Math.max(0, Math.min(max, Number.parseInt(value, 10) || 0))).padStart(2, "0");
            timeInput.value = `${clampTime(hour.value, 23)}:${clampTime(minute.value, 59)}`;
            updateDate();
            closeCalendar();
            dateTrigger.focus();
        }, { signal });
        dialog.addEventListener("cancel", (event) => {
            if (presetsButton.getAttribute("aria-expanded") === "true") {
                event.preventDefault();
                revealPresets(false);
                presetsButton.focus();
            }
            else if (!calendar.hidden) {
                event.preventDefault();
                closeCalendar();
                dateTrigger.focus();
            }
            else {
                event.preventDefault();
                void closeEditor();
            }
        }, { signal });
        dialog.addEventListener("click", (event) => {
            if (presetsButton.getAttribute("aria-expanded") === "true" &&
                !event.composedPath().includes(presetsPanel) &&
                !event.composedPath().includes(presetsButton))
                revealPresets(false);
            if (!event.composedPath().includes(calendar) &&
                !event.composedPath().includes(dateTrigger))
                closeCalendar();
        }, { signal });
        let pressedOutside = false;
        function outsideDialog(event) {
            const bounds = dialog.getBoundingClientRect();
            return (event.target === dialog &&
                (event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom));
        }
        dialog.addEventListener("pointerdown", (event) => {
            pressedOutside = outsideDialog(event);
        }, { signal });
        dialog.addEventListener("click", (event) => {
            if (pressedOutside && outsideDialog(event))
                void closeEditor();
            pressedOutside = false;
        }, { signal });
        colour.addEventListener("input", updateDate, { signal });
        const picker = form.querySelector(".changelog-picker");
        const pickerPanel = form.querySelector(".changelog-emoji-disclosure");
        const pickerButton = form.querySelector("[data-changelog-icons]");
        const help = form.querySelector(".changelog-format-help");
        const helpToggle = help.querySelector("summary");
        const helpContent = help.querySelector(".changelog-help-content");
        const animations = new Map();
        function reveal(panel, show, complete) {
            const start = panel.hidden ? 0 : panel.getBoundingClientRect().height;
            const opacity = panel.hidden ? 0 : Number(getComputedStyle(panel).opacity);
            animations.get(panel)?.cancel();
            animations.delete(panel);
            panel.hidden = false;
            const height = panel.getBoundingClientRect().height;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                panel.hidden = !show;
                complete?.();
                return;
            }
            const animation = panel.animate([
                { height: `${start}px`, opacity, overflow: "hidden" },
                { height: `${show ? height : 0}px`, opacity: show ? 1 : 0, overflow: "hidden" },
            ], { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" });
            animations.set(panel, animation);
            void animation.finished
                .then(() => {
                if (animations.get(panel) !== animation)
                    return;
                panel.hidden = !show;
                animation.cancel();
                animations.delete(panel);
                complete?.();
            })
                .catch(() => {
                /* A newer toggle replaced this transition. */
            });
        }
        helpToggle.addEventListener("click", (event) => {
            event.preventDefault();
            const show = helpToggle.getAttribute("aria-expanded") !== "true";
            helpToggle.setAttribute("aria-expanded", String(show));
            if (show)
                help.open = true;
            reveal(helpContent, show, () => {
                if (!show)
                    help.open = false;
            });
        }, { signal });
        const textColourInput = form.querySelector("input[data-text-colour]");
        const textColourPreview = form.querySelector("[data-text-colour-preview]");
        function updateTextColour() {
            textColourPreview.style.color = textColourInput.value;
        }
        textColourInput.addEventListener("input", updateTextColour, { signal });
        const presetsButton = form.querySelector("[data-colour-presets]");
        const presetsPanel = form.querySelector(".changelog-colour-presets");
        const presetList = form.querySelector("[data-preset-list]");
        const presetHex = form.querySelector("#changelog-preset-hex");
        const presetPicker = form.querySelector("[data-preset-picker]");
        presetPicker.addEventListener("input", () => {
            presetHex.value = presetPicker.value;
        }, { signal });
        presetHex.addEventListener("input", () => {
            const value = presetHex.value.trim();
            if (/^#[a-f0-9]{6}$/i.test(value))
                presetPicker.value = value;
        }, { signal });
        const presetStatus = form.querySelector("[data-preset-status]");
        function positionPresets() {
            const tools = form.querySelector(".changelog-text-tools");
            presetsPanel.style.top = `${tools.offsetTop + tools.offsetHeight + 8}px`;
        }
        window.addEventListener("resize", () => {
            if (!presetsPanel.hidden)
                positionPresets();
        }, { signal });
        function revealPresets(show) {
            if (show)
                positionPresets();
            const wasHidden = presetsPanel.hidden;
            const style = getComputedStyle(presetsPanel);
            const opacity = wasHidden ? 0 : Number(style.opacity);
            const transform = wasHidden ? "translateY(-6px)" : style.transform;
            animations.get(presetsPanel)?.cancel();
            animations.delete(presetsPanel);
            presetsButton.setAttribute("aria-expanded", String(show));
            presetsPanel.inert = !show;
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                presetsPanel.hidden = !show;
                return;
            }
            presetsPanel.hidden = false;
            const motion = presetsPanel.animate([
                { opacity, transform },
                {
                    opacity: show ? 1 : 0,
                    transform: show ? "translateY(0)" : "translateY(-6px)",
                },
            ], { duration: show ? 180 : 140, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" });
            animations.set(presetsPanel, motion);
            void motion.finished
                .then(() => {
                if (animations.get(presetsPanel) !== motion)
                    return;
                presetsPanel.hidden = !show;
                motion.cancel();
                animations.delete(presetsPanel);
            })
                .catch(() => {
                /* A newer toggle replaced this transition. */
            });
        }
        const presetKey = "cyrene-changelog-colour-presets-v1";
        let presets = [];
        try {
            const saved = JSON.parse(localStorage.getItem(presetKey) || "[]");
            if (Array.isArray(saved))
                presets = [
                    ...new Set(saved
                        .filter((item) => typeof item === "string" && /^#[a-f0-9]{6}$/i.test(item))
                        .map((item) => item.toLowerCase())),
                ].slice(0, 24);
        }
        catch {
            /* Presets remain usable when storage is unavailable. */
        }
        function persistPresets() {
            try {
                localStorage.setItem(presetKey, JSON.stringify(presets));
            }
            catch {
                presetStatus.textContent =
                    "Browser storage is unavailable; presets will last until you leave this page.";
            }
        }
        function renderPresets() {
            presetList.replaceChildren();
            if (!presets.length) {
                const empty = document.createElement("p");
                empty.textContent = "Save a colour code below to reuse it here.";
                presetList.append(empty);
            }
            for (const hex of presets) {
                const group = document.createElement("div");
                group.className = "changelog-preset";
                const use = document.createElement("button");
                use.type = "button";
                use.setAttribute("aria-label", `Use colour ${hex}`);
                const swatch = document.createElement("span");
                swatch.style.backgroundColor = hex;
                swatch.setAttribute("aria-hidden", "true");
                use.append(swatch, document.createTextNode(hex));
                use.addEventListener("click", () => {
                    textColourInput.value = hex;
                    updateTextColour();
                    presetsButton.setAttribute("aria-expanded", "false");
                    revealPresets(false);
                    presetsButton.focus();
                }, { signal });
                const remove = document.createElement("button");
                remove.type = "button";
                remove.textContent = "\u00d7";
                remove.setAttribute("aria-label", `Remove colour ${hex}`);
                remove.addEventListener("click", () => {
                    presets = presets.filter((item) => item !== hex);
                    persistPresets();
                    renderPresets();
                }, { signal });
                group.append(use, remove);
                presetList.append(group);
            }
        }
        function savePreset() {
            const hex = presetHex.value.trim().toLowerCase();
            if (!/^#[a-f0-9]{6}$/.test(hex)) {
                presetStatus.textContent = "Enter a six-digit hex colour, such as #ec3b83.";
                return;
            }
            if (presets.includes(hex)) {
                presetStatus.textContent = "This colour is already saved.";
                return;
            }
            if (presets.length >= 24) {
                presetStatus.textContent = "You can save up to 24 colours. Remove one first.";
                return;
            }
            presets.push(hex);
            presetStatus.textContent = "Colour saved.";
            persistPresets();
            renderPresets();
            textColourInput.value = hex;
            updateTextColour();
        }
        presetsButton.addEventListener("click", () => {
            const show = presetsButton.getAttribute("aria-expanded") !== "true";
            presetsButton.setAttribute("aria-expanded", String(show));
            if (show) {
                presetHex.value = textColourInput.value;
                presetPicker.value = textColourInput.value;
                presetStatus.textContent = "";
                renderPresets();
            }
            revealPresets(show);
        }, { signal });
        form.querySelector("[data-save-preset]").addEventListener("click", savePreset, { signal });
        presetHex.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                savePreset();
            }
        }, { signal });
        const preview = form.querySelector(".changelog-preview");
        const error = form.querySelector("[data-changelog-error]");
        const remove = form.querySelector("[data-changelog-delete]");
        const submit = form.querySelector("[type=submit]");
        let icons = [];
        let feedVersion = "";
        let editing = null;
        let busy = false;
        function image(icon) {
            const img = document.createElement("img");
            img.src = icon.url;
            img.alt = icon.label;
            img.className = "changelog-emoji";
            img.width = 22;
            img.height = 22;
            img.draggable = false;
            return img;
        }
        function appendMarkdown(target, source) {
            // Read colour/opacity independently of Markdown so a selection may cross bold markers.
            let text = "";
            const styles = [];
            const styled = /\\.|`[^`]+`|\[([^\]\n]+)\]\{(#[a-fA-F0-9]{6}(?:;opacity:(?:100|[1-9]?\d))?|opacity:(?:100|[1-9]?\d))\}/g;
            let cursor = 0;
            for (const match of source.matchAll(styled)) {
                const prefix = source.slice(cursor, match.index);
                text += prefix;
                styles.push(...Array(prefix.length).fill(undefined));
                const value = match[1] ?? match[0];
                text += value;
                styles.push(...Array(value.length).fill(match[2]));
                cursor = match.index + match[0].length;
            }
            const suffix = source.slice(cursor);
            text += suffix;
            styles.push(...Array(suffix.length).fill(undefined));
            function appendText(parent, value, offset) {
                let at = 0;
                while (at < value.length) {
                    const attributes = styles[offset + at];
                    let end = at + 1;
                    while (end < value.length && styles[offset + end] === attributes)
                        end++;
                    const literal = value.slice(at, end);
                    if (attributes) {
                        const span = document.createElement("span");
                        styleText(span, attributes);
                        span.textContent = literal;
                        parent.append(span);
                    }
                    else
                        parent.append(document.createTextNode(literal));
                    at = end;
                }
            }
            function render(parent, value, offset = 0, depth = 0) {
                if (depth > 12) {
                    appendText(parent, value, offset);
                    return;
                }
                const tokens = /\\([\\`*_~[\]():])|`([^`]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*\*|___|\*\*|__|~~|\*|_)(?=\S)(.+?\S|\S)\5|:[A-Za-z0-9_]+:/g;
                let cursor = 0;
                for (const match of value.matchAll(tokens)) {
                    appendText(parent, value.slice(cursor, match.index), offset + cursor);
                    const [token, escaped, code, label, url, delimiter, inner] = match;
                    const position = offset + match.index;
                    if (escaped)
                        appendText(parent, escaped, position + 1);
                    else if (code) {
                        const node = document.createElement("code");
                        appendText(node, code, position + 1);
                        parent.append(node);
                    }
                    else if (url) {
                        const node = document.createElement("a");
                        node.href = url;
                        node.rel = "noopener noreferrer";
                        render(node, label, position + 1, depth + 1);
                        parent.append(node);
                    }
                    else if (delimiter) {
                        const intraword = delimiter.includes("_") &&
                            /[a-z0-9]/i.test(value[match.index - 1] ?? "") &&
                            /[a-z0-9]/i.test(value[match.index + token.length] ?? "");
                        if (intraword)
                            appendText(parent, token, position);
                        else {
                            const node = document.createElement(delimiter === "~~" ? "s" : delimiter.length >= 2 ? "strong" : "em");
                            if (delimiter.length === 3) {
                                const em = document.createElement("em");
                                render(em, inner, position + 3, depth + 1);
                                node.append(em);
                            }
                            else
                                render(node, inner, position + delimiter.length, depth + 1);
                            parent.append(node);
                        }
                    }
                    else {
                        const icon = icons.find((icon) => token === `:${icon.name}:`);
                        if (icon) {
                            const img = image(icon);
                            if (styles[position]) {
                                const span = document.createElement("span");
                                styleText(span, styles[position]);
                                span.append(img);
                                parent.append(span);
                            }
                            else
                                parent.append(img);
                        }
                        else
                            appendText(parent, token, position);
                    }
                    cursor = match.index + token.length;
                }
                appendText(parent, value.slice(cursor), offset + cursor);
            }
            render(target, text);
        }
        function renderContent(target, text) {
            target.replaceChildren();
            for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
                const item = document.createElement("p");
                appendMarkdown(item, line);
                target.append(item);
            }
        }
        let savedSelection = null;
        function styleText(node, attributes) {
            for (const attribute of attributes.split(";")) {
                if (/^#[a-f0-9]{6}$/i.test(attribute)) {
                    node.dataset.textColour = attribute;
                    node.style.color = attribute;
                }
                else if (/^opacity:(100|[1-9]?\d)$/.test(attribute)) {
                    node.dataset.textOpacity = attribute.slice(8);
                    node.style.opacity = String(Number(attribute.slice(8)) / 100);
                }
            }
        }
        function editorSource(node = content, inherited = {}) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent ?? "";
                const attributes = [
                    inherited.colour,
                    inherited.opacity !== undefined ? `opacity:${inherited.opacity}` : "",
                ]
                    .filter(Boolean)
                    .join(";");
                return attributes
                    ? text
                        .split("\n")
                        .map((line) => (line ? `[${line}]{${attributes}}` : ""))
                        .join("\n")
                    : text;
            }
            if (!(node instanceof HTMLElement))
                return "";
            if (node.tagName === "BR")
                return "\n";
            const styles = { ...inherited };
            if (node.dataset.textColour)
                styles.colour = node.dataset.textColour;
            if (node.dataset.textOpacity !== undefined)
                styles.opacity = node.dataset.textOpacity;
            const text = Array.from(node.childNodes, (child) => editorSource(child, styles)).join("");
            if (/^(B|STRONG)$/.test(node.tagName))
                return `**${text}**`;
            if (/^(I|EM)$/.test(node.tagName))
                return `_${text}_`;
            if (/^(S|STRIKE)$/.test(node.tagName))
                return `~~${text}~~`;
            return text + (node !== content && /^(DIV|P)$/.test(node.tagName) ? "\n" : "");
        }
        function loadEditor(source) {
            content.replaceChildren();
            savedSelection = null;
            const colours = /\[([^\]\n]+)\]\{(#[a-f0-9]{6}(?:;opacity:(?:100|[1-9]?\d))?|opacity:(?:100|[1-9]?\d))\}/gi;
            let cursor = 0;
            for (const match of source.matchAll(colours)) {
                content.append(document.createTextNode(source.slice(cursor, match.index)));
                const span = document.createElement("span");
                styleText(span, match[2]);
                span.textContent = match[1];
                content.append(span);
                cursor = match.index + match[0].length;
            }
            content.append(document.createTextNode(source.slice(cursor)));
        }
        function selectionRange() {
            if (savedSelection && content.contains(savedSelection.commonAncestorContainer))
                return savedSelection.cloneRange();
            const range = document.createRange();
            range.selectNodeContents(content);
            range.collapse(false);
            return range;
        }
        function insertEditor(node, range = selectionRange()) {
            range.deleteContents();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            content.focus();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            savedSelection = range.cloneRange();
            renderContent(preview, editorSource());
        }
        document.addEventListener("selectionchange", () => {
            const selection = window.getSelection();
            if (selection?.rangeCount &&
                content.contains(selection.getRangeAt(0).commonAncestorContainer))
                savedSelection = selection.getRangeAt(0).cloneRange();
        }, { signal });
        content.addEventListener("paste", (event) => {
            event.preventDefault();
            insertEditor(document.createTextNode(event.clipboardData?.getData("text/plain") ?? ""));
        }, { signal });
        content.addEventListener("beforeinput", (event) => {
            if (event.inputType === "insertParagraph" ||
                event.inputType === "insertLineBreak") {
                event.preventDefault();
                insertEditor(document.createTextNode("\n"));
            }
        }, { signal });
        function open(entry) {
            editing = entry?.id ?? null;
            form.reset();
            updateOpacity();
            updateTextColour();
            date.value =
                entry?.date ??
                    new Intl.DateTimeFormat("en-CA", {
                        timeZone: "Europe/London",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                    }).format(new Date());
            colour.value = /^#[0-9a-f]{6}$/i.test(entry?.pill_colour ?? "")
                ? entry.pill_colour
                : "#8f9cff";
            timeInput.value =
                entry?.time ??
                    new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Europe/London",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                    }).format(new Date());
            gradient.checked = /^#[a-f0-9]{6}$/i.test(entry?.pill_colour_end ?? "");
            colourEnd.value = gradient.checked ? entry.pill_colour_end : "#56b987";
            closeCalendar();
            updateDate();
            loadEditor(entry?.content ?? "");
            error.textContent = "";
            remove.hidden = !entry;
            submit.textContent = entry ? "Save changes" : "Publish update";
            form.querySelector("h2").textContent = entry ? "Edit Changelog" : "Add Changelog";
            for (const animation of animations.values())
                animation.cancel();
            animations.clear();
            presetsPanel.hidden = true;
            presetsButton.setAttribute("aria-expanded", "false");
            help.open = false;
            helpContent.hidden = true;
            helpToggle.setAttribute("aria-expanded", "false");
            pickerPanel.hidden = true;
            pickerButton.setAttribute("aria-expanded", "false");
            renderContent(preview, editorSource());
            dialog.style.removeProperty("margin-top");
            dialog.style.removeProperty("margin-bottom");
            dialog.style.removeProperty("max-height");
            dialog.showModal();
            const top = Math.max(24, dialog.getBoundingClientRect().top);
            dialog.style.marginTop = `${top}px`;
            dialog.style.marginBottom = "auto";
            dialog.style.maxHeight = `calc(100dvh - ${top + 24}px)`;
            animateEditorIn();
            form.querySelector("h2").focus();
        }
        async function load() {
            const response = await fetch("/api/changelog", { signal, cache: "no-store" });
            if (!response.ok)
                throw new Error("Couldn't load the changelog. Please try again.");
            const data = await response.json();
            const version = JSON.stringify(data);
            if (version === feedVersion)
                return;
            feedVersion = version;
            icons = data.icons.filter((icon) => /^[A-Za-z0-9_]+$/.test(icon.name) &&
                !["Live_Status", "Changelog"].includes(icon.name) &&
                icon.url === `/static/images/ui/ui_misc/${icon.name}.png`);
            add.hidden = !data.can_edit;
            list.replaceChildren();
            for (const entry of data.entries) {
                const article = document.createElement("article");
                article.className = "changelog-entry";
                const heading = document.createElement("div");
                heading.className = "changelog-entry-heading";
                const time = document.createElement("time");
                time.dateTime = `${entry.date}T${entry.time ?? "00:00"}`;
                time.textContent = entry.date_label;
                stylePill(time, /^#[0-9a-f]{6}$/i.test(entry.pill_colour ?? "")
                    ? entry.pill_colour
                    : "#8f9cff", entry.pill_colour_end);
                heading.append(time);
                if (data.can_edit) {
                    const edit = document.createElement("button");
                    edit.type = "button";
                    edit.className = "cyrene-button cyrene-button--compact";
                    edit.textContent = "Edit";
                    edit.setAttribute("aria-label", `Edit changelog for ${entry.date_label}`);
                    edit.addEventListener("click", () => open(entry), { signal });
                    heading.append(edit);
                }
                const body = document.createElement("div");
                body.className = "changelog-entry-content";
                renderContent(body, entry.content);
                article.append(heading, body);
                list.append(article);
            }
            status.textContent = data.entries.length ? "" : "Updates will appear here.";
            picker.replaceChildren();
            for (const icon of icons) {
                const button = document.createElement("button");
                button.type = "button";
                button.title = icon.label;
                button.setAttribute("aria-label", `Insert ${icon.label}`);
                button.append(image(icon), document.createTextNode(icon.label));
                button.addEventListener("click", () => {
                    insertEditor(document.createTextNode(`:${icon.name}: `));
                }, { signal });
                picker.append(button);
            }
        }
        async function save(deleting = false) {
            if (busy)
                return;
            if (!deleting && (!content.textContent?.trim() || editorSource().length > 8000)) {
                error.textContent = "Write an update of up to 8,000 characters.";
                return;
            }
            busy = true;
            submit.disabled = remove.disabled = true;
            error.textContent = "";
            try {
                const response = await fetch(`/api/changelog${editing === null ? "" : `/${editing}`}`, {
                    method: deleting ? "DELETE" : editing === null ? "POST" : "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: deleting
                        ? undefined
                        : JSON.stringify({
                            date: date.value,
                            time: timeInput.value,
                            content: editorSource(),
                            pill_colour: colour.value,
                            pill_colour_end: gradient.checked ? colourEnd.value : null,
                        }),
                    signal,
                });
                if (!response.ok) {
                    const result = await response.json();
                    throw new Error(typeof result.detail === "string"
                        ? result.detail
                        : "Couldn't save the update.");
                }
                await closeEditor();
                await load();
            }
            catch (reason) {
                if (signal.aborted)
                    return;
                const message = reason instanceof Error ? reason.message : "Couldn't save the update.";
                if (dialog.open)
                    error.textContent = message;
                else
                    status.textContent = message;
            }
            finally {
                busy = false;
                submit.disabled = remove.disabled = false;
            }
        }
        add.addEventListener("click", () => open(), { signal });
        for (const button of form.querySelectorAll("[data-changelog-close], [data-changelog-cancel]")) {
            button.addEventListener("click", () => void closeEditor(), { signal });
        }
        pickerButton.addEventListener("click", () => {
            const show = pickerButton.getAttribute("aria-expanded") !== "true";
            pickerButton.setAttribute("aria-expanded", String(show));
            reveal(pickerPanel, show);
        }, { signal });
        function applyTextStyle(kind, value) {
            const range = selectionRange();
            if (range.collapsed) {
                error.textContent = "Select the text you want to format first.";
                return;
            }
            const fragment = range.extractContents();
            const selector = kind === "colour" ? "[data-text-colour]" : "[data-text-opacity]";
            for (const previous of fragment.querySelectorAll(selector)) {
                if (kind === "colour") {
                    delete previous.dataset.textColour;
                    previous.style.removeProperty("color");
                }
                else {
                    delete previous.dataset.textOpacity;
                    previous.style.removeProperty("opacity");
                }
            }
            const span = document.createElement("span");
            styleText(span, kind === "colour" ? value : `opacity:${value}`);
            span.append(fragment);
            insertEditor(span, range);
            // Flatten overlapping styles so repeated opacity changes replace, rather than multiply.
            const source = editorSource();
            loadEditor(source);
            const caret = document.createRange();
            caret.selectNodeContents(content);
            caret.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(caret);
            savedSelection = caret.cloneRange();
            error.textContent = "";
        }
        form.querySelector("[data-apply-text-colour]").addEventListener("click", () => {
            applyTextStyle("colour", form.querySelector("input[data-text-colour]").value);
        }, { signal });
        const opacity = form.querySelector("[data-opacity-input]");
        const opacityLabel = form.querySelector("[data-opacity-value]");
        function updateOpacity() {
            opacityLabel.value = `${opacity.value}%`;
            opacity.style.setProperty("--opacity-fill", `${((Number(opacity.value) - 10) / 90) * 100}%`);
        }
        opacity.addEventListener("input", updateOpacity, { signal });
        form.querySelector("[data-apply-opacity]").addEventListener("click", () => {
            applyTextStyle("opacity", opacity.value);
        }, { signal });
        content.addEventListener("input", () => renderContent(preview, editorSource()), { signal });
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            void save();
        }, { signal });
        remove.addEventListener("click", () => {
            deleteDialog.querySelector("[data-delete-date]").textContent =
                dateTrigger.textContent;
            deleteDialog.showModal();
        }, { signal });
        let checking = false;
        async function checkUpdates() {
            if (checking || busy || dialog.open || document.hidden)
                return;
            checking = true;
            try {
                await load();
            }
            catch {
                /* Keep the current feed during a temporary outage. */
            }
            finally {
                checking = false;
            }
        }
        const liveTimer = window.setInterval(() => void checkUpdates(), 15000);
        document.addEventListener("visibilitychange", () => void checkUpdates(), { signal });
        window.addEventListener("focus", () => void checkUpdates(), { signal });
        window.disposeHome = () => {
            for (const animation of animations.values())
                animation.cancel();
            animations.clear();
            window.clearInterval(liveTimer);
            lifecycle.abort();
            modalMotion?.cancel();
            modalMotion = null;
            deleteDialog.close();
            dialog.close();
            delete root.dataset.initialised;
        };
        void load().catch(() => {
            if (!signal.aborted)
                status.textContent = "Couldn't load updates. Refresh the page to try again.";
        });
    };
})();
