interface Window {
    initJourneyMap?: () => void;
}

(() => {
    const STORAGE_KEY = "cyrene-journey-map-tab";

    function savedTab(): string | null {
        try {
            return sessionStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function rememberTab(name: string): void {
        try {
            sessionStorage.setItem(STORAGE_KEY, name);
        } catch {
            return;
        }
    }

    async function refreshPage(page: HTMLElement): Promise<void> {
        const response = await fetch(window.location.href, { headers: { Accept: "text/html" } });

        if (!response.ok) throw new Error(`Refresh failed (${response.status}).`);

        const fresh = new DOMParser().parseFromString(await response.text(), "text/html");
        const swap = (selector: string, inner = false): void => {
            const target = page.querySelector<HTMLElement>(selector);
            const source = fresh.querySelector<HTMLElement>(selector);

            if (!target || !source) return;

            if (inner) target.innerHTML = source.innerHTML;
            else target.replaceWith(document.importNode(source, true));
        };

        for (const selector of [".jm-banner", ".jm-tiles", ".jm-switches"]) {
            const target = page.querySelector(`[data-jm-panel="map"] ${selector}`);
            const source = fresh.querySelector(`[data-jm-panel="map"] ${selector}`);

            if (target && source) target.replaceWith(document.importNode(source, true));
        }

        for (const selector of [".jm-banner", ".jm-coverage", ".jm-switches"]) {
            const target = page.querySelector(`[data-jm-panel="beacons"] ${selector}`);
            const source = fresh.querySelector(`[data-jm-panel="beacons"] ${selector}`);

            if (target && source) target.replaceWith(document.importNode(source, true));
        }

        swap(".jm-legend");
        const incoming = Array.from(fresh.querySelectorAll<HTMLElement>("details.jm-category"));
        page.querySelectorAll<HTMLElement>("details.jm-category").forEach((category, index) => {
            const next = incoming[index];

            if (!next) return;

            for (const selector of ["summary", ".jm-items"]) {
                const target = category.querySelector(selector);
                const source = next.querySelector(selector);

                if (target && source) target.replaceWith(document.importNode(source, true));
            }
        });
    }

    function setupItemDetails(page: HTMLElement): void {
        let active: HTMLElement | null = null;

        function close(): void {
            active?.hidePopover();
            active = null;
        }

        function show(item: HTMLElement): void {
            const card = item.querySelector<HTMLElement>(".jm-item-details");

            if (!card || card === active) return;

            close();
            active = card;
            card.showPopover();
            position(item, card);
        }

        function position(item: HTMLElement, card: HTMLElement): void {
            const bounds = item.getBoundingClientRect();
            const width = card.offsetWidth;
            const height = card.offsetHeight;
            const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
            const below = bounds.bottom + 8;
            const top =
                below + height <= window.innerHeight - 12
                    ? below
                    : Math.max(12, bounds.top - height - 8);
            card.style.left = `${left}px`;
            card.style.top = `${top}px`;
        }

        for (const name of ["pointerover", "focusin"]) {
            page.addEventListener(name, (event) => {
                const target = event.target;

                if (!(target instanceof Element)) return;

                const item = target.closest<HTMLElement>(".jm-items > li[data-item-id]");

                if (item) show(item);
            });
        }

        for (const name of ["pointerout", "focusout"]) {
            page.addEventListener(name, (event) => {
                if (!(event instanceof MouseEvent || event instanceof FocusEvent)) return;

                const target = event.target;

                if (!(target instanceof Element)) return;

                const item = target.closest(".jm-items > li[data-item-id]");

                if (
                    item &&
                    event.relatedTarget instanceof Node &&
                    item.contains(event.relatedTarget)
                )
                    return;

                if (item) close();
            });
        }

        page.addEventListener("click", close);
        page.addEventListener("keydown", (event) => {
            if (event.key === "Escape") close();
        });
        window.addEventListener("resize", close);
        document.addEventListener(
            "scroll",
            (event) => {
                if (!(event.target instanceof Node) || !active?.contains(event.target)) close();
            },
            true,
        );
    }

    function setupVersions(page: HTMLElement): void {
        const dialog = page.querySelector<HTMLDialogElement>("[data-jm-versions]");
        const form = page.querySelector<HTMLFormElement>("[data-jm-versions-form]");
        const error = page.querySelector<HTMLElement>("[data-jm-versions-error]");
        const cancel = page.querySelector<HTMLButtonElement>("[data-jm-versions-cancel]");

        if (!dialog || !form || !error || !cancel) return;

        const fields = Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"));
        const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button"));

        page.addEventListener("click", (event) => {
            const target = event.target;

            if (!(target instanceof Element) || !target.closest("[data-jm-versions-open]")) return;

            for (const field of fields) field.value = field.defaultValue;

            error.hidden = true;
            dialog.showModal();
        });

        cancel.addEventListener("click", () => dialog.close());

        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) dialog.close();
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            const body = Object.fromEntries(
                fields.map((field) => [field.name, field.value.trim()]),
            );

            if (Object.values(body).some((value) => value === "")) {
                error.textContent = "Fill in every version.";
                error.hidden = false;

                return;
            }

            for (const button of buttons) button.disabled = true;

            error.hidden = true;
            void (async () => {
                try {
                    const response = await fetch("/api/journey-map/versions", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });

                    if (!response.ok) {
                        error.textContent = `Could not save (${response.status}).`;
                        error.hidden = false;

                        return;
                    }

                    for (const field of fields)
                        field.defaultValue = body[field.name] ?? field.value;

                    dialog.close();

                    try {
                        await refreshPage(page);
                    } catch {
                        window.location.reload();
                    }
                } catch {
                    error.textContent = "Could not reach the server.";
                    error.hidden = false;
                } finally {
                    for (const button of buttons) button.disabled = false;
                }
            })();
        });
    }

    function setupEditableList(container: HTMLElement, kind: "todos" | "limits"): void {
        const page = container.querySelector<HTMLElement>(`[data-jm-list="${kind}"]`);

        if (!page) return;

        const noun = kind === "todos" ? "to-do" : "limit";
        const label = kind === "todos" ? "To-do" : "Limit";
        const dialog = page.querySelector<HTMLDialogElement>("[data-jm-todo-dialog]");
        const form = page.querySelector<HTMLFormElement>("[data-jm-todo-form]");
        const list = page.querySelector<HTMLUListElement>(".jm-todo");
        const empty = page.querySelector<HTMLElement>(".jm-todo-empty");
        const error = page.querySelector<HTMLElement>("[data-jm-todo-error]");
        const listError = page.querySelector<HTMLElement>("[data-jm-todo-list-error]");
        const confirmation = page.querySelector<HTMLDialogElement>("[data-jm-todo-confirm]");
        const deleteError = page.querySelector<HTMLElement>("[data-jm-todo-delete-error]");
        const title = form?.querySelector<HTMLInputElement>('[name="title"]');
        const detail = form?.querySelector<HTMLTextAreaElement>('[name="detail"]');
        const heading = form?.querySelector<HTMLElement>(`#jm-${kind}-title`);
        const save = form?.querySelector<HTMLButtonElement>("[data-jm-todo-save]");
        const remove = form?.querySelector<HTMLButtonElement>("[data-jm-todo-delete]");

        if (
            !dialog ||
            !form ||
            !list ||
            !empty ||
            !error ||
            !listError ||
            !confirmation ||
            !deleteError ||
            !title ||
            !detail ||
            !heading ||
            !save ||
            !remove
        )
            return;

        type Task = { id: string; title: string; detail: string; done: boolean };
        let current: HTMLLIElement | null = null;
        let busy = false;
        const read = (row: HTMLLIElement): Task => ({
            id: row.dataset.todoId ?? "",
            title: row.querySelector("strong")?.textContent ?? "",
            detail: row.querySelector("[data-jm-notes]")?.textContent ?? "",
            done: row.classList.contains("is-done"),
        });
        const showError = (element: HTMLElement, message: string): void => {
            element.textContent = message;
            element.hidden = false;
        };
        const render = (task: Task, row = document.createElement("li")): void => {
            row.dataset.todoId = task.id;
            row.classList.toggle("is-done", task.done);
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = task.done;
            checkbox.dataset.jmTodoDone = "";
            checkbox.setAttribute("aria-label", `Complete ${task.title}`);
            const content = document.createElement("button");
            content.type = "button";
            content.className = "jm-todo-content";
            content.dataset.jmTodoEdit = "";
            content.setAttribute("aria-label", `Edit ${task.title}`);
            const label = document.createElement("strong");
            label.textContent = task.title;
            content.append(label);

            if (task.detail) {
                const notes = document.createElement("span");
                notes.dataset.jmNotes = "";
                notes.textContent = task.detail;
                content.append(notes);
            }

            row.replaceChildren(...(kind === "todos" ? [checkbox, content] : [content]));

            if (!row.isConnected) list.append(row);

            empty.hidden = list.children.length > 0;
        };
        const request = async (url: string, method: string, body?: object): Promise<Response> => {
            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok)
                throw new Error(
                    `Could not save the ${noun} (${response.status}). Please try again.`,
                );

            return response;
        };
        const lock = (value: boolean): void => {
            busy = value;

            for (const control of page.querySelectorAll<
                HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement
            >(
                ".jm-tasks button, .jm-tasks input, [data-jm-todo-dialog] button, [data-jm-todo-dialog] input, [data-jm-todo-dialog] textarea, [data-jm-todo-confirm] button",
            ))
                control.disabled = value;
        };
        const message = (cause: unknown): string =>
            cause instanceof Error
                ? cause.message
                : "Could not reach the server. Please try again.";
        const notify = (text: string): void => window.showCyreneToast?.(text);
        const close = (): void => {
            if (!busy) dialog.close();
        };

        for (const button of form.querySelectorAll("[data-jm-todo-cancel]"))
            button.addEventListener("click", close);

        for (const modal of [dialog, confirmation]) {
            modal.addEventListener("cancel", (event) => {
                if (busy) event.preventDefault();
            });
            modal.addEventListener("click", (event) => {
                const bounds = modal.getBoundingClientRect();

                if (
                    !busy &&
                    event.target === modal &&
                    (event.clientX < bounds.left ||
                        event.clientX > bounds.right ||
                        event.clientY < bounds.top ||
                        event.clientY > bounds.bottom)
                )
                    modal.close();
            });
        }

        page.addEventListener("click", (event) => {
            if (!(event.target instanceof Element) || busy) return;

            const add = event.target.closest("[data-jm-todo-add]");
            const edit = event.target.closest("[data-jm-todo-edit]");

            if (!add && !edit) return;

            current = edit?.closest<HTMLLIElement>("li[data-todo-id]") ?? null;
            const task = current ? read(current) : null;
            form.reset();
            title.value = task?.title ?? "";
            detail.value = task?.detail ?? "";
            heading.textContent = `${task ? "Edit" : "Add"} ${noun}`;
            save.textContent = task ? "Save changes" : `Add ${noun}`;
            remove.hidden = !task;
            error.hidden = true;
            dialog.showModal();
            title.focus();
        });
        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (busy) return;

            const trimmed = title.value.trim();

            if (!trimmed) {
                showError(error, `Give your ${noun} a title.`);
                title.focus();

                return;
            }

            const row = current;
            const body = {
                title: trimmed,
                detail: detail.value.trim(),
                done: row ? read(row).done : false,
            };
            error.hidden = true;
            lock(true);
            void (async () => {
                try {
                    const response = await request(
                        `/api/journey-map/lists/${kind}${row ? `/${read(row).id}` : ""}`,
                        row ? "PUT" : "POST",
                        body,
                    );
                    render((await response.json()) as Task, row ?? undefined);
                    dialog.close();
                    notify(row ? `${label} updated.` : `${label} added.`);
                } catch (cause) {
                    showError(error, message(cause));
                } finally {
                    lock(false);
                }
            })();
        });
        list.addEventListener("change", (event) => {
            const checkbox = event.target;

            if (!(checkbox instanceof HTMLInputElement) || busy) return;

            const row = checkbox.closest<HTMLLIElement>("li[data-todo-id]");

            if (!row) return;

            const task = read(row);
            listError.hidden = true;
            lock(true);
            void (async () => {
                try {
                    await request(`/api/journey-map/lists/${kind}/${task.id}`, "PUT", {
                        ...task,
                        done: checkbox.checked,
                    });
                    row.classList.toggle("is-done", checkbox.checked);
                    notify(checkbox.checked ? "To-do completed." : "To-do reopened.");
                } catch (cause) {
                    checkbox.checked = task.done;
                    showError(listError, message(cause));
                    window.showCyreneToast?.(message(cause), "error");
                } finally {
                    lock(false);
                }
            })();
        });
        remove.addEventListener("click", () => {
            deleteError.hidden = true;
            confirmation.showModal();
        });
        page.querySelector("[data-jm-todo-keep]")?.addEventListener("click", () => {
            if (!busy) confirmation.close();
        });
        page.querySelector("[data-jm-todo-remove]")?.addEventListener("click", () => {
            if (!current || busy) return;

            const row = current;
            deleteError.hidden = true;
            lock(true);
            void (async () => {
                try {
                    await request(`/api/journey-map/lists/${kind}/${read(row).id}`, "DELETE");
                    row.remove();
                    empty.hidden = list.children.length > 0;
                    confirmation.close();
                    dialog.close();
                    notify(`${label} deleted.`);
                } catch (cause) {
                    showError(deleteError, message(cause));
                } finally {
                    lock(false);
                }
            })();
        });
    }

    function setupCollapsing(page: HTMLElement): void {
        const categories = Array.from(
            page.querySelectorAll<HTMLDetailsElement>("details[data-jm-category]"),
        );
        let pending: Promise<void> = Promise.resolve();
        const closed = (): string[] =>
            categories
                .filter((category) => !category.open)
                .map((category) => category.dataset.jmCategory ?? "");
        let saved = JSON.stringify(closed());

        function save(): void {
            const tabs = closed();
            const snapshot = JSON.stringify(tabs);

            if (snapshot === saved) return;

            saved = snapshot;
            pending = pending
                .then(async () => {
                    const response = await fetch("/api/journey-map/collapsed", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ tabs }),
                    });

                    if (!response.ok)
                        console.error(`Could not save the collapsed tabs (${response.status}).`);
                })
                .catch((error: unknown) => {
                    console.error("Could not save the collapsed tabs.", error);
                });
        }

        for (const category of categories) category.addEventListener("toggle", save);
    }

    function setupEditor(page: HTMLElement): void {
        const dialog = page.querySelector<HTMLDialogElement>("[data-jm-editor]");
        const form = page.querySelector<HTMLFormElement>("[data-jm-editor-form]");

        if (!dialog || !form) return;

        const icon = form.querySelector<HTMLImageElement>("[data-jm-editor-icon]");
        const name = form.querySelector<HTMLElement>("[data-jm-editor-name]");
        const details = form.querySelector<HTMLElement>("[data-jm-editor-details]");
        const error = form.querySelector<HTMLElement>("[data-jm-editor-error]");
        const reset = form.querySelector<HTMLButtonElement>("[data-jm-editor-reset]");
        const cancel = form.querySelector<HTMLButtonElement>("[data-jm-editor-cancel]");
        const radios = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="state"]'));
        const working = form.querySelector<HTMLInputElement>('input[name="working"]');
        const testedOn = form.querySelector<HTMLInputElement>('input[name="tested_on"]');
        const checks = Array.from(form.querySelectorAll<HTMLElement>(".jm-check-options"));
        const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button"));

        if (!icon || !name || !details || !error || !reset || !cancel || !working || !testedOn)
            return;

        let current: HTMLElement | null = null;
        const showError = (message: string): void => {
            error.textContent = message;
            error.hidden = false;
        };
        const open = (item: HTMLElement): void => {
            current = item;
            const image = item.querySelector<HTMLImageElement>("img");
            icon.src = image?.src ?? "";
            name.textContent = item.querySelector("span")?.textContent ?? "";

            for (const radio of radios) radio.checked = radio.value === item.dataset.itemState;

            const saved = item.dataset.checks;
            working.checked = saved !== undefined;
            testedOn.value = item.dataset.testedOn ?? "";
            checks.forEach((box, index) => {
                const savedValue = saved?.[index];
                const value = savedValue === "1" || savedValue === "-" ? savedValue : "0";
                box.querySelectorAll<HTMLButtonElement>(".jm-check-choice").forEach((choice) => {
                    choice.setAttribute("aria-pressed", String(choice.dataset.value === value));
                });
            });
            details.hidden = !working.checked;
            error.hidden = true;
            dialog.showModal();
        };
        const send = async (request: () => Promise<Response>): Promise<void> => {
            for (const button of buttons) button.disabled = true;

            error.hidden = true;

            try {
                const response = await request();

                if (!response.ok) {
                    showError(`Could not save (${response.status}).`);

                    return;
                }

                dialog.close();

                try {
                    await refreshPage(page);
                } catch {
                    window.location.reload();
                }
            } catch {
                showError("Could not reach the server.");
            } finally {
                for (const button of buttons) button.disabled = false;
            }
        };

        page.addEventListener("click", (event) => {
            const target = event.target;

            if (!(target instanceof Element)) return;

            const item = target.closest<HTMLElement>(".jm-items li[data-item-id]");

            if (item) open(item);
        });

        working.addEventListener("change", () => {
            details.hidden = !working.checked;
        });

        checks.forEach((group) => {
            group.addEventListener("click", (event) => {
                const target = event.target;

                if (!(target instanceof Element)) return;

                const choice = target.closest<HTMLButtonElement>(".jm-check-choice");

                if (!choice) return;

                group.querySelectorAll<HTMLButtonElement>(".jm-check-choice").forEach((option) => {
                    option.setAttribute("aria-pressed", String(option === choice));
                });
            });
        });

        cancel.addEventListener("click", () => dialog.close());

        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) dialog.close();
        });

        reset.addEventListener("click", () => {
            if (!current) return;

            const id = current.dataset.itemId;
            void send(() => fetch(`/api/journey-map/items/${id}`, { method: "DELETE" }));
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!current) return;

            const id = current.dataset.itemId;
            const chosen = radios.find((radio) => radio.checked)?.value ?? null;
            const unchanged =
                chosen === current.dataset.itemState && current.dataset.itemManual === undefined;
            const body = {
                state: unchanged ? null : chosen,
                working: working.checked
                    ? {
                          tested_on: testedOn.value.trim(),
                          checks: checks.map((group) => {
                              const value = group.querySelector<HTMLButtonElement>(
                                  '.jm-check-choice[aria-pressed="true"]',
                              )?.dataset.value;

                              return value === "-" ? null : value === "1";
                          }),
                      }
                    : null,
            };
            void send(() =>
                fetch(`/api/journey-map/items/${id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                }),
            );
        });
    }

    function initJourneyMap(): void {
        const page = document.querySelector<HTMLElement>("[data-jm-page]");

        if (!page || page.dataset.jmReady === "true") return;

        page.dataset.jmReady = "true";

        const tabs = Array.from(page.querySelectorAll<HTMLButtonElement>("[data-jm-tab]"));
        const panels = Array.from(page.querySelectorAll<HTMLElement>("[data-jm-panel]"));

        function select(name: string, focus = false): void {
            for (const tab of tabs) {
                const active = tab.dataset.jmTab === name;
                tab.setAttribute("aria-selected", String(active));
                tab.tabIndex = active ? 0 : -1;

                if (active && focus) tab.focus();
            }

            for (const panel of panels) {
                panel.hidden = panel.dataset.jmPanel !== name;
            }

            rememberTab(name);
        }

        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => select(tab.dataset.jmTab ?? "map"));
            tab.addEventListener("keydown", (event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : -1;
                const next = tabs[(index + step + tabs.length) % tabs.length];
                select(next.dataset.jmTab ?? "map", true);
            });
        });

        setupItemDetails(page);
        setupEditor(page);
        setupVersions(page);
        setupCollapsing(page);
        setupEditableList(page, "todos");
        setupEditableList(page, "limits");

        const remembered = savedTab();
        select(tabs.find((tab) => tab.dataset.jmTab === remembered)?.dataset.jmTab ?? "map");
    }

    window.initJourneyMap = initJourneyMap;
})();
