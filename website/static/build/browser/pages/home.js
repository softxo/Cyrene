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
        function closeEditor() {
            dialog.close();
            return Promise.resolve();
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
        function revealPresets(show) {
            presetsButton.setAttribute("aria-expanded", String(show));
            presetsPanel.hidden = !show;
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
            img.dataset.changelogIcon = icon.name;
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
                const tokens = /\\([\\`*_~[\]():])|`([^`]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*\*|___|\*\*|__|~~|\+\+|\*|_)(?=\S)(.+?\S|\S)\5|:[A-Za-z0-9_]+:/g;
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
                            const node = document.createElement(delimiter === "++"
                                ? "u"
                                : delimiter === "~~"
                                    ? "s"
                                    : delimiter.length >= 2
                                        ? "strong"
                                        : "em");
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
        // Filled paths drawn for a native 16px grid, rather than scaled strokes.
        const calloutPaths = {
            note: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 7h1.5v5h-1.5V7ZM8 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
            tip: "M8 0a5.5 5.5 0 0 0-3.8 9.5c.7.7 1.1 1.5 1.1 2.5h5.4c0-1 .4-1.8 1.1-2.5A5.5 5.5 0 0 0 8 0Zm0 1.5a4 4 0 0 1 2.8 6.9c-.7.6-1.2 1.3-1.5 2.1H6.7c-.3-.8-.8-1.5-1.5-2.1A4 4 0 0 1 8 1.5ZM5.5 13h5v1.5h-5V13ZM6.5 15h3v1h-3v-1Z",
            important: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 4h1.5v5.5h-1.5V4ZM7 11h2v2H7v-2Z",
            caution: "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM5 4l3 3 3-3 1 1-3 3 3 3-1 1-3-3-3 3-1-1 3-3-3-3 1-1Z",
            warning: "M6.7 1.8a1.5 1.5 0 0 1 2.6 0l6.3 11a1.5 1.5 0 0 1-1.3 2.2H1.7a1.5 1.5 0 0 1-1.3-2.2l6.3-11ZM8 3 2 13.5h12L8 3ZM7.25 6h1.5v4.5h-1.5V6Zm0 5.5h1.5V13h-1.5v-1.5Z",
        };
        function callout(kind, message, editable = false) {
            const block = document.createElement("aside");
            block.className = `changelog-callout changelog-callout--${kind}`;
            block.dataset.callout = kind;
            const heading = document.createElement("div");
            heading.className = "changelog-callout-heading";
            if (editable)
                heading.contentEditable = "false";
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 16 16");
            svg.setAttribute("fill", "currentColor");
            svg.setAttribute("width", "16");
            svg.setAttribute("height", "16");
            svg.setAttribute("aria-hidden", "true");
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", calloutPaths[kind]);
            path.setAttribute("fill-rule", "evenodd");
            svg.append(path);
            const title = document.createElement("strong");
            title.textContent = kind[0].toUpperCase() + kind.slice(1);
            heading.append(svg, title);
            const body = document.createElement("div");
            body.dataset.calloutBody = "true";
            for (const line of message.split("\n")) {
                const paragraph = document.createElement("p");
                appendMarkdown(paragraph, line);
                body.append(paragraph);
            }
            block.append(heading, body);
            return block;
        }
        function codeBlock(source, language = "", editable = false) {
            const pre = document.createElement("pre");
            pre.className = "changelog-code-block";
            pre.dataset.codeBlock = "true";
            if (language)
                pre.dataset.language = language;
            pre.setAttribute("aria-label", language ? `${language} code block` : "Code block");
            if (editable)
                pre.contentEditable = "false";
            const code = document.createElement("code");
            code.textContent = source;
            pre.append(code);
            return pre;
        }
        function contentBlocks(source) {
            const result = [];
            const lines = source.split(/\r?\n/);
            for (let index = 0; index < lines.length; index++) {
                const fence = lines[index].match(/^\s*(`{3,}|~{3,})([A-Za-z0-9_+#.-]{0,32})\s*$/);
                if (fence) {
                    const body = [];
                    const closing = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
                    while (++index < lines.length && !closing.test(lines[index]))
                        body.push(lines[index]);
                    result.push({ code: true, language: fence[2], text: body.join("\n") });
                    continue;
                }
                const header = lines[index].match(/^>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]\s*$/i);
                if (!header) {
                    result.push({ text: lines[index] });
                    continue;
                }
                const body = [];
                while (index + 1 < lines.length &&
                    /^>/.test(lines[index + 1]) &&
                    !/^>\s*\[!(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]/i.test(lines[index + 1])) {
                    body.push(lines[++index].replace(/^> ?/, ""));
                }
                result.push({
                    kind: header[1].toLowerCase(),
                    text: body.join("\n"),
                });
            }
            return result;
        }
        function renderContent(target, text) {
            target.replaceChildren();
            for (const block of contentBlocks(text)) {
                if (block.code)
                    target.append(codeBlock(block.text, block.language));
                else if (block.kind)
                    target.append(callout(block.kind, block.text));
                else if (block.text.trim()) {
                    const item = document.createElement("p");
                    appendMarkdown(item, block.text);
                    target.append(item);
                }
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
                const text = (node.textContent ?? "").replace(/\u200b/g, "");
                const attributes = [
                    inherited.colour,
                    inherited.opacity !== undefined ? `opacity:${inherited.opacity}` : "",
                ]
                    .filter(Boolean)
                    .join(";");
                return attributes
                    ? text
                        .split("\n")
                        .map((line) => {
                        const parts = line.match(/^(\s*)(.*?)(\s*)$/);
                        return parts[2]
                            ? `${parts[1]}[${parts[2]}]{${attributes}}${parts[3]}`
                            : line;
                    })
                        .join("\n")
                    : text;
            }
            if (!(node instanceof HTMLElement))
                return "";
            if (node.tagName === "BR")
                return "\n";
            if (node.dataset.changelogIcon)
                return `:${node.dataset.changelogIcon}:`;
            if (node.tagName === "CODE")
                return "`" + (node.textContent ?? "") + "`";
            if (node.dataset.codeBlock) {
                const source = node.querySelector("code")?.textContent ?? "";
                const runs = Array.from(source.matchAll(/`+/g), (match) => match[0].length);
                const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
                return `${fence}${node.dataset.language ?? ""}\n${source}\n${fence}`;
            }
            if (node.dataset.callout) {
                const body = node.querySelector("[data-callout-body]");
                const message = body ? editorSource(body).trim() : "";
                return `> [!${node.dataset.callout.toUpperCase()}]\n${message
                    .split("\n")
                    .map((line) => `> ${line}`)
                    .join("\n")}`;
            }
            const styles = { ...inherited };
            if (node.dataset.textColour)
                styles.colour = node.dataset.textColour;
            if (node.dataset.textOpacity !== undefined)
                styles.opacity = node.dataset.textOpacity;
            let text = "";
            let afterBlock = false;
            for (const child of node.childNodes) {
                const part = editorSource(child, styles);
                const block = child instanceof HTMLElement &&
                    (!!child.dataset.callout || !!child.dataset.codeBlock);
                if (block && text && !text.endsWith("\n"))
                    text += "\n";
                else if (afterBlock && part && !part.startsWith("\n"))
                    text += "\n";
                text += part;
                if (part)
                    afterBlock = block;
            }
            const marked = (delimiter) => text
                .split("\n")
                .map((line) => {
                const parts = line.match(/^(\s*)(.*?)(\s*)$/);
                return parts[2]
                    ? `${parts[1]}${delimiter}${parts[2]}${delimiter}${parts[3]}`
                    : line;
            })
                .join("\n");
            if (/^(B|STRONG)$/.test(node.tagName))
                return marked("**");
            if (/^(I|EM)$/.test(node.tagName))
                return marked("_");
            if (node.tagName === "U")
                return marked("++");
            if (node.tagName === "A") {
                const url = safeLink(node.getAttribute("href") ?? "");
                return url ? `[${text}](${url})` : text;
            }
            if (/^(S|STRIKE)$/.test(node.tagName))
                return marked("~~");
            return text + (node !== content && /^(DIV|P)$/.test(node.tagName) ? "\n" : "");
        }
        function loadEditor(source) {
            content.replaceChildren();
            savedSelection = null;
            const blocks = contentBlocks(source);
            blocks.forEach((block, index) => {
                if (index &&
                    !block.kind &&
                    !block.code &&
                    !blocks[index - 1].kind &&
                    !blocks[index - 1].code)
                    content.append(document.createTextNode("\n"));
                if (block.code)
                    content.append(codeBlock(block.text, block.language, true));
                else if (block.kind)
                    content.append(callout(block.kind, block.text, true));
                else
                    appendMarkdown(content, block.text);
            });
        }
        function selectionRange() {
            const current = window.getSelection();
            if (current?.rangeCount &&
                content.contains(current.getRangeAt(0).commonAncestorContainer))
                return current.getRangeAt(0).cloneRange();
            if (savedSelection && content.contains(savedSelection.commonAncestorContainer))
                return savedSelection.cloneRange();
            const range = document.createRange();
            range.selectNodeContents(content);
            range.collapse(false);
            return range;
        }
        function marksAt(range) {
            const marks = {};
            let start = range.startContainer;
            if (!range.collapsed && start instanceof HTMLElement) {
                const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
                let fallback = null;
                for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                    if (!range.intersectsNode(text))
                        continue;
                    const from = text === range.startContainer ? range.startOffset : 0;
                    const to = text === range.endContainer
                        ? range.endOffset
                        : (text.textContent?.length ?? 0);
                    const selected = (text.textContent ?? "").slice(from, to);
                    if (selected && !fallback)
                        fallback = text;
                    if (selected.replace(/\u200b/g, "")) {
                        start = text;
                        break;
                    }
                }
                if (start === range.startContainer && fallback)
                    start = fallback;
            }
            let node = start instanceof HTMLElement ? start : start.parentElement;
            while (node && node !== content) {
                if (/^(B|STRONG)$/.test(node.tagName))
                    marks.bold = true;
                if (/^(I|EM)$/.test(node.tagName))
                    marks.italic = true;
                if (node.tagName === "U")
                    marks.underline = true;
                if (node.dataset.textColour && !marks.colour)
                    marks.colour = node.dataset.textColour;
                if (node.dataset.textOpacity && !marks.opacity)
                    marks.opacity = node.dataset.textOpacity;
                if (node.tagName === "A" && !marks.link)
                    marks.link = safeLink(node.getAttribute("href") ?? "") ?? undefined;
                node = node.parentElement;
            }
            return marks;
        }
        function focusRange(range) {
            content.focus();
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            savedSelection = range.cloneRange();
            updateInlineButtons();
        }
        function splitTail(range, scope = content) {
            const tail = document.createRange();
            tail.setStart(range.startContainer, range.startOffset);
            tail.setEnd(scope, scope.childNodes.length);
            return tail.extractContents();
        }
        function placeFormatted(fragment, marks, range) {
            const common = range.commonAncestorContainer instanceof HTMLElement
                ? range.commonAncestorContainer
                : range.commonAncestorContainer.parentElement;
            const paragraph = common?.closest("[data-callout-body] p");
            const scope = paragraph ?? common?.closest("[data-callout-body]") ?? content;
            const tail = splitTail(range, scope);
            // Extracting a whole formatted selection may include its wrappers.
            // Reapply each inherited mark once, avoiding nested Markdown markers
            // and multiplied opacity when another tool formats that selection.
            for (const [enabled, selector] of [
                [marks.bold, "b,strong"],
                [marks.italic, "i,em"],
                [marks.underline, "u"],
                [marks.link, "a"],
            ]) {
                if (enabled)
                    for (const node of fragment.querySelectorAll(selector))
                        node.replaceWith(...node.childNodes);
            }
            for (const node of fragment.querySelectorAll("[data-text-opacity]")) {
                if (node.dataset.textOpacity === marks.opacity) {
                    delete node.dataset.textOpacity;
                    node.style.removeProperty("opacity");
                }
            }
            const empty = !fragment.textContent && !fragment.querySelector("img");
            const anchor = document.createTextNode("\u200b");
            if (empty)
                fragment.append(anchor);
            const wrapper = document.createElement("span");
            let parent = wrapper;
            for (const [enabled, tag] of [
                [marks.bold, "strong"],
                [marks.italic, "em"],
                [marks.underline, "u"],
            ]) {
                if (enabled) {
                    const node = document.createElement(tag);
                    parent.append(node);
                    parent = node;
                }
            }
            if (marks.link) {
                const link = document.createElement("a");
                link.href = marks.link;
                link.rel = "noopener noreferrer";
                parent.append(link);
                parent = link;
            }
            styleText(wrapper, [marks.colour, marks.opacity ? `opacity:${marks.opacity}` : ""]
                .filter(Boolean)
                .join(";"));
            parent.append(fragment);
            scope.append(wrapper, tail);
            const selected = document.createRange();
            if (empty) {
                selected.setStart(anchor, 1);
                selected.collapse(true);
            }
            else
                selected.selectNodeContents(wrapper);
            focusRange(selected);
            renderContent(preview, editorSource());
        }
        function insertNewLine() {
            const range = selectionRange();
            range.deleteContents();
            const tail = splitTail(range);
            const anchor = document.createTextNode("\u200b");
            content.append(document.createTextNode("\n"), anchor, tail);
            const caret = document.createRange();
            caret.setStart(anchor, 1);
            caret.collapse(true);
            focusRange(caret);
            renderContent(preview, editorSource());
        }
        function updateInlineButtons() {
            const marks = savedSelection && content.contains(savedSelection.commonAncestorContainer)
                ? marksAt(savedSelection)
                : {};
            for (const button of form.querySelectorAll("[data-inline-format]")) {
                button.setAttribute("aria-pressed", String(!!marks[button.dataset.inlineFormat]));
            }
        }
        function toggleInline(kind) {
            const range = selectionRange();
            const marks = marksAt(range);
            marks[kind] = !marks[kind];
            const fragment = range.extractContents();
            const selector = kind === "bold" ? "b,strong" : kind === "italic" ? "i,em" : "u";
            for (const node of fragment.querySelectorAll(selector))
                node.replaceWith(...node.childNodes);
            placeFormatted(fragment, marks, range);
        }
        const toolbar = form.querySelector(".changelog-format-toolbar");
        const formatPanels = Array.from(form.querySelectorAll("[data-format-panel]"));
        const formatButtons = Array.from(form.querySelectorAll("[data-format-popup]"));
        function showFormatPreview(kind) {
            form.querySelector(".changelog-format-live-preview").hidden =
                kind === "markdown" || kind === "code";
            for (const sample of form.querySelectorAll("[data-preview-kind]")) {
                sample.hidden = sample.dataset.previewKind !== kind;
            }
        }
        function closeFormatPanels() {
            for (const panel of formatPanels)
                panel.hidden = true;
            for (const button of formatButtons)
                button.setAttribute("aria-expanded", "false");
            revealPresets(false);
        }
        function positionFormatPanel() {
            const button = formatButtons.find((button) => button.getAttribute("aria-expanded") === "true");
            const panel = formatPanels.find((panel) => !panel.hidden);
            if (!button || !panel)
                return;
            panel.style.left = `${Math.max(0, Math.min(button.offsetLeft, toolbar.clientWidth - panel.offsetWidth))}px`;
            panel.style.top = `${toolbar.clientHeight + 6}px`;
        }
        for (const button of formatButtons) {
            button.addEventListener("click", () => {
                const show = button.getAttribute("aria-expanded") !== "true";
                closeFormatPanels();
                if (!show)
                    return;
                const panel = formatPanels.find((panel) => panel.dataset.formatPanel === button.dataset.formatPopup);
                panel.hidden = false;
                showFormatPreview(button.dataset.formatPopup);
                button.setAttribute("aria-expanded", "true");
                if (button.dataset.formatPopup === "link") {
                    linkText.value = selectionRange()
                        .toString()
                        .replace(/\u200b/g, "");
                    updateLinkPreview();
                }
                if (button.dataset.formatPopup === "code") {
                    const range = selectionRange();
                    const start = range.startContainer instanceof HTMLElement
                        ? range.startContainer
                        : range.startContainer.parentElement;
                    const existing = start?.closest("[data-code-block]");
                    codeText.value =
                        existing?.querySelector("code")?.textContent ??
                            range.toString().replace(/\u200b/g, "");
                    codeLanguage.value = existing?.dataset.language ?? "";
                    if (existing) {
                        range.selectNode(existing);
                        savedSelection = range.cloneRange();
                        window.getSelection()?.removeAllRanges();
                    }
                    codeError.textContent = "";
                    updateCodePreview();
                }
                if (button.dataset.formatPopup === "markdown") {
                    blockMessage.value = selectionRange()
                        .toString()
                        .replace(/\u200b/g, "");
                    updateBlockPreview();
                }
                positionFormatPanel();
            }, { signal });
        }
        window.addEventListener("resize", positionFormatPanel, { signal });
        document.addEventListener("pointerdown", (event) => {
            if (event.target instanceof Node && !toolbar.contains(event.target))
                closeFormatPanels();
        }, { signal });
        toolbar.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                const trigger = formatButtons.find((button) => button.getAttribute("aria-expanded") === "true");
                closeFormatPanels();
                trigger?.focus();
            }
        }, { signal });
        for (const button of form.querySelectorAll("[data-inline-format]")) {
            button.addEventListener("pointerdown", (event) => event.preventDefault(), { signal });
            button.addEventListener("click", () => toggleInline(button.dataset.inlineFormat), { signal });
        }
        content.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                ["b", "i", "u"].includes(event.key.toLowerCase())) {
                event.preventDefault();
                toggleInline({ b: "bold", i: "italic", u: "underline" }[event.key.toLowerCase()]);
            }
        }, { signal });
        function safeLink(value) {
            try {
                const url = new URL(value.trim());
                return ["https:", "http:"].includes(url.protocol) && !/[\s()]/.test(value.trim())
                    ? url.href
                    : null;
            }
            catch {
                return null;
            }
        }
        const linkText = form.querySelector("[data-link-text]");
        const linkUrl = form.querySelector("[data-link-url]");
        const linkPreview = form.querySelector("[data-link-preview]");
        const linkError = form.querySelector("[data-link-error]");
        function updateLinkPreview() {
            linkPreview.textContent = linkText.value.trim() || "This is how the text will look.";
            const url = safeLink(linkUrl.value);
            if (url)
                linkPreview.href = url;
            else
                linkPreview.removeAttribute("href");
            linkPreview.rel = "noopener noreferrer";
            linkError.textContent =
                linkUrl.value && !url ? "Use a complete http:// or https:// link." : "";
        }
        linkText.addEventListener("input", updateLinkPreview, { signal });
        linkUrl.addEventListener("input", updateLinkPreview, { signal });
        form.querySelector("[data-apply-link]").addEventListener("click", () => {
            const url = safeLink(linkUrl.value);
            if (!url || !linkText.value.trim()) {
                linkError.textContent = "Enter a message and a valid http:// or https:// link.";
                return;
            }
            const range = selectionRange();
            const marks = marksAt(range);
            range.deleteContents();
            const fragment = document.createDocumentFragment();
            fragment.append(document.createTextNode(linkText.value.trim()));
            placeFormatted(fragment, { ...marks, link: url }, range);
            closeFormatPanels();
        }, { signal });
        let blockKind = "note";
        const blockMessage = form.querySelector("[data-block-message]");
        const blockPreview = form.querySelector("[data-block-preview]");
        function updateBlockPreview() {
            blockPreview.replaceChildren(callout(blockKind, blockMessage.value || "This is how the text will look."));
        }
        for (const button of form.querySelectorAll("[data-callout-kind]")) {
            button.addEventListener("click", () => {
                blockKind = button.dataset.calloutKind;
                for (const option of form.querySelectorAll("[data-callout-kind]"))
                    option.setAttribute("aria-pressed", String(option === button));
                updateBlockPreview();
            }, { signal });
        }
        blockMessage.addEventListener("input", updateBlockPreview, { signal });
        form.querySelector("[data-apply-block]").addEventListener("click", () => {
            if (!blockMessage.value.trim()) {
                blockMessage.focus();
                return;
            }
            insertStandaloneBlock(callout(blockKind, blockMessage.value.trim(), true));
        }, { signal });
        function insertStandaloneBlock(node) {
            const range = selectionRange();
            range.deleteContents();
            const tail = splitTail(range);
            for (const child of Array.from(content.childNodes)) {
                const blank = !(child.textContent ?? "").replace(/\u200b/g, "");
                if (blank &&
                    (child.nodeType === Node.TEXT_NODE ||
                        (child instanceof HTMLElement &&
                            child.matches("span,b,strong,i,em,u") &&
                            !child.querySelector("img"))))
                    child.remove();
            }
            const anchor = document.createTextNode("\u200b");
            content.append(node, anchor, tail);
            const caret = document.createRange();
            caret.setStart(anchor, 1);
            caret.collapse(true);
            focusRange(caret);
            renderContent(preview, editorSource());
            closeFormatPanels();
        }
        const codeText = form.querySelector("[data-code-text]");
        const codeLanguage = form.querySelector("[data-code-language]");
        const codePreview = form.querySelector("[data-code-preview]");
        const codeError = form.querySelector("[data-code-error]");
        function updateCodePreview() {
            codePreview.textContent = codeText.value || "This is how the code will look.";
        }
        codeText.addEventListener("input", updateCodePreview, { signal });
        codeText.addEventListener("keydown", (event) => {
            if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                codeText.setRangeText("\t", codeText.selectionStart, codeText.selectionEnd, "end");
                updateCodePreview();
            }
        }, { signal });
        form.querySelector("[data-apply-code]").addEventListener("click", () => {
            const language = codeLanguage.value.trim();
            if (!/^[A-Za-z0-9_+#.-]{0,32}$/.test(language)) {
                codeError.textContent =
                    "Use a language name such as python, javascript or c++.";
                return;
            }
            if (!codeText.value.trim()) {
                codeText.focus();
                return;
            }
            insertStandaloneBlock(codeBlock(codeText.value.replace(/\r\n?/g, "\n"), language, true));
        }, { signal });
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
                content.contains(selection.getRangeAt(0).commonAncestorContainer)) {
                savedSelection = selection.getRangeAt(0).cloneRange();
                updateInlineButtons();
            }
        }, { signal });
        content.addEventListener("paste", (event) => {
            event.preventDefault();
            const lines = (event.clipboardData?.getData("text/plain") ?? "")
                .replace(/\r\n?/g, "\n")
                .split("\n");
            lines.forEach((line, index) => {
                if (index)
                    insertNewLine();
                insertEditor(document.createTextNode(line));
            });
        }, { signal });
        let deletionMarks = null;
        content.addEventListener("beforeinput", (event) => {
            deletionMarks = event.inputType.startsWith("delete")
                ? marksAt(selectionRange())
                : null;
            if (event.inputType === "insertParagraph" ||
                event.inputType === "insertLineBreak") {
                event.preventDefault();
                insertNewLine();
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
            closeFormatPanels();
            showFormatPreview("default");
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
            if (!deleting && (!editorSource().trim() || editorSource().length > 8000)) {
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
            const marks = marksAt(range);
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
            marks[kind] = value;
            placeFormatted(fragment, marks, range);
            error.textContent = "";
            closeFormatPanels();
        }
        form.querySelector("[data-apply-text-colour]").addEventListener("click", () => {
            applyTextStyle("colour", form.querySelector("input[data-text-colour]").value);
        }, { signal });
        const opacity = form.querySelector("[data-opacity-input]");
        const opacityLabel = form.querySelector("[data-opacity-value]");
        function updateOpacity() {
            opacityLabel.value = `${opacity.value}%`;
            form.querySelector("[data-opacity-preview]").style.opacity = String(Number(opacity.value) / 100);
            opacity.style.setProperty("--opacity-fill", `${((Number(opacity.value) - 10) / 90) * 100}%`);
        }
        opacity.addEventListener("input", updateOpacity, { signal });
        form.querySelector("[data-apply-opacity]").addEventListener("click", () => {
            applyTextStyle("opacity", opacity.value);
        }, { signal });
        content.addEventListener("input", () => {
            const range = selectionRange();
            if (deletionMarks && range.collapsed) {
                const current = marksAt(range);
                const lostMark = Object.keys(deletionMarks).some((key) => !!deletionMarks?.[key] && !current[key]);
                // Browsers can remove an empty formatting element while retaining
                // an invisible native typing style. Restore an explicit caret run
                // so the toolbar and the next typed character agree.
                if (lostMark)
                    placeFormatted(document.createDocumentFragment(), { ...current, ...deletionMarks }, range);
            }
            deletionMarks = null;
            savedSelection = selectionRange();
            updateInlineButtons();
            renderContent(preview, editorSource());
        }, { signal });
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
