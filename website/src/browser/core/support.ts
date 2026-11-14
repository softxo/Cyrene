type SupportStatus = "open" | "solved" | "closed";
type SupportList = "home" | "staff" | "inbox";
type SupportView = SupportList | "thread";

interface SupportSummary {
    id: number;
    topic: string;
    status: SupportStatus;
    author: string;
    preview: string;
    updated_at: string;
    last_from_staff: boolean;
    last_author: string;
    last_body: string;
    last_avatar: string | null;
    unread: boolean;
}

type SupportState = "open" | "done";

interface SupportOverview {
    signed_in: boolean;
    staff: boolean;
    unread: number;
    waiting: number;
    tickets: SupportSummary[];
    waiting_tickets: SupportSummary[];
    version: number;
}

const STATUS_LABELS: Record<SupportStatus, string> = {
    open: "Open",
    solved: "Solved",
    closed: "Closed",
};
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NOTIFIED_KEY = "cyrene-support-notified";

function clockTime(iso: string): string {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
}

function readNotified(): Record<string, string> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "{}");
        return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
        return {};
    }
}

function writeNotified(value: Record<string, string>): void {
    try {
        const entries = Object.entries(value).slice(-100);
        localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
        return;
    }
}

interface SupportMessage {
    id: number;
    from_staff: boolean;
    author: string;
    avatar: string | null;
    badges: string[];
    body: string;
    images: string[];
    created_at: string;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imageStrip(sources: string[], link: boolean): HTMLElement {
    const strip = document.createElement("div");
    strip.className = "support-images";
    for (const source of sources) {
        const image = document.createElement("img");
        image.src = source;
        image.alt = "Attached image";
        image.loading = "lazy";
        if (link) {
            const anchor = document.createElement("a");
            anchor.href = source;
            anchor.target = "_blank";
            anchor.rel = "noopener";
            anchor.append(image);
            strip.append(anchor);
        } else {
            strip.append(image);
        }
    }
    return strip;
}

function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            resolve(result.slice(result.indexOf(",") + 1));
        });
        reader.addEventListener("error", () => reject(new Error("That image couldn't be read.")));
        reader.readAsDataURL(file);
    });
}

const BADGES = new Set(["staff", "special", "premium"]);
const MEDIA_HOSTS = ["discordapp.com", "discordapp.net", "tenor.com", "giphy.com", "klipy.com"];
const TOKEN_PATTERN =
    /<(a?):(\w{2,32}):(\d{17,20})>|<@!?(\d{15,20})>|<@&(support)>|(https?:\/\/[^\s<>"]+)/g;
const ROLE_TOKEN = "<@&support>";
type People = Record<string, string>;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)*$/u;

function mediaElement(url: URL): HTMLElement | null {
    const host = url.hostname.toLowerCase();
    if (!MEDIA_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
        return null;
    }
    const extension = url.pathname.split(".").pop()?.toLowerCase() ?? "";
    if (["mp4", "webm"].includes(extension)) {
        const video = document.createElement("video");
        video.className = "support-media";
        video.src = url.href;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        return video;
    }
    if (["gif", "png", "jpg", "jpeg", "webp"].includes(extension)) {
        const image = document.createElement("img");
        image.className = "support-media";
        image.src = url.href;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        return image;
    }
    return null;
}

function renderBody(target: HTMLElement, text: string, people: People = {}): void {
    const nodes: Node[] = [];
    let emojiOnly = true;
    let emojiCount = 0;
    let last = 0;
    for (const match of text.matchAll(TOKEN_PATTERN)) {
        const before = text.slice(last, match.index);
        nodes.push(document.createTextNode(before));
        if (!EMOJI_ONLY.test(before)) emojiOnly = false;
        last = match.index + match[0].length;
        if (match[3]) {
            const emoji = document.createElement("img");
            emoji.className = "support-emoji";
            emoji.src = `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? "gif" : "webp"}?size=96`;
            emoji.alt = `:${match[2]}:`;
            emoji.title = `:${match[2]}:`;
            emoji.referrerPolicy = "no-referrer";
            nodes.push(emoji);
            emojiCount += 1;
            continue;
        }
        emojiOnly = false;
        if (match[4] || match[5]) {
            const mention = document.createElement("span");
            mention.className = "support-mention";
            mention.dataset.role = String(Boolean(match[5]));
            mention.textContent = match[5]
                ? "@Cyrene Support"
                : `@${people[match[4]] ?? "someone"}`;
            nodes.push(mention);
            continue;
        }
        const raw = match[6].replace(/[).,!?]+$/, "");
        last -= match[6].length - raw.length;
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            nodes.push(document.createTextNode(raw));
            continue;
        }
        const media = mediaElement(url);
        if (media) {
            nodes.push(media);
            continue;
        }
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = raw;
        nodes.push(link);
    }
    const rest = text.slice(last);
    nodes.push(document.createTextNode(rest));
    if (!EMOJI_ONLY.test(rest)) emojiOnly = false;
    const unicodeEmoji = (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    target.classList.toggle(
        "support-message-jumbo",
        emojiOnly && emojiCount + unicodeEmoji > 0 && emojiCount + unicodeEmoji <= 12,
    );
    target.replaceChildren(...nodes);
}

function parsePeople(source: string | undefined): People {
    try {
        const parsed: unknown = JSON.parse(source ?? "{}");
        return parsed && typeof parsed === "object" ? (parsed as People) : {};
    } catch {
        return {};
    }
}

export function renderSupportTranscripts(root: ParentNode = document): void {
    for (const element of root.querySelectorAll<HTMLElement>("[data-support-render]")) {
        const people = parsePeople(
            element.closest<HTMLElement>("[data-support-people]")?.dataset.supportPeople,
        );
        renderBody(element, element.dataset.supportRender ?? "", people);
        delete element.dataset.supportRender;
    }
}

function stateChip(ticket: SupportSummary, staffView: boolean): HTMLElement {
    const [state, label] =
        ticket.status !== "open"
            ? [ticket.status, STATUS_LABELS[ticket.status]]
            : ticket.last_from_staff
              ? staffView
                  ? ["replied", "Replied"]
                  : ticket.unread
                    ? ["new", "New reply"]
                    : ["replied", "Replied"]
              : staffView
                ? ["new", "Needs reply"]
                : ["waiting", "Waiting for staff"];
    const chip = document.createElement("span");
    chip.className = "support-status";
    chip.dataset.status = state;
    chip.textContent = label;
    return chip;
}

function avatarElement(avatar: string | null, name: string): HTMLElement {
    if (avatar) {
        const image = document.createElement("img");
        image.className = "support-avatar";
        image.src = avatar;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        return image;
    }
    const initial = document.createElement("span");
    initial.className = "support-avatar";
    initial.setAttribute("aria-hidden", "true");
    initial.textContent = (name.trim()[0] ?? "?").toUpperCase();
    return initial;
}

function badgeElement(badge: string): HTMLElement {
    const bubble = document.createElement("span");
    bubble.className = "discord-account-type";
    const label = document.createElement("b");
    label.className = `discord-account-${badge}`;
    label.textContent = badge[0].toUpperCase() + badge.slice(1);
    bubble.append(label);
    return bubble;
}

interface SupportConversation {
    id: number;
    topic: string;
    status: SupportStatus;
    locked: boolean;
    author: string;
    owner: boolean;
    updated_at: string;
    version: number;
    people: People;
    messages: SupportMessage[];
}

interface Mentionable {
    id: string;
    name: string;
    avatar: string | null;
    staff: boolean;
    role?: boolean;
}

const RETRY_DELAY_MS = 3000;
const SUMMARY_POLL_MS = 120000;

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
const MAX_LENGTH = 2000;

async function supportRequest<T>(
    path: string,
    options: { method?: string; body?: unknown; background?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
    const headers: Record<string, string> = { "X-Cyrene-Background": "1" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: "same-origin",
        cache: "no-store",
        signal: options.signal,
    });
    if (!response.ok) {
        let detail = "Something went wrong. Please try again.";
        try {
            const data: unknown = await response.json();
            if (
                data &&
                typeof data === "object" &&
                "detail" in data &&
                typeof data.detail === "string"
            ) {
                detail = data.detail;
            }
        } catch {
            detail = `Something went wrong (${response.status}). Please try again.`;
        }
        throw new Error(detail);
    }
    return (await response.json()) as T;
}

function relativeTime(iso: string): string {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto", style: "short" });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
    ];
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    }
    return "just now";
}

function showError(error: unknown): void {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    window.showCyreneToast?.(message, "error");
}

export function initialiseSupport(): void {
    const panel = document.querySelector<HTMLDialogElement>("[data-support-panel]");
    const openers = document.querySelectorAll<HTMLButtonElement>("[data-support-open]");
    const dot = document.querySelector<HTMLElement>("[data-support-dot]");
    if (!panel || !openers.length) return;

    const find = <T extends Element>(selector: string): T => {
        const element = panel.querySelector<T>(selector);
        if (!element) throw new Error(`Support panel is missing ${selector}`);
        return element;
    };
    const dialog: HTMLDialogElement = panel;
    const scroller = find<HTMLElement>(".support-body");
    const staffTab = find<HTMLButtonElement>("[data-support-staff-tab]");
    const waitingBadge = find<HTMLElement>("[data-support-waiting]");
    const staffList = find<HTMLUListElement>("[data-support-staff]");
    const staffEmpty = find<HTMLElement>("[data-support-staff-empty]");
    const note = find<HTMLElement>("[data-support-note]");
    const recent = find<HTMLUListElement>("[data-support-recent]");
    const recentEmpty = find<HTMLElement>("[data-support-recent-empty]");
    const inbox = find<HTMLUListElement>("[data-support-inbox]");
    const inboxEmpty = find<HTMLElement>("[data-support-inbox-empty]");
    const threadHeader = find<HTMLElement>("[data-support-thread-header]");
    const threadTitle = find<HTMLElement>("[data-support-thread-title]");
    const threadStatus = find<HTMLElement>("[data-support-thread-status]");
    const threadMeta = find<HTMLElement>("[data-support-thread-meta]");
    const statusButton = find<HTMLButtonElement>("[data-support-status]");
    const solveButton = find<HTMLButtonElement>("[data-support-solve]");
    const states = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-support-state]"));
    let staffState: SupportState = "open";
    const messages = find<HTMLOListElement>("[data-support-messages]");
    const composer = find<HTMLFormElement>("[data-support-composer]");
    const text = find<HTMLTextAreaElement>("[data-support-text]");
    const chars = find<HTMLElement>("[data-support-chars]");
    const send = find<HTMLButtonElement>("[data-support-send]");
    const topics = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-support-topic]"));
    const views = Array.from(panel.querySelectorAll<HTMLElement>("[data-support-view]"));
    const tabButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-support-tab]"));
    let view: SupportView = "home";
    let listView: SupportList = "home";
    let topic: string | null = null;
    let threadId: number | null = null;
    let thread: SupportConversation | null = null;
    let sending = false;
    let watcher: { id: number; controller: AbortController } | null = null;
    let knownVersion = 0;
    let overviewVersion = 0;
    const attachList = find<HTMLUListElement>("[data-support-attachments]");
    const fileInput = find<HTMLInputElement>("[data-support-file]");
    let attached: { file: File; preview: string }[] = [];

    function renderAttachments(): void {
        attachList.hidden = attached.length === 0;
        attachList.replaceChildren(
            ...attached.map((entry) => {
                const item = document.createElement("li");
                const image = document.createElement("img");
                image.src = entry.preview;
                image.alt = entry.file.name;
                const remove = document.createElement("button");
                remove.type = "button";
                remove.setAttribute("aria-label", `Remove ${entry.file.name}`);
                const cross = document.createElement("span");
                cross.className = "cyrene-close";
                cross.setAttribute("aria-hidden", "true");
                remove.append(cross);
                remove.addEventListener("click", () => {
                    URL.revokeObjectURL(entry.preview);
                    attached = attached.filter((other) => other !== entry);
                    renderAttachments();
                });
                item.append(image, remove);
                return item;
            }),
        );
    }

    function addFiles(files: Iterable<File>): void {
        for (const file of files) {
            if (!IMAGE_TYPES.has(file.type)) {
                window.showCyreneToast?.("Images must be PNG, JPEG, GIF or WebP.", "warning");
                continue;
            }
            if (file.size > MAX_IMAGE_BYTES) {
                window.showCyreneToast?.(`${file.name} is over 8 MB.`, "warning");
                continue;
            }
            if (attached.length >= MAX_IMAGES) {
                window.showCyreneToast?.(`You can attach up to ${MAX_IMAGES} images.`, "warning");
                break;
            }
            attached.push({ file, preview: URL.createObjectURL(file) });
        }
        renderAttachments();
    }

    const mentionList = find<HTMLUListElement>("[data-support-mentions]");
    let people: Mentionable[] = [];
    let peopleKey: string | null = null;
    let chosen: Mentionable[] = [];
    let matches: Mentionable[] = [];
    let activeMatch = 0;

    async function loadPeople(): Promise<void> {
        const key = view === "thread" && threadId !== null ? String(threadId) : "new";
        if (peopleKey === key) return;
        peopleKey = key;
        const path = key === "new" ? "/api/support/people" : `/api/support/tickets/${key}/people`;
        try {
            people = (await supportRequest<{ people: Mentionable[] }>(path)).people;
        } catch {
            peopleKey = null;
            people = [];
        }
    }

    function mentionQuery(): { start: number; query: string } | null {
        const before = text.value.slice(0, text.selectionStart ?? text.value.length);
        const match = /(^|\s)@([^\s@]{0,32})$/.exec(before);
        if (!match) return null;
        return { start: before.length - match[2].length - 1, query: match[2].toLowerCase() };
    }

    function hideMentions(): void {
        mentionList.hidden = true;
        matches = [];
    }

    function renderMentions(): void {
        mentionList.replaceChildren(
            ...matches.map((person, index) => {
                const item = document.createElement("li");
                item.setAttribute("role", "option");
                item.setAttribute("aria-selected", String(index === activeMatch));
                const button = document.createElement("button");
                button.type = "button";
                button.tabIndex = -1;
                if (person.role) {
                    const icon = document.createElement("span");
                    icon.className = "support-avatar support-mention-role";
                    icon.textContent = "@";
                    button.append(icon);
                } else {
                    button.append(avatarElement(person.avatar, person.name));
                }
                const name = document.createElement("span");
                name.textContent = person.name;
                button.append(name);
                if (person.role || person.staff) {
                    const tag = document.createElement("small");
                    tag.textContent = person.role ? "Role" : "Staff";
                    button.append(tag);
                }
                button.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                    chooseMention(person);
                });
                item.append(button);
                return item;
            }),
        );
        mentionList.hidden = matches.length === 0;
    }

    async function updateMentions(): Promise<void> {
        const query = mentionQuery();
        if (!query) {
            hideMentions();
            return;
        }
        await loadPeople();
        const found = people.filter((person) => person.name.toLowerCase().includes(query.query));
        found.sort(
            (a, b) =>
                Number(!a.name.toLowerCase().startsWith(query.query)) -
                Number(!b.name.toLowerCase().startsWith(query.query)),
        );
        matches = found.slice(0, 6);
        activeMatch = 0;
        renderMentions();
    }

    function chooseMention(person: Mentionable): void {
        const query = mentionQuery();
        if (!query) return;
        const caret = text.selectionStart ?? text.value.length;
        const inserted = `@${person.name} `;
        text.value = text.value.slice(0, query.start) + inserted + text.value.slice(caret);
        const position = query.start + inserted.length;
        text.setSelectionRange(position, position);
        if (!chosen.some((other) => other.id === person.id)) chosen.push(person);
        hideMentions();
        updateChars();
        text.focus();
    }

    function withMentionTokens(body: string): { body: string; names: People } {
        const names: People = {};
        let result = body;
        for (const person of [...chosen].sort((a, b) => b.name.length - a.name.length)) {
            const visible = `@${person.name}`;
            if (!result.includes(visible)) continue;
            result = result.split(visible).join(person.role ? ROLE_TOKEN : `<@${person.id}>`);
            if (!person.role) names[person.id] = person.name;
        }
        return { body: result, names };
    }

    function markSeen(conversation: SupportConversation): void {
        const seen = readNotified();
        seen[`reply:${conversation.id}`] = conversation.updated_at;
        seen[`staff:${conversation.id}`] = conversation.updated_at;
        writeNotified(seen);
    }

    async function watchOverview(): Promise<void> {
        while (true) {
            try {
                const data = await supportRequest<{ version: number }>(
                    `/api/support/updates?version=${overviewVersion}`,
                );
                if (data.version !== overviewVersion) await loadOverview(true);
            } catch {
                await delay(RETRY_DELAY_MS * 2);
            }
        }
    }

    function stopThreadPolling(): void {
        watcher?.controller.abort();
        watcher = null;
    }

    async function watchThread(id: number): Promise<void> {
        if (watcher?.id === id) return;
        stopThreadPolling();
        const controller = new AbortController();
        watcher = { id, controller };
        while (!controller.signal.aborted && threadId === id && dialog.open) {
            try {
                const data = await supportRequest<{ version: number }>(
                    `/api/support/tickets/${id}/wait?version=${knownVersion}`,
                    { signal: controller.signal },
                );
                if (controller.signal.aborted || threadId !== id) return;
                if (data.version === knownVersion) continue;
                const before = knownVersion;
                await openThread(id, true);
                if (knownVersion === before) await delay(RETRY_DELAY_MS);
            } catch {
                if (controller.signal.aborted) return;
                await delay(RETRY_DELAY_MS);
            }
        }
        if (watcher?.controller === controller) watcher = null;
    }

    function pendingMessage(body: string, previews: string[], names: People): HTMLLIElement {
        const item = document.createElement("li");
        item.className = "support-message";
        item.dataset.mine = "true";
        item.dataset.grouped = "true";
        item.dataset.pending = "true";
        const content = document.createElement("div");
        content.className = "support-message-content";
        if (body) {
            const bubble = document.createElement("div");
            bubble.className = "support-message-body";
            renderBody(bubble, body, names);
            content.append(bubble);
        }
        if (previews.length) content.append(imageStrip(previews, false));
        const state = document.createElement("span");
        state.className = "support-message-state";
        state.textContent = "Sending…";
        content.append(state);
        item.append(avatarElement(null, ""), content);
        return item;
    }

    function setView(next: SupportView): void {
        view = next;
        if (next !== "thread") {
            listView = next;
            threadId = null;
            thread = null;
            stopThreadPolling();
        }
        for (const section of views) section.hidden = section.dataset.supportView !== next;
        threadHeader.hidden = next !== "thread";
        for (const button of tabButtons) {
            button.classList.toggle("active", button.dataset.supportTab === listView);
        }
        composer.hidden = next === "inbox" || next === "staff";
        text.placeholder =
            next === "thread"
                ? "Write a reply…"
                : "What happened, any Error ID you were shown, and what you've already tried…";
    }

    function renderList(
        list: HTMLUListElement,
        empty: HTMLElement,
        tickets: SupportSummary[],
        staffView: boolean,
    ): void {
        list.replaceChildren(
            ...tickets.map((ticket) => {
                const item = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "support-item";
                button.dataset.unread = String(!staffView && ticket.unread);
                const top = document.createElement("span");
                top.className = "support-item-top";
                const preview = document.createElement("strong");
                preview.textContent = ticket.preview;
                const time = document.createElement("span");
                time.className = "support-item-time";
                time.textContent = relativeTime(ticket.updated_at);
                top.append(preview, time);
                const context = document.createElement("span");
                context.className = "support-item-context";
                context.textContent = [
                    ticket.topic,
                    `#${ticket.id}`,
                    staffView ? `from ${ticket.author}` : "",
                ]
                    .filter(Boolean)
                    .join(" · ");
                const latest = document.createElement("span");
                latest.className = "support-item-latest";
                const latestText = document.createElement("span");
                latestText.className = "support-item-latest-text";
                const sender = document.createElement("b");
                sender.textContent =
                    !staffView && !ticket.last_from_staff ? "You" : ticket.last_author;
                latestText.append(sender);
                if (ticket.last_from_staff) {
                    const tag = document.createElement("span");
                    tag.className = "support-item-staff";
                    tag.textContent = "Staff";
                    latestText.append(tag);
                }
                latestText.append(`: ${ticket.last_body}`);
                latest.append(
                    avatarElement(ticket.last_avatar, ticket.last_author),
                    latestText,
                    stateChip(ticket, staffView),
                );
                button.append(top, context, latest);
                button.addEventListener("click", () => void openThread(ticket.id));
                item.append(button);
                return item;
            }),
        );
        empty.hidden = tickets.length > 0;
    }

    async function loadOverview(background = false): Promise<void> {
        const overview = await supportRequest<SupportOverview>("/api/support", { background });
        overviewVersion = overview.version;
        const staffWaiting = overview.staff ? overview.waiting : 0;
        if (dot) dot.hidden = !(overview.unread > 0 || staffWaiting > 0);
        staffTab.hidden = !overview.staff;
        if (!overview.staff && listView === "staff") setView("home");
        waitingBadge.hidden = staffWaiting === 0;
        waitingBadge.textContent = String(staffWaiting);
        note.textContent = overview.signed_in
            ? "The team sees your Discord name with your messages. Replies show up here and stay with your account."
            : "You're not signed in, so replies only show up in this browser. Connect Discord to see them anywhere.";
        renderList(recent, recentEmpty, overview.tickets, false);
        notify(overview);
    }

    function notificationStack(): HTMLElement {
        let stack = document.querySelector<HTMLElement>("[data-support-notifications]");
        if (!stack) {
            stack = document.createElement("div");
            stack.className = "support-notifications";
            stack.dataset.supportNotifications = "";
            stack.setAttribute("popover", "manual");
            stack.setAttribute("aria-live", "polite");
            stack.setAttribute("aria-label", "Support notifications");
            document.body.append(stack);
        }
        return stack;
    }

    function showNotification(ticket: SupportSummary, staffAlert: boolean): void {
        const stack = notificationStack();
        const card = document.createElement("div");
        card.className = "support-notification";
        card.dataset.staffAlert = String(staffAlert);
        const name = staffAlert ? ticket.author : ticket.last_author;
        const content = document.createElement("div");
        content.className = "support-notification-content";
        const title = document.createElement("strong");
        title.textContent = staffAlert ? `New message from ${name}` : `${name} replied`;
        const topicLine = document.createElement("span");
        topicLine.className = "support-notification-topic";
        topicLine.textContent = `${ticket.topic} · #${ticket.id}`;
        const preview = document.createElement("p");
        preview.textContent = ticket.last_body;
        const actions = document.createElement("div");
        actions.className = "support-notification-actions";
        const view = document.createElement("button");
        view.type = "button";
        view.className = "cyrene-button cyrene-button--compact";
        view.textContent = "View";
        const dismissButton = document.createElement("button");
        dismissButton.type = "button";
        dismissButton.className = "cyrene-button cyrene-button--icon support-notification-close";
        dismissButton.setAttribute("aria-label", "Dismiss notification");
        const cross = document.createElement("span");
        cross.className = "cyrene-close";
        cross.setAttribute("aria-hidden", "true");
        dismissButton.append(cross);
        actions.append(view);
        content.append(title, topicLine, preview, actions);
        card.append(avatarElement(ticket.last_avatar, name), content, dismissButton);

        let timeout = 0;
        const dismiss = () => {
            window.clearTimeout(timeout);
            card.dataset.leaving = "true";
            window.setTimeout(() => {
                card.remove();
                if (!stack.childElementCount && stack.matches(":popover-open")) stack.hidePopover();
            }, 200);
        };
        const schedule = () => {
            window.clearTimeout(timeout);
            timeout = window.setTimeout(dismiss, 12000);
        };
        view.addEventListener("click", () => {
            dismiss();
            if (!dialog.open) dialog.showModal();
            void openThread(ticket.id);
        });
        dismissButton.addEventListener("click", dismiss);
        card.addEventListener("pointerenter", () => window.clearTimeout(timeout));
        card.addEventListener("pointerleave", schedule);

        while (stack.childElementCount >= 3) stack.firstElementChild?.remove();
        stack.append(card);
        if (stack.matches(":popover-open")) stack.hidePopover();
        stack.showPopover();
        schedule();
    }

    function notify(overview: SupportOverview): void {
        const seen = readNotified();
        let changed = false;
        const candidates: [SupportSummary, boolean][] = [
            ...overview.tickets
                .filter((ticket) => ticket.unread && ticket.last_from_staff)
                .map((ticket): [SupportSummary, boolean] => [ticket, false]),
            ...overview.waiting_tickets.map((ticket): [SupportSummary, boolean] => [ticket, true]),
        ];
        for (const [ticket, staffAlert] of candidates) {
            const key = `${staffAlert ? "staff" : "reply"}:${ticket.id}`;
            if (seen[key] === ticket.updated_at) continue;
            seen[key] = ticket.updated_at;
            changed = true;
            if (dialog.open && threadId === ticket.id) continue;
            showNotification(ticket, staffAlert);
        }
        if (changed) writeNotified(seen);
    }

    async function loadStaff(): Promise<void> {
        const data = await supportRequest<{ tickets: SupportSummary[] }>(
            `/api/support/staff?state=${staffState}`,
            { background: true },
        );
        renderList(staffList, staffEmpty, data.tickets, true);
    }

    function loadList(list: SupportList): Promise<void> {
        if (list === "inbox") return loadInbox();
        if (list === "staff") return loadStaff();
        return loadOverview();
    }

    async function loadInbox(): Promise<void> {
        const data = await supportRequest<{ tickets: SupportSummary[] }>("/api/support/inbox", {
            background: true,
        });
        renderList(inbox, inboxEmpty, data.tickets, false);
    }

    function renderThread(conversation: SupportConversation): void {
        const signature = (value: SupportConversation) =>
            JSON.stringify([value.id, value.status, value.locked, value.messages]);
        const previous = thread ? signature(thread) : "";
        const grew =
            !thread ||
            thread.id !== conversation.id ||
            thread.messages.length !== conversation.messages.length;
        thread = conversation;
        threadTitle.textContent = conversation.topic;
        threadStatus.dataset.status = conversation.status;
        threadStatus.textContent = STATUS_LABELS[conversation.status];
        const from = conversation.owner ? "" : ` · from ${conversation.author}`;
        threadMeta.textContent = `#${conversation.id}${from}`;
        solveButton.hidden = conversation.status !== "open";
        statusButton.hidden = conversation.status !== "open";
        composer.hidden =
            conversation.status !== "open" || (conversation.locked && conversation.owner);
        if (previous === signature(conversation)) return;
        const items: HTMLLIElement[] = [];
        let previousMessage: SupportMessage | null = null;
        for (const message of conversation.messages) {
            const created = new Date(message.created_at);
            const previousDate = previousMessage ? new Date(previousMessage.created_at) : null;
            const newDay = !previousDate || previousDate.toDateString() !== created.toDateString();
            if (newDay) {
                const day = document.createElement("li");
                day.className = "support-day";
                day.textContent = dayLabel(created);
                items.push(day);
            }
            const grouped =
                !newDay &&
                previousMessage !== null &&
                previousMessage.author === message.author &&
                previousMessage.from_staff === message.from_staff &&
                created.getTime() - new Date(previousMessage.created_at).getTime() <
                    GROUP_WINDOW_MS;
            const item = document.createElement("li");
            item.className = "support-message";
            item.dataset.mine = String(
                conversation.owner ? !message.from_staff : message.from_staff,
            );
            item.dataset.staff = String(message.from_staff);
            item.dataset.grouped = String(grouped);
            const content = document.createElement("div");
            content.className = "support-message-content";
            if (!grouped) {
                const meta = document.createElement("span");
                meta.className = "support-message-meta";
                const author = document.createElement("strong");
                author.textContent = message.author;
                const time = document.createElement("time");
                time.dateTime = message.created_at;
                time.textContent = clockTime(message.created_at);
                meta.append(
                    author,
                    ...message.badges.filter((badge) => BADGES.has(badge)).map(badgeElement),
                    time,
                );
                content.append(meta);
            }
            if (message.body) {
                const body = document.createElement("div");
                body.className = "support-message-body";
                body.title = clockTime(message.created_at);
                renderBody(body, message.body, conversation.people);
                content.append(body);
            }
            if (message.images.length) content.append(imageStrip(message.images, true));
            item.append(avatarElement(message.avatar, message.author), content);
            items.push(item);
            previousMessage = message;
        }
        if (conversation.status !== "open" || conversation.locked) {
            const notice = document.createElement("li");
            notice.className = "support-notice";
            notice.dataset.status = conversation.status === "open" ? "locked" : conversation.status;
            notice.textContent =
                conversation.status === "solved"
                    ? "Marked as solved. If you need more help, start a new conversation."
                    : conversation.status === "closed"
                      ? "This conversation is closed. If you need more help, start a new conversation."
                      : conversation.owner
                        ? "Staff have locked this conversation, so only they can reply."
                        : "Locked: only staff can reply.";
            items.push(notice);
        }
        messages.replaceChildren(...items);
        if (grew) scroller.scrollTop = scroller.scrollHeight;
    }

    async function openThread(id: number, background = false): Promise<void> {
        try {
            const conversation = await supportRequest<SupportConversation>(
                `/api/support/tickets/${id}`,
                { background },
            );
            if (background && threadId !== id) return;
            threadId = id;
            if (!background) {
                listView = !conversation.owner
                    ? "staff"
                    : conversation.status === "open"
                      ? "home"
                      : "inbox";
            }
            setView("thread");
            renderThread(conversation);
            knownVersion = conversation.version;
            if (dialog.open) {
                markSeen(conversation);
                void loadOverview(true).catch(() => undefined);
            }
            void watchThread(id);
        } catch (error) {
            if (!background) showError(error);
        }
    }

    function updateChars(): void {
        chars.textContent = `${text.value.length} / ${MAX_LENGTH}`;
    }

    async function submit(): Promise<void> {
        if (sending) return;
        const body = text.value.trim();
        if (!body && !attached.length) {
            text.focus();
            return;
        }
        if (view === "home" && !topic) {
            window.showCyreneToast?.("Choose what your message is about first.", "warning");
            topics[0]?.focus();
            return;
        }
        sending = true;
        send.disabled = true;
        const sentFiles = attached;
        const restore = () => {
            if (!attached.length) {
                attached = sentFiles;
                renderAttachments();
            }
            if (!text.value) {
                text.value = body;
                updateChars();
            }
        };
        const tokens = withMentionTokens(body);
        try {
            const images = await Promise.all(sentFiles.map((entry) => readAsBase64(entry.file)));
            attached = [];
            renderAttachments();
            text.value = "";
            updateChars();
            hideMentions();
            if (view === "thread" && threadId !== null) {
                const id = threadId;
                const pending = pendingMessage(
                    tokens.body,
                    sentFiles.map((entry) => entry.preview),
                    tokens.names,
                );
                messages.append(pending);
                scroller.scrollTop = scroller.scrollHeight;
                try {
                    await supportRequest(`/api/support/tickets/${id}/messages`, {
                        method: "POST",
                        body: { body: tokens.body, images },
                    });
                } catch (error) {
                    pending.dataset.failed = "true";
                    const state = pending.querySelector(".support-message-state");
                    if (state) state.textContent = "Not sent";
                    restore();
                    throw error;
                }
                await openThread(id, true);
            } else {
                try {
                    const created = await supportRequest<{ id: number }>("/api/support/tickets", {
                        method: "POST",
                        body: { topic, body: tokens.body, images },
                    });
                    setTopic(null);
                    await openThread(created.id);
                    window.showCyreneToast?.("Sent. The team will reply here.");
                } catch (error) {
                    restore();
                    throw error;
                }
            }
            for (const entry of sentFiles) URL.revokeObjectURL(entry.preview);
            chosen = [];
        } catch (error) {
            showError(error);
        } finally {
            sending = false;
            send.disabled = false;
        }
    }

    function setTopic(next: string | null): void {
        topic = next;
        for (const button of topics) {
            button.setAttribute("aria-checked", String(button.dataset.supportTopic === next));
        }
    }

    for (const button of topics) {
        button.addEventListener("click", () => setTopic(button.dataset.supportTopic ?? null));
    }

    for (const button of tabButtons) {
        button.addEventListener("click", () => {
            const tab = button.dataset.supportTab;
            const next: SupportList = tab === "inbox" || tab === "staff" ? tab : "home";
            setView(next);
            void loadList(next).catch(showError);
        });
    }

    for (const button of states) {
        button.addEventListener("click", () => {
            staffState = button.dataset.supportState === "done" ? "done" : "open";
            for (const other of states) {
                other.setAttribute("aria-pressed", String(other === button));
            }
            void loadStaff().catch(showError);
        });
    }

    find<HTMLButtonElement>("[data-support-back]").addEventListener("click", () => {
        setView(listView);
        void loadList(listView).catch(showError);
    });

    async function changeStatus(next: SupportStatus): Promise<void> {
        if (!thread) return;
        const id = thread.id;
        statusButton.disabled = true;
        solveButton.disabled = true;
        try {
            await supportRequest(`/api/support/tickets/${id}/status`, {
                method: "POST",
                body: { status: next },
            });
            await openThread(id, true);
            if (next === "solved") window.showCyreneToast?.("Marked as solved.");
        } catch (error) {
            showError(error);
        } finally {
            statusButton.disabled = false;
            solveButton.disabled = false;
        }
    }

    statusButton.addEventListener("click", () => {
        if (thread?.status === "open") void changeStatus("closed");
    });
    solveButton.addEventListener("click", () => void changeStatus("solved"));

    composer.addEventListener("submit", (event) => {
        event.preventDefault();
        void submit();
    });
    text.addEventListener("input", () => {
        updateChars();
        void updateMentions();
    });
    text.addEventListener("click", () => void updateMentions());
    text.addEventListener("blur", hideMentions);
    find<HTMLButtonElement>("[data-support-attach]").addEventListener("click", () =>
        fileInput.click(),
    );
    fileInput.addEventListener("change", () => {
        addFiles(Array.from(fileInput.files ?? []));
        fileInput.value = "";
    });
    text.addEventListener("paste", (event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
            file.type.startsWith("image/"),
        );
        if (!images.length) return;
        event.preventDefault();
        addFiles(images);
    });
    text.addEventListener("keydown", (event) => {
        if (!mentionList.hidden && matches.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                activeMatch = (activeMatch + step + matches.length) % matches.length;
                renderMentions();
                return;
            }
            if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
                event.preventDefault();
                chooseMention(matches[activeMatch]);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                hideMentions();
                return;
            }
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void submit();
        }
    });

    for (const opener of openers) {
        opener.addEventListener("click", () => {
            if (!panel.open) panel.showModal();
            const refresh =
                view === "thread" && threadId !== null ? openThread(threadId) : loadList(listView);
            void refresh.catch(showError);
            if (view !== "home") void loadOverview(true).catch(() => undefined);
        });
    }

    find<HTMLButtonElement>("[data-support-close]").addEventListener("click", () => panel.close());
    find<HTMLAnchorElement>("[data-support-close-link]").addEventListener("click", () =>
        panel.close(),
    );
    const outsidePanel = (event: MouseEvent) => {
        const bounds = panel.getBoundingClientRect();
        return (
            event.target === panel &&
            (event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom)
        );
    };
    let pressedOutside = false;
    panel.addEventListener("pointerdown", (event) => {
        pressedOutside = outsidePanel(event);
    });
    panel.addEventListener("click", (event) => {
        if (pressedOutside && outsidePanel(event)) panel.close();
        pressedOutside = false;
    });
    panel.addEventListener("close", () => {
        stopThreadPolling();
        void loadOverview(true).catch(() => undefined);
    });

    setView("home");
    updateChars();
    window.setTimeout(() => {
        void loadOverview(true)
            .catch(() => undefined)
            .finally(() => void watchOverview());
    }, 1500);
    window.setInterval(() => {
        if (!document.hidden) void loadOverview(true).catch(() => undefined);
    }, SUMMARY_POLL_MS);
}
